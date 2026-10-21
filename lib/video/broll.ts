import "server-only";
import { desc, eq } from "drizzle-orm";
import { AiError, generateStructured } from "@/lib/ai/client";
import { BROLL_RULES, brollAiSchema, brollTask, sentences } from "@/lib/ai/prompts/editor";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { libraryOption, libraryScore, mapPexelsVideo, mapPixabayVideo, type LibraryClip, type PexelsVideo, type PixabayVideo } from "./broll-options";
import type { StylePreset } from "./style";
import { removedIds } from "./timeline";
import type { BrollItem, BrollOption, EditPlan, VideoFormat, Word } from "./types";

/**
 * B-roll de video para el Editor (solo videos, no imágenes).
 *
 * Fuentes detrás de una sola interfaz (`BrollSource`):
 * - Pixabay: videos de stock gratis con uso comercial y sin atribución obligatoria (igual la mostramos).
 *   Clave gratuita en PIXABAY_API_KEY. Se baja el archivo al render (no se enlaza de forma permanente).
 * - Pexels: videos de stock gratis con uso comercial; la guía pide atribución visible (en la revisión y en
 *   creditos.txt junto a la descarga). Clave gratuita en PEXELS_API_KEY.
 * Sin ninguna de las dos claves, el stock no se usa.
 * - Biblioteca del cliente: clips que sube una vez (broll_clips), con etiquetas.
 * - Videos generados con IA: todavía no (caros, lentos y se notan artificiales). Cuando se sumen, se agrega
 *   una fuente con `kind: "ai"` que devuelva `BrollOption` y el resto del flujo no cambia.
 */
export type BrollQuery = { queryEn: string; keywords: string[]; format: VideoFormat; minDuration: number };

export interface BrollSource {
  kind: "pixabay" | "pexels" | "library" | "ai";
  available(): boolean;
  search(query: BrollQuery, limit: number): Promise<BrollOption[]>;
}

export class BrollError extends Error {}

export const pexelsSource: BrollSource = {
  kind: "pexels",
  available: () => Boolean(env().PEXELS_API_KEY),
  async search(query, limit) {
    const key = env().PEXELS_API_KEY;
    if (!key || !query.queryEn.trim()) return [];
    const params = new URLSearchParams({
      query: query.queryEn.trim().slice(0, 100),
      orientation: query.format === "9:16" ? "portrait" : "landscape",
      size: "medium",
      per_page: String(Math.min(15, limit + 4)),
    });
    let res: Response;
    try {
      res = await fetch(`${env().PEXELS_API_BASE}/videos/search?${params}`, { headers: { authorization: key }, signal: AbortSignal.timeout(12_000) });
    } catch {
      throw new BrollError("Pexels no respondió. Prueba de nuevo en un momento.");
    }
    if (res.status === 401 || res.status === 403) throw new BrollError("La clave de Pexels no es válida. Avísale a soporte.");
    if (res.status === 429) throw new BrollError("Llegamos al límite de búsquedas de Pexels por esta hora. Prueba más tarde o usa tu biblioteca.");
    if (!res.ok) throw new BrollError("Pexels no respondió bien. Prueba de nuevo en un momento.");
    const body = (await res.json().catch(() => null)) as { videos?: PexelsVideo[] } | null;
    return (body?.videos ?? [])
      .map((v) => mapPexelsVideo(v, query.format))
      .filter((o): o is BrollOption => Boolean(o && o.duration >= Math.min(query.minDuration, 3)))
      .slice(0, limit);
  },
};

export const pixabaySource: BrollSource = {
  kind: "pixabay",
  available: () => Boolean(env().PIXABAY_API_KEY),
  async search(query, limit) {
    const key = env().PIXABAY_API_KEY;
    if (!key || !query.queryEn.trim()) return [];
    const params = new URLSearchParams({
      key,
      q: query.queryEn.trim().slice(0, 100),
      lang: "en",
      safesearch: "true",
      // Pixabay no filtra por orientación: se piden más y se descartan las que no sirven.
      per_page: String(Math.min(30, Math.max(6, limit * 3))),
    });
    let res: Response;
    try {
      res = await fetch(`${env().PIXABAY_API_BASE}/api/videos/?${params}`, { signal: AbortSignal.timeout(12_000) });
    } catch {
      throw new BrollError("Pixabay no respondió. Prueba de nuevo en un momento.");
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new BrollError("La clave de Pixabay no es válida. Avísale a soporte.");
    if (res.status === 429) throw new BrollError("Llegamos al límite de búsquedas de Pixabay por ahora. Prueba en un minuto o usa tu biblioteca.");
    if (!res.ok) throw new BrollError("Pixabay no respondió bien. Prueba de nuevo en un momento.");
    const body = (await res.json().catch(() => null)) as { hits?: PixabayVideo[] } | null;
    return (body?.hits ?? [])
      .map((v) => mapPixabayVideo(v, query.format))
      .filter((o): o is BrollOption => Boolean(o && o.duration >= Math.min(query.minDuration, 3)))
      .slice(0, limit);
  },
};

const stockSources = [pixabaySource, pexelsSource];

async function readyClips(): Promise<LibraryClip[]> {
  const rows = await getDb()
    .select()
    .from(schema.brollClips)
    .where(eq(schema.brollClips.status, "READY"))
    .orderBy(desc(schema.brollClips.updatedAt))
    .limit(500);
  return rows.map((r) => ({ id: r.id, title: r.title, tags: r.tags, fileKey: r.fileKey, thumbKey: r.thumbKey, duration: r.duration ?? 0, width: r.width ?? 0, height: r.height ?? 0 }));
}

export const librarySource: BrollSource = {
  kind: "library",
  available: () => true,
  async search(query, limit) {
    const clips = await readyClips();
    return clips
      .map((c) => ({ c, score: libraryScore(c, [...query.keywords, ...query.queryEn.split(" ")]) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => libraryOption(x.c));
  },
};

/** Toda la biblioteca (para elegir a mano en la revisión). */
export async function libraryOptions(): Promise<BrollOption[]> {
  return (await readyClips()).map(libraryOption);
}

export async function libraryTags(): Promise<string[]> {
  const clips = await readyClips();
  return [...new Set(clips.flatMap((c) => [...c.tags, ...c.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3)]))].slice(0, 80);
}

/** Hasta 6 alternativas: primero los clips propios que coinciden, después el stock (Pixabay y Pexels, mezclados). */
export async function searchOptions(query: BrollQuery, limit = 6): Promise<{ options: BrollOption[]; warning: string | null }> {
  const own = await librarySource.search(query, 3);
  const active = stockSources.filter((s) => s.available());
  const room = limit - own.length;
  let warning: string | null = null;
  const results = await Promise.all(
    active.map(async (source) => {
      try {
        return await source.search(query, room);
      } catch (error) {
        warning ??= error instanceof BrollError ? error.message : "No pudimos buscar videos de stock.";
        return [];
      }
    }),
  );
  // Intercalados (uno de cada fuente) para que una no tape a la otra.
  const stock: BrollOption[] = [];
  for (let i = 0; stock.length < room && results.some((r) => r[i]); i++) for (const r of results) if (r[i] && stock.length < room) stock.push(r[i]!);
  // Si una fuente falló pero la otra trajo clips, no hace falta avisar.
  if (stock.length) warning = null;
  return { options: [...own, ...stock].slice(0, limit), warning };
}

/** Si hay videos de stock activos (alguna clave cargada). */
export function brollSourcesReady(): { stock: boolean } {
  return { stock: stockSources.some((s) => s.available()) };
}

// ─── Plan de b-roll (lo arma Claude) ──────────────────────────────────────

const DEFAULT_EVERY: Record<VideoFormat, number> = { "9:16": 10, "16:9": 20 };
const MAX_ITEMS: Record<VideoFormat, number> = { "9:16": 8, "16:9": 12 };

let counter = 0;
const newId = () => `b${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * Dónde va cada b-roll y con qué clip. Nunca dentro del gancho elegido ni de la última frase (el llamado a la
 * acción). La cadencia sale del estilo (si hay) o de 0–1 cada 8–12 s en reels. Si la IA o el stock fallan,
 * el video se edita igual, sin b-roll o con menos alternativas, y se avisa.
 */
export async function planBroll(input: {
  words: Word[];
  plan: EditPlan;
  outputDuration: number;
  format: VideoFormat;
  preset: StylePreset | null;
  context: string;
}): Promise<{ items: BrollItem[]; warning: string | null }> {
  const { words, plan, format } = input;
  const every = input.preset?.broll.enabled ? input.preset.broll.everySeconds : DEFAULT_EVERY[format];
  const target = Math.min(MAX_ITEMS[format], Math.floor(input.outputDuration / Math.max(6, every)));
  if (target < 1 || words.length < 12) return { items: [], warning: null };
  const length = input.preset?.broll.enabled ? input.preset.broll.durationSeconds : 2.5;
  const minSeconds = Math.max(1, length * 0.6);
  const maxSeconds = Math.min(6, Math.max(minSeconds + 0.8, length * 1.6));

  const removed = removedIds(plan, words.length);
  const forbidden: { from: number; to: number; label: string }[] = [];
  const hook = plan.selected_hook != null ? plan.hook_candidates[plan.selected_hook] : null;
  if (hook) forbidden.push({ from: hook.from_word, to: hook.to_word, label: "gancho" });
  const kept = words.filter((w) => !removed.has(w.id));
  const first = kept[0];
  if (first) {
    // Los primeros 3 s del video se ven a cámara.
    const opening = kept.filter((w) => w.start - first.start < 3).at(-1);
    forbidden.push({ from: first.id, to: opening?.id ?? first.id, label: "apertura" });
  }
  const last = sentences(kept).at(-1);
  if (last) forbidden.push({ from: last.from, to: last.to, label: "llamado a la acción" });

  let ai;
  try {
    ai = await generateStructured({
      feature: "video.broll",
      model: "main",
      context: `${BROLL_RULES}\n\n${input.context}`,
      task: brollTask({ words: kept, count: target, minSeconds, maxSeconds, forbidden, format, libraryTags: await libraryTags() }),
      schema: brollAiSchema,
      maxTokens: 2500,
    });
  } catch (error) {
    console.error("[editor] b-roll sin IA:", error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
    return { items: [], warning: "No pudimos elegir el b-roll con IA. Puedes agregarlo a mano desde la revisión." };
  }

  const blocked = (id: number) => forbidden.some((f) => id >= f.from && id <= f.to);
  const chosen: BrollItem[] = [];
  for (const b of ai.broll) {
    if (chosen.length >= target) break;
    const from = Math.max(0, Math.min(b.from_word, b.to_word));
    const to = Math.min(words.length - 1, Math.max(b.from_word, b.to_word));
    if (from >= words.length || to < 0) continue;
    const ids = Array.from({ length: to - from + 1 }, (_, k) => from + k);
    if (ids.some(blocked)) continue;
    if (ids.filter((id) => removed.has(id)).length > ids.length * 0.4) continue;
    const span = words[to]!.end - words[from]!.start;
    if (span < 0.8 || span > 8) continue;
    if (chosen.some((c) => from <= c.to_word && c.from_word <= to)) continue;
    chosen.push({ id: newId(), from_word: from, to_word: to, query_en: b.query_en.trim().slice(0, 120), keywords: b.keywords.map((k) => k.trim().slice(0, 40)).filter(Boolean).slice(0, 4), why: b.why.slice(0, 300), choice: null, options: [] });
  }
  chosen.sort((a, b) => a.from_word - b.from_word);

  let warning: string | null = null;
  for (const item of chosen) {
    const span = words[item.to_word]!.end - words[item.from_word]!.start;
    const { options, warning: w } = await searchOptions({ queryEn: item.query_en, keywords: item.keywords, format, minDuration: span });
    warning ??= w;
    item.options = options;
    item.choice = options[0] ?? null;
  }
  if (chosen.length && chosen.every((c) => !c.choice)) {
    warning ??= brollSourcesReady().stock
      ? "No encontramos clips para el b-roll. Puedes buscar otros o subir los tuyos a la biblioteca."
      : "Para el b-roll automático sube clips a tu biblioteca (o pide que activen los videos de stock).";
  }
  return { items: chosen, warning };
}

export function newBrollId(): string {
  return newId();
}
