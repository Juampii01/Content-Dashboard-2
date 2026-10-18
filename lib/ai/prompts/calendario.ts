import { z } from "zod";

/**
 * Prompt del plan semanal del Calendario. El contexto de marca (lib/ai/brand-context.ts) va primero y en caché:
 * ahí ya están los pilares, las ofertas, la voz y lo que ya funcionó. Aquí van las reglas de planeación
 * y la tarea con lo que cambia cada semana (lo programado y el balance de pilares).
 */
export const PLAN_FORMATS = ["REEL", "CAROUSEL", "SHORT", "VIDEO", "STORY"] as const;
export const PLAN_PLATFORMS = ["INSTAGRAM", "YOUTUBE", "TIKTOK"] as const;

export const planSchema = z.object({
  ideas: z
    .array(
      z.object({
        title: z.string().describe("Título interno corto de la pieza, máximo 70 caracteres."),
        hook: z.string().describe("El gancho tal como se diría en los primeros 2 segundos, máximo 2 frases."),
        pillar: z.string().describe("Nombre exacto de uno de los pilares de la marca."),
        format: z.enum(PLAN_FORMATS),
        platforms: z.array(z.enum(PLAN_PLATFORMS)).describe("Redes donde se publica, solo de las conectadas."),
        day: z.number().int().describe("Día de la semana: 0 = lunes, 1 = martes … 6 = domingo."),
        why: z.string().describe("Por qué esta pieza esta semana, en una frase (qué patrón ganador o qué pilar atrasado cubre)."),
      }),
    )
    .describe("Entre 3 y 5 piezas, una por día como máximo."),
});
export type WeekPlan = z.infer<typeof planSchema>;

export const PLANNING_RULES = `Eres el estratega de contenido de este creador. Planeas su semana: pocas piezas, cada una con un motivo claro.

REGLAS DE PLANEACIÓN
- Propón entre 3 y 5 piezas para la semana indicada, como máximo una por día. Repártelas en la semana (no todas seguidas).
- Prioriza los pilares atrasados frente a su porcentaje objetivo. Usa el nombre exacto del pilar.
- Toma los patrones de gancho, ángulo y formato de "lo que ya funcionó", nunca el mismo tema.
- No repitas ni parafrasees lo que ya está programado o se publicó hace poco: cada idea tiene que ser nueva.
- Si una idea apunta a vender, conéctala con una de las ofertas listadas. No todas tienen que vender.
- El gancho se entiende en 2 segundos y sin contexto. Prohibido arrancar con "Hola", "Hoy te voy a hablar de", "En este video".
- Formatos: REEL (Instagram y TikTok), CAROUSEL (solo Instagram), SHORT y VIDEO (YouTube), STORY (historias de Instagram).
- Usa solo las redes conectadas que se indican.
- Respeta las palabras prohibidas y el idioma de la marca.
- Responde solo con el JSON del esquema.`;

export function planTask(input: {
  weekLabel: string;
  platforms: string[];
  pillarBalance: { name: string; target: number; recent: number }[];
  scheduled: { day: string; title: string; pillar: string | null }[];
  recent: string[];
}): string {
  const balance = input.pillarBalance.length
    ? input.pillarBalance.map((p) => `- ${p.name}: objetivo ${p.target} %, últimas 4 semanas ${p.recent} pieza${p.recent === 1 ? "" : "s"}`).join("\n")
    : "- (sin pilares definidos: elige temas variados del nicho)";
  const scheduled = input.scheduled.length ? input.scheduled.map((s) => `- ${s.day}: ${s.title}${s.pillar ? ` [${s.pillar}]` : ""}`).join("\n") : "- (nada todavía)";
  const recent = input.recent.length ? input.recent.map((t) => `- ${t}`).join("\n") : "- (nada)";
  return `TAREA: planea la semana del ${input.weekLabel}.
Redes conectadas: ${input.platforms.join(", ") || "Instagram"}.

BALANCE DE PILARES
${balance}

YA PROGRAMADO ESA SEMANA (no lo repitas; elige otros días si puedes)
${scheduled}

PUBLICADO O PLANEADO HACE POCO (no lo repitas)
${recent}`;
}
