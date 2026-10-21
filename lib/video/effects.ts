/**
 * Efectos del estilo sobre el timeline final: zooms/punch-ins y tramos de b-roll en segundos del video editado.
 *
 * Como los cortes, se calculan siempre a partir del timeline (lib/video/timeline.ts): la vista previa y el render
 * usan la misma función, así lo que se ve en la revisión es lo que sale en el MP4. Sin servidor ni navegador.
 */
import type { StylePreset } from "./style";
import { outputRange, type Timeline } from "./timeline";
import { FPS, type BrollItem, type BrollOption } from "./types";

export type OutputZoom = { start: number; end: number; scale: number; ramp: number; kind: "punch" | "smooth" };
export type OutputBroll = { id: string; start: number; end: number; option: BrollOption };

type Range = { start: number; end: number };

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const inside = (t: number, ranges: Range[]) => ranges.some((r) => t >= r.start - 0.15 && t <= r.end + 0.15);

/** Instantes de corte del video final (inicio de cada tramo, menos el primero). */
export function cutTimes(timeline: Pick<Timeline, "clips">): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const [i, c] of timeline.clips.entries()) {
    if (i > 0) out.push(round3(acc));
    acc += (c.endFrame - c.startFrame) / FPS;
  }
  return out;
}

/**
 * Zooms al ritmo del estilo. Candidatos: los cortes (punch-in, como un jump cut), los comienzos de frase y las
 * palabras resaltadas (zoom suave, de énfasis). Se eligen en orden con la separación del estilo, nunca en el
 * primer medio segundo ni encima de un b-roll. Cada zoom dura hasta el próximo corte (o unos segundos).
 */
export function computeZooms(timeline: Timeline, zoom: StylePreset["zoom"] | null | undefined, options: { emphasis?: number[]; avoid?: Range[] } = {}): OutputZoom[] {
  if (!zoom?.enabled || timeline.duration < 3) return [];
  const duration = timeline.duration;
  const cuts = cutTimes(timeline);
  const emphasis = new Set(options.emphasis ?? []);
  const avoid = options.avoid ?? [];
  type Candidate = { t: number; priority: number; kind: OutputZoom["kind"] };
  const candidates: Candidate[] = [];
  for (const t of cuts) candidates.push({ t, priority: 2, kind: "punch" });
  for (const [i, w] of timeline.words.entries()) {
    const prev = timeline.words[i - 1];
    if (prev?.stop) candidates.push({ t: w.start, priority: 1, kind: "punch" });
    if (emphasis.has(w.id)) candidates.push({ t: Math.max(0, w.start - 0.15), priority: 3, kind: zoom.mode === "punch" ? "punch" : "smooth" });
  }
  if (zoom.mode === "smooth") for (const c of candidates) c.kind = "smooth";
  const usable = candidates.filter((c) => c.t >= 0.6 && c.t <= duration - 1 && !inside(c.t, avoid)).sort((a, b) => a.t - b.t);
  const spacing = Math.max(1.2, zoom.everySeconds * 0.85);
  const picked: Candidate[] = [];
  let i = 0;
  while (i < usable.length) {
    const c = usable[i]!;
    const last = picked[picked.length - 1];
    if (last && c.t - last.t < spacing) {
      i++;
      continue;
    }
    // Entre los candidatos del próximo segundo, el de más prioridad.
    const window = usable.filter((x) => x.t >= c.t && x.t <= c.t + 1);
    const best = window.reduce((a, b) => (b.priority > a.priority ? b : a), c);
    picked.push(best);
    i = usable.indexOf(best) + 1;
  }
  const out: OutputZoom[] = [];
  for (const [k, c] of picked.entries()) {
    const nextCut = cuts.find((t) => t > c.t + 0.6);
    const nextZoom = picked[k + 1]?.t ?? duration;
    const nextBroll = avoid.filter((r) => r.start > c.t).sort((a, b) => a.start - b.start)[0]?.start ?? duration;
    const maxLen = Math.min(3.5, Math.max(1.2, zoom.everySeconds * 0.6));
    let end = Math.min(nextCut ?? c.t + maxLen, c.t + maxLen, nextZoom - 0.05, nextBroll - 0.05, duration);
    if (end - c.t < 0.6) end = Math.min(c.t + 1, nextZoom - 0.05, duration);
    if (end - c.t < 0.4) continue;
    out.push({ start: round3(c.t), end: round3(end), scale: c.kind === "smooth" ? Math.min(zoom.scale, 1.15) : zoom.scale, ramp: c.kind === "smooth" ? 0.35 : 0, kind: c.kind });
  }
  return out;
}

/** Tramos de b-roll en el video final (los que tienen clip elegido y palabras que quedan). */
export function brollSegments(timeline: Timeline, items: BrollItem[]): OutputBroll[] {
  const out: OutputBroll[] = [];
  const sorted = [...items].filter((b) => b.choice).sort((a, b) => a.from_word - b.from_word);
  for (const item of sorted) {
    const range = outputRange(timeline, item.from_word, item.to_word);
    if (!range) continue;
    let { start, end } = range;
    const prev = out[out.length - 1];
    if (prev && start < prev.end) start = prev.end;
    // Un b-roll de menos de 0,8 s parpadea: se estira un poco (sin pasarse del final).
    if (end - start < 0.8) end = Math.min(start + 1.2, timeline.duration);
    if (end - start < 0.5) continue;
    out.push({ id: item.id, start: round3(start), end: round3(end), option: item.choice! });
  }
  return out;
}

/** creditos.txt: autor y página de cada video de stock (Pexels lo pide; en Pixabay es cortesía). */
export function brollCredits(segments: OutputBroll[]): string {
  const banks = [
    { source: "pixabay", label: "Pixabay", url: "https://pixabay.com" },
    { source: "pexels", label: "Pexels", url: "https://www.pexels.com" },
  ] as const;
  const blocks: string[] = [];
  for (const bank of banks) {
    const items = segments.filter((s) => s.option.source === bank.source && s.option.credit);
    if (!items.length) continue;
    const seen = new Set<string>();
    const lines = [`Videos de stock de ${bank.label} (${bank.url})`, ""];
    for (const s of items) {
      const c = s.option.credit!;
      if (seen.has(c.page)) continue;
      seen.add(c.page);
      lines.push(`Video de ${c.name} en ${bank.label}: ${c.page}`);
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.length ? `${blocks.join("\n\n")}\n` : "";
}
