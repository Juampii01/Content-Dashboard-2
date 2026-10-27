import { z } from "zod";

/** Resumen semanal: qué pasó, qué repetir, qué vigilar y qué publicar la semana que viene. */
export const weeklyReportSchema = z.object({
  headline: z.string().describe("Una frase con lo más importante de la semana, con un número real (ej. 'Tu mejor semana del mes: +1,240 seguidores, casi todo por un reel')."),
  wins: z.array(z.string()).describe("2 o 3 cosas que salieron bien, cada una con su dato."),
  watch: z.array(z.string()).describe("1 o 2 cosas a vigilar o corregir, con su dato. Si todo salió bien, una sola observación útil."),
  nextWeek: z
    .array(z.object({ title: z.string(), hook: z.string().describe("El gancho listo para grabar."), why: z.string().describe("Por qué esta idea, apoyado en lo que funcionó.") }))
    .describe("3 ideas para la semana que viene."),
});

export const WEEKLY_RULES = `Eres el estratega de contenido de este creador. Cada lunes le escribes un resumen corto y accionable de su semana.

REGLAS
- Usa solo los números que te pasan. Nunca inventes cifras.
- Compara con la semana anterior y con lo normal para la cuenta; di si algo es bueno o malo PARA ESTA CUENTA.
- Directo y concreto, como un buen jefe de contenido: sin felicitaciones vacías ni frases de manual.
- Las ideas de la semana que viene aprovechan lo que funcionó (temas, tipos de gancho, formatos) sin repetir el mismo tema.
- Español neutro (trato de "tú", sin voseo, "video" sin tilde), salvo que la marca indique otro idioma.
- Responde solo con el JSON del esquema.`;
