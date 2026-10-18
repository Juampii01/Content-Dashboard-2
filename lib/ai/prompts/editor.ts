import { z } from "zod";
import type { Candidate } from "@/lib/video/candidates";
import { endsSentence } from "@/lib/video/text";
import type { Word } from "@/lib/video/types";

/**
 * Prompt del plan de edición (feature "video.plan").
 * Claude ve la transcripción palabra por palabra con sus ids y los candidatos que encontró el detector,
 * y responde decisiones sobre ids: nunca escribe segundos. El plan final lo arma y valida lib/video/plan.ts.
 */
export const EDITOR_RULES = `Eres el editor de video personal de este creador. Editas videos donde la persona habla a cámara (talking head) para Reels, TikTok y Shorts.

QUÉ HACES
1. Decides cuáles de los CANDIDATOS a cortar se cortan de verdad (tomas repetidas, arranques en falso, muletillas).
2. Si ves otras tomas fallidas o frases que se cortaron a la mitad y se repiten bien después, las agregas como cortes extra.
3. Propones 3 ganchos: tramos de 3 a 8 segundos que se entiendan solos, sin contexto previo, y den ganas de seguir mirando.
4. Marcas hasta 8 palabras clave para resaltar en los subtítulos (números, resultados, la idea central).

REGLAS
- Nunca cortes contenido bueno: si una frase se dice dos veces y las dos están completas, se corta solo la primera.
- En una toma repetida gana la última toma completa.
- Una muletilla se corta solo si sacarla no cambia el sentido.
- No cortes palabras sueltas en medio de una frase fluida: se nota el salto.
- Lo que no está en el guion se marca, pero no se corta solo por eso.
- Los ganchos deben empezar y terminar en un límite de frase. Si el video ya abre con un buen gancho, ese va primero.
- Si el guion ya trae un gancho al principio, respétalo como primer candidato.
- Usa solo ids que existan en la transcripción. Los tramos van de from_word a to_word, inclusive.
- La duración ideal del video final para Reels y TikTok es de 30 a 90 segundos; no inventes cortes para llegar.
- "why", "note", "summary" y "warning" son para el creador: cortos, concretos y en el idioma de la marca (ver IDIOMA más abajo; por defecto, español neutro con trato de "tú", sin voseo ni español de España).`;

export const planAiSchema = z.object({
  decisions: z
    .array(
      z.object({
        candidate: z.string().describe("Id del candidato, por ejemplo C3."),
        cut: z.boolean(),
        confidence: z.number().describe("De 0 a 1."),
      }),
    )
    .describe("Una decisión por cada candidato que no sea de tipo silencio."),
  extra_removals: z
    .array(
      z.object({
        from_word: z.number().int(),
        to_word: z.number().int(),
        reason: z.enum(["retake", "false_start", "filler", "off_topic"]),
        confidence: z.number(),
        note: z.string().describe("Por qué, en una frase corta."),
      }),
    )
    .describe("Cortes que el detector no encontró. Vacío si no hay."),
  hook_candidates: z
    .array(
      z.object({
        from_word: z.number().int(),
        to_word: z.number().int(),
        score: z.number().describe("De 0 a 1: qué tan fuerte es como apertura."),
        why: z.string().describe("Por qué funciona como gancho, en una frase."),
      }),
    )
    .describe("Exactamente 3 ganchos de 3 a 8 segundos, el mejor primero."),
  emphasis_words: z.array(z.number().int()).describe("Ids de hasta 8 palabras para resaltar."),
  summary: z.string().describe("Qué se cortó y por qué, en una o dos frases."),
  warning: z.string().describe("Algo que la persona debería revisar (audio malo, video muy largo), o vacío."),
});
export type PlanAiOutput = z.infer<typeof planAiSchema>;

export type Sentence = { index: number; from: number; to: number; start: number; end: number; text: string };

/** Frases a partir de la puntuación y de las pausas largas. */
export function sentences(words: Word[]): Sentence[] {
  const out: Sentence[] = [];
  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const next = words[i + 1];
    if (!next || endsSentence(w.text) || next.start - w.end > 0.7) {
      out.push({
        index: out.length + 1,
        from: words[from]!.id,
        to: w.id,
        start: words[from]!.start,
        end: w.end,
        text: words.slice(from, i + 1).map((x) => x.text).join(" "),
      });
      from = i + 1;
    }
  }
  return out;
}

const s = (n: number) => n.toFixed(1);

const KIND_LABEL: Record<Candidate["kind"], string> = {
  retake: "toma repetida",
  false_start: "arranque en falso",
  filler: "muletilla",
  silence: "silencio",
};

export function planTask(input: {
  words: Word[];
  candidates: Candidate[];
  duration: number;
  format: string;
  script: string | null;
  scriptCoverage: number | null;
}): string {
  const { words, candidates } = input;
  const transcript = words
    .map((w, i) => {
      const prev = words[i - 1];
      const pause = prev && w.start - prev.end >= 0.6 ? `(pausa ${s(w.start - prev.end)} s) ` : "";
      return `${pause}${w.id}:${w.text}`;
    })
    .join(" ");
  const frases = sentences(words)
    .map((f) => `F${f.index} [${f.from}–${f.to}] ${s(f.end - f.start)} s (${s(f.start)}–${s(f.end)}): ${f.text}`)
    .join("\n");
  const cands = candidates.length
    ? candidates
        .map((c) => `${c.id} ${KIND_LABEL[c.kind]} [${c.from_word}–${c.to_word}] conf ${c.confidence.toFixed(2)}: ${c.note}`)
        .join("\n")
    : "(ninguno)";

  return `Arma el plan de edición de este video.

DATOS
- Duración del original: ${s(input.duration)} s
- Formato de salida: ${input.format}
- Palabras: ${words.length}
${input.script ? `- Hay guion (coincide con el ${Math.round((input.scriptCoverage ?? 0) * 100)} % de lo dicho).` : "- No hay guion."}

FRASES (id de la frase, rango de palabras, duración y tiempos)
${frases}

CANDIDATOS A CORTAR (del detector automático)
${cands}

${input.script ? `GUION ORIGINAL\n<guion>\n${input.script.slice(0, 12000)}\n</guion>\n` : ""}
TRANSCRIPCIÓN PALABRA POR PALABRA (id:palabra)
<transcripcion>
${transcript}
</transcripcion>`;
}
