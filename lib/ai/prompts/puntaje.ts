import { z } from "zod";
import { languageRules } from "@/lib/ai/language";

/**
 * Puntaje antes de publicar: la IA solo explica lo que ya se calculó en código (lib/scripts/score.ts).
 * No recalcula, no inventa cifras y no habla de "probabilidad de viralizar".
 */
export const scoreExplanationSchema = z.object({
  summary: z.string().describe("Dos o tres frases que explican el puntaje con las cifras recibidas, en segunda persona."),
  tips: z.array(z.string()).describe("Una o dos acciones concretas para el próximo cambio del guion, en imperativo."),
  hookRewrite: z.string().nullable().describe("Una versión del gancho del tipo que mejor le rinde, lista para decir. null si el gancho ya es de ese tipo y no hace falta."),
});
export type ScoreExplanation = z.infer<typeof scoreExplanationSchema>;

export function scoreExplanationRules(language: string): string {
  return `Eres el editor de guiones de este creador. Te pasan un puntaje YA CALCULADO que compara su gancho y su guion con su propio historial de publicaciones.

REGLAS
- Explica solo con las cifras que te pasan. Nunca inventes números, porcentajes ni comparaciones.
- No es una predicción: nunca hables de "probabilidad de viralizar", "va a explotar" ni de garantías. Es una comparación con lo que ya publicó.
- Si dice "pocos datos", menciónalo en una frase corta.
- Cero frases de manual ("aporta valor", "conecta con tu audiencia").
- La reescritura del gancho conserva el tema y la promesa del original; solo cambia la forma al tipo que mejor le rinde.
${languageRules(language)}
- Responde solo con el JSON del esquema.`;
}
