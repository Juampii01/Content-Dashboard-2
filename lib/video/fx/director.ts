/**
 * La biblioteca de efectos para el director de edición: reglas del prompt (cuándo usar cada efecto), los límites de este
 * video (qué efectos permite Mi marca y cuántos), el armado desde el formato de cable con reglas duras, el simulador
 * (AI_FAKE) y los pedidos de "Edítalo así" ("ponle el efecto revista al principio"). Sin servidor.
 */
import { sentences } from "@/lib/ai/prompts/editor";
import { norm } from "../text";
import type { Word } from "../types";
import { FX_CATEGORIES, FX_CATEGORY_LABELS, FX_FREQUENCY_LABELS, FX_INFO, FX_MIN_GAP, fxBudget, fxByCategory, type FxFrequency, type FxKind } from "./catalog";
import { cutPoints, newTransitionId, transitionCenter, TRANSITION_INFO, TRANSITION_KINDS, type TransitionItem, type TransitionKind } from "./transitions";
import type { Timeline } from "../timeline";
import { fxFromText } from "./request-words";
import { clampFx, defaultFx, newFxId, strongWords, type FxItem, type FxSettings } from "./schema";

export type FxLimits = { allowed: FxKind[]; max: number; minGap: number; frequency: FxFrequency; /** Transiciones que puede poner (con moderación). */ transitions?: number };

/** Transiciones por video según la frecuencia de Mi marca: pocas (un corte de cada tanto, nunca todos). */
export function transitionBudget(frequency: FxFrequency, seconds: number): number {
  if (frequency === "ninguno") return 0;
  const perMinute = frequency === "pocos" ? 1 : frequency === "normal" ? 2.5 : 5;
  const cap = frequency === "pocos" ? 1 : frequency === "normal" ? 4 : 8;
  return Math.max(1, Math.min(cap, Math.round((seconds / 60) * perMinute)));
}

/** Límites de efectos para un video (lo que permite Mi marca y la duración). */
export function fxLimits(settings: FxSettings, seconds: number): FxLimits {
  const allowed = settings.frequency === "ninguno" ? [] : settings.allowed;
  return { allowed, max: allowed.length ? fxBudget(settings.frequency, seconds) : 0, minGap: FX_MIN_GAP[settings.frequency], frequency: settings.frequency, transitions: transitionBudget(settings.frequency, seconds) };
}

/** Cuántas veces puede ir el mismo efecto en un video (variedad: casi todos, una sola vez). */
export const FX_REPEAT: Partial<Record<FxKind, number>> = { digital_zoom: 2, snap_zoom: 2, beat_pulse: 2, impact: 2, emoji_bounce: 2, word_pop: 2 };

function fxLine(k: FxKind): string {
  const i = FX_INFO[k];
  const fields = [i.text ? `text = ${i.text.label.toLowerCase()} (máx. ${i.text.max})` : "", i.items ? `items = ${i.items.label.toLowerCase()} (${i.items.count}, máx. ${i.items.max} c/u)` : "", k === "digital_zoom" ? "items = 1 a 3 palabras fuertes TAL COMO SE DICEN en el tramo" : ""].filter(Boolean);
  return `- ${k} «${i.label}»: ${i.when} ${i.duration.min}–${i.duration.max} s.${i.mask ? " Recorte (cara a cámara)." : ""}${fields.length ? ` ${fields.join("; ")}.` : ""}`;
}

/** Reglas estables (van en el contexto, con caché): la biblioteca completa por categoría y cómo usarla. */
export const FX_DIRECTOR_RULES = `EFECTOS DE LA BIBLIOTECA (effects)
Una biblioteca de ${FX_CATEGORIES.reduce((n, c) => n + fxByCategory(c).length, 0)} efectos con nombre que se dibujan con la marca sobre un tramo de palabras (como el b-roll, pero la persona sigue a la vista). Úsalos donde suman al sentido, nunca de relleno: un buen efecto subraya un momento (la apertura, un dato, una lista, un giro, una emoción). Cada uno lleva su "why".
${FX_CATEGORIES.map((c) => `${FX_CATEGORY_LABELS[c].label.toUpperCase()} (${FX_CATEGORY_LABELS[c].description})\n${fxByCategory(c).map(fxLine).join("\n")}`).join("\n")}
REGLAS DE LOS EFECTOS
- Nunca sobre un b-roll (un tramo lleva b-roll o efecto, no los dos), ni sobre algo importante que se muestra (producto, pantalla, gesto), ni sobre una toma mala.
- Los que dicen "Recorte" van detrás de la persona: solo donde se la ve a cámara.
- VARIEDAD: no repitas un efecto en el mismo video (los zooms y golpes de cámara, como mucho dos veces); alterna categorías (texto, tarjeta, cámara, look…) y no pongas dos de la misma categoría seguidos.
- Elige por el contenido: una cifra que se dice → counter o big_stat; una lista → checklist o numbered_list; una cita → quote_card; una pregunta al público → poll o question_box; algo del pasado → film_grain, dust o polaroid; un giro → word_slam, impact o glitch; presentarte → lower_third. Los looks (grano, VHS, duotono…) y la cámara (sacudida, pulso…) acompañan un tramo con intención, no todo el video.
- cover_story y glass_type abren o presentan el tema (cover_story casi siempre en los primeros segundos). zoom_cut solo en el cambio entre dos ideas.
- Nunca inventes cifras: counter, big_stat y price_tag solo con un número que se dice en ese tramo.
- Respeta la cantidad y la separación de EFECTOS PERMITIDOS. Si no hay efectos permitidos, effects va vacío.
- Los textos de los efectos van en el idioma de la marca, cortísimos.

TRANSICIONES (transition)
Tapan un corte entre dos tramos con movimiento, luz o color. La voz no se corre: solo cambia la imagen en el corte. Van en la PRIMERA palabra del tramo que entra después de un corte (from_word = to_word = esa palabra): un corte que tú haces o una pausa larga que se recorta.
${TRANSITION_KINDS.map((k) => `- ${k} «${TRANSITION_INFO[k].label}» (${TRANSITION_INFO[k].energy}): ${TRANSITION_INFO[k].description}`).join("\n")}
- Con moderación (ver TRANSICIONES PERMITIDAS): solo en el cambio de una parte a otra (del gancho al contenido, entre puntos de una lista, antes de la CTA), nunca en todos los cortes ni dentro de una misma frase.
- Las suaves para un cambio de tema tranquilo; las fuertes con ritmo alto. No repitas la misma dos veces seguidas. Nunca en un corte con b-roll o efecto encima.

`;

/** Lo que va en la tarea de este video. */
export function fxTaskText(limits: FxLimits): string {
  const tr = limits.transitions ?? 0;
  const trText = tr > 0 ? `\nTRANSICIONES PERMITIDAS: hasta ${tr} en este video, en cambios de parte.` : "\nTRANSICIONES PERMITIDAS: ninguna (sin acciones transition).";
  if (!limits.allowed.length || limits.max <= 0) return `EFECTOS PERMITIDOS: ninguno (effects vacío).${trText}`;
  return `EFECTOS PERMITIDOS: hasta ${limits.max} en este video, separados al menos ${limits.minGap} s (frecuencia "${FX_FREQUENCY_LABELS[limits.frequency].label}" de Mi marca). Solo estos: ${limits.allowed.join(", ")}.${trText}`;
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
    /** false: la persona pidió quitar los efectos (también los suyos). */
    keepUser?: boolean;
  },
): { items: FxItem[]; dropped: string[] } {
  const { words, limits } = input;
  const n = words.length;
  const dropped: string[] = [];
  const out: FxItem[] = [];
  const lastEnd: number[] = [];
  const used = new Map<FxKind, number>();
  // Los efectos que puso la persona se quedan (salvo que choquen con algo nuevo): el director no los quita solo.
  const keptUser = input.keepUser === false ? [] : (input.base ?? []).filter((b) => b.source === "user" && !input.broll.some((x) => overlaps({ from: x.from_word, to: x.to_word }, { from: b.from_word, to: b.to_word })));
  for (const e of [...wire].sort((a, b) => a.from_word - b.from_word)) {
    if (out.length >= limits.max) break;
    const from = Math.min(e.from_word, e.to_word);
    const to = Math.max(e.from_word, e.to_word);
    if (keptUser.some((u) => overlaps({ from: u.from_word, to: u.to_word }, { from, to }) && !(u.kind === e.kind && u.from_word === from && u.to_word === to))) continue;
    if (!(from >= 0 && to < n) || !limits.allowed.includes(e.kind)) continue;
    const info = FX_INFO[e.kind];
    // Variedad: el mismo efecto no se repite (salvo los zooms y golpes, hasta dos veces).
    if ((used.get(e.kind) ?? 0) >= (FX_REPEAT[e.kind] ?? 1) && !input.base?.some((b) => b.kind === e.kind && b.from_word === from && b.to_word === to)) {
      dropped.push(`No repetí ${info.label}: ya estaba en el video.`);
      continue;
    }
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
      used.set(e.kind, (used.get(e.kind) ?? 0) + 1);
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
    used.set(e.kind, (used.get(e.kind) ?? 0) + 1);
    lastEnd.push(words[to]!.end);
  }
  for (const u of keptUser) if (!out.some((o) => o.id === u.id)) out.push(u);
  out.sort((a, b) => a.from_word - b.from_word);
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
  const kind = REQUEST_WORDS.find(([re]) => re.test(t))?.[1] ?? fxFromText(t.normalize("NFD").replace(/[̀-ͯ]/g, ""));
  if (!kind) return null;
  const where = /al (principio|inicio|comienzo)|para abrir|de entrada/.test(t) ? "start" : /al final|para cerrar/.test(t) ? "end" : /en el medio|a la mitad/.test(t) ? "middle" : null;
  return { kind, where };
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
  // Lo que pidió la persona va primero al recortar a la cantidad máxima.
  const asked = request && "kind" in request ? spaced.find((e) => e.kind === request.kind) : undefined;
  const rest = spaced.filter((e) => e !== asked);
  return (asked ? [asked, ...rest.slice(0, limits.max - 1)] : spaced.slice(0, limits.max)).sort((a, b) => a.from_word - b.from_word);
}

/** Una línea por efecto para el plan que lee el director al corregir. */
export function fxPlanText(items: FxItem[]): string {
  if (!items.length) return "Efectos: ninguno.";
  return `Efectos:\n${items.map((e) => `- ${e.kind} [${e.from_word}–${e.to_word}]${e.text ? ` "${e.text}"` : ""}${e.items?.length ? ` (${e.items.join(" / ")})` : ""}${e.source === "user" ? " (lo puso la persona: no lo quites salvo que lo pida)" : ""}`).join("\n")}`;
}

// ─── Transiciones del director ────────────────────────────────────────────

export type TransitionWire = { at_word: number; kind: TransitionKind; why: string };

/**
 * Del formato de cable a las transiciones del plan, con reglas duras: en un corte que existe en el video final o, si la
 * palabra no abre un tramo, en cualquier punto (anclada al inicio de esa palabra, sobre el plano), sin b-roll ni efecto
 * encima, como mucho las permitidas, separadas al menos 3 s y sin repetir la misma seguida. Las que puso la persona se
 * quedan.
 */
export function transitionsFromWire(
  wire: TransitionWire[],
  input: { timeline: Pick<Timeline, "clips" | "words" | "duration">; limits: FxLimits; blocked: { start: number; end: number }[]; base?: TransitionItem[] | null },
): { items: TransitionItem[]; dropped: string[] } {
  const cuts = cutPoints(input.timeline);
  const max = input.limits.transitions ?? 0;
  const kept = (input.base ?? []).filter((t) => t.source === "user" && transitionCenter(input.timeline, t, cuts) != null);
  const out: TransitionItem[] = [...kept];
  const dropped: string[] = [];
  let added = 0;
  for (const w of [...wire].sort((a, b) => a.at_word - b.at_word)) {
    if (added >= max) break;
    if (!(TRANSITION_KINDS as readonly string[]).includes(w.kind)) continue;
    const onCut = cuts.some((c) => c.word === w.at_word);
    // Fuera de un corte: en el inicio de la palabra (solo si la palabra queda en el video).
    const candidate: TransitionItem = { id: newTransitionId(), kind: w.kind, at_word: w.at_word, ...(onCut ? {} : { offset: 0 }), source: "director", why: w.why.slice(0, 300) };
    if (!onCut && !input.timeline.words.some((x) => x.id === w.at_word)) continue;
    const at = transitionCenter(input.timeline, candidate, cuts);
    if (at == null) continue;
    if (out.some((t) => t.at_word === w.at_word)) continue;
    if (input.blocked.some((b) => at > b.start - 0.4 && at < b.end + 0.4)) {
      dropped.push(`No puse la transición ${TRANSITION_INFO[w.kind].label}: ahí hay un b-roll o un efecto.`);
      continue;
    }
    const near = out.map((t) => transitionCenter(input.timeline, t, cuts)).filter((x): x is number => x != null);
    if (near.some((c) => Math.abs(c - at) < 3)) continue;
    const prev = [...out].filter((t) => t.at_word < w.at_word).sort((a, b) => b.at_word - a.at_word)[0];
    if (prev && prev.kind === w.kind) continue;
    out.push(candidate);
    added++;
  }
  return { items: out.sort((a, b) => a.at_word - b.at_word), dropped };
}

/** Transiciones del director simulado: en el cambio del gancho al cuerpo y entre partes, alternando suaves y fuertes. */
export function simulateTransitions(input: { words: Word[]; cuts: { from_word: number; to_word: number }[]; limits: FxLimits }): TransitionWire[] {
  const max = input.limits.transitions ?? 0;
  if (max <= 0) return [];
  const rotation: TransitionKind[] = input.limits.frequency === "muchos" ? ["tr_whip", "tr_zoom_in", "tr_glitch", "tr_flash", "tr_slide", "tr_spin"] : ["tr_zoom_in", "tr_blur", "tr_whip", "tr_light_leak", "tr_iris"];
  const out: TransitionWire[] = [];
  let lastAt = -99;
  for (const c of [...input.cuts].sort((a, b) => a.to_word - b.to_word)) {
    const at = Math.max(c.from_word, c.to_word) + 1;
    const w = input.words[at];
    if (!w || w.start - lastAt < 4) continue;
    out.push({ at_word: at, kind: rotation[out.length % rotation.length]!, why: "Tapa el corte entre dos partes con movimiento." });
    lastAt = w.start;
    if (out.length >= max) break;
  }
  return out;
}
