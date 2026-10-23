/**
 * La biblioteca de efectos para el director de edición: reglas del prompt (cuándo usar cada efecto), los límites de este
 * video (qué efectos permite Mi marca y cuántos), el armado desde el formato de cable con reglas duras, el simulador
 * (AI_FAKE) y los pedidos de "Edítalo así" ("ponle el efecto revista al principio"). Sin servidor.
 */
import { sentences } from "@/lib/ai/prompts/editor";
import { norm } from "../text";
import type { Word } from "../types";
import { FX_FREQUENCY_LABELS, FX_INFO, FX_KINDS, FX_MIN_GAP, fxBudget, type FxFrequency, type FxKind } from "./catalog";
import { clampFx, defaultFx, newFxId, strongWords, type FxItem, type FxSettings } from "./schema";

export type FxLimits = { allowed: FxKind[]; max: number; minGap: number; frequency: FxFrequency };

/** Límites de efectos para un video (lo que permite Mi marca y la duración). */
export function fxLimits(settings: FxSettings, seconds: number): FxLimits {
  const allowed = settings.frequency === "ninguno" ? [] : settings.allowed;
  return { allowed, max: allowed.length ? fxBudget(settings.frequency, seconds) : 0, minGap: FX_MIN_GAP[settings.frequency], frequency: settings.frequency };
}

/** Reglas estables (van en el contexto, con caché): la biblioteca completa y cómo usarla. */
export const FX_DIRECTOR_RULES = `EFECTOS DE FIRMA (effects)
Una biblioteca de efectos con nombre que se dibujan con la marca sobre un tramo de palabras (como el b-roll, pero la persona sigue a la vista). Úsalos donde suman al sentido, nunca de relleno: un buen efecto subraya un momento (la apertura, un dato, una lista, un giro). Cada uno lleva su "why".
${FX_KINDS.map((k) => {
  const i = FX_INFO[k];
  const fields = [i.text ? `text = ${i.text.label.toLowerCase()} (máx. ${i.text.max})` : "", i.items ? `items = ${i.items.label.toLowerCase()} (${i.items.count}, máx. ${i.items.max} c/u)` : "", k === "digital_zoom" ? "items = 1 a 3 palabras fuertes TAL COMO SE DICEN en el tramo" : ""].filter(Boolean);
  return `- ${k} «${i.label}»: ${i.description} Cuándo: ${i.when} Dura ${i.duration.min}–${i.duration.max} s.${i.mask ? " Va detrás de la persona (necesita su cara a cámara en ese tramo)." : ""}${fields.length ? ` Campos: ${fields.join("; ")}.` : ""}`;
}).join("\n")}
REGLAS DE LOS EFECTOS
- Nunca sobre un b-roll (un tramo lleva b-roll o efecto, no los dos), ni sobre algo importante que se muestra (producto, pantalla, gesto), ni sobre una toma mala.
- Los que van detrás de la persona, solo donde se la ve a cámara.
- cover_story y glass_type abren o presentan el tema (cover_story casi siempre en los primeros segundos). checklist cuando enumeras pasos (los ítems son esos pasos, cortos). chart_grow cuando hablas de crecimiento. digital_zoom en una frase con 1 a 3 palabras clave. zoom_cut solo en el cambio entre dos ideas.
- Respeta la cantidad y la separación de EFECTOS PERMITIDOS. Si no hay efectos permitidos, effects va vacío.
- Los textos de los efectos van en el idioma de la marca, cortísimos y sin cifras que no se dicen.`;

/** Lo que va en la tarea de este video. */
export function fxTaskText(limits: FxLimits): string {
  if (!limits.allowed.length || limits.max <= 0) return "EFECTOS PERMITIDOS: ninguno (effects vacío).";
  return `EFECTOS PERMITIDOS: hasta ${limits.max} en este video, separados al menos ${limits.minGap} s (frecuencia "${FX_FREQUENCY_LABELS[limits.frequency].label}" de Mi marca). Solo estos: ${limits.allowed.join(", ")}.`;
}

export type FxWire = { from_word: number; to_word: number; kind: FxKind; text: string; items: string[]; why: string };

const overlaps = (a: { from: number; to: number }, b: { from: number; to: number }) => a.from <= b.to && b.from <= a.to;

/**
 * Del formato de cable a los efectos del plan, con reglas duras: permitidos, cantidad y separación, sin pisar b-roll ni
 * lo prohibido (lo importante que se muestra, tomas malas), los de recorte solo con cara, y duración razonable.
 */
export function effectsFromWire(
  wire: FxWire[],
  input: {
    words: Word[];
    limits: FxLimits;
    broll: { from_word: number; to_word: number }[];
    forbidden: { from: number; to: number; label: string }[];
    /** Palabras donde se ve la cara (de los ojos). Sin dato, se asume que sí. */
    faceWords?: Set<number> | null;
    removed: Set<number>;
    base?: FxItem[] | null;
  },
): { items: FxItem[]; dropped: string[] } {
  const { words, limits } = input;
  const n = words.length;
  const dropped: string[] = [];
  const out: FxItem[] = [];
  const lastEnd: number[] = [];
  for (const e of [...wire].sort((a, b) => a.from_word - b.from_word)) {
    if (out.length >= limits.max) break;
    const from = Math.min(e.from_word, e.to_word);
    const to = Math.max(e.from_word, e.to_word);
    if (!(from >= 0 && to < n) || !limits.allowed.includes(e.kind)) continue;
    const info = FX_INFO[e.kind];
    const range = { from, to };
    if (input.broll.some((b) => overlaps({ from: b.from_word, to: b.to_word }, range))) {
      dropped.push(`Quité un efecto (${info.label}) que se pisaba con un b-roll.`);
      continue;
    }
    const hit = input.forbidden.find((f) => overlaps(f, range));
    if (hit) {
      dropped.push(`Quité un efecto (${info.label}) que iba a tapar ${hit.label}.`);
      continue;
    }
    const ids = Array.from({ length: to - from + 1 }, (_, k) => from + k);
    const kept = ids.filter((id) => !input.removed.has(id));
    if (kept.length < ids.length * 0.6) continue;
    if (info.mask && input.faceWords && kept.filter((id) => input.faceWords!.has(id)).length < kept.length * 0.7) {
      dropped.push(`No puse ${info.label}: en ese tramo no se te ve a cámara.`);
      continue;
    }
    const span = words[to]!.end - words[from]!.start;
    if (span < info.duration.min * 0.6 || span > info.duration.max + 2) continue;
    const start = words[from]!.start;
    if (lastEnd.length && start - lastEnd[lastEnd.length - 1]! < limits.minGap) continue;
    // Al corregir, un efecto que sigue en el mismo lugar conserva lo que ya tenía (y lo que cambió la persona).
    const same = input.base?.find((b) => b.kind === e.kind && b.from_word === from && b.to_word === to);
    if (same) {
      out.push({ ...same, why: e.why.slice(0, 300) || same.why });
      lastEnd.push(words[to]!.end);
      continue;
    }
    const spoken = words.slice(from, to + 1).map((w) => ({ id: w.id, text: w.text }));
    const defaults = defaultFx(e.kind, spoken);
    const item: FxItem = { id: newFxId(), kind: e.kind, from_word: from, to_word: to, ...defaults, why: e.why.slice(0, 300), source: "director" };
    if (info.text && e.text.trim()) item.text = e.text.trim();
    if (info.items && e.items.some((x) => x.trim())) item.items = e.items.map((x) => x.trim()).filter(Boolean);
    if (e.kind === "digital_zoom") {
      const wanted = e.items.map((x) => norm(x)).filter(Boolean);
      const ids2 = spoken.filter((w) => wanted.includes(norm(w.text))).map((w) => w.id);
      item.words = ids2.length ? ids2.slice(0, 5) : strongWords(spoken, 3);
    }
    out.push(clampFx(item));
    lastEnd.push(words[to]!.end);
  }
  return { items: out, dropped };
}

// ─── "Edítalo así" y simulador ────────────────────────────────────────────

const REQUEST_WORDS: [RegExp, FxKind][] = [
  [/revista|portada/, "cover_story"],
  [/zoom digital|punch/, "digital_zoom"],
  [/checklist|lista de (tareas|pasos)/, "checklist"],
  [/vidrio|cristal/, "glass_type"],
  [/tel[eé]fono|celular|iphone|m[oó]vil/, "iphone"],
  [/gr[aá]fico que crece|crecimiento|curva/, "chart_grow"],
  [/titulares|notas en la pared|muro/, "headline_wall"],
  [/giro|orbit|3d/, "orbit"],
  [/capturas|pared de/, "couch_wall"],
  [/ventana|interfaz|app/, "ui_world"],
  [/cuadro|marco/, "frame_break"],
  [/corte con zoom|transici[oó]n/, "zoom_cut"],
  [/zoom out|alej/, "zoom_out"],
  [/pantalla verde|temporizador|timer|pomodoro/, "green_screen"],
  [/papel|recorte|nota de rescate/, "paper_cut"],
  [/garabato|dibujo|doodle/, "doodle_boil"],
  [/v[eé]rtigo|dolly/, "vertigo"],
];

export type FxRequest = { kind: FxKind; where: "start" | "end" | "middle" | null } | { none: true };

/** Lo que pide la persona sobre efectos en "Edítalo así" (para el simulador; Claude lee el pedido entero). */
export function parseFxRequest(instruction: string): FxRequest | null {
  const t = instruction.toLowerCase();
  if (/sin efectos|quita (los|el) efectos?|saca (los|el) efectos?/.test(t)) return { none: true };
  if (!/efecto|ponle|pon |agrega|suma/.test(t)) return null;
  const hit = REQUEST_WORDS.find(([re]) => re.test(t));
  if (!hit) return null;
  const where = /al (principio|inicio|comienzo)|para abrir|de entrada/.test(t) ? "start" : /al final|para cerrar/.test(t) ? "end" : /en el medio|a la mitad/.test(t) ? "middle" : null;
  return { kind: hit[1], where };
}

/**
 * Efectos del director simulado: reglas claras sobre la transcripción (portada al abrir, checklist si enumera, gráfico
 * si habla de crecer, zoom digital en una frase con cifras) y lo que pide "Edítalo así".
 */
export function simulateEffects(input: { words: Word[]; limits: FxLimits; removed: Set<number>; taken: { from: number; to: number }[]; instruction?: string | null }): FxWire[] {
  const { words, limits } = input;
  if (!limits.allowed.length || limits.max <= 0) return [];
  const phrases = sentences(words).filter((f) => !Array.from({ length: f.to - f.from + 1 }, (_, k) => f.from + k).some((id) => input.removed.has(id)));
  const free = (f: { from: number; to: number }) => !input.taken.some((x) => overlaps(x, f));
  const out: FxWire[] = [];
  const allow = (k: FxKind) => limits.allowed.includes(k);
  const fit = (f: { from: number; to: number }, kind: FxKind) => {
    const max = FX_INFO[kind].duration.max;
    let to = f.from;
    while (to < f.to && words[to + 1]!.end - words[f.from]!.start <= max) to++;
    return { from_word: f.from, to_word: to };
  };
  const request = input.instruction ? parseFxRequest(input.instruction) : null;
  if (request && "none" in request) return [];
  if (request && "kind" in request && allow(request.kind)) {
    const pool = phrases.filter(free);
    const f = request.where === "end" ? pool.at(-2) ?? pool.at(-1) : request.where === "middle" ? pool[Math.floor(pool.length / 2)] : pool[0];
    if (f) out.push({ ...fit(f, request.kind), kind: request.kind, text: "", items: [], why: "Lo pediste en «Edítalo así»." });
  }
  const first = phrases.find(free);
  if (first && allow("cover_story") && !out.some((e) => e.kind === "cover_story") && words[first.from]!.start < 6) out.push({ ...fit(first, "cover_story"), kind: "cover_story", text: "", items: [], why: "Abre como una portada: presenta el tema con fuerza." });
  for (const f of phrases) {
    if (out.length >= limits.max) break;
    if (!free(f) || out.some((e) => overlaps({ from: e.from_word, to: e.to_word }, f))) continue;
    const text = f.text.toLowerCase();
    if (allow("checklist") && /primero|paso|tres cosas|lo que tienes que hacer/.test(text)) {
      const end = phrases.filter((g) => g.from >= f.from && words[g.to]!.end - words[f.from]!.start <= 10).at(-1) ?? f;
      out.push({ from_word: f.from, to_word: end.to, kind: "checklist", text: "", items: [], why: "Enumeras pasos: la lista se tilda a medida que los dices." });
    } else if (allow("chart_grow") && /crec|escala|de \w+ a \w+|segu[ií]dores/.test(text)) {
      out.push({ ...fit(f, "chart_grow"), kind: "chart_grow", text: "", items: [], why: "Hablas de crecimiento: la línea lo muestra." });
    } else if (allow("digital_zoom") && /\d|nunca|siempre|clave|secreto/.test(text)) {
      out.push({ ...fit(f, "digital_zoom"), kind: "digital_zoom", text: "", items: [], why: "Remarca las palabras fuertes de esta frase." });
    }
  }
  // Separación mínima entre efectos (en segundos del original).
  const sorted = out.sort((a, b) => a.from_word - b.from_word);
  const spaced: FxWire[] = [];
  for (const e of sorted) {
    const prev = spaced.at(-1);
    if (prev && words[e.from_word]!.start - words[prev.to_word]!.end < limits.minGap) continue;
    if (prev && overlaps({ from: prev.from_word, to: prev.to_word }, { from: e.from_word, to: e.to_word })) continue;
    spaced.push(e);
  }
  return spaced.slice(0, limits.max);
}

/** Una línea por efecto para el plan que lee el director al corregir. */
export function fxPlanText(items: FxItem[]): string {
  if (!items.length) return "Efectos: ninguno.";
  return `Efectos:\n${items.map((e) => `- ${e.kind} [${e.from_word}–${e.to_word}]${e.text ? ` "${e.text}"` : ""}${e.items?.length ? ` (${e.items.join(" / ")})` : ""}${e.source === "user" ? " (lo puso la persona: no lo quites salvo que lo pida)" : ""}`).join("\n")}`;
}
