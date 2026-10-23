import "server-only";
import { AiError, aiConfigured, generateStructured } from "@/lib/ai/client";
import { TRANSCRIPT_FIX_RULES, transcriptFixSchema, transcriptFixTask } from "@/lib/ai/prompts/transcripcion";
import type { Word } from "./types";

/** Hasta cuántas palabras se mandan a corregir (un video de ~25 minutos). */
const MAX_WORDS = 4000;
const MAX_FIXES = 80;

/**
 * Limpia lo que devolvió Claude: ids que existen, textos cortos, una o dos palabras y distintos del original.
 * Si el original tenía signos pegados al final (coma, punto, ?) y la corrección no, se los agrega.
 */
export function cleanFixes(words: Word[], fixes: { id: number; text: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fixes.slice(0, MAX_FIXES)) {
    const w = words[f.id];
    if (!w || !Number.isInteger(f.id)) continue;
    let text = f.text.trim().replace(/\s+/g, " ");
    if (!text || text.length > 60 || text.split(" ").length > 2) continue;
    const trail = w.text.match(/[.,;:?!…»"”)]+$/)?.[0] ?? "";
    const lead = w.text.match(/^[¿¡«"“(]+/)?.[0] ?? "";
    if (trail && !/[.,;:?!…»"”)]$/.test(text)) text += trail;
    if (lead && !/^[¿¡«"“(]/.test(text)) text = lead + text;
    if (text === w.text) continue;
    out[String(f.id)] = text;
  }
  return out;
}

/**
 * Corrige las palabras mal transcritas para los subtítulos (solo el texto: el audio y los tiempos quedan igual).
 * Nunca tira error: si la IA no está o falla, el video sigue con la transcripción tal cual.
 */
export async function proofreadTranscript(input: { words: Word[]; brandCtx: string; script: string | null }): Promise<Record<string, string>> {
  if (!aiConfigured() || !input.words.length) return {};
  const words = input.words.slice(0, MAX_WORDS);
  try {
    const out = await generateStructured({
      feature: "video.transcripcion.corregir",
      model: "main",
      context: `${TRANSCRIPT_FIX_RULES}\n\n${input.brandCtx}`,
      task: transcriptFixTask({ words, script: input.script }),
      schema: transcriptFixSchema,
      maxTokens: 3000,
      fake: () => ({ fixes: [] }),
    });
    return cleanFixes(words, out.fixes);
  } catch (error) {
    console.error("[editor] corrección de transcripción:", error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
    return {};
  }
}
