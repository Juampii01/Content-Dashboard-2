/**
 * "Dónde se fue la gente": detección de caídas fuertes en la curva de retención de YouTube y cruce con lo que se
 * decía en ese momento. Sin dependencias de servidor: se prueba sola (tests/youtube.test.mts).
 *
 * La curva de YouTube Analytics trae 100 puntos (`elapsedVideoTimeRatio` de 0,01 a 1) con `audienceWatchRatio`:
 * la parte del público que mira ese punto. Una "caída" es un tramo corto donde se pierde público mucho más rápido
 * que el ritmo normal de ese mismo video. El final (último 5 %) no cuenta: ahí se va todo el mundo y es normal.
 */
import type { RetentionDrop, RetentionPoint, TranscriptSegment } from "./types";

export const DROP_RULES = {
  /** Pérdida mínima (puntos del público inicial) para marcar una caída en el cuerpo del video. */
  minLossPct: 3,
  /** Cuántas veces más rápido que el ritmo normal tiene que caer. */
  minSteepness: 2.5,
  /** Pérdida mínima en el arranque para marcarlo como caída. */
  introMinLossPct: 8,
  /** Máximo de caídas que se muestran (además del arranque). */
  maxDrops: 4,
  /** El último tramo no se analiza (pantalla final, despedida). */
  tailFrom: 0.95,
  /** Segundos antes de la caída que se leen en la transcripción (la gente se va después de oír algo). */
  quoteLeadSec: 4,
};

/** Puntos limpios y ordenados. Descarta valores imposibles. */
export function cleanCurve(points: RetentionPoint[]): RetentionPoint[] {
  const seen = new Set<number>();
  return points
    .filter((p) => Number.isFinite(p.at) && Number.isFinite(p.ratio) && p.at > 0 && p.at <= 1 && p.ratio >= 0 && p.ratio < 20)
    .sort((a, b) => a.at - b.at)
    .filter((p) => {
      const key = Math.round(p.at * 1000);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Media móvil de 3 puntos (las curvas de videos con pocas vistas tienen ruido). */
function smooth(values: number[]): number[] {
  return values.map((_, i) => {
    const w = values.slice(Math.max(0, i - 1), Math.min(values.length, i + 2));
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Fin del arranque: los primeros 30 s en un video largo, el primer 10 % en uno corto (nunca menos de 2 puntos). */
export function introEnd(durationSec: number | null): number {
  if (!durationSec || durationSec <= 0) return 0.1;
  return Math.min(0.1, Math.max(0.02, 30 / durationSec));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Caídas fuertes de la curva, ordenadas por tiempo. La del arranque va primero si es grande (es la que más pesa
 * en YouTube). Devuelve [] si la curva tiene muy pocos puntos para decir algo.
 */
export function detectDrops(points: RetentionPoint[], durationSec: number | null, rules = DROP_RULES): RetentionDrop[] {
  const curve = cleanCurve(points);
  if (curve.length < 10) return [];
  const at = curve.map((p) => p.at);
  const raw = curve.map((p) => p.ratio);
  const s = smooth(raw);
  const toSec = (x: number) => (durationSec && durationSec > 0 ? Math.round(x * durationSec * 10) / 10 : null);
  const drops: RetentionDrop[] = [];

  // Arranque: desde el primer punto hasta el fin del arranque.
  const introIdx = Math.max(1, at.findIndex((x) => x >= introEnd(durationSec)));
  // Sin suavizar: en el arranque la curva cae tan rápido que la media móvil se come parte de la caída.
  const introLoss = (raw[0]! - raw[introIdx]!) * 100;
  const tailIdx = at.findIndex((x) => x >= rules.tailFrom);
  const bodyEnd = tailIdx > 0 ? tailIdx : at.length - 1;

  // Ritmo normal: mediana de la pérdida por punto en el cuerpo (sin el arranque ni el final).
  const steps: number[] = [];
  for (let i = introIdx + 1; i <= bodyEnd; i++) steps.push(s[i - 1]! - s[i]!);
  const normal = Math.max(0.0005, median(steps));

  if (introLoss >= rules.introMinLossPct) {
    drops.push({
      fromAt: at[0]!,
      toAt: at[introIdx]!,
      startSec: toSec(at[0]!),
      endSec: toSec(at[introIdx]!),
      lostPct: round1(introLoss),
      steepness: round1(introLoss / 100 / introIdx / normal),
      intro: true,
    });
  }

  // Cuerpo: ventanas de ~3 % del video donde se pierde mucho más que el ritmo normal.
  const w = Math.max(2, Math.round(curve.length * 0.03));
  const used = new Array<boolean>(curve.length).fill(false);
  for (let i = 0; i <= introIdx; i++) used[i] = true;
  const body: RetentionDrop[] = [];
  while (body.length < rules.maxDrops) {
    let best: { from: number; to: number; loss: number } | null = null;
    for (let from = introIdx; from + w <= bodyEnd; from++) {
      let free = true;
      for (let k = from + 1; k <= from + w; k++) if (used[k]) free = false;
      if (!free) continue;
      const loss = s[from]! - s[from + w]!;
      if (!best || loss > best.loss) best = { from, to: from + w, loss };
    }
    if (!best) break;
    // Se estira mientras los vecinos también caen fuerte (un acantilado puede durar más que la ventana).
    let { from, to } = best;
    while (from > introIdx && !used[from] && s[from - 1]! - s[from]! > 2 * normal && best.to - from < w * 3) from--;
    while (to < bodyEnd && !used[to + 1] && s[to]! - s[to + 1]! > 2 * normal && to - best.from < w * 3) to++;
    const loss = (s[from]! - s[to]!) * 100;
    const steepness = loss / 100 / (to - from) / normal;
    if (loss < rules.minLossPct || steepness < rules.minSteepness) break;
    for (let k = Math.max(0, from - 1); k <= Math.min(curve.length - 1, to + 1); k++) used[k] = true;
    body.push({ fromAt: at[from]!, toAt: at[to]!, startSec: toSec(at[from]!), endSec: toSec(at[to]!), lostPct: round1(loss), steepness: round1(steepness), intro: false });
  }
  return [...drops, ...body.sort((a, b) => a.fromAt - b.fromAt)];
}

/** Retención al final del arranque y a la mitad (para el resumen), en porcentaje. */
export function retentionMarks(points: RetentionPoint[], durationSec: number | null): { intro: number | null; middle: number | null; introAt: number } {
  const curve = cleanCurve(points);
  const near = (x: number) => curve.reduce<RetentionPoint | null>((best, p) => (!best || Math.abs(p.at - x) < Math.abs(best.at - x) ? p : best), null);
  const cut = introEnd(durationSec);
  const i = near(cut);
  const m = near(0.5);
  return { intro: i ? round1(i.ratio * 100) : null, middle: m ? round1(m.ratio * 100) : null, introAt: cut };
}

/**
 * Cómo retiene contra videos de YouTube de duración parecida (relativeRetentionPerformance, 0 a 1), en el arranque
 * y en todo el video. null si la curva no lo trae (curvas viejas o YouTube no lo dio para este video).
 */
export function relativeSummary(points: RetentionPoint[], durationSec: number | null): { intro: number; overall: number } | null {
  const curve = cleanCurve(points).filter((p) => typeof p.relative === "number" && Number.isFinite(p.relative));
  if (curve.length < 10) return null;
  const cut = introEnd(durationSec);
  const avg = (list: RetentionPoint[]) => list.reduce((a, p) => a + (p.relative as number), 0) / Math.max(1, list.length);
  const intro = curve.filter((p) => p.at <= cut);
  return { intro: avg(intro.length ? intro : curve.slice(0, 3)), overall: avg(curve.filter((p) => p.at < DROP_RULES.tailFrom)) };
}

/** "por encima del promedio", "en el promedio" o "por debajo del promedio" de videos de su duración. */
export function relativeLabel(value: number): "por encima del promedio" | "en el promedio" | "por debajo del promedio" {
  return value >= 0.55 ? "por encima del promedio" : value <= 0.45 ? "por debajo del promedio" : "en el promedio";
}

// ─── Cruce con la transcripción ─────────────────────────────────────────

export type DropQuote = { text: string; start: number; end: number };

/**
 * Lo que se decía justo antes y durante una caída: los tramos de la transcripción que tocan
 * [inicio − 4 s, fin]. Se recorta a ~180 caracteres, quedándose con lo más cercano a la caída.
 */
export function quoteForDrop(segments: TranscriptSegment[], drop: Pick<RetentionDrop, "startSec" | "endSec">, leadSec = DROP_RULES.quoteLeadSec, maxChars = 180): DropQuote | null {
  if (drop.startSec == null || drop.endSec == null || !segments.length) return null;
  const from = Math.max(0, drop.startSec - leadSec);
  const to = Math.max(drop.endSec, drop.startSec + 1);
  const hits = segments.filter((seg) => seg.end > from && seg.start < to && seg.text.trim()).sort((a, b) => a.start - b.start);
  if (!hits.length) return null;
  let text = hits.map((h) => h.text.trim()).join(" ").replace(/\s+/g, " ").trim();
  if (text.length > maxChars) {
    // Se queda con el final (lo último que oyeron antes de irse), cortando en una palabra.
    const tail = text.slice(text.length - maxChars);
    text = `…${tail.slice(tail.indexOf(" ") + 1)}`;
  }
  return { text, start: hits[0]!.start, end: hits[hits.length - 1]!.end };
}

/** La frase que se muestra: "Aquí se fue el 18 %: estabas diciendo «…»". */
export function dropSentence(drop: Pick<RetentionDrop, "lostPct" | "intro">, quote: DropQuote | null): string {
  const pct = `${String(Math.round(drop.lostPct)).replace(".", ",")} %`;
  const head = drop.intro ? `En el arranque se fue el ${pct}` : `Aquí se fue el ${pct}`;
  return quote ? `${head}: estabas diciendo «${quote.text}»` : `${head}.`;
}

/** Curva como texto para la IA: un punto cada 5 % (y los de las caídas), con segundos si se sabe la duración. */
export function curveAsText(points: RetentionPoint[], durationSec: number | null): string {
  const curve = cleanCurve(points);
  return curve
    .filter((p, i) => i === 0 || Math.round(p.at * 100) % 5 === 0)
    .map((p) => `${Math.round(p.at * 100)} %${durationSec ? ` (${Math.round(p.at * durationSec)} s)` : ""}: ${(p.ratio * 100).toFixed(1)} %`)
    .join("\n");
}
