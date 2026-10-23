/**
 * Lo que pide la persona en "Edítalo así" es obligatorio.
 *
 * En una corrida real, la persona pidió "abre con la Portada de revista y corta las pausas al mínimo" y la segunda
 * mirada lo deshizo ("quité la portada de revista que tapaba el plano de apertura", "pasé el ritmo a normal porque el
 * video educa"). Aquí:
 * - `parseLocks`: del pedido salen los "candados": efectos pedidos, ritmo rápido o tranquilo, densidad y b-roll.
 * - `guardIssues`: el crítico solo puede pedir arreglos técnicos (frase cortada, algo que tapa el producto o la
 *   pantalla, texto encima de texto); los pedidos que revierten un candado se descartan.
 * - `enforceLocks`: después de cada corrección (y al cerrar) se vuelve a poner lo pedido si se perdió.
 *
 * Sin servidor: lo usan el servicio del director y las pruebas.
 */
import { FX_INFO, FX_KINDS, type FxKind } from "../fx/catalog";
import { DENSITY_TARGETS, type Density } from "../rhythm";
import type { EditPlan } from "../types";
import type { CriticIssue } from "./types";

export type RequestLocks = {
  instruction: string;
  /** Efectos que pidió (tienen que quedar). */
  fx: FxKind[];
  pace: "fast" | "calm" | null;
  density: Density | null;
  /** Pidió sin b-roll / sin gráficos. */
  noBroll: boolean;
};

const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Cómo se nombra cada efecto (el nombre de la galería y los apodos), sin confundir los zooms de cámara. */
const FX_NAMES: [RegExp, FxKind][] = [
  [/revista|portada/, "cover_story"],
  [/zoom digital/, "digital_zoom"],
  [/checklist|lista de (tareas|pasos)/, "checklist"],
  [/letras de vidrio|vidrio|cristal/, "glass_type"],
  [/telefono con tareas|iphone/, "iphone"],
  [/grafico que crece/, "chart_grow"],
  [/titulares/, "headline_wall"],
  [/giro 3d/, "orbit"],
  [/pantalla verde/, "green_screen"],
  [/vertigo|dolly/, "vertigo"],
  [/garabato|doodle/, "doodle_boil"],
  [/recorte de papel|papel/, "paper_cut"],
];

export function parseLocks(instruction: string): RequestLocks {
  const t = plain(instruction);
  const fx = new Set<FxKind>();
  const negated = /sin efectos|quita (los |el )?efectos?|saca (los |el )?efectos?/.test(t);
  if (!negated) {
    for (const [re, kind] of FX_NAMES) if (re.test(t)) fx.add(kind);
    for (const k of FX_KINDS) if (t.includes(plain(FX_INFO[k].label))) fx.add(k);
  }
  const fast = /pausas al minimo|corta (las )?pausas|mas dinamic|muy dinamic|mucho mas dinamic|ritmo (alto|rapido)|mas rapido|editor de reels|mas ritmo|agil/.test(t);
  const calm = /mas tranquil|mas lento|con calma|sin apuro|mas pausad/.test(t);
  const density: Density | null = /editor de reels|mucho mas dinamic|muy dinamic/.test(t) ? "reels" : /sobri|minimalista|pocos cambios/.test(t) ? "sobria" : null;
  return { instruction: instruction.trim().slice(0, 600), fx: [...fx], pace: fast && !calm ? "fast" : calm && !fast ? "calm" : null, density, noBroll: /sin b-?roll|sin graficos|sin nada encima/.test(t) };
}

export const hasLocks = (l: RequestLocks | null | undefined): l is RequestLocks => Boolean(l && (l.fx.length || l.pace || l.density || l.noBroll));

/** Texto para el director y el crítico: lo que no se puede deshacer. */
export function locksText(l: RequestLocks | null | undefined): string {
  if (!hasLocks(l)) return "";
  const parts = [
    ...l.fx.map((k) => `el efecto «${FX_INFO[k].label}» (${k}) tiene que quedar`),
    ...(l.pace === "fast" ? ["ritmo rápido: pausas al mínimo (0,3 s) y muletillas fuera; nunca lo bajes"] : l.pace === "calm" ? ["ritmo tranquilo"] : []),
    ...(l.density ? [`densidad «${l.density === "reels" ? "Editor de reels" : l.density === "sobria" ? "Sobria" : "Normal"}»: no la bajes`] : []),
    ...(l.noBroll ? ["sin b-roll ni gráficos"] : []),
  ];
  return `PEDIDO DE LA PERSONA (obligatorio, no se revierte): "${l.instruction}"\n- ${parts.join("\n- ")}`;
}

const SLOWER = /(ritmo|pace|pausas?).{0,40}(normal|calm|tranquil|mas lento|baj|menos rapid|mas largas)|(baja|bajar|reduce|reducir|menos).{0,20}(ritmo|zooms?|cambios|efectos|graficos)|demasiad[oa]s? (zooms?|efectos|cambios|graficos)|sobrecargad|satura/;

/**
 * Lo que puede pedir el crítico: arreglos técnicos. Se descarta lo que revierte un pedido (quitar un efecto pedido,
 * bajar el ritmo o la densidad, sacar b-roll pedido) salvo que tape el producto o la pantalla (eso siempre se arregla).
 */
export function guardIssues(issues: CriticIssue[], locks: RequestLocks | null | undefined): { kept: CriticIssue[]; dropped: CriticIssue[] } {
  if (!hasLocks(locks)) return { kept: issues, dropped: [] };
  const kept: CriticIssue[] = [];
  const dropped: CriticIssue[] = [];
  for (const i of issues) {
    const text = plain(`${i.note} ${i.fix}`);
    const touchesFx = locks.fx.some((k) => text.includes(k.replace("_", " ")) || text.includes(k) || text.includes(plain(FX_INFO[k].label)));
    const removes = /quita|saca|elimina|borra|sin |reemplaza|cambia/.test(text);
    // Tapar lo que se muestra es un problema técnico real (salvo que hable del plano a cámara o de la apertura).
    const technical = i.kind === "tapa_importante" && !/camara|apertura|plano de|tu cara|la persona/.test(text);
    if (touchesFx && removes && !technical) {
      dropped.push(i);
      continue;
    }
    if ((locks.pace === "fast" || locks.density === "reels") && SLOWER.test(text)) {
      dropped.push(i);
      continue;
    }
    kept.push(i);
  }
  return { kept, dropped };
}

const overlaps = (a: { from: number; to: number }, b: { from: number; to: number }) => a.from <= b.to && b.from <= a.to;

/**
 * Vuelve a poner lo pedido si una corrección lo perdió: los efectos pedidos (como estaban en el plan anterior), el
 * ritmo y la densidad. Devuelve el plan y lo que se restauró (en palabras para la persona).
 */
export function enforceLocks(plan: EditPlan, previous: EditPlan | null, locks: RequestLocks | null | undefined, blocked: { from: number; to: number }[] = []): { plan: EditPlan; restored: string[] } {
  if (!hasLocks(locks)) return { plan, restored: [] };
  const restored: string[] = [];
  let next: EditPlan = { ...plan };
  for (const kind of locks.fx) {
    if ((next.effects ?? []).some((e) => e.kind === kind)) continue;
    const before = previous?.effects?.find((e) => e.kind === kind);
    // Lo que tapa el producto o la pantalla no vuelve (es un problema técnico, no un gusto).
    if (!before || blocked.some((z) => overlaps(z, { from: before.from_word, to: before.to_word }))) continue;
    // Lo que esté encima (otro efecto o un b-roll) deja lugar al efecto pedido.
    const range = { from: before.from_word, to: before.to_word };
    next = {
      ...next,
      broll: next.broll.filter((b) => !overlaps({ from: b.from_word, to: b.to_word }, range)),
      effects: [...(next.effects ?? []).filter((e) => !overlaps({ from: e.from_word, to: e.to_word }, range)), before].sort((a, b) => a.from_word - b.from_word),
      zoom_moments: (next.zoom_moments ?? []).filter((z) => !overlaps({ from: z.from_word, to: z.to_word }, range)),
    };
    restored.push(`Dejé el efecto «${FX_INFO[kind].label}» que pediste.`);
  }
  if (locks.pace === "fast") {
    const pause = DENSITY_TARGETS.reels.pause;
    if ((next.pacing?.long_pause ?? 0.5) > pause || next.director?.pace !== "fast") {
      next = { ...next, pacing: { long_pause: Math.min(next.pacing?.long_pause ?? pause, pause) }, director: { version: 1, pace: "fast" } };
      restored.push("Mantuve el ritmo rápido que pediste.");
    }
  }
  if (locks.density && next.rhythm?.density !== locks.density) {
    next = { ...next, rhythm: { density: locks.density, added: next.rhythm?.added ?? [] } };
    restored.push("Mantuve la densidad que pediste.");
  }
  if (locks.noBroll && next.broll.length) next = { ...next, broll: [] };
  return { plan: next, restored };
}
