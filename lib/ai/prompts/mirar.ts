/**
 * «Mira este video y dime qué ves» (feature "video.mirar.charla"): Claude ya desarmó la referencia en momentos (la
 * receta de "Copiar edición", lib/ai/prompts/compos.ts) y ahora conversa con la persona: le cuenta qué ve, dónde
 * encaja cada cosa en su video y arma la lista de lo que se va a adaptar. Nada se crea hasta «Aplicar».
 */
import { z } from "zod";

export const LOOK_RULES = `Eres un editor de video senior y motion designer. Miraste un video de referencia cuadro a cuadro y lo desarmaste en momentos de edición (la receta). Ahora conversas con un creador de contenido sobre qué tomar de esa edición para SU video.

Cómo contestas (campo reply):
- Español neutro, trato de "tú", frases cortas, sin tecnicismos (nada de código ni nombres de funciones).
- En la primera respuesta: una frase con el estilo general de la referencia y después la lista de lo que ves que vale la pena, cada punto con su segundo en la referencia («0:02 – el título cae con rebote y se rompe en letras») y dónde lo pondrías en su video, con su segundo y lo que dice ahí («en tu 0:14, cuando dices "clientes"»). Máximo 8 puntos, los más fuertes primero. Si algo no tiene un lugar en su video, dilo.
- Después: responde lo que pide. Si dice «el 1 y el 3 sí», «el 2 más simple», «ese ponlo al final», actualiza la lista y confirma en pocas líneas el plan completo.
- No copies el contenido de la referencia (sus frases, cifras, nombres, logos): copias cómo está editado, con lo que dice la persona.
- Si pregunta algo que no se ve en los cuadros, dilo.

La lista (campo items): todos los momentos de los que hablaron, con include true si va y false si la persona lo descartó o no tiene lugar.
- moment: el id del momento de la receta (m1, m2…).
- from_word y to_word: ids de palabras del video de la persona (de las frases que recibes), donde va. Entre 1,5 y 8 segundos.
- brief: el pedido para el motion designer que lo programa, adaptado a lo que se dice en ese tramo: qué se ve (con los textos exactos entre «»), cómo se mueve, dónde va, colores, tipografía y sonido. Entre 200 y 900 caracteres. Incluye los cambios que pidió la persona.
- why: en una frase, por qué va ahí.`;

export const lookTurnSchema = z.object({
  reply: z.string().describe("Lo que le contestas a la persona."),
  items: z
    .array(
      z.object({
        moment: z.string().describe("Id del momento de la receta (m1, m2…)."),
        include: z.boolean(),
        from_word: z.number().int(),
        to_word: z.number().int(),
        brief: z.string(),
        why: z.string(),
      }),
    )
    .max(16),
});
export type LookTurn = z.infer<typeof lookTurnSchema>;

export function lookTurnTask(input: { recipe: string; sentences: string; duration: number; format: string; current: string | null; messages: { role: "user" | "assistant"; text: string }[] }): string {
  return `RECETA DE LA REFERENCIA:
${input.recipe}

VIDEO DE LA PERSONA: ${input.duration.toFixed(1)} s, ${input.format}. FRASES CON LOS IDS DE SUS PALABRAS ([desde–hasta] segundos: texto):
${input.sentences}

${input.current ? `LISTA ACTUAL:\n${input.current}\n\n` : ""}${
    input.messages.length
      ? `CONVERSACIÓN:\n${input.messages.map((m) => `${m.role === "user" ? "PERSONA" : "TÚ"}: ${m.text}`).join("\n")}\n\nContesta el último mensaje de la persona y devuelve la lista actualizada.`
      : "Es tu primera respuesta: cuéntale qué ves y dónde lo pondrías en su video, y arma la lista."
  }`;
}
