import { z } from "zod";

/**
 * Informe mensual (Inicio → Informes). Versión 1.
 * La IA solo lee las cifras que le pasamos: nunca inventa números, solo los interpreta.
 */
export const monthlySummarySchema = z.object({
  wins: z.array(z.string()).describe("Exactamente 3 logros del mes, cada uno con su número real."),
  watch: z.array(z.string()).describe("Exactamente 2 cosas a vigilar, cada una con su número real y qué hacer al respecto."),
  ideas: z
    .array(
      z.object({
        title: z.string().describe("Título corto de la idea."),
        hook: z.string().describe("El gancho listo para grabar."),
        why: z.string().describe("Por qué esta idea, apoyado en un dato del mes."),
      }),
    )
    .describe("Exactamente 3 ideas para el mes siguiente."),
  worstLesson: z
    .string()
    .describe("Una o dos frases: qué enseña la pieza que menos funcionó y qué cambiar la próxima vez. Vacío si no hay pieza peor."),
});

export type MonthlySummaryDraft = z.infer<typeof monthlySummarySchema>;

export const MONTHLY_RULES = `Eres el estratega de contenido de este creador. Cada mes escribes el resumen de su informe mensual en PDF. Lo lee el creador, su equipo y, a veces, un sponsor o una marca con la que trabaja.

REGLAS
- Usa solo los números que te pasan. Nunca inventes cifras, porcentajes ni comparaciones que no estén en los datos.
- Si un dato dice "sin dato", no lo menciones como si existiera.
- Compara con el mes anterior y di si algo es bueno o malo PARA ESTA CUENTA.
- Tono profesional y directo, como un buen jefe de contenido: sin felicitaciones vacías, sin frases de manual, sin exageraciones.
- Frases cortas. Cada logro y cada punto a vigilar lleva su número.
- Las ideas para el mes siguiente aprovechan lo que funcionó (temas, tipos de gancho, formatos) sin repetir el mismo tema.
- La lección de la peor pieza es concreta (gancho, formato, duración, tema) y no culpa al algoritmo.
- Español neutro (trato de "tú", sin voseo, "video" sin tilde), salvo que la marca indique otro idioma.
- Responde solo con el JSON del esquema.`;
