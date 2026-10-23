/**
 * Sincronía de los gráficos con la voz ("cues" por palabra).
 *
 * Cada componente del motor dice qué elementos entran con la voz (`cueTexts`: los ítems de una lista, los pasos, las
 * barras, la cifra, cada palabra de una frase). Aquí:
 * 1. `inferCueWords`: empareja el texto de cada elemento con las palabras que se dicen en el tramo (sin tildes, sin
 *    mayúsculas, con números dichos en palabras, coincidencia difusa y en orden). Lo usa el plan cuando Claude no marcó
 *    las palabras (`cue_words`) y la revisión cuando la persona cambia el gráfico.
 * 2. `resolveSceneCues`: con las palabras del video final ya cortado (timeline: cortes, pausas, gancho movido y bloques
 *    movidos incluidos) pasa cada palabra a su segundo dentro del tramo (`cues`). Lo hace `brollSegments`, que usan la
 *    vista previa y el render: los dos dibujan exactamente lo mismo.
 *
 * Sin servidor ni navegador.
 */
import { COMPONENTS, type ComponentName } from "./motion/components";
import { sceneSchema, type Layer, type MotionScene } from "./motion/schema";
import { spokenNumbers } from "./graphics";
import { levenshtein } from "./text";

export type CueWord = { id: number; text: string };
export type TimedCueWord = CueWord & { start: number; end?: number };

const STOP = new Set(
  "el la los las un una unos unas de del al a en y o u que con por para es son se te tu tus mi mis su sus lo le les como pero si ya muy mas este esta esto ese esa eso hay fue ser tienes tiene hace cuando donde porque yo me nos todo toda todos e".split(" "),
);

/** Palabra normalizada: minúsculas, sin tildes ni signos; los números dichos en palabras pasan a cifras. */
export function cueToken(raw: string): string {
  const t = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
  if (!t) return "";
  if (/\d/.test(t)) return t.replace(/\D+/g, "") || t;
  const nums = spokenNumbers(t);
  return nums.length === 1 && Number.isFinite(nums[0]) && !/^(doble|triple|mitad)/.test(t) ? String(nums[0]) : t;
}

const tokensOf = (text: string) => text.split(/[\s/–—-]+/).map(cueToken).filter(Boolean);

/** Parecido entre dos palabras normalizadas (0 a 1). */
export function tokenSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return 0;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  // Misma raíz: "anuncios" y "anunciando", "contenido" y "contenidos".
  if (short.length >= 4 && long.startsWith(short)) return 0.88;
  if (short.length >= 5 && long.slice(0, 5) === short.slice(0, 5)) return 0.8;
  const ratio = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return ratio >= 0.75 ? ratio : 0;
}

const MATCH = 0.75;

/**
 * Para cada texto (en orden), el id de la palabra dicha en que empieza; -1 si no aparece. Las coincidencias van en
 * orden (un ítem no puede sonar antes que el anterior).
 */
export function inferCueWords(texts: string[], spoken: CueWord[]): number[] {
  const words = spoken.map((w) => ({ id: w.id, tok: cueToken(w.text) }));
  const out: number[] = [];
  let ptr = 0;
  let matched = false;
  for (const text of texts) {
    const all = tokensOf(text);
    const content = all.filter((t) => !STOP.has(t));
    const slot = content.length ? content : all;
    if (!slot.length) {
      out.push(-1);
      continue;
    }
    const single = slot.length === 1 && all.length === 1;
    // Palabra suelta después de otra ya encontrada (una frase palabra por palabra): se busca cerca; lo demás, en todo
    // lo que queda.
    const horizon = single && matched ? Math.min(words.length, ptr + 8) : words.length;
    let best = { j: -1, score: 0 };
    for (let j = ptr; j < horizon; j++) {
      if (!slot.some((t) => tokenSimilarity(t, words[j]!.tok) >= MATCH)) continue;
      const window = words.slice(j, j + slot.length * 2 + 2);
      const used = new Set<number>();
      let score = 0;
      for (const t of slot) {
        let bestK = -1;
        let bestS = 0;
        window.forEach((w, k) => {
          if (used.has(k)) return;
          const sim = tokenSimilarity(t, w.tok);
          if (sim > bestS) {
            bestS = sim;
            bestK = k;
          }
        });
        if (bestS >= MATCH) {
          used.add(bestK);
          score += bestS;
        }
      }
      score /= slot.length;
      // La primera palabra del ítem que suena tiene que ser una de las suyas (si no, la ventana empieza antes).
      if (score > best.score + 1e-6) best = { j, score };
      if (score >= 0.999) break;
    }
    if (best.j >= 0 && best.score >= (slot.length === 1 ? MATCH : 0.34)) {
      out.push(words[best.j]!.id);
      ptr = best.j + 1;
      matched = true;
    } else out.push(-1);
  }
  return out;
}

/** Textos de los elementos que entran con la voz, para una capa. */
export function layerCueTexts(layer: Layer): string[] {
  if (layer.type === "component") {
    const def = COMPONENTS[layer.component as ComponentName];
    const parsed = def.props.safeParse(layer.props);
    if (!parsed.success) return [];
    const p = parsed.data as never;
    if (def.cueTexts) return (def.cueTexts as (p: never) => string[])(p).map((t) => String(t ?? ""));
    const main = (def.texts as (p: never) => string[])(p).filter(Boolean)[0];
    return main ? [main] : [];
  }
  if (layer.type === "text") return [layer.text];
  if (layer.type === "counter") return [layer.value];
  return [];
}

/**
 * Completa las palabras de cada elemento que falten (`cue_words` de los componentes, `cue_word` de los textos y
 * cifras) emparejando con lo que se dice. Lo que Claude ya marcó (ids válidos dentro de lo dicho) se respeta.
 */
export function withCueWords(scene: MotionScene, spoken: CueWord[]): MotionScene {
  const ids = new Set(spoken.map((w) => w.id));
  // Las capas que no son componentes también siguen el orden de la voz (un tachado y la palabra nueva).
  let from = 0;
  const layers = (scene.layers as Layer[]).map((l) => {
    const texts = layerCueTexts(l);
    if (!texts.length) return l;
    const rest = spoken.slice(from);
    if (l.type === "component") {
      const given = l.cue_words?.length === texts.length && l.cue_words.some((id) => ids.has(id)) ? l.cue_words.map((id) => (ids.has(id) ? id : -1)) : null;
      const cueWords = given ?? inferCueWords(texts, rest);
      const lastKnown = Math.max(...cueWords);
      if (lastKnown >= 0) from = Math.max(from, spoken.findIndex((w) => w.id === lastKnown));
      return { ...l, cue_words: cueWords };
    }
    const given = l.cue_word != null && ids.has(l.cue_word) ? l.cue_word : null;
    const id = given ?? inferCueWords([texts.join(" ")], rest)[0] ?? -1;
    if (id >= 0) from = Math.max(from, spoken.findIndex((w) => w.id === id) + 1);
    return { ...l, cue_word: id };
  });
  const parsed = sceneSchema.safeParse({ ...scene, layers });
  return parsed.success ? parsed.data : scene;
}

/** Segundos de salida de la escena (lo que dura el fundido final), igual que compileScene. */
const exitOf = (scene: Pick<MotionScene, "exit" | "duration">) => (scene.exit === "none" ? 0 : Math.min(0.45, Math.max(0.22, scene.duration * 0.12)));

/** Completa los segundos que no se saben repartiéndolos entre los vecinos conocidos (y en orden). */
export function fillCueTimes(times: (number | null)[], duration: number): number[] | null {
  const n = times.length;
  if (!n) return null;
  const known = times.map((t, i) => (t != null ? i : -1)).filter((i) => i >= 0);
  const out = new Array<number>(n);
  if (!known.length) {
    // Nada se dijo tal cual: si son varios, se reparten en el tramo (y no todos de golpe); si es uno, su reloj.
    if (n === 1) return null;
    for (let i = 0; i < n; i++) out[i] = 0.2 + ((duration * 0.7 - 0.2) * i) / (n - 1);
    return out;
  }
  for (const i of known) out[i] = times[i]!;
  const first = known[0]!;
  const last = known[known.length - 1]!;
  for (let i = first - 1; i >= 0; i--) out[i] = Math.max(0, out[i + 1]! - 0.45);
  for (let i = last + 1; i < n; i++) out[i] = out[i - 1]! + 0.5;
  for (let a = 0; a < known.length - 1; a++) {
    const i = known[a]!;
    const j = known[a + 1]!;
    for (let k = i + 1; k < j; k++) out[k] = out[i]! + ((out[j]! - out[i]!) * (k - i)) / (j - i);
  }
  for (let i = 1; i < n; i++) out[i] = Math.max(out[i]!, out[i - 1]! + 0.05);
  return out;
}

/**
 * Pasa las palabras de cada elemento a segundos del tramo (desde `segStart`, en el video final) y deja la escena lista
 * para dibujar. `timed`: palabras del video final con su inicio (timeline.words). Si una capa no tiene palabras, se
 * infieren con lo que se dice en el tramo.
 */
export function resolveSceneCues(scene: MotionScene, timed: TimedCueWord[], segStart: number, segEnd: number): MotionScene {
  const duration = Math.max(0.6, segEnd - segStart);
  const inside = timed.filter((w) => w.start >= segStart - 0.35 && w.start <= segEnd + 0.1);
  const withWords = withCueWords(scene, inside);
  const at = new Map(timed.map((w) => [w.id, w.start]));
  const limit = Math.max(0.3, duration - exitOf({ exit: scene.exit, duration }) - 0.35);
  const toSecs = (id: number | undefined): number | null => {
    if (id == null || id < 0) return null;
    const t = at.get(id);
    if (t == null) return null;
    const s = t - segStart;
    return s < -0.35 || s > duration ? null : Math.max(0, s);
  };
  const layers = (withWords.layers as Layer[]).map((l) => {
    if (l.type === "component") {
      const words = l.cue_words ?? [];
      const filled = fillCueTimes(words.map(toSecs), duration);
      const { cues: _old, ...rest } = l;
      void _old;
      return filled ? { ...rest, cues: filled.map((c) => round3(Math.min(limit, c))) } : rest;
    }
    if (l.type === "text" || l.type === "counter") {
      const s = toSecs(l.cue_word);
      const { cue: _old, ...rest } = l;
      void _old;
      return s != null ? { ...rest, cue: round3(Math.min(limit, s)) } : rest;
    }
    return l;
  });
  const parsed = sceneSchema.safeParse({ ...withWords, duration: round3(duration), layers });
  return parsed.success ? parsed.data : scene;
}

/** Segundos (del tramo) en que entra cada elemento sincronizado, para los efectos de sonido y la línea de tiempo. */
export function sceneCueTimes(scene: MotionScene): number[] {
  const out: number[] = [];
  for (const l of scene.layers as Layer[]) {
    if (l.type === "component") out.push(...(l.cues ?? []));
    else if ((l.type === "text" || l.type === "counter") && l.cue != null) out.push(l.cue);
  }
  return [...new Set(out.map(round3))].sort((a, b) => a - b);
}

/** Última palabra dicha de los elementos (para que el gráfico dure lo que dura lo que se dice). */
export function lastCueWord(scene: MotionScene): number {
  let last = -1;
  for (const l of scene.layers as Layer[]) {
    if (l.type === "component") last = Math.max(last, ...(l.cue_words ?? [-1]));
    else if ((l.type === "text" || l.type === "counter") && l.cue_word != null) last = Math.max(last, l.cue_word);
  }
  return last;
}

export const isV2Scene = (g: unknown): g is MotionScene => Boolean(g && typeof g === "object" && (g as { v?: unknown }).v === 2);

const round3 = (n: number) => Math.round(n * 1000) / 1000;
