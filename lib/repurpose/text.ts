/**
 * Texto de origen de "Sacarle todo el jugo" y hashtags medidos. Sin dependencias de servidor: se prueba solo.
 */
import type { EditPlan, Transcript } from "@/lib/video/types";
import { removedIds } from "@/lib/video/timeline";

/** Texto del video editado: la transcripción sin los tramos que se cortaron (tomas malas, muletillas, silencios). */
export function editedTranscriptText(transcript: Transcript | null | undefined, plan: Pick<EditPlan, "removals"> | null | undefined): string {
  const words = transcript?.words ?? [];
  if (!words.length) return "";
  const removed = plan?.removals?.length ? removedIds(plan, words.length) : new Set<number>();
  return words
    .filter((w) => !removed.has(w.id))
    .map((w) => w.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.;:!?…])/g, "$1")
    .trim();
}

export function wordCount(text: string): number {
  return (text.match(/\p{L}[\p{L}\p{N}'’-]*/gu) ?? []).length;
}

/** Hashtags de relleno: no dicen de qué trata la pieza ni a quién le sirve. Nunca se proponen. */
export const FILLER_HASHTAGS = new Set(
  ["fyp", "foryou", "foryoupage", "parati", "paratii", "viral", "virales", "viralvideo", "trending", "trend", "explore", "explorepage", "explorar", "reels", "reel", "reelsinstagram", "instagood", "instagram", "tiktok", "youtube", "shorts", "short", "video", "videos", "follow", "likes", "like4like", "follow4follow", "love", "fyy", "xyzbca", "capcut"].map((t) => t.toLowerCase()),
);

export function extractHashtags(text: string | null | undefined): string[] {
  return [...(text ?? "").matchAll(/#([\p{L}\p{N}_]{2,60})/gu)].map((m) => m[1]!);
}

/** Clave para comparar hashtags sin mayúsculas ni tildes ("#Educación" = "#educacion"). Se muestra como lo escribió la persona. */
export function hashtagKey(tag: string): string {
  return tag.replace(/^#/, "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Limpia la lista que propone la IA: con #, sin espacios, sin repetidos, sin relleno y con un tope. */
export function cleanHashtags(tags: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const body = raw.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (body.length < 2) continue;
    const key = hashtagKey(body);
    if (seen.has(key) || FILLER_HASHTAGS.has(key)) continue;
    seen.add(key);
    out.push(`#${body}`);
    if (out.length >= max) break;
  }
  return out;
}

export type MeasuredHashtag = { tag: string; uses: number; median: number };

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Hashtags que la persona ya usó, con cuánto rindieron sus piezas (mediana de "× tu mediana").
 * Solo cuentan los que aparecen en al menos `minUses` piezas medidas; los de relleno no entran.
 */
export function rankHashtags(pieces: { caption: string | null; perfScore: number | null }[], minUses = 2, limit = 12): MeasuredHashtag[] {
  const byKey = new Map<string, { tag: string; scores: number[] }>();
  for (const p of pieces) {
    if (p.perfScore == null || !Number.isFinite(p.perfScore)) continue;
    const seen = new Set<string>();
    for (const tag of extractHashtags(p.caption)) {
      const key = hashtagKey(tag);
      if (FILLER_HASHTAGS.has(key) || seen.has(key)) continue;
      seen.add(key);
      const entry = byKey.get(key) ?? { tag: `#${tag}`, scores: [] };
      entry.scores.push(p.perfScore);
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()]
    .filter((e) => e.scores.length >= minUses)
    .map((e) => ({ tag: e.tag, uses: e.scores.length, median: median(e.scores) }))
    .sort((a, b) => b.median - a.median || b.uses - a.uses)
    .slice(0, limit);
}
