/**
 * Efectos en el plan de edición: forma (Zod), textos por defecto a partir de lo que se dice, validación (que no se
 * pisen entre sí ni con el b-roll, duración y textos dentro de los límites de cada efecto) y la configuración de Mi
 * marca (qué efectos puede elegir el director y con qué frecuencia). Sin servidor.
 */
import { z } from "zod";
import { FX_FREQUENCIES, FX_INFO, FX_KINDS, FX_MOVABLE, SIGNATURE_FX_KINDS, type FxFrequency, type FxKind } from "./catalog";
import { animSchema, cleanPlace, transformSchema } from "../canvas/transform";
import { captionText, norm } from "../text";

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

export const fxItemSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(FX_KINDS),
  from_word: z.number().int().min(0),
  to_word: z.number().int().min(0),
  /** Texto principal (palabra de portada, rótulo, comando…). */
  text: z.string().max(90).optional(),
  /** Lista de textos (tareas, titulares). */
  items: z.array(z.string().max(80)).max(6).optional(),
  /** Rótulo chico (fecha y número de la portada, nombre de la ventana). */
  kicker: z.string().max(40).optional(),
  /** Zoom digital: ids de las palabras fuertes (dentro del tramo). */
  words: z.array(z.number().int().min(0)).max(6).optional(),
  /** Color de acento propio (si no, el de Mi marca). */
  accent: hex.optional(),
  why: z.string().max(300).optional(),
  source: z.enum(["director", "user"]).optional(),
  /**
   * Solo los efectos con elemento movible (FX_MOVABLE): dónde va ese elemento y cómo entra y sale, desde el lienzo de
   * la revisión. Sin estos campos, como siempre (la entrada y la salida propias del efecto).
   */
  transform: transformSchema.optional(),
  anim: animSchema.optional(),
  /** Capa (orden de dibujo): más alta, más arriba. Sin el campo, 0 (planes viejos). Ver lib/video/layers.ts. */
  layer: z.number().int().min(0).max(999).optional(),
});
export type FxItem = z.infer<typeof fxItemSchema>;

export const MAX_EFFECTS = 40;
export const fxListSchema = z.array(fxItemSchema).max(MAX_EFFECTS);

// ─── Mi marca: qué efectos puede usar el director ─────────────────────────

/** Versión del catálogo: 2 = la biblioteca de 100. Lo guardado con la de 17 suma solo los efectos nuevos. */
export const FX_CATALOG_VERSION = 2;

export const fxSettingsSchema = z.object({
  allowed: z.array(z.enum(FX_KINDS)).max(FX_KINDS.length),
  frequency: z.enum(FX_FREQUENCIES),
  v: z.number().int().optional(),
});
export type FxSettings = { allowed: FxKind[]; frequency: FxFrequency; v?: number };

/** De fábrica: todos permitidos, frecuencia normal. */
export const FX_FACTORY: FxSettings = { allowed: [...FX_KINDS], frequency: "normal", v: FX_CATALOG_VERSION };

export function readFxSettings(raw: unknown): FxSettings {
  // Lo guardado antes de la biblioteca de 100 trae nombres que existen: se lee igual (los desconocidos se ignoran).
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const allowedRaw = Array.isArray(obj?.allowed) ? obj.allowed.filter((k): k is FxKind => typeof k === "string" && (FX_KINDS as readonly string[]).includes(k)) : null;
  const parsed = fxSettingsSchema.safeParse(obj ? { ...obj, allowed: allowedRaw ?? obj.allowed } : raw);
  if (!parsed.success || (Array.isArray(obj?.allowed) && obj.allowed.length > 0 && allowedRaw?.length === 0)) return { ...FX_FACTORY, allowed: [...FX_FACTORY.allowed] };
  const allowed = new Set(parsed.data.allowed as FxKind[]);
  // Elegido con el catálogo de 17: los nuevos quedan permitidos (no existían cuando la persona eligió).
  if ((parsed.data.v ?? 1) < FX_CATALOG_VERSION) for (const k of FX_KINDS) if (!(SIGNATURE_FX_KINDS as readonly string[]).includes(k)) allowed.add(k);
  return { allowed: FX_KINDS.filter((k) => allowed.has(k)), frequency: parsed.data.frequency as FxFrequency, v: FX_CATALOG_VERSION };
}

// ─── Textos por defecto ───────────────────────────────────────────────────

type SpokenWord = { id: number; text: string };

const STOP = new Set(
  "el la los las un una unos unas de del al a en y o que con por para es son se te tu tus mi mis su sus lo le les como pero si no ya muy mas más este esta esto ese esa eso hay fue ser estar tienes tiene tengo hace hacer cuando donde porque yo me nos qué cómo cuál todo toda todos".split(" "),
);

const upper = (s: string) => s.toLocaleUpperCase("es");

/** La palabra más fuerte del tramo: la más larga que no es de relleno (o un número). */
export function keyWord(words: SpokenWord[]): string {
  const clean = words.map((w) => captionText(w.text)).filter(Boolean);
  const num = clean.find((w) => /\d/.test(w));
  if (num) return num.slice(0, 12);
  const best = clean.filter((w) => !STOP.has(norm(w))).sort((a, b) => b.length - a.length)[0];
  return (best ?? clean[0] ?? "").replace(/[¿?¡!]/g, "").slice(0, 12);
}

/** Partes del tramo para listas (tareas, titulares): por frases o por "primero/segundo/tercero". */
export function phrasesOf(words: SpokenWord[], count: number, max: number): string[] {
  const text = words.map((w) => w.text).join(" ");
  const parts = text
    .split(/(?<=[.?!;])\s+|\b(?:primero|segundo|tercero|cuarto|quinto|después|luego|y por último|por último)\b[,:]?\s*/i)
    .map((p) => captionText(p.trim()))
    .filter((p) => p.split(/\s+/).length >= 2);
  return parts.slice(0, count).map((p) => {
    const short = p.split(/\s+/).slice(0, 6).join(" ");
    const out = short.length > max ? `${short.slice(0, max - 1).trimEnd()}…` : short;
    return out.charAt(0).toLocaleUpperCase("es") + out.slice(1);
  });
}

const MONTHS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

/** Textos de un efecto nuevo a partir de lo que se dice en el tramo (la persona los cambia en la revisión). */
export function defaultFx(kind: FxKind, words: SpokenWord[], now = new Date()): Pick<FxItem, "text" | "items" | "kicker" | "words"> {
  const info = FX_INFO[kind];
  const key = keyWord(words);
  const out: Pick<FxItem, "text" | "items" | "kicker" | "words"> = {};
  switch (kind) {
    case "cover_story":
      out.text = upper(key || "TÚ").slice(0, info.text!.max);
      out.kicker = `${MONTHS[now.getMonth()]} ${now.getFullYear()} · N° ${String((now.getDate() % 40) + 1).padStart(2, "0")}`;
      out.items = splitTwo(phrasesOf(words, 1, 60)[0] ?? "La edición de hoy", info.items!.max);
      break;
    case "glass_type":
    case "paper_cut":
      out.text = upper(key || "IDEA").slice(0, info.text!.max);
      break;
    case "doodle_boil":
      out.text = (key ? `¡${key.toLocaleLowerCase("es")}!` : "¡clave!").slice(0, info.text!.max);
      break;
    case "checklist":
      out.text = "TODO LO QUE TIENES QUE HACER";
      out.items = fill(phrasesOf(words, 3, info.items!.max), ["Primer paso", "Segundo paso", "Tercer paso"]);
      break;
    case "iphone":
      out.text = "Hoy";
      out.items = fill(phrasesOf(words, 4, info.items!.max), ["Grabar el reel", "Editar el video", "Publicar", "Responder"]);
      break;
    case "chart_grow":
      out.text = "ESCALA";
      break;
    case "headline_wall":
      out.items = fill(phrasesOf(words, 5, info.items!.max), ["Nadie te lo dice", "El error de todos", "Lo que sí funciona", "Así empezó todo", "La verdad"]);
      break;
    case "ui_world":
      out.text = "edita mis clips con mi marca";
      out.kicker = "Tu estudio";
      break;
    case "zoom_out":
      out.text = "Editando tu reel";
      break;
    case "green_screen":
      out.text = "25:00";
      out.items = fill(phrasesOf(words, 3, info.items!.max), ["Guion listo", "Grabar", "Publicar"]);
      break;
    case "digital_zoom":
      out.words = strongWords(words, 3);
      break;
    default:
      Object.assign(out, autoFx(kind, words));
      break;
  }
  return out;
}

const EMOJI_HINTS: [RegExp, string][] = [
  [/fuego|incre[ií]ble|brutal|explot/, "fuego"],
  [/amo|amor|coraz[oó]n|quiero/, "corazón"],
  [/crec|despeg|lanz|cohete|r[aá]pido/, "cohete"],
  [/idea|truco|consejo|secreto/, "idea"],
  [/mira|ojo|atenci[oó]n/, "ojos"],
  [/dinero|plata|venta|factur|cobr|precio/, "dinero"],
  [/risa|gracioso|chiste|jaja/, "risa"],
];

/** Textos por defecto de los efectos de la biblioteca ampliada (su ficha dice de dónde salen). */
function autoFx(kind: FxKind, words: SpokenWord[]): Pick<FxItem, "text" | "items" | "kicker"> {
  const info = FX_INFO[kind];
  const auto = info.auto ?? {};
  const out: Pick<FxItem, "text" | "items" | "kicker"> = {};
  const said = words.map((w) => w.text).join(" ");
  const sentence = captionText(said.split(/(?<=[.?!])\s+/)[0] ?? said);
  const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
  const cap = (s: string) => s.charAt(0).toLocaleUpperCase("es") + s.slice(1);
  if (info.text) {
    const max = info.text.max;
    const a = auto.text;
    let text = "";
    if (typeof a === "object" && a) text = a.fixed;
    else if (a === "key") text = keyWord(words).toLocaleLowerCase("es");
    else if (a === "KEY") text = upper(keyWord(words));
    else if (a === "phrase" || a === "lower-phrase") {
      const p = phrasesOf(words, 1, max)[0] ?? cut(sentence, max);
      text = a === "lower-phrase" ? p.toLocaleLowerCase("es").replace(/[.…]$/, "") : p;
    } else if (a === "sentence") text = cut(cap(sentence), max);
    else if (a === "number") text = (words.map((w) => captionText(w.text)).find((w) => /\d/.test(w)) ?? "").slice(0, max);
    else if (a === "question") {
      const q = said.match(/¿[^?]+\?/)?.[0] ?? said.split(/(?<=[.?!])\s+/).find((p) => p.includes("?"));
      text = cut(q ? captionText(q) : cap(sentence), max);
    } else if (a === "emoji") {
      const low = said.toLowerCase();
      text = EMOJI_HINTS.find(([re]) => re.test(low))?.[1] ?? "estrella";
    } else if (a === "yesno") text = /\b(no|nunca|error|mal|jam[aá]s)\b/i.test(said) ? "NO" : "SÍ";
    out.text = text.slice(0, max);
  }
  if (info.items) {
    const { count, max } = info.items;
    const a = auto.items;
    let items: string[] = [];
    if (typeof a === "object" && a) items = a.fixed;
    else if (a === "words") {
      const ids = strongWords(words, count);
      items = ids.map((id) => upper(captionText(words.find((w) => w.id === id)?.text ?? "").replace(/[¿?¡!.,;:]/g, ""))).filter(Boolean);
    } else if (a === "sentence") items = [cut(cap(sentence), max)];
    else if (a === "phrases") items = phrasesOf(words, count, max);
    out.items = items.map((x) => x.slice(0, max)).slice(0, count);
  }
  if (info.kicker) out.kicker = (auto.kicker ?? "").slice(0, info.kicker.max);
  return out;
}

function fill(list: string[], fallback: string[]): string[] {
  const out = [...list];
  for (const f of fallback) if (out.length < fallback.length) out.push(f);
  return out.slice(0, fallback.length);
}

function splitTwo(text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const half = Math.ceil(words.length / 2);
  return [words.slice(0, half).join(" "), words.slice(half).join(" ")].map((s) => s.slice(0, max)).filter(Boolean);
}

/** Palabras fuertes para el zoom digital: cifras primero, después las más largas que no son de relleno, en orden. */
export function strongWords(words: SpokenWord[], max = 3): number[] {
  const scored = words
    .map((w, i) => ({ id: w.id, i, w: norm(w.text), raw: w.text }))
    .filter((x) => x.w && !STOP.has(x.w))
    .map((x) => ({ ...x, score: (/\d/.test(x.raw) ? 10 : 0) + x.w.length }))
    .sort((a, b) => b.score - a.score);
  const picked: typeof scored = [];
  for (const s of scored) {
    if (picked.length >= max) break;
    if (picked.some((p) => Math.abs(p.i - s.i) < 2)) continue;
    picked.push(s);
  }
  return picked.sort((a, b) => a.i - b.i).map((p) => p.id);
}

// ─── Validación ───────────────────────────────────────────────────────────

/** Deja un efecto dentro de los límites de su ficha (textos cortados, ítems, palabras dentro del tramo). */
export function clampFx(item: FxItem): FxItem {
  const info = FX_INFO[item.kind];
  const out: FxItem = { id: item.id, kind: item.kind, from_word: Math.min(item.from_word, item.to_word), to_word: Math.max(item.from_word, item.to_word) };
  if (info.text) out.text = (item.text ?? "").trim().slice(0, info.text.max);
  if (info.items) out.items = (item.items ?? []).map((s) => s.trim().slice(0, info.items!.max)).filter(Boolean).slice(0, info.items.count);
  if (info.kicker) out.kicker = (item.kicker ?? "").trim().slice(0, info.kicker.max);
  if (item.kind === "digital_zoom") out.words = [...new Set((item.words ?? []).filter((id) => id >= out.from_word && id <= out.to_word))].sort((a, b) => a - b).slice(0, 5);
  if (item.accent) out.accent = item.accent;
  if (item.why) out.why = item.why.slice(0, 300);
  if (item.source) out.source = item.source;
  const movable = FX_MOVABLE[item.kind];
  const place = movable ? cleanPlace({ transform: item.transform, anim: item.anim }, { rotation: movable.rotation, keepDefaultAnim: true }) : undefined;
  if (place?.transform) out.transform = place.transform;
  if (place?.anim) out.anim = place.anim;
  if (item.layer != null && Number.isInteger(item.layer) && item.layer >= 0) out.layer = Math.min(999, item.layer);
  return out;
}

/**
 * Problemas de los efectos del plan (ids y rangos). Lista vacía = válido. Superponerse con otro efecto o con un b-roll
 * no es un problema: van en capas (lib/video/layers.ts).
 */
export function fxIssues(items: FxItem[], wordCount: number, broll: { from_word: number; to_word: number }[] = []): string[] {
  const issues: string[] = [];
  const valid = (id: number) => Number.isInteger(id) && id >= 0 && id < wordCount;
  const sorted = [...items].sort((a, b) => a.from_word - b.from_word);
  sorted.forEach((e) => {
    if (!valid(e.from_word) || !valid(e.to_word)) issues.push(`Efecto: ids fuera de rango (${e.from_word}–${e.to_word}).`);
    else if (e.from_word > e.to_word) issues.push(`Efecto: rango invertido (${e.from_word}–${e.to_word}).`);
  });
  void broll;
  return issues;
}

/** Efectos que manda el navegador: forma válida, dentro de la transcripción, sin pisarse entre sí ni con el b-roll. */
export function cleanFx(raw: unknown[], wordCount: number, broll: { from_word: number; to_word: number }[] = []): FxItem[] {
  const out: FxItem[] = [];
  const parsed = raw.map((r) => fxItemSchema.safeParse(r)).filter((p) => p.success).map((p) => clampFx(p.data as FxItem));
  for (const e of parsed.sort((a, b) => a.from_word - b.from_word).slice(0, MAX_EFFECTS)) {
    if (e.to_word >= wordCount) continue;
    // Se pueden superponer entre sí y con el b-roll: se dibujan en capas (lib/video/layers.ts).
    void broll;
    out.push(e);
  }
  return out;
}

let counter = 0;
export const newFxId = () => `fx${Date.now().toString(36)}${(counter++).toString(36)}`;
