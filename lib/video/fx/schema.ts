/**
 * Efectos en el plan de edición: forma (Zod), textos por defecto a partir de lo que se dice, validación (que no se
 * pisen entre sí ni con el b-roll, duración y textos dentro de los límites de cada efecto) y la configuración de Mi
 * marca (qué efectos puede elegir el director y con qué frecuencia). Sin servidor.
 */
import { z } from "zod";
import { FX_FREQUENCIES, FX_INFO, FX_KINDS, FX_MOVABLE, type FxFrequency, type FxKind } from "./catalog";
import { animSchema, cleanPlace, transformSchema } from "../canvas/transform";
import { captionText, norm } from "../text";

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

export const fxItemSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(FX_KINDS),
  from_word: z.number().int().min(0),
  to_word: z.number().int().min(0),
  /** Texto principal (palabra de portada, rótulo, comando…). */
  text: z.string().max(60).optional(),
  /** Lista de textos (tareas, titulares). */
  items: z.array(z.string().max(60)).max(6).optional(),
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
});
export type FxItem = z.infer<typeof fxItemSchema>;

export const MAX_EFFECTS = 16;
export const fxListSchema = z.array(fxItemSchema).max(MAX_EFFECTS);

// ─── Mi marca: qué efectos puede usar el director ─────────────────────────

export const fxSettingsSchema = z.object({
  allowed: z.array(z.enum(FX_KINDS)).max(FX_KINDS.length),
  frequency: z.enum(FX_FREQUENCIES),
});
export type FxSettings = z.infer<typeof fxSettingsSchema>;

/** De fábrica: todos permitidos, frecuencia normal. */
export const FX_FACTORY: FxSettings = { allowed: [...FX_KINDS], frequency: "normal" };

export function readFxSettings(raw: unknown): FxSettings {
  const parsed = fxSettingsSchema.safeParse(raw);
  if (!parsed.success) return { ...FX_FACTORY, allowed: [...FX_FACTORY.allowed] };
  return { allowed: [...new Set(parsed.data.allowed)], frequency: parsed.data.frequency as FxFrequency };
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
      break;
  }
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
  const place = movable ? cleanPlace({ transform: item.transform, anim: item.anim }, { rotation: movable.rotation }) : undefined;
  if (place?.transform) out.transform = place.transform;
  if (place?.anim) out.anim = place.anim;
  return out;
}

/** Problemas de los efectos del plan (ids, superposiciones entre efectos y con el b-roll). Lista vacía = válido. */
export function fxIssues(items: FxItem[], wordCount: number, broll: { from_word: number; to_word: number }[] = []): string[] {
  const issues: string[] = [];
  const valid = (id: number) => Number.isInteger(id) && id >= 0 && id < wordCount;
  const sorted = [...items].sort((a, b) => a.from_word - b.from_word);
  sorted.forEach((e, i) => {
    if (!valid(e.from_word) || !valid(e.to_word)) issues.push(`Efecto: ids fuera de rango (${e.from_word}–${e.to_word}).`);
    else if (e.from_word > e.to_word) issues.push(`Efecto: rango invertido (${e.from_word}–${e.to_word}).`);
    const next = sorted[i + 1];
    if (next && next.from_word <= e.to_word) issues.push(`Efectos superpuestos (${e.from_word}–${e.to_word} y ${next.from_word}–${next.to_word}).`);
    const b = broll.find((x) => x.from_word <= e.to_word && e.from_word <= x.to_word);
    if (b) issues.push(`Un efecto se pisa con un b-roll (${e.from_word}–${e.to_word}).`);
  });
  return issues;
}

/** Efectos que manda el navegador: forma válida, dentro de la transcripción, sin pisarse entre sí ni con el b-roll. */
export function cleanFx(raw: unknown[], wordCount: number, broll: { from_word: number; to_word: number }[] = []): FxItem[] {
  const out: FxItem[] = [];
  const parsed = raw.map((r) => fxItemSchema.safeParse(r)).filter((p) => p.success).map((p) => clampFx(p.data as FxItem));
  for (const e of parsed.sort((a, b) => a.from_word - b.from_word).slice(0, MAX_EFFECTS)) {
    if (e.to_word >= wordCount) continue;
    if (out.some((o) => e.from_word <= o.to_word && o.from_word <= e.to_word)) continue;
    if (broll.some((b) => e.from_word <= b.to_word && b.from_word <= e.to_word)) continue;
    out.push(e);
  }
  return out;
}

let counter = 0;
export const newFxId = () => `fx${Date.now().toString(36)}${(counter++).toString(36)}`;
