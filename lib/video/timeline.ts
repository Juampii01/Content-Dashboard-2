/**
 * Del plan (palabras cortadas + gancho elegido) al timeline final: qué tramos del original quedan y en qué orden.
 *
 * Es la única fuente de verdad del corte: la vista previa del navegador salta exactamente estos tramos
 * y el worker los renderiza tal cual, así lo que se ve en la revisión es lo que sale en el MP4.
 * Los bordes se ajustan a la rejilla de 30 cuadros por segundo; audio y video usan los mismos cuadros.
 */
import { captionText, endsSentence } from "./text";
import { FPS, type Clip, type EditPlan, type PlanSegment, type TimedWord, type Word } from "./types";

export const TIMING = {
  /** Una pausa más larga que esto entre dos palabras que quedan se recorta. */
  longPause: 0.5,
  /** Aire que se deja antes de la primera palabra de un tramo. */
  padIn: 0.08,
  /** Aire que se deja después de la última palabra de un tramo (para no comerse la cola de la sílaba). */
  padOut: 0.14,
  /** Tramo mínimo en cuadros. */
  minFrames: 3,
};

export function removedIds(plan: Pick<EditPlan, "removals">, wordCount: number): Set<number> {
  const set = new Set<number>();
  for (const r of plan.removals) {
    for (let id = Math.max(0, r.from_word); id <= Math.min(wordCount - 1, r.to_word); id++) set.add(id);
  }
  return set;
}

type Run = { first: number; last: number; start: number; end: number };

/** Agrupa palabras que quedan en tramos continuos y calcula sus bordes en segundos. */
function runsFor(words: Word[], keep: (id: number) => boolean, duration: number): Run[] {
  const runs: Run[] = [];
  let current: { first: number; last: number } | null = null;
  const close = () => {
    if (!current) return;
    const first = words[current.first]!;
    const last = words[current.last]!;
    const prev = words[current.first - 1];
    const next = words[current.last + 1];
    // El aire se recorta a la mitad del hueco con la palabra vecina, para no meter un pedazo de lo cortado.
    const start = Math.max(0, first.start - Math.min(TIMING.padIn, prev ? Math.max(0, first.start - prev.end) / 2 : TIMING.padIn));
    const end = Math.min(duration, last.end + Math.min(TIMING.padOut, next ? Math.max(0, next.start - last.end) / 2 : TIMING.padOut));
    runs.push({ first: current.first, last: current.last, start, end });
    current = null;
  };
  for (const w of words) {
    if (!keep(w.id)) {
      close();
      continue;
    }
    if (current && (w.id !== current.last + 1 || w.start - words[current.last]!.end > TIMING.longPause)) close();
    if (!current) current = { first: w.id, last: w.id };
    else current.last = w.id;
  }
  close();
  return runs;
}

function toClips(runs: Run[], role: Clip["role"]): Clip[] {
  const clips: Clip[] = [];
  for (const r of runs) {
    let startFrame = Math.max(0, Math.round(r.start * FPS));
    let endFrame = Math.round(r.end * FPS);
    if (endFrame - startFrame < TIMING.minFrames) endFrame = startFrame + TIMING.minFrames;
    const prev = clips[clips.length - 1];
    // Dos tramos que se tocan después de ajustar a cuadros se unen (no hace falta un corte).
    if (prev && startFrame <= prev.endFrame && r.first > prev.lastWord) {
      prev.endFrame = Math.max(prev.endFrame, endFrame);
      prev.lastWord = r.last;
      continue;
    }
    if (prev && startFrame < prev.endFrame) startFrame = prev.endFrame;
    if (endFrame <= startFrame) continue;
    clips.push({ startFrame, endFrame, role, firstWord: r.first, lastWord: r.last });
  }
  return clips;
}

export type Timeline = {
  clips: Clip[];
  /** Duración final en segundos. */
  duration: number;
  /** Palabras que quedan, con tiempos del video final. */
  words: TimedWord[];
};

/**
 * Arma el timeline. Si hay gancho elegido, sus palabras pasan al principio y salen de su lugar original.
 */
export function buildTimeline(
  words: Word[],
  plan: Pick<EditPlan, "removals" | "hook_candidates" | "selected_hook" | "corrections" | "captions">,
  duration: number,
): Timeline {
  const removed = removedIds(plan, words.length);
  const hook = plan.selected_hook != null ? plan.hook_candidates[plan.selected_hook] : undefined;
  const inHook = (id: number) => Boolean(hook && id >= hook.from_word && id <= hook.to_word);
  // Si el gancho ya está al principio del video, no se mueve: es parte del cuerpo.
  const firstKept = words.find((w) => !removed.has(w.id));
  const hookIsOpening = Boolean(hook && firstKept && hook.from_word <= firstKept.id);

  const hookRuns = hook && !hookIsOpening ? runsFor(words, (id) => inHook(id) && !removed.has(id), duration) : [];
  const bodyRuns = runsFor(words, (id) => !removed.has(id) && (hookIsOpening || !inHook(id)), duration);
  const clips = [...toClips(hookRuns, "hook"), ...toClips(bodyRuns, "body")];

  const emphasis = new Set(plan.captions.emphasis_words);
  const timed: TimedWord[] = [];
  let offset = 0;
  for (const clip of clips) {
    const clipStart = clip.startFrame / FPS;
    const clipDur = (clip.endFrame - clip.startFrame) / FPS;
    for (let id = clip.firstWord; id <= clip.lastWord; id++) {
      const w = words[id];
      if (!w || removed.has(id)) continue;
      if (clip.role === "body" && !hookIsOpening && inHook(id)) continue;
      const start = offset + Math.max(0, w.start - clipStart);
      const end = offset + Math.min(clipDur, Math.max(w.end - clipStart, w.start - clipStart + 0.05));
      const raw = plan.corrections[String(id)] ?? w.text;
      const text = captionText(raw);
      if (text) timed.push({ id, text, start: round3(start), end: round3(Math.max(end, start + 0.05)), emphasis: emphasis.has(id), stop: endsSentence(w.text) || endsSentence(raw) });
    }
    offset += clipDur;
  }
  return { clips, duration: round3(offset), words: timed };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Segmentos y orden en el formato del plan v2 (para guardarlo legible junto al plan). */
export function planSegments(clips: Clip[]): { segments: PlanSegment[]; order: string[] } {
  const segments = clips.map((c, i) => ({ id: `s${i}`, from_word: c.firstWord, to_word: c.lastWord, role: c.role }));
  return { segments, order: segments.map((s) => s.id) };
}

/** Mapea un instante del video original al del video final (para la vista previa). null si cae en un corte. */
export function sourceToOutput(clips: Clip[], t: number): { clipIndex: number; out: number } | null {
  let offset = 0;
  for (const [i, c] of clips.entries()) {
    const s = c.startFrame / FPS;
    const e = c.endFrame / FPS;
    if (t >= s && t < e) return { clipIndex: i, out: offset + (t - s) };
    offset += e - s;
  }
  return null;
}

/** Instante del original que corresponde a un instante del video final. */
export function outputToSource(clips: Clip[], out: number): { clipIndex: number; source: number } {
  let offset = 0;
  for (const [i, c] of clips.entries()) {
    const dur = (c.endFrame - c.startFrame) / FPS;
    if (out < offset + dur || i === clips.length - 1) return { clipIndex: i, source: c.startFrame / FPS + Math.min(dur, Math.max(0, out - offset)) };
    offset += dur;
  }
  return { clipIndex: 0, source: 0 };
}
