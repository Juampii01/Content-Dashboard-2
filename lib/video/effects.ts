/**
 * Efectos del estilo sobre el timeline final: zooms/punch-ins y tramos de b-roll en segundos del video editado.
 *
 * Como los cortes, se calculan siempre a partir del timeline (lib/video/timeline.ts): la vista previa y el render
 * usan la misma función, así lo que se ve en la revisión es lo que sale en el MP4. Sin servidor ni navegador.
 */
import { resolveEdit, type BrollEdit } from "./broll-edit";
import type { StylePreset } from "./style";
import { isV2Scene, lastCueWord, resolveSceneCues, sceneCueTimes } from "./motion-cues";
import { graphicWithPlace } from "./motion-graphics";
import { outputRange, type Timeline } from "./timeline";
import { FPS, type BrollItem, type BrollOption, type ZoomMoment } from "./types";

export type OutputZoom = { start: number; end: number; scale: number; ramp: number; kind: "punch" | "smooth" };
/** `layer`: capa del b-roll (lib/video/layers.ts); con otros encima o debajo, se dibujan en ese orden. */
export type OutputBroll = { id: string; start: number; end: number; option: BrollOption; edit: BrollEdit; layer?: number };

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

/**
 * Zooms que decidió el director (lib/video/director): cada uno sobre su rango de palabras, nunca encima de un b-roll
 * ni en el primer medio segundo. Se usan cuando no hay un estilo con sus propios zooms.
 */
export function directorZooms(timeline: Timeline, moments: ZoomMoment[] | undefined, avoid: Range[] = []): OutputZoom[] {
  // 1. Cada zoom en su tramo (sin entrar en un b-roll ni en un efecto, que llevan su propia cámara).
  type Cand = { start: number; end: number; scale: number; layer: number; order: number };
  const cands: Cand[] = [];
  [...(moments ?? [])]
    .map((m, i) => ({ m, i }))
    .sort((a, b) => a.m.from_word - b.m.from_word || a.i - b.i)
    .forEach(({ m }, order) => {
      const range = outputRange(timeline, m.from_word, m.to_word);
      if (!range) return;
      // El punch-in cae en la palabra (dos cuadros antes, para que el corte de encuadre se sienta en la sílaba).
      const start = Math.max(0.5, range.start - 0.06);
      let end = Math.min(timeline.duration, range.end + 0.3, start + 3.5);
      const nextBroll = avoid.filter((r) => r.end > start).sort((a, b) => a.start - b.start)[0];
      if (nextBroll && nextBroll.start <= start + 0.2) return;
      if (nextBroll) end = Math.min(end, nextBroll.start - 0.05);
      if (end - start < 0.6) return;
      cands.push({ start, end, scale: Math.max(1.04, Math.min(1.32, m.scale)), layer: m.layer ?? 0, order });
    });
  // 2. Superpuestos: en cada instante manda el de capa más alta (con la misma capa, el que empezó después). Debajo, el
  // otro sigue antes y después. Así nunca se multiplican (la cara no se va de cuadro).
  const cuts = [...new Set(cands.flatMap((c) => [c.start, c.end]))].sort((a, b) => a - b);
  type Piece = { start: number; end: number; src: Cand };
  const pieces: Piece[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const a = cuts[k]!;
    const b = cuts[k + 1]!;
    const top = cands.filter((c) => c.start <= a + 1e-6 && c.end >= b - 1e-6).sort((x, y) => y.layer - x.layer || y.start - x.start || y.order - x.order)[0];
    if (!top) continue;
    const last = pieces[pieces.length - 1];
    if (last && last.src === top && Math.abs(last.end - a) < 1e-6) last.end = b;
    else pieces.push({ start: a, end: b, src: top });
  }
  // 3. Como antes: dos zooms seguidos con la misma escala vuelven al plano normal un momento (o se saltea el segundo);
  // con distinta escala son un cambio de encuadre y pueden ir pegados.
  const out: OutputZoom[] = [];
  for (const p of pieces) {
    const prev = out[out.length - 1];
    const sameScale = prev ? Math.abs(prev.scale - p.src.scale) <= 0.02 : false;
    if (prev && sameScale && p.start < prev.end + 0.4) {
      if (p.start <= prev.end + 1e-6) prev.end = round3(Math.max(prev.end, p.end));
      continue;
    }
    if (p.end - p.start < 0.2) continue;
    const kind: OutputZoom["kind"] = p.src.scale >= 1.12 ? "punch" : "smooth";
    // La rampa suave solo al empezar el zoom (un pedazo que sigue a otro entra de golpe: es un cambio de encuadre).
    const fresh = Math.abs(p.start - p.src.start) < 1e-6 && !(prev && Math.abs(prev.end - p.start) < 1e-6);
    out.push({ start: round3(p.start), end: round3(p.end), scale: p.src.scale, ramp: kind === "smooth" && fresh ? 0.35 : 0, kind });
  }
  return out;
}

/**
 * Tramos de b-roll en el video final (los que tienen clip elegido y palabras que quedan). La entrada y la salida se
 * corren según la edición de la revisión (`start_delta`, `end_delta`), sin salirse del video ni pisar el anterior.
 */
export function brollSegments(timeline: Timeline, items: BrollItem[]): OutputBroll[] {
  const out: OutputBroll[] = [];
  // En el orden en que se ven (un b-roll sobre el gancho, que pasa al principio, va primero).
  const placed = [...items]
    .filter((b) => b.choice)
    .map((item) => ({ item, range: outputRange(timeline, item.from_word, item.to_word) }))
    .sort((a, b) => (a.range?.start ?? Infinity) - (b.range?.start ?? Infinity) || a.item.from_word - b.item.from_word);
  const sorted = placed.map((p) => p.item);
  const ranges = placed.map((p) => p.range);
  for (const [i, item] of sorted.entries()) {
    const range = ranges[i];
    if (!range) continue;
    const edit = resolveEdit(item.edit);
    const start = Math.max(0, range.start + edit.start_delta);
    let end = Math.min(timeline.duration, range.end + edit.end_delta);
    // Se pueden superponer (capas): cada uno queda en su tramo, sin recortar al anterior.
    let option = item.choice!;
    if (option.source === "graphic" && isV2Scene(option.graphic)) {
      // Un gráfico dura lo que dura lo que se dice: si su último elemento suena casi al final, se estira para que se
      // lea (sin pisar el b-roll siguiente).
      const last = lastCueWord(option.graphic);
      const lastAt = last >= 0 ? timeline.words.find((w) => w.id === last) : undefined;
      const next = ranges.slice(i + 1).find(Boolean);
      const hold = lastAt ? Math.max(lastAt.end + 0.9, lastAt.start + 1.4) : 0;
      // Sin pisar el b-roll siguiente que empieza después (uno que ya se superpone no lo acorta).
      if (lastAt && hold > end) end = Math.max(end, Math.min(timeline.duration, hold, next && next.start > end ? next.start - 0.05 : Infinity));
      option = { ...option, graphic: resolveSceneCues(option.graphic, timeline.words, start, end) };
    }
    // Lugar y animación del lienzo de la revisión: van con el gráfico (los dibuja el motor, igual en la vista previa y el render).
    if (option.source === "graphic" && option.graphic) option = { ...option, graphic: graphicWithPlace(option.graphic, edit) };
    // Un b-roll de menos de 0,8 s parpadea: se estira un poco (sin pasarse del final).
    if (end - start < 0.8) end = Math.min(start + 1.2, timeline.duration);
    if (end - start < 0.5) continue;
    out.push({ id: item.id, start: round3(start), end: round3(end), option, edit, layer: item.layer ?? 0 });
  }
  return out;
}

/** Instantes del video final en que entra cada elemento sincronizado de los gráficos (ítems, cifras, palabras). */
export function graphicEntries(segments: OutputBroll[]): number[] {
  const out: number[] = [];
  for (const s of segments) if (s.option.source === "graphic" && isV2Scene(s.option.graphic)) for (const c of sceneCueTimes(s.option.graphic)) out.push(round3(s.start + c));
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

/**
 * ¿Se ocultan los subtítulos mientras se ve este gráfico? Sí a pantalla completa, abajo (la franja de los subtítulos) o
 * si el gráfico ya muestra la frase. Una palabra clave, una notificación o un ícono arriba conviven con los subtítulos
 * (como hace un editor de reels).
 */
export function graphicHidesCaptions(graphic: unknown): boolean {
  if (!graphic || typeof graphic !== "object") return false;
  const g = graphic as { v?: number; mode?: string; position?: string; layers?: { type?: string; component?: string }[] };
  if (g.v !== 2) return true;
  if (g.mode !== "overlay" || g.position === "bottom") return true;
  const comps = (g.layers ?? []).filter((l) => l.type === "component").map((l) => l.component);
  return !(comps.length && comps.every((c) => c === "keyword" || c === "dmNotification" || c === "iconBurst"));
}
