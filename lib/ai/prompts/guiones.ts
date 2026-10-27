import { z } from "zod";

/**
 * Prompts y esquemas de Guiones. El contexto de marca (lib/ai/brand-context.ts) va primero y en caché;
 * aquí están las reglas de escritura y la tarea de cada acción.
 */
export const HOOK_TYPES = ["contraste", "curiosidad", "dolor", "resultado", "historia", "pregunta", "lista"] as const;

const hookSchema = z.object({
  text: z.string().describe("El gancho tal como se dice, máximo 2 frases."),
  type: z.enum(HOOK_TYPES),
  score: z.number().describe("Del 1 al 10: qué tan fuerte es para esta audiencia, comparado con lo que ya le funcionó."),
  why: z.string().describe("Por qué funcionaría, en una frase."),
});

const beatSchema = z.object({
  purpose: z.string().describe("Qué logra este bloque (ej. 'mostrar el error', 'dar la prueba')."),
  spoken: z.string().describe("Lo que se dice, natural, como lo diría el creador."),
  onScreenText: z.string().describe("Texto en pantalla, máximo 6 palabras, o vacío."),
  broll: z.string().describe("Una toma filmable y concreta para cubrir este bloque, o vacío."),
  seconds: z.number().describe("Duración estimada del bloque en segundos."),
});

export const scriptSchema = z.object({
  title: z.string().describe("Título interno corto del guion."),
  angle: z.string().describe("El ángulo en una frase: desde dónde se cuenta el tema."),
  hooks: z.array(hookSchema).describe("Exactamente 5 ganchos de tipos distintos, el mejor primero."),
  beats: z.array(beatSchema).describe("El cuerpo del guion, sin el gancho ni el CTA."),
  cta: z.object({
    spoken: z.string(),
    onScreenText: z.string(),
    offer: z.string().describe("Nombre de la oferta usada, o vacío si es un CTA de seguir o guardar."),
  }),
  caption: z.string().describe("Caption para publicar: primera línea que engancha, cuerpo breve y el mismo CTA."),
});
export type GeneratedScript = z.infer<typeof scriptSchema>;

export const hooksSchema = z.object({ hooks: z.array(hookSchema).describe("Exactamente 5 ganchos nuevos, de tipos distintos, el mejor primero.") });
export const beatsSchema = z.object({ beats: z.array(beatSchema) });
export const beatSchemaOnly = z.object({ beat: beatSchema });
export const ctaSchema = z.object({ cta: scriptSchema.shape.cta, caption: z.string() });

export const FORMATS = {
  REEL: { label: "Reel o TikTok (30–60 s)", words: [70, 150], spec: "video vertical de 30 a 60 segundos para Instagram Reels o TikTok" },
  SHORT: { label: "YouTube Short (hasta 45 s)", words: [50, 110], spec: "YouTube Short de 20 a 45 segundos" },
  YT_LONG: { label: "YouTube largo (6–12 min)", words: [900, 1800], spec: "video de YouTube de 6 a 12 minutos con capítulos claros" },
  STORY: { label: "Historias (3–5 pantallas)", words: [40, 100], spec: "secuencia de 3 a 5 historias de Instagram" },
} as const;
export type FormatKey = keyof typeof FORMATS;

export const OBJECTIVES = {
  alcance: "llegar a gente nueva: el CTA pide compartir o guardar",
  seguidores: "ganar seguidores: el CTA invita a seguir para más",
  ventas: "generar conversaciones de venta: el CTA lleva a la oferta (comentar o mandar DM con la palabra clave)",
} as const;
export type ObjectiveKey = keyof typeof OBJECTIVES;

export const WRITING_RULES = `Eres el guionista personal de este creador. Escribes como habla esta persona, no como un copywriter.

REGLAS DE ESCRITURA
- El gancho se entiende en 2 segundos y sin contexto. Prohibido arrancar con "Hola", "Hoy te voy a hablar de", "En este video".
- Cada bloque cumple un solo propósito y empuja al siguiente. Nada de relleno ni repetir la idea con otras palabras.
- Ejemplos concretos, números, casos y situaciones reales del nicho. Cero generalidades. No prometas resultados que la marca no puede cumplir ni inventes cifras: si un dato no está en el contexto, usa un ejemplo hipotético dicho como tal.
- Un solo CTA, coherente con el objetivo. Si el objetivo es ventas, usa una de las ofertas listadas y su palabra clave.
- Texto en pantalla: máximo 6 palabras por bloque. B-roll: una toma concreta que se pueda filmar con un teléfono.
- Respeta las palabras prohibidas y el idioma de la marca.
- Si hay una referencia, toma la estructura y el ángulo, nunca el texto.
- Responde solo con el JSON del esquema.`;

export function generateTask(input: {
  idea: string;
  format: FormatKey;
  objective: ObjectiveKey;
  pillar: string | null;
  offer: string | null;
  reference: string | null;
  referenceLabel: string | null;
}): string {
  const f = FORMATS[input.format];
  return `TAREA: escribe un guion.
Formato: ${f.spec}. Largo total hablado (gancho + cuerpo + CTA): entre ${f.words[0]} y ${f.words[1]} palabras.
Objetivo: ${OBJECTIVES[input.objective]}.
${input.pillar ? `Pilar: ${input.pillar}.` : ""}
${input.offer ? `Oferta para el CTA: ${input.offer}.` : ""}

IDEA
${input.idea}

${input.reference ? `REFERENCIA (${input.referenceLabel ?? "texto de referencia"}): toma la estructura y el ángulo, nunca las frases.\n<referencia>\n${input.reference.slice(0, 6000)}\n</referencia>` : ""}`.trim();
}

export function scriptAsText(s: { hooks: { text: string }[]; selectedHook: number; beats: { spoken: string }[]; cta: { spoken: string } }): string {
  return [s.hooks[s.selectedHook]?.text ?? "", ...s.beats.map((b) => b.spoken), s.cta.spoken].filter(Boolean).join("\n\n");
}

export function hooksTask(current: string, idea: string, avoid: string[]): string {
  return `TAREA: escribe 5 ganchos nuevos para este guion. Tienen que ser distintos entre sí y distintos de los anteriores.
IDEA: ${idea}
GUION ACTUAL:
${current}
GANCHOS ANTERIORES (no los repitas):
${avoid.map((h) => `- ${h}`).join("\n")}`;
}

export function rewriteBeatsTask(kind: "acortar" | "directo", current: string, beatsJson: string, format: FormatKey): string {
  const f = FORMATS[format];
  return kind === "acortar"
    ? `TAREA: acorta el cuerpo de este guion un 30 % o más sin perder la idea ni el orden. Quita lo que se repite y lo que no empuja. Formato: ${f.spec}.
GUION COMPLETO (para contexto):
${current}
BLOQUES A REESCRIBIR (JSON):
${beatsJson}`
    : `TAREA: reescribe el cuerpo de este guion para que sea más directo: frases más cortas, verbos activos, menos rodeos, más afirmaciones concretas. Mantén la idea y el orden.
GUION COMPLETO (para contexto):
${current}
BLOQUES A REESCRIBIR (JSON):
${beatsJson}`;
}

export function beatTask(current: string, beatJson: string, instruction: string): string {
  return `TAREA: reescribe solo este bloque del guion. ${instruction ? `Indicación: ${instruction}.` : "Hazlo más claro y con un ejemplo más concreto."}
GUION COMPLETO (para contexto):
${current}
BLOQUE (JSON):
${beatJson}`;
}

export function ctaTask(current: string, objective: ObjectiveKey, offer: string | null): string {
  return `TAREA: escribe un CTA nuevo y el caption para este guion.
Objetivo: ${OBJECTIVES[objective]}.
${offer ? `Oferta: ${offer}.` : ""}
GUION:
${current}`;
}

export function adaptTask(current: string, from: FormatKey, to: FormatKey): string {
  return `TAREA: adapta este guion de "${FORMATS[from].spec}" a "${FORMATS[to].spec}". No es un recorte: reescríbelo para que funcione nativo en el formato nuevo (ritmo, largo, estructura). Mantén la idea central, la voz y el CTA.
Largo total hablado: entre ${FORMATS[to].words[0]} y ${FORMATS[to].words[1]} palabras.
GUION ORIGINAL:
${current}`;
}
