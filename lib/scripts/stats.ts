import type { ScriptContent } from "@/lib/db/schema";

/** Palabras habladas y duración estimada (unas 2.5 palabras por segundo en video corto). */
export function scriptStats(content: ScriptContent): { wordCount: number; estimatedSeconds: number } {
  const text = [content.hooks[content.selectedHook]?.text ?? "", ...content.beats.map((b) => b.spoken), content.cta.spoken].join(" ");
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return { wordCount, estimatedSeconds: Math.round(wordCount / 2.5) };
}
