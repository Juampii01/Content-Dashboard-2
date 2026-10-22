import { G, Line, Path, Rect, Svg, Text, View } from "@react-pdf/renderer";
import { formatCompact } from "@/lib/format";
import type { PdfTheme } from "./theme";

/**
 * Gráficos del PDF dibujados en SVG (vectoriales: se ven nítidos al imprimir o hacer zoom).
 * Las etiquetas van fuera del SVG, con la misma tipografía del informe.
 */

/** Máximo "redondo" para el eje (1, 2, 2.5, 5 × 10^n) por encima del valor. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const n = value / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * exp;
}

const AXIS_W = 34;

function YAxis({ max, height, theme, ticks = 2 }: { max: number; height: number; theme: PdfTheme; ticks?: number }) {
  return (
    <View style={{ width: AXIS_W, height, position: "relative" }}>
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const value = (max / ticks) * (ticks - i);
        return (
          <Text key={i} style={{ position: "absolute", top: (height / ticks) * i - 4, right: 6, fontSize: 6.5, color: theme.faint, fontFamily: "JetBrains Mono" }}>
            {formatCompact(value)}
          </Text>
        );
      })}
    </View>
  );
}

function XLabels({ labels, width, theme }: { labels: { at: number; text: string }[]; width: number; theme: PdfTheme }) {
  return (
    <View style={{ marginLeft: AXIS_W, width, height: 12, position: "relative" }}>
      {labels.map((l, i) => (
        <Text key={i} style={{ position: "absolute", left: Math.max(0, Math.min(width - 24, l.at - 12)), width: 24, top: 3, textAlign: "center", fontSize: 6.5, color: theme.faint, fontFamily: "JetBrains Mono" }}>
          {l.text}
        </Text>
      ))}
    </View>
  );
}

/** Etiquetas del eje X: el día del mes cada 5 días (1, 5, 10…) y el último. */
function dayLabels(days: string[], slot: number): { at: number; text: string }[] {
  return days
    .map((d, i) => ({ d: Number(d.slice(8)), i }))
    .filter(({ d, i }) => d === 1 || d % 5 === 0 || i === days.length - 1)
    .filter((x, k, all) => k === all.length - 1 || all[k + 1]!.i - x.i >= 2)
    .map(({ d, i }) => ({ at: slot * i + slot / 2, text: String(d) }));
}

/** Barras por día (visualizaciones). Los días sin dato quedan vacíos, no en cero. */
export function DailyBars({ days, values, width, height, color, theme }: { days: string[]; values: (number | null)[]; width: number; height: number; color: string; theme: PdfTheme }) {
  const plotW = width - AXIS_W;
  const max = niceMax(Math.max(0, ...values.map((v) => v ?? 0)));
  const slot = plotW / Math.max(1, days.length);
  const barW = Math.max(2, slot * 0.62);
  return (
    <View>
      <View style={{ flexDirection: "row" }}>
        <YAxis max={max} height={height} theme={theme} />
        <Svg width={plotW} height={height} viewBox={`0 0 ${plotW} ${height}`}>
          {[0, 0.5, 1].map((t) => (
            <Line key={t} x1={0} x2={plotW} y1={height * t} y2={height * t} stroke={theme.line} strokeWidth={t === 1 ? 0.8 : 0.5} />
          ))}
          {values.map((v, i) => {
            if (v == null || v <= 0) return null;
            const h = Math.max(1, (v / max) * height);
            return <Rect key={i} x={slot * i + (slot - barW) / 2} y={height - h} width={barW} height={h} fill={color} rx={Math.min(1.5, barW / 3)} />;
          })}
        </Svg>
      </View>
      <XLabels labels={dayLabels(days, slot)} width={plotW} theme={theme} />
    </View>
  );
}

/** Línea con área suave (seguidores). El eje no arranca en cero para que se vea el cambio. */
export function FollowersLine({ days, values, width, height, color, theme }: { days: string[]; values: (number | null)[]; width: number; height: number; color: string; theme: PdfTheme }) {
  const plotW = width - AXIS_W;
  const known = values.filter((v): v is number => v != null);
  if (known.length < 2) return null;
  let lo = Math.min(...known);
  let hi = Math.max(...known);
  const pad = Math.max(1, (hi - lo) * 0.15);
  lo = Math.max(0, lo - pad);
  hi = hi + pad;
  const slot = plotW / Math.max(1, days.length);
  const x = (i: number) => slot * i + slot / 2;
  const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
  const points = values.map((v, i) => (v == null ? null : [x(i), y(v)] as const)).filter((p): p is readonly [number, number] => p !== null);
  const line = points.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
  const area = `${line} L${points.at(-1)![0].toFixed(1)} ${height} L${points[0]![0].toFixed(1)} ${height} Z`;
  return (
    <View>
      <View style={{ flexDirection: "row" }}>
        <View style={{ width: AXIS_W, height, position: "relative" }}>
          {[hi, lo].map((v, i) => (
            <Text key={i} style={{ position: "absolute", top: i ? height - 6 : -2, right: 6, fontSize: 6.5, color: theme.faint, fontFamily: "JetBrains Mono" }}>
              {formatCompact(v)}
            </Text>
          ))}
        </View>
        <Svg width={plotW} height={height} viewBox={`0 0 ${plotW} ${height}`}>
          <Line x1={0} x2={plotW} y1={height} y2={height} stroke={theme.line} strokeWidth={0.8} />
          <Path d={area} fill={color} fillOpacity={0.1} />
          <Path d={line} stroke={color} strokeWidth={1.6} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      </View>
      <XLabels labels={dayLabels(days, slot)} width={plotW} theme={theme} />
    </View>
  );
}

/** Barras por semana contra la meta (línea punteada). */
export function WeekBars({
  weeks,
  width,
  height,
  theme,
}: {
  weeks: { label: string; pieces: number; target: number; hit: boolean }[];
  width: number;
  height: number;
  theme: PdfTheme;
}) {
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.pieces, w.target))) * 1.15;
  const slot = width / Math.max(1, weeks.length);
  const barW = Math.min(46, slot * 0.5);
  return (
    <View>
      <View style={{ width, height, position: "relative" }}>
        <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", top: 0, left: 0 }}>
          <Line x1={0} x2={width} y1={height} y2={height} stroke={theme.line} strokeWidth={0.8} />
          {weeks.map((w, i) => {
            const h = (w.pieces / max) * height;
            const ty = height - (w.target / max) * height;
            const cx = slot * i + slot / 2;
            return (
              <G key={i}>
                {w.pieces > 0 && <Rect x={cx - barW / 2} y={height - h} width={barW} height={h} fill={w.hit ? theme.accent : "#c9d1dc"} rx={2} />}
                <Line x1={cx - barW / 2 - 6} x2={cx + barW / 2 + 6} y1={ty} y2={ty} stroke={theme.ink} strokeWidth={0.9} strokeDasharray="2.5 2" />
              </G>
            );
          })}
        </Svg>
        {weeks.map((w, i) => {
          const h = (w.pieces / max) * height;
          return (
            <Text
              key={i}
              style={{ position: "absolute", left: slot * i, width: slot, top: Math.max(0, height - h - 13), textAlign: "center", fontSize: 9, fontWeight: 700, color: theme.ink }}
            >
              {w.pieces}
            </Text>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", width }}>
        {weeks.map((w, i) => (
          <Text key={i} style={{ width: slot, textAlign: "center", fontSize: 7, color: theme.muted, marginTop: 4 }}>
            {w.label}
          </Text>
        ))}
      </View>
    </View>
  );
}
