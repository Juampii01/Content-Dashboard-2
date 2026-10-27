/**
 * Cuadros clave de una edición para la segunda mirada y la revisión final: el gancho, antes y después de cada corte,
 * cada b-roll y gráfico en su lugar, los tramos con texto en pantalla y el final. Instantes del video final.
 * Sin servidor: el worker los saca del plan armado (o del MP4) y arma las hojas.
 */
import { brollSegments } from "../effects";
import { outputRange, type Timeline } from "../timeline";
import { FPS, type EditPlan, type Word } from "../types";
import { textOf, wordsInSpan } from "./context";
import type { Eyes } from "./types";

export type KeyFrame = { t: number; label: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function keyFrames(input: { plan: EditPlan; words: Word[]; timeline: Timeline; eyes: Eyes | null; max?: number }): KeyFrame[] {
  const { plan, words, timeline } = input;
  const max = input.max ?? 36;
  const d = timeline.duration;
  if (d <= 0) return [];
  const must: KeyFrame[] = [];
  const nice: KeyFrame[] = [];
  const at = (t: number) => round2(Math.max(0.05, Math.min(d - 0.05, t)));
  const hook = plan.selected_hook != null ? plan.hook_candidates[plan.selected_hook] : null;
  must.push({ t: at(0.3), label: hook ? `Gancho (inicio): "${textOf(words, hook.from_word, hook.to_word, plan.corrections, 60)}"` : "Inicio del video" });
  if (hook) {
    const r = outputRange(timeline, hook.from_word, hook.to_word);
    if (r) must.push({ t: at(r.end - 0.2), label: "Gancho (final)" });
  }
  const ordered = [...plan.broll].sort((a, b) => a.from_word - b.from_word);
  for (const seg of brollSegments(timeline, plan.broll)) {
    const n = ordered.findIndex((b) => b.id === seg.id) + 1;
    const kind = seg.option.source === "graphic" ? "Gráfico" : "B-roll";
    must.push({ t: at((seg.start + seg.end) / 2), label: `${kind} B${n} en su lugar` });
  }
  let acc = 0;
  for (const [i, c] of timeline.clips.entries()) {
    acc += (c.endFrame - c.startFrame) / FPS;
    if (i === timeline.clips.length - 1) break;
    nice.push({ t: at(acc - 0.15), label: `Antes del corte ${i + 1}` });
    nice.push({ t: at(acc + 0.15), label: `Después del corte ${i + 1}` });
  }
  for (const t of input.eyes?.tramos ?? []) {
    if (!t.text) continue;
    const span = wordsInSpan(words, t.start, t.end);
    const r = span ? outputRange(timeline, span.from, span.to) : null;
    if (r) must.push({ t: at((r.start + r.end) / 2), label: `Texto en pantalla: "${t.text.slice(0, 30)}"` });
  }
  must.push({ t: at(d - 0.4), label: "Final del video" });
  // Lo obligatorio primero; los cortes, repartidos de forma pareja hasta el tope.
  const room = Math.max(0, max - must.length);
  const step = nice.length > room && room > 0 ? nice.length / room : 1;
  const picked = room > 0 ? (step === 1 ? nice : Array.from({ length: room }, (_, k) => nice[Math.floor(k * step)]!)) : [];
  const all = [...must, ...picked].sort((a, b) => a.t - b.t);
  // Dos cuadros a menos de 0,1 s son el mismo: se quedan con una etiqueta que junta las dos.
  const out: KeyFrame[] = [];
  for (const f of all) {
    const last = out[out.length - 1];
    if (last && f.t - last.t < 0.1) last.label = `${last.label} · ${f.label}`;
    else out.push({ ...f });
  }
  return out.slice(0, max);
}

/** Cuadros parejos de un video ya exportado (revisión final): uno cada `every` segundos más el inicio y el final. */
export function evenFrames(duration: number, max = 24): KeyFrame[] {
  if (duration <= 0) return [];
  const n = Math.max(4, Math.min(max, Math.ceil(duration / 2)));
  return Array.from({ length: n }, (_, k) => {
    const t = round2(Math.min(duration - 0.1, 0.2 + (k * (duration - 0.4)) / Math.max(1, n - 1)));
    return { t, label: k === 0 ? "Inicio" : k === n - 1 ? "Final" : `Segundo ${t.toFixed(1)}` };
  });
}

/** Junta dos listas de cuadros sin repetir instantes (a menos de 0,3 s) y con tope. */
export function mergeFrames(a: KeyFrame[], b: KeyFrame[], max: number): KeyFrame[] {
  const out = [...a];
  for (const f of b) if (!out.some((x) => Math.abs(x.t - f.t) < 0.3)) out.push(f);
  return out.sort((x, y) => x.t - y.t).slice(0, max);
}
