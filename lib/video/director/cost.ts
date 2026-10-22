/**
 * Costo del director de edición: estimación por etapa, tope por video y degradación ordenada.
 *
 * Etapas: mapa (Opus mira las hojas), dirección (Opus con razonamiento), segunda mirada (crítico con visión + corrección,
 * hasta 2 vueltas) y revisión final (crítico con visión sobre el MP4). Si la estimación se pasa de lo que queda del
 * tope, se degrada en este orden (de lo que menos se nota a lo que más):
 *   1. revisión final con Sonnet → 2. una sola vuelta de segunda mirada → 3. la mitad de los cuadros en el mapa →
 *   4. crítico con Sonnet → 5. mapa con Sonnet → 6. sin revisión final con IA (solo verificaciones) →
 *   7. sin segunda mirada con IA (solo verificaciones y arreglos seguros) → 8. dirección con menos razonamiento →
 *   9. dirección con Sonnet.
 * La dirección siempre corre: es lo que más importa. Sin nada de servidor (lo usan el servicio, la revisión y las pruebas).
 */
import { MODELS, type ModelKey } from "@/lib/ai/models";
import { costOf, imageTokens } from "@/lib/ai/pricing";
import { BUDGET } from "./types";

export type Effort = "low" | "medium" | "high";
export type StagePlan = { model: ModelKey; effort: Effort | null };

export type BudgetPlan = {
  map: StagePlan & { sheets: "all" | "half" };
  director: StagePlan;
  critic: (StagePlan & { rounds: number }) | null;
  final: StagePlan | null;
  degraded: string[];
  estimate: { map: number; director: number; round: number; final: number; total: number };
};

/** Lo que se sabe del video antes de llamar a la IA. */
export type CostInput = {
  words: number;
  sheets: number;
  /** Tamaño de una hoja de contacto (px). */
  sheet: { width: number; height: number };
  /** Cuántos b-roll como mucho (cada gráfico es salida larga). */
  broll: number;
};

const OUT_MULT: Record<Effort, number> = { low: 1.3, medium: 2, high: 3 };

/** Tokens de las reglas en caché (reglas + motion + marca), aproximados. */
const RULES = { map: 2500, director: 9000, critic: 2500 } as const;
const BRAND = 2500;

export function estimateStage(stage: "map" | "director" | "round" | "final", plan: StagePlan, input: CostInput, opts: { sheets?: number } = {}): number {
  const model = MODELS[plan.model];
  const mult = plan.effort ? OUT_MULT[plan.effort] : 1;
  const img = imageTokens(input.sheet.width, input.sheet.height);
  const words = input.words;
  // El contexto en caché se escribe la primera vez (1 h) y se lee en las siguientes: se cuenta como escritura.
  switch (stage) {
    case "map": {
      const sheets = opts.sheets ?? input.sheets;
      return costOf(model, { input: words * 9 + 600 + sheets * img, output: Math.round((1500 + words * 1.2) * mult), cacheRead: 0, cacheWrite: RULES.map + BRAND });
    }
    case "director":
      return costOf(model, { input: words * 12 + 3000, output: Math.round((1800 + words * 0.9 + input.broll * 380) * mult), cacheRead: 0, cacheWrite: RULES.director + BRAND });
    case "round": {
      // Crítico (2 o 3 hojas de cuadros clave) + la corrección del director.
      const critic = costOf(model, { input: 3500 + words * 2 + 3 * img, output: Math.round(1200 * mult), cacheRead: 0, cacheWrite: RULES.critic });
      return critic;
    }
    case "final":
      return costOf(model, { input: 3000 + words * 2 + 2 * img, output: Math.round(1000 * mult), cacheRead: 0, cacheWrite: RULES.critic });
  }
}

/** Una corrección del director (después de la crítica o por "Edítalo así"). */
export function estimateRevise(plan: StagePlan, input: CostInput): number {
  return estimateStage("director", plan, input) * 1.1;
}

export function clampBudget(usd: number | null | undefined): number {
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0) return BUDGET.default;
  return Math.round(Math.max(BUDGET.min, Math.min(BUDGET.max, n)) * 100) / 100;
}

/** Plan de costo para el análisis completo dentro de lo que queda del tope. */
export function planBudget(input: CostInput & { capUsd: number; spentUsd: number }): BudgetPlan {
  const remaining = Math.max(0, input.capUsd - input.spentUsd);
  const plan: BudgetPlan = {
    map: { model: "deep", effort: "medium", sheets: "all" },
    director: { model: "deep", effort: "high" },
    critic: { model: "deep", effort: "medium", rounds: 2 },
    final: { model: "deep", effort: "low" },
    degraded: [],
    estimate: { map: 0, director: 0, round: 0, final: 0, total: 0 },
  };
  const compute = () => {
    const mapSheets = plan.map.sheets === "half" ? Math.ceil(input.sheets / 2) : input.sheets;
    const map = input.sheets ? estimateStage("map", plan.map, input, { sheets: mapSheets }) : estimateStage("map", plan.map, input, { sheets: 0 });
    const director = estimateStage("director", plan.director, input);
    const round = plan.critic ? estimateStage("round", plan.critic, input) + estimateRevise(plan.director, input) : 0;
    const final = plan.final ? estimateStage("final", plan.final, input) : 0;
    const total = map + director + round * (plan.critic?.rounds ?? 0) + final;
    plan.estimate = { map: r4(map), director: r4(director), round: r4(round), final: r4(final), total: r4(total) };
    return total;
  };
  const steps: [string, () => void][] = [
    ["La revisión final la hace un modelo más económico.", () => (plan.final = plan.final && { model: "main", effort: null })],
    ["Una sola vuelta de segunda mirada (en lugar de dos).", () => plan.critic && (plan.critic.rounds = 1)],
    ["El mapa del video mira la mitad de los cuadros.", () => (plan.map.sheets = "half")],
    ["La segunda mirada la hace un modelo más económico.", () => plan.critic && (plan.critic = { model: "main", effort: null, rounds: plan.critic.rounds })],
    ["El mapa del video lo arma un modelo más económico.", () => (plan.map = { model: "main", effort: null, sheets: plan.map.sheets })],
    ["Sin revisión final con IA (solo las verificaciones automáticas).", () => (plan.final = null)],
    ["Sin segunda mirada con IA (solo verificaciones y arreglos automáticos).", () => (plan.critic = null)],
    ["La dirección razona menos.", () => (plan.director = { model: "deep", effort: "medium" })],
    ["La dirección la hace un modelo más económico.", () => (plan.director = { model: "main", effort: null })],
  ];
  let total = compute();
  for (const [note, apply] of steps) {
    if (total <= remaining) break;
    apply();
    plan.degraded.push(note);
    total = compute();
  }
  return plan;
}

/** Cuántos cuadros mira el worker según el tope (menos cuadros = menos tokens de imagen). */
export function eyesMaxFrames(capUsd: number): number {
  return capUsd >= 4 ? 240 : capUsd >= 2.5 ? 160 : 90;
}

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
