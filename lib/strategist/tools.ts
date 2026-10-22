/**
 * Herramientas del estratega: definiciones (nombre, descripción, entrada validada con Zod) y el registro de
 * referencias que se citan en la respuesta ([P3], [C1], [E2]). Sin base de datos: sirve en pruebas.
 *
 * Todas son de solo lectura y acotadas (filtros con valores cerrados, límites máximos). Nunca SQL libre.
 * La única que "escribe" es proponer_idea, y solo deja la idea en la respuesta con sus botones.
 */
import { z } from "zod";
import type { StrategistCitation, StrategistIdea } from "@/lib/db/schema";

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
const day = z.string().refine(isDay, "Fecha no válida: usa AAAA-MM-DD.");
const red = z.enum(["instagram", "youtube", "tiktok"]);
const HOOKS = ["contraste", "curiosidad", "dolor", "resultado", "historia", "pregunta", "lista"] as const;

export const TOOL_INPUTS = {
  buscar_piezas: z.object({
    red: red.optional().describe("Solo una red. Sin esto, las tres."),
    tipo: z.enum(["reel", "carrusel", "post", "video", "short"]).optional(),
    desde: day.optional().describe("Fecha de publicación desde (AAAA-MM-DD). Sin esto, los últimos 90 días."),
    hasta: day.optional().describe("Fecha de publicación hasta (AAAA-MM-DD). Sin esto, hoy."),
    texto: z.string().trim().max(100).optional().describe("Palabras que tiene que tener el título o el caption."),
    gancho: z.enum(HOOKS).optional().describe("Solo piezas con este tipo de gancho."),
    orden: z.enum(["puntaje", "vistas", "fecha", "interaccion", "guardados", "compartidos", "comentarios"]).default("puntaje").describe("puntaje = veces su mediana (lo más justo para comparar)."),
    direccion: z.enum(["desc", "asc"]).default("desc").describe("asc para ver las que peor rindieron."),
    limite: z.number().int().min(1).max(12).default(8),
  }),
  resumen_periodo: z.object({
    desde: day,
    hasta: day,
    red: red.optional().describe("Sin esto, el total y el detalle por red."),
    comparar: z.boolean().default(true).describe("Compara con el periodo anterior de la misma duración."),
  }),
  ranking_ganchos: z.object({
    red: red.optional(),
  }),
  calendario: z.object({
    dias: z.number().int().min(1).max(31).default(7).describe("Días hacia adelante desde hoy (incluido)."),
  }),
  meta_seguidores: z.object({}),
  analisis_pieza: z.object({
    pieza: z.string().trim().min(2).max(40).describe("La referencia de la pieza (P3) que ya recibiste."),
  }),
  informe_mensual: z.object({
    mes: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes no válido: usa AAAA-MM.")
      .optional()
      .describe("AAAA-MM. Sin esto, el último informe guardado."),
  }),
  proponer_idea: z.object({
    titulo: z.string().trim().min(3).max(120),
    idea: z.string().trim().min(10).max(600).describe("Qué contar y con qué ángulo, en una o dos frases."),
    gancho: z.string().trim().max(240).optional().describe("El gancho dicho tal cual, listo para grabar."),
    formato: z.enum(["REEL", "CAROUSEL", "VIDEO", "SHORT", "STORY", "POST"]),
    redes: z.array(z.enum(["INSTAGRAM", "YOUTUBE", "TIKTOK"])).min(1).max(3),
    fecha: day.optional().describe("Día sugerido para publicarla (AAAA-MM-DD), si tiene sentido."),
    por_que: z.string().trim().max(300).optional().describe("Qué dato tuyo la respalda, con su referencia ([P3])."),
  }),
} as const;

export type ToolName = keyof typeof TOOL_INPUTS;
export type ToolInput<N extends ToolName> = z.output<(typeof TOOL_INPUTS)[N]>;
export const TOOL_NAMES = Object.keys(TOOL_INPUTS) as ToolName[];

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  buscar_piezas:
    "Busca piezas publicadas con filtros (red, tipo, fechas, texto, tipo de gancho) y las ordena. Devuelve sus métricas y 'x_mediana' (veces la mediana de su red y tipo). Úsala para encontrar las mejores o peores, o las de un tema.",
  resumen_periodo:
    "Totales de un periodo (vistas, interacción, guardados, compartidos, seguidores netos, piezas publicadas) por red, comparados con el periodo anterior. Úsala para '¿cómo voy?', '¿por qué bajó…?'.",
  ranking_ganchos: "Rendimiento por tipo de gancho (mediana de 'x_mediana', últimos 180 días, mínimo 3 piezas por tipo), con la mejor pieza de cada tipo.",
  calendario: "Lo que está planeado en el calendario para los próximos días (sin lo ya publicado) y los días libres.",
  meta_seguidores: "Meta de seguidores, ritmo actual, proyección y constancia de publicación por semana.",
  analisis_pieza: "Detalle de una pieza que ya recibiste (por su referencia): métricas contra su mediana y el análisis '¿Por qué funcionó?' si ya existe.",
  informe_mensual: "Resumen del informe mensual guardado (totales, por red, mejores piezas y conclusiones).",
  proponer_idea:
    "Propón una pieza concreta para publicar. Aparece debajo de tu respuesta con los botones 'Crear guion' y 'Agregar al calendario'. Máximo 3 por respuesta. Respáldala con datos.",
};

/** Lo que se muestra mientras corre cada herramienta. */
export function toolStatus(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const net = typeof i.red === "string" ? ` de ${i.red === "youtube" ? "YouTube" : i.red === "tiktok" ? "TikTok" : "Instagram"}` : "";
  switch (name) {
    case "buscar_piezas":
      return `Revisando tus piezas${net}…`;
    case "resumen_periodo":
      return `Sumando tus números${net}…`;
    case "ranking_ganchos":
      return `Mirando qué ganchos te funcionan${net}…`;
    case "calendario":
      return "Revisando tu calendario…";
    case "meta_seguidores":
      return "Revisando tu meta de seguidores…";
    case "analisis_pieza":
      return "Leyendo el detalle de la pieza…";
    case "informe_mensual":
      return "Leyendo tu informe mensual…";
    case "proponer_idea":
      return "Armando una idea…";
    default:
      return "Revisando tus datos…";
  }
}

/** Esquemas JSON para la API de Anthropic (lo que el modelo puede mandar, con los valores por defecto opcionales). */
export function toolDefinitions(): { name: ToolName; description: string; input_schema: { type: "object"; [k: string]: unknown } }[] {
  return TOOL_NAMES.map((name) => {
    const json = z.toJSONSchema(TOOL_INPUTS[name], { io: "input" }) as Record<string, unknown>;
    delete json.$schema;
    return { name, description: TOOL_DESCRIPTIONS[name], input_schema: { ...json, type: "object" } };
  });
}

export type ParsedTool = { ok: true; name: ToolName; input: ToolInput<ToolName> } | { ok: false; error: string };

/** Valida el pedido del modelo. Un error vuelve al modelo como texto para que corrija la llamada. */
export function parseToolCall(name: string, input: unknown): ParsedTool {
  if (!(TOOL_NAMES as string[]).includes(name)) return { ok: false, error: `No existe la herramienta ${name}.` };
  const parsed = TOOL_INPUTS[name as ToolName].safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: `Entrada no válida: ${parsed.error.issues.map((i) => `${i.path.join(".") || "entrada"}: ${i.message}`).join("; ")}` };
  return { ok: true, name: name as ToolName, input: parsed.data as ToolInput<ToolName> };
}

// ─── Referencias citables ───────────────────────────────────────────────────

/**
 * Lleva la cuenta de lo que se le mostró al modelo, con una referencia corta para citar.
 * Continúa la numeración de la conversación (las referencias viejas siguen sirviendo).
 */
export class RefRegistry {
  private items = new Map<string, StrategistCitation>();
  private byTarget = new Map<string, string>();
  private counters = { P: 0, C: 0, E: 0 };

  constructor(previous: StrategistCitation[] = []) {
    for (const c of previous) this.remember(c);
  }

  private remember(c: StrategistCitation) {
    this.items.set(c.ref, c);
    if (c.targetId) this.byTarget.set(`${c.kind}:${c.targetId}`, c.ref);
    const m = /^([PCE])(\d+)$/.exec(c.ref);
    if (m) this.counters[m[1] as "P" | "C" | "E"] = Math.max(this.counters[m[1] as "P" | "C" | "E"], Number(m[2]));
  }

  piece(p: { id: string; label: string; detail: string | null; platform: StrategistCitation["platform"] }): string {
    const known = this.byTarget.get(`pieza:${p.id}`);
    if (known) return known;
    const ref = `P${++this.counters.P}`;
    this.remember({ ref, kind: "pieza", label: p.label.slice(0, 140), detail: p.detail, href: `/metricas/${p.id}`, targetId: p.id, platform: p.platform });
    return ref;
  }

  figure(f: { label: string; detail: string | null; href: string; platform?: StrategistCitation["platform"] }): string {
    const ref = `C${++this.counters.C}`;
    this.remember({ ref, kind: "cifra", label: f.label.slice(0, 140), detail: f.detail, href: f.href, targetId: null, platform: f.platform ?? null });
    return ref;
  }

  entry(e: { id: string; label: string; detail: string | null; href: string }): string {
    const known = this.byTarget.get(`calendario:${e.id}`);
    if (known) return known;
    const ref = `E${++this.counters.E}`;
    this.remember({ ref, kind: "calendario", label: e.label.slice(0, 140), detail: e.detail, href: e.href, targetId: e.id, platform: null });
    return ref;
  }

  get(ref: string): StrategistCitation | undefined {
    return this.items.get(ref.toUpperCase());
  }

  /** id de la pieza detrás de una referencia (o el id tal cual si ya es un uuid). */
  pieceId(refOrId: string): string | null {
    if (/^[0-9a-f-]{36}$/i.test(refOrId)) return refOrId;
    const c = this.get(refOrId.replace(/[[\]\s]/g, ""));
    return c?.kind === "pieza" ? c.targetId : null;
  }
}

/** Referencias citadas en el texto, en orden de aparición y sin repetir, solo las que existen. */
export function extractCitations(text: string, registry: RefRegistry): StrategistCitation[] {
  const seen = new Set<string>();
  const out: StrategistCitation[] = [];
  for (const m of text.matchAll(/\[([PCE]\d{1,3})\]/g)) {
    const ref = m[1]!;
    if (seen.has(ref)) continue;
    seen.add(ref);
    const c = registry.get(ref);
    if (c) out.push(c);
  }
  return out;
}

/** Quita del texto las referencias que no existen (el modelo no puede citar algo que no recibió). */
export function stripUnknownRefs(text: string, registry: RefRegistry): string {
  return text.replace(/\s?\[([PCE]\d{1,3})\]/g, (all, ref: string) => (registry.get(ref) ? all : ""));
}

/** Convierte una propuesta del modelo en una idea con botones. */
export function toIdea(input: ToolInput<"proponer_idea">, id: string): StrategistIdea {
  return {
    id,
    title: input.titulo,
    idea: input.idea,
    hook: input.gancho || null,
    format: input.formato,
    platforms: [...new Set(input.redes)],
    date: input.fecha ?? null,
    why: input.por_que || null,
  };
}

export const MAX_IDEAS = 3;
