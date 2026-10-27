import { z } from "zod";
import type { Word } from "@/lib/video/types";

/**
 * Prompt de "video.transcripcion.corregir": arregla las palabras que la transcripción automática escuchó mal
 * ("desancado" por "estancado") antes de que lleguen a los subtítulos. Solo toca la ortografía de lo que se dijo:
 * nunca cambia la forma de hablar de la persona. Lo aplica lib/video/transcript-fix.ts.
 */
export const TRANSCRIPT_FIX_RULES = `Eres corrector de subtítulos. Recibes la transcripción automática de un video donde una persona habla a cámara, palabra por palabra con su número (id:palabra).

QUÉ HACES
Encuentras las palabras que la transcripción escuchó mal y devuelves cómo se escriben de verdad, según el contexto de la frase.
Ejemplos: "desancado" → "estancado", "conbierten" → "convierten", un nombre de marca o de persona mal escrito → como se escribe en la marca o el guion.

REGLAS
- Corriges solo errores de transcripción: palabras que no existen, que no tienen sentido en la frase o nombres propios mal escritos (usa la marca y el guion, si hay).
- NUNCA cambias la forma de hablar de la persona: el voseo ("vos", "tenés", "mirá"), los modismos, las muletillas y la gramática informal se quedan tal cual.
- No reescribes ni mejoras frases, no cambias una palabra correcta por un sinónimo y no corriges la puntuación.
- Una corrección es para una sola palabra (id) y devuelve solo esa palabra corregida (como mucho dos palabras si la transcripción pegó dos en una). No corrijas errores que abarcan varios ids.
- Si la palabra original tenía signos pegados (coma, punto, signos de pregunta), mantenlos en la corrección.
- Ante la duda, no corrijas. Es mejor dejar un error que inventar una palabra.
- Si no hay nada que corregir, devuelve la lista vacía.`;

export const transcriptFixSchema = z.object({
  fixes: z
    .array(
      z.object({
        id: z.number().int().describe("Id de la palabra mal transcrita."),
        text: z.string().describe("La palabra corregida, con los signos que tenía pegados."),
      }),
    )
    .describe("Solo las palabras mal transcritas. Lista vacía si no hay errores."),
});

export type TranscriptFixOutput = z.infer<typeof transcriptFixSchema>;

export function transcriptFixTask(input: { words: Word[]; script: string | null }): string {
  const text = input.words.map((w) => `${w.id}:${w.text}`).join(" ");
  return [
    input.script ? `GUION QUE LEÍA (puede no coincidir palabra por palabra):\n${input.script.slice(0, 6000)}` : null,
    `TRANSCRIPCIÓN:\n${text}`,
    "Devuelve las correcciones.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
