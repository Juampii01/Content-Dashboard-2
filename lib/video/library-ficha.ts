/**
 * Ficha de cada pieza de la biblioteca (videos e imágenes): lo que Claude vio al subirla (descripción, momentos con su
 * tramo dentro del clip, colores, estilo, usos y etiquetas). Con ella se busca por texto, se elige el b-roll por lo que
 * se ve (y desde qué segundo del clip) y se le cuenta a Claude qué tiene la persona en su biblioteca.
 *
 * Funciones puras (sin base ni red): las usan lib/video/library.ts, lib/video/broll.ts, el chat del video y las pruebas.
 */
import { z } from "zod";
import { PHOTO_DEFAULTS } from "./broll-edit";
import { normalizeWord } from "./broll-options";
import type { BrollItem, BrollOption } from "./types";

export const LIBRARY_KINDS = ["video", "image"] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

/** none: subida antes de las fichas · pending: esperando los cuadros o a Claude · thinking: Claude la está escribiendo. */
export const FICHA_STATUSES = ["none", "pending", "thinking", "ready", "failed"] as const;
export type FichaStatus = (typeof FICHA_STATUSES)[number];

export const fichaMomentSchema = z.object({
  start: z.number().min(0).max(600),
  end: z.number().min(0).max(600),
  what: z.string().trim().min(1).max(240),
});
export type FichaMoment = z.infer<typeof fichaMomentSchema>;

/** La ficha guardada (y la que edita la persona). */
export const fichaSchema = z.object({
  description: z.string().trim().max(600),
  moments: z.array(fichaMomentSchema).max(16),
  colors: z.array(z.string().trim().min(1).max(30)).max(6),
  style: z.string().trim().max(300),
  uses: z.array(z.string().trim().min(1).max(120)).max(6),
  tags: z.array(z.string().trim().min(1).max(30)).max(16),
  tagsEn: z.array(z.string().trim().min(1).max(30)).max(12),
});
export type Ficha = z.infer<typeof fichaSchema>;

/** Hoja de cuadros de un clip (la arma el worker): su clave, su tamaño y el segundo de cada cuadro (#1, #2…). */
export const fichaSheetSchema = z.object({
  key: z.string().regex(/^editor\/biblioteca\/[0-9a-f-]{36}\/hoja-[0-9]{2}\.jpg$/),
  width: z.number().int().min(1).max(4000),
  height: z.number().int().min(1).max(4000),
  frames: z.array(z.number().int().min(1).max(200)).max(60),
  times: z.array(z.number().min(0).max(600)).max(60),
});
export type FichaSheet = z.infer<typeof fichaSheetSchema>;

/**
 * Lo que devuelve Claude (salida estructurada: sin topes numéricos, que la API no acepta; se ajusta en `fichaFromAi`).
 */
export const fichaAiSchema = z.object({
  description: z.string().describe("Qué es, en 1 a 3 frases: qué se ve, dónde, quién, qué pasa."),
  moments: z
    .array(
      z.object({
        start: z.number().describe("Segundo del clip donde empieza (de los cuadros #n)."),
        end: z.number().describe("Segundo donde termina."),
        what: z.string().describe("Qué se ve en ese tramo, concreto (acción, objeto, encuadre)."),
      }),
    )
    .max(12)
    .describe("Tramos del clip con algo distinto que mostrar, en orden y sin superponerse. En una imagen, vacío."),
  colors: z.array(z.string()).max(5).describe("Colores dominantes en hexadecimal (#1f2a44)."),
  style: z.string().describe("Estilo y encuadre: plano (general, medio, detalle), luz, movimiento de cámara, look."),
  uses: z.array(z.string()).max(6).describe("Para qué sirve como b-roll o referencia: temas de los que puede hablar la persona mientras se ve."),
  tags: z.array(z.string()).max(12).describe("Etiquetas en español, una o dos palabras cada una."),
  tags_en: z.array(z.string()).max(10).describe("Las mismas etiquetas en inglés."),
});
export type FichaAi = z.infer<typeof fichaAiSchema>;

const clean = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);
const cleanList = (list: string[], max: number, len: number) => [...new Set(list.map((t) => clean(t, len)).filter((t) => t.length >= 2))].slice(0, max);
const tagList = (list: string[], max: number) => cleanList(list.map((t) => t.toLowerCase()), max, 30);

/** Normaliza lo que dijo Claude: tramos dentro del clip, en orden y sin superponerse; colores en hexadecimal. */
export function fichaFromAi(ai: FichaAi, duration: number, kind: LibraryKind): Ficha {
  const dur = Math.max(0, duration);
  const moments: FichaMoment[] = [];
  if (kind === "video" && dur > 0) {
    const sorted = [...ai.moments].filter((m) => Number.isFinite(m.start) && Number.isFinite(m.end)).sort((a, b) => a.start - b.start);
    for (const m of sorted) {
      const start = Math.max(0, Math.min(m.start, dur));
      const end = Math.max(0, Math.min(Math.max(m.end, m.start), dur));
      const prev = moments.at(-1);
      const from = prev ? Math.max(start, prev.end) : start;
      if (end - from < 0.4 || !m.what.trim()) continue;
      moments.push({ start: round(from), end: round(end), what: clean(m.what, 240) });
      if (moments.length >= 12) break;
    }
  }
  return {
    description: clean(ai.description, 600),
    moments,
    colors: cleanList(ai.colors.filter((c) => /^#?[0-9a-f]{6}$/i.test(c.trim())).map((c) => (c.trim().startsWith("#") ? c.trim() : `#${c.trim()}`).toLowerCase()), 5, 7),
    style: clean(ai.style, 300),
    uses: cleanList(ai.uses, 6, 120),
    tags: tagList(ai.tags, 12),
    tagsEn: tagList(ai.tags_en, 10),
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Valida una ficha editada por la persona (o guardada antes): null si no se puede leer. */
export function readFicha(raw: unknown, duration?: number | null): Ficha | null {
  const parsed = fichaSchema.safeParse(raw);
  if (!parsed.success) return null;
  const f = parsed.data;
  const dur = duration && duration > 0 ? duration : 600;
  const moments = f.moments
    .map((m) => ({ start: round(Math.min(m.start, dur)), end: round(Math.min(Math.max(m.end, m.start), dur)), what: clean(m.what, 240) }))
    .filter((m) => m.end - m.start >= 0.2 && m.what)
    .sort((a, b) => a.start - b.start);
  return { ...f, description: clean(f.description, 600), style: clean(f.style, 300), moments, tags: tagList(f.tags, 16), tagsEn: tagList(f.tagsEn, 12), uses: cleanList(f.uses, 6, 120), colors: cleanList(f.colors, 6, 30) };
}

/**
 * Texto para buscar (columna search_text, con índice de texto de Postgres): minúsculas y sin tildes, igual que la
 * búsqueda. Lleva el nombre, las etiquetas y toda la ficha.
 */
export function searchTextOf(input: { title: string; tags: string[]; ficha: Ficha | null }): string {
  const f = input.ficha;
  const parts = [input.title, ...input.tags, ...(f ? [f.description, f.style, ...f.uses, ...f.tags, ...f.tagsEn, ...f.moments.map((m) => m.what)] : [])];
  return normalizeWord(parts.join(" ")).replace(/\s+/g, " ").slice(0, 8000);
}

/** La búsqueda escrita por la persona, normalizada igual que search_text (para `plainto_tsquery`). */
export function searchQueryOf(query: string): string {
  return normalizeWord(query).replace(/\s+/g, " ").trim().slice(0, 200);
}

// ─── Elegir por lo que se ve ──────────────────────────────────────────────

export type LibraryEntry = {
  id: string;
  kind: LibraryKind;
  title: string;
  tags: string[];
  duration: number;
  width: number;
  height: number;
  ficha: Ficha | null;
};

const STOP = new Set(["the", "and", "for", "with", "una", "uno", "unos", "unas", "los", "las", "del", "con", "por", "para", "que", "como", "muy", "mas", "sus", "este", "esta", "eso", "esto", "hay", "son", "sin", "sobre"]);

function wantedWords(keywords: string[]): string[] {
  return [...new Set(keywords.flatMap((k) => normalizeWord(k).split(" ")).filter((w) => w.length >= 3 && !STOP.has(w)))];
}

/** Coincide una palabra buscada con una palabra del texto (con raíz: "llamando" ~ "llamada", "client" ~ "clientes"). */
function hits(text: string, w: string): boolean {
  const stem = w.slice(0, Math.max(4, w.length - 2));
  return text.split(" ").some((t) => t.length >= 3 && (t === w || t.startsWith(stem) || (t.length >= 4 && w.startsWith(t.slice(0, Math.max(4, t.length - 2))))));
}

export type LibraryMatch = { score: number; moment: FichaMoment | null };

/**
 * Qué tan bien una pieza responde a lo que se busca, mirando su ficha: etiquetas (en español e inglés) y nombre valen
 * más; la descripción, los usos y el estilo, menos; y cada momento suma por su lado (el que más suma es el tramo que
 * se usa). 0 = nada.
 */
export function matchLibrary(entry: LibraryEntry, keywords: string[]): LibraryMatch {
  const wanted = wantedWords(keywords);
  if (!wanted.length) return { score: 0, moment: null };
  const f = entry.ficha;
  const tags = [...entry.tags, ...(f?.tags ?? []), ...(f?.tagsEn ?? [])].map(normalizeWord).join(" ");
  const title = normalizeWord(entry.title);
  const body = normalizeWord([f?.description ?? "", f?.style ?? "", ...(f?.uses ?? [])].join(" "));
  let score = 0;
  for (const w of wanted) {
    if (hits(tags, w)) score += 3;
    else if (hits(title, w)) score += 2;
    else if (hits(body, w)) score += 1;
  }
  let moment: FichaMoment | null = null;
  let best = 0;
  for (const m of f?.moments ?? []) {
    const text = normalizeWord(m.what);
    const s = wanted.reduce((n, w) => n + (hits(text, w) ? 1.5 : 0), 0);
    if (s > best) {
      best = s;
      moment = m;
    }
  }
  return { score: score + best, moment };
}

/**
 * Desde qué segundo del clip se ve para cubrir `span` segundos: el arranque del momento elegido, sin pasarse del final
 * del clip (si el momento es más corto, se corre hacia atrás lo justo). Imágenes y clips sin datos: 0.
 */
export function clipStartFor(entry: Pick<LibraryEntry, "kind" | "duration">, moment: Pick<FichaMoment, "start" | "end"> | null, span: number): number {
  if (entry.kind !== "video" || !moment || !(entry.duration > 0)) return 0;
  const latest = Math.max(0, entry.duration - Math.max(0.5, span));
  return round(Math.max(0, Math.min(moment.start, latest)));
}

/** El momento que contiene (o está más cerca de) un segundo del clip: para cuando Claude da el segundo exacto. */
export function momentAt(entry: LibraryEntry, at: number): FichaMoment | null {
  const ms = entry.ficha?.moments ?? [];
  return ms.find((m) => at >= m.start - 0.05 && at < m.end) ?? null;
}

// ─── Lo que Claude sabe de la biblioteca ──────────────────────────────────

const fmt = (t: number) => (t >= 60 ? `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}` : `${t.toFixed(1)}`);
const shape = (e: Pick<LibraryEntry, "width" | "height">) => (!e.width || !e.height ? "" : e.height > e.width * 1.1 ? "vertical" : e.width > e.height * 1.1 ? "horizontal" : "cuadrado");

/** Una pieza en una línea: «C3 «Oficina» (video 12.0 s, vertical): descripción · momentos [0.0–3.5] … · usos …». */
export function catalogLine(code: string, e: LibraryEntry, opts: { moments?: boolean } = {}): string {
  const f = e.ficha;
  const head = `${code} «${e.title.slice(0, 60)}» (${e.kind === "image" ? "imagen" : `video ${e.duration.toFixed(1)} s`}${shape(e) ? `, ${shape(e)}` : ""})`;
  if (!f) return `${head}: sin ficha; etiquetas ${e.tags.join(", ") || "(ninguna)"}`;
  const moments = opts.moments !== false && f.moments.length ? ` · momentos ${f.moments.map((m) => `[${fmt(m.start)}–${fmt(m.end)}] ${m.what.slice(0, 90)}`).join("; ")}` : "";
  const uses = f.uses.length ? ` · usos: ${f.uses.slice(0, 4).join(", ")}` : "";
  return `${head}: ${f.description.slice(0, 220)}${moments}${uses}`;
}

/**
 * La biblioteca para un prompt: una línea por pieza con su código (C1, C2…), hasta `maxChars`. Devuelve el texto y el
 * código de cada pieza, para leer después lo que eligió Claude.
 */
export function libraryCatalog(entries: LibraryEntry[], opts: { maxChars?: number; kinds?: LibraryKind[] } = {}): { text: string; codes: Map<string, LibraryEntry> } {
  const max = opts.maxChars ?? 5000;
  const codes = new Map<string, LibraryEntry>();
  const lines: string[] = [];
  let used = 0;
  for (const e of entries) {
    if (opts.kinds && !opts.kinds.includes(e.kind)) continue;
    const code = `C${codes.size + 1}`;
    let line = catalogLine(code, e);
    if (used + line.length > max) line = catalogLine(code, e, { moments: false });
    if (used + line.length > max) break;
    codes.set(code, e);
    lines.push(line);
    used += line.length + 1;
  }
  return { text: lines.join("\n"), codes };
}

/** Lo que Claude lee de una pieza que la persona nombró con @ o adjuntó: la ficha completa en pocas líneas. */
export function fichaText(e: LibraryEntry): string {
  const f = e.ficha;
  if (!f) return `«${e.title}» (${e.kind === "image" ? "imagen" : `video de ${e.duration.toFixed(1)} s`}), todavía sin ficha. Etiquetas: ${e.tags.join(", ") || "ninguna"}.`;
  return [
    `«${e.title}» (${e.kind === "image" ? "imagen" : `video de ${e.duration.toFixed(1)} s`}${shape(e) ? `, ${shape(e)}` : ""}): ${f.description}`,
    f.moments.length ? `Momentos: ${f.moments.map((m) => `[${fmt(m.start)}–${fmt(m.end)} s] ${m.what}`).join("; ")}` : "",
    f.style ? `Estilo: ${f.style}` : "",
    f.colors.length ? `Colores: ${f.colors.join(", ")}` : "",
    f.uses.length ? `Usos: ${f.uses.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Cómo se nombra una pieza con @ en el chat: el nombre en minúsculas, sin tildes y con guiones ("@oficina-de-noche"). */
export function mentionSlug(title: string): string {
  return normalizeWord(title).replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "pieza";
}

/** Las menciones (@algo) de un texto, sin repetir. */
export function mentionsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/(?:^|\s)@([\p{L}\p{N}][\p{L}\p{N}_-]{0,39})/gu)].map((m) => m[1]!.toLowerCase()))];
}

// ─── De la biblioteca al b-roll ───────────────────────────────────────────

/** Una pieza como alternativa de b-roll (con el tramo del clip que mejor encaja, si se sabe). */
export function pieceOption(p: LibraryEntry & { fileKey: string; thumbKey: string | null }, moment: FichaMoment | null = null): BrollOption {
  return {
    source: "library",
    id: p.id,
    duration: p.kind === "image" ? 0 : p.duration,
    width: p.width,
    height: p.height,
    key: p.fileKey,
    thumbKey: p.thumbKey,
    title: p.title,
    ...(p.kind === "image" ? { kind: "image" as const } : {}),
    ...(moment ? { moment: { start: moment.start, end: moment.end, what: moment.what } } : {}),
  };
}

/**
 * Si el b-roll elegido es un clip de la biblioteca con su tramo, se ve desde ese segundo (`edit.clip_start`). Lo usan
 * el plan automático, el director y el chat; en la revisión, elegir otra alternativa vuelve a calcularlo.
 *
 * Una imagen que entra al plan sin movimiento elegido recibe el de las fotos nuevas (automático, con fondo
 * desenfocado). Los planes guardados antes no pasan por aquí: sus fotos siguen fijas.
 */
export function withLibraryStart(item: BrollItem, span: number): BrollItem {
  const c = item.choice;
  if (!c || c.source !== "library") return item;
  if (c.kind === "image" && !item.edit?.motion) {
    const edit = { ...(item.edit ?? {}), ...PHOTO_DEFAULTS, clip_start: 0 };
    if (item.edit?.fit) edit.fit = item.edit.fit;
    return { ...item, edit };
  }
  const start = c.kind === "image" ? 0 : clipStartFor({ kind: "video", duration: c.duration }, c.moment ?? null, span);
  if (!start && !item.edit?.clip_start) return item;
  return { ...item, edit: { ...(item.edit ?? {}), clip_start: start } };
}
