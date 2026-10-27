"use client";

import { useMemo } from "react";
import { Activity } from "lucide-react";
import { SegmentedControl } from "@/components/ui/tabs";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DENSITIES, DENSITY_LABELS, DENSITY_TARGETS, type Density, type RhythmScore } from "@/lib/video/rhythm";
import type { SfxCue } from "@/lib/video/sfx";

const LANES = [
  { key: "zoom", label: "Zoom", color: "bg-accent-hi" },
  { key: "broll", label: "B-roll", color: "bg-[#199e70]" },
  { key: "grafico", label: "Gráfico", color: "bg-accent" },
  { key: "efecto", label: "Efecto", color: "bg-[#d55181]" },
] as const;

const pctOf = (t: number, d: number) => `${Math.max(0, Math.min(100, (t / Math.max(0.01, d)) * 100))}%`;
const dec = (n: number) => n.toFixed(1).replace(".", ",");

/**
 * Ritmo del video de un vistazo: una línea de tiempo compacta con dónde cae cada cosa sobre el video final (cortes,
 * zooms, b-roll, gráficos, efectos y sonidos), sincronizada con la reproducción, y el puntaje medido contra la densidad
 * elegida. Tocar la barra lleva la vista previa a ese segundo.
 */
export function RhythmPanel({
  score,
  cuts,
  sfx,
  entries,
  time,
  density,
  onDensity,
  onSeek,
  canEdit,
  showBar = true,
}: {
  score: RhythmScore;
  /** Instantes de corte del video final. */
  cuts: number[];
  sfx: SfxCue[];
  /** Instantes en que entra cada elemento sincronizado (ítems de los gráficos). */
  entries: number[];
  /** Segundo actual de la vista previa (video final), o null. */
  time: number | null;
  density: Density;
  onDensity: (d: Density) => void;
  onSeek: (t: number) => void;
  canEdit: boolean;
  /** Sin la barra de ritmo (en el Estudio, la línea de tiempo editable ya muestra todo). */
  showBar?: boolean;
}) {
  const d = score.duration;
  const target = DENSITY_TARGETS[density];
  const tone = score.score >= 85 ? "text-success" : score.score >= 65 ? "text-warning" : "text-danger";
  const lanes = useMemo(() => LANES.map((l) => ({ ...l, spans: score.spans.filter((s) => s.kind === l.key && (s.kind !== "zoom" || (s.scale ?? 1) > 1.01)) })), [score.spans]);

  function seek(e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if ("clientX" in e) {
      const r = el.getBoundingClientRect();
      onSeek(((e.clientX - r.left) / r.width) * d);
    }
  }

  return (
    <section aria-labelledby="rhythm-title" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="rhythm-title" className="flex items-center gap-2 text-sm font-semibold text-white">
            <Activity className="h-4 w-4 text-accent-hi" aria-hidden /> Ritmo
          </h2>
          <p className="text-xs text-muted">{score.verdict}</p>
        </div>
        <div className="flex flex-none flex-col items-end">
          <span className={cn("font-mono text-xl font-semibold tabular-nums leading-none", tone)} aria-label={`Puntaje de ritmo: ${score.score} de 100`}>
            {score.score}
          </span>
          <span className="font-mono text-[10px] text-muted">de 100</span>
        </div>
      </div>

      <SegmentedControl
        label="Densidad del ritmo"
        value={density}
        onValueChange={(v) => canEdit && onDensity(v as Density)}
        options={DENSITIES.map((k) => ({ value: k, label: k === "reels" ? "Reels" : DENSITY_LABELS[k].label }))}
      />
      <p className="-mt-1 text-xs text-muted" aria-live="polite">
        <span className="font-semibold text-text">{DENSITY_LABELS[density].label}:</span> {DENSITY_LABELS[density].description}
      </p>

      {showBar && (
      <div className="flex flex-col gap-1">
        {/* Barra: tocarla lleva la vista previa a ese segundo. */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Línea de tiempo del ritmo"
          aria-valuemin={0}
          aria-valuemax={Math.round(d)}
          aria-valuenow={Math.round(time ?? 0)}
          aria-valuetext={`${dec(time ?? 0)} s de ${dec(d)} s`}
          className="relative cursor-pointer select-none rounded-xl border border-line bg-white/[0.02] px-0 py-2 outline-none focus-visible:ring-2 focus-visible:ring-accent-hi"
          onClick={seek}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") onSeek(Math.min(d, (time ?? 0) + 1));
            if (e.key === "ArrowLeft") onSeek(Math.max(0, (time ?? 0) - 1));
          }}
          data-testid="rhythm-timeline"
        >
          {/* Huecos más largos que el objetivo de la densidad. */}
          {score.gaps.map((g) => (
            <div key={`g${g.start}`} className="absolute top-0 bottom-0 bg-danger/12" style={{ left: pctOf(g.start, d), width: pctOf(g.end - g.start, d) }} title={`${dec(g.seconds)} s sin cambios`} />
          ))}
          <div className="relative flex flex-col gap-1">
            {lanes.map((l) => (
              <div key={l.key} className="relative h-2.5">
                {l.spans.map((s, i) => (
                  <div
                    key={i}
                    className={cn("absolute top-0 h-full rounded-sm", l.color, l.key === "zoom" && (s.scale ?? 1) < 1.2 && "opacity-60")}
                    style={{ left: pctOf(s.start, d), width: pctOf(Math.max(0.12, s.end - s.start), d) }}
                    title={`${l.label}: ${dec(s.start)}–${dec(s.end)} s`}
                  />
                ))}
              </div>
            ))}
            {/* Cortes, entradas sincronizadas y sonidos. */}
            <div className="relative h-3">
              {cuts.map((t) => (
                <div key={`c${t}`} className="absolute top-0 h-3 w-px bg-white/70" style={{ left: pctOf(t, d) }} />
              ))}
              {entries.map((t, i) => (
                <div key={`e${i}`} className="absolute top-0.5 h-2 w-2 -translate-x-1/2 rotate-45 bg-accent-glow" style={{ left: pctOf(t, d) }} />
              ))}
              {sfx.map((c, i) => (
                <div key={`s${i}`} className="absolute top-1 h-1 w-1 -translate-x-1/2 rounded-full bg-warning" style={{ left: pctOf(c.at, d) }} />
              ))}
            </div>
          </div>
          {time != null && <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_6px_rgba(255,255,255,.7)]" style={{ left: pctOf(time, d) }} aria-hidden />}
        </div>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted" aria-label="Referencias">
          {LANES.map((l) => (
            <li key={l.key} className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-sm", l.color)} aria-hidden />
              {l.label}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span className="h-2.5 w-px bg-white/70" aria-hidden />
            Corte
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rotate-45 bg-accent-glow" aria-hidden />
            Entra con tu voz
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-warning" aria-hidden />
            Sonido
          </li>
        </ul>
      </div>
      )}

      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-white/[0.04] px-2 py-2">
          <dt className="text-[11px] text-muted">Cambios / 10 s</dt>
          <dd className={cn("font-mono text-sm font-semibold tabular-nums", score.changesPer10 >= target.changesPer10 ? "text-white" : "text-warning")}>{dec(score.changesPer10)}</dd>
        </div>
        <div className="rounded-xl bg-white/[0.04] px-2 py-2">
          <dt className="text-[11px] text-muted">Hueco más largo</dt>
          <dd className={cn("font-mono text-sm font-semibold tabular-nums", score.longestGap.seconds <= target.changeEvery + 0.5 ? "text-white" : "text-warning")}>{dec(score.longestGap.seconds)} s</dd>
        </div>
        <div className="rounded-xl bg-white/[0.04] px-2 py-2">
          <dt className="text-[11px] text-muted">Con algo en pantalla</dt>
          <dd className={cn("font-mono text-sm font-semibold tabular-nums", score.coverage >= target.coverage ? "text-white" : "text-warning")}>{formatNumber(Math.round(score.coverage * 100))} %</dd>
        </div>
      </dl>
    </section>
  );
}
