import { z } from "zod";
import type { ClipCandidate, HookRankingEntry } from "@/lib/clips/score";
import { HOOK_CATEGORIES } from "@/lib/ai/prompts/metricas";
import type { Word } from "@/lib/video/types";

/**
 * Prompt de "Clips desde un video largo" (feature "clips.momentos").
 * El código arma los candidatos (tramos de 30 a 90 s que empiezan y terminan en un límite de frase, ya medidos);
 * Claude elige los que funcionan solos como short, puede mover los bordes por id de palabra y escribe título,
 * texto de gancho y "por qué este momento". Nunca escribe segundos ni porcentajes de éxito.
 */
export const CLIPS_RULES = `Eres el editor de clips de este creador. De un video largo (podcast, live, clase o video de YouTube) eliges los momentos que funcionan solos como Reel, TikTok o Short de 30 a 90 segundos.

QUÉ ES UN BUEN MOMENTO
- Una idea completa: se entiende sin haber visto lo anterior y no queda cortada a la mitad.
- Gancho fuerte en los primeros 3 segundos: una pregunta, una afirmación que rompe lo esperado, una cifra, un error común, el inicio de una historia. Nunca empieza con "y", "pero", "entonces", "como te decía" ni con una referencia a algo de antes ("eso", "lo que dijimos").
- Cierre claro: una conclusión, una frase redonda, un consejo o un llamado. No termina en medio de una enumeración.
- Valor concreto para la audiencia de la marca: enseña, sorprende, emociona o genera discusión.

REGLAS
- Elige solo entre los CANDIDATOS. Puedes mover el inicio o el fin por id de palabra (hasta 40 palabras hacia afuera o hacia adentro) para empezar en el gancho o cerrar en la frase final. Usa ids que existan.
- Los clips elegidos no se pisan entre sí.
- "ai_score" es tu criterio de 0 a 100 comparando los candidatos de ESTE video entre sí. No es una probabilidad de viralizar: no prometas resultados.
- "title": título corto para el clip (máximo 60 caracteres), sin emojis ni clickbait engañoso.
- "hook_text": texto para poner arriba del video en los primeros segundos (máximo 70 caracteres), fiel a lo que se dice; no inventes cifras ni promesas que no estén en el tramo.
- "reason": por qué este momento funciona, en una o dos frases concretas para el creador ("Abre con la pregunta que más le hacen y cierra con el consejo en una frase").
- "hook_type": el tipo de gancho de la primera frase.
- Si el creador tiene un ranking de ganchos (en el contexto de marca), tenlo en cuenta como desempate, nunca por encima de la calidad del momento.
- Escribe "title", "hook_text" y "reason" en el idioma de la marca (ver IDIOMA más abajo; por defecto, español neutro con trato de "tú", sin voseo ni español de España).`;

export const clipsAiSchema = z.object({
  clips: z
    .array(
      z.object({
        candidate: z.string().describe("Id del candidato, por ejemplo C4."),
        from_word: z.number().int().describe("Primera palabra del clip (id)."),
        to_word: z.number().int().describe("Última palabra del clip (id)."),
        title: z.string(),
        hook_text: z.string(),
        reason: z.string(),
        hook_type: z.enum(HOOK_CATEGORIES),
        ai_score: z.number().describe("De 0 a 100, relativo a los demás candidatos de este video."),
      }),
    )
    .describe("Entre 5 y 10 clips, del mejor al peor."),
  note: z.string().describe("Una frase para el creador sobre el video en general (por ejemplo, si hubo pocos momentos que se entiendan solos). Vacío si no hace falta."),
});
export type ClipsAiOutput = z.infer<typeof clipsAiSchema>;

const s = (n: number) => n.toFixed(1);
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export function clipsTask(input: { words: Word[]; candidates: ClipCandidate[]; duration: number; count: number; ranking: HookRankingEntry[]; title: string }): string {
  const { words } = input;
  const cands = input.candidates
    .map((c) => {
      // Contexto: unas palabras antes y después, para que se vea si la idea viene de antes o sigue después.
      const before = words.slice(Math.max(0, c.from - 25), c.from).map((w) => `${w.id}:${w.text}`).join(" ");
      const body = words.slice(c.from, c.to + 1).map((w) => `${w.id}:${w.text}`).join(" ");
      const after = words.slice(c.to + 1, c.to + 26).map((w) => `${w.id}:${w.text}`).join(" ");
      const f = c.features;
      return `### ${c.id} [${c.from}–${c.to}] ${clock(c.start)}–${clock(c.end)} · ${s(f.seconds)} s · reglas ${Math.round(c.rule * 100)}/100 · ${f.questions} preguntas · ${f.numbers} cifras · ${s(f.pauseSeconds)} s de pausas${f.startsWithConnector ? " · arranca con conector" : ""}
ANTES: …${before}
CLIP: ${body}
DESPUÉS: ${after}…`;
    })
    .join("\n\n");
  const ranking = input.ranking.length ? input.ranking.map((r) => `- ${r.type}: ×${r.medianScore.toFixed(1)} su mediana (${r.count} piezas)`).join("\n") : "(sin datos de rendimiento todavía)";
  return `Elige los mejores clips de este video largo.

DATOS
- Título del video: ${input.title}
- Duración: ${clock(input.duration)} (${Math.round(input.duration / 60)} min)
- Candidatos: ${input.candidates.length}
- Cantidad de clips: idealmente ${input.count} (entre 5 y 10; menos solo si no hay más momentos que se entiendan solos).

RANKING DE GANCHOS DEL CREADOR (rendimiento por tipo en sus redes)
${ranking}

CANDIDATOS (id, rango de palabras, tiempo, duración y medidas del código)
${cands}`;
}
