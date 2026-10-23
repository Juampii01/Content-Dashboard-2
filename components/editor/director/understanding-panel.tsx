"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, Eye, Film, ScanText, ShieldCheck, Sparkles, Type } from "lucide-react";
import { formatDuration, formatNumber, formatUsd } from "@/lib/format";
import type { DirectorView } from "@/lib/dal/video";
import { BAD_TAKE_LABELS, BEAT_LABELS, ISSUE_LABELS, SHOT_KIND_LABELS, VIDEO_KIND_LABELS, type BeatRole } from "@/lib/video/director/types";
import type { Word } from "@/lib/video/types";
import { cn } from "@/lib/utils";
import { BriefEditor } from "./brief-form";
import { FrameThumb, gridFor, type SheetGrid } from "./frame-thumb";
import { useHumanize } from "../studio/humanize";

const BEAT_TONE: Partial<Record<BeatRole, string>> = {
  gancho: "border-accent/60 bg-accent/15 text-white",
  cta: "border-success/50 bg-success/10 text-white",
  oferta: "border-warning/50 bg-warning/10 text-white",
  cifra: "border-accent-hi/40 bg-accent-hi/10 text-white",
};

function excerpt(words: Word[], from: number, to: number, corrections: Record<string, string>, max = 70): string {
  const t = words
    .slice(from, to + 1)
    .map((w) => corrections[String(w.id)] ?? w.text)
    .join(" ");
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * "Lo que entendió": el mapa del video que armó el director mirando las hojas de contacto (tipo de video, historia por
 * partes, lo importante que se ve, tomas malas, texto en pantalla), la segunda mirada, el brief editable y el costo.
 */
export function UnderstandingPanel({
  projectId,
  view,
  words,
  corrections = {},
  removed,
  coveredBy,
  onListen,
  canEdit,
  sourceWidth,
  sourceHeight,
  defaultOpen = true,
}: {
  projectId: string;
  view: DirectorView;
  words: Word[];
  corrections?: Record<string, string>;
  /** Palabras cortadas ahora (para decir si una toma mala quedó). */
  removed?: Set<number>;
  /** Si un rango quedó tapado por un b-roll. */
  coveredBy?: (from: number, to: number) => boolean;
  onListen?: (wordId: number) => void;
  canEdit: boolean;
  sourceWidth: number;
  sourceHeight: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const h = useHumanize();
  const { state, cost } = view;
  const map = state.map;
  const grid: SheetGrid = view.layout ?? gridFor(sourceWidth, sourceHeight);
  const thumbs = view.sheets.map((s) => ({ url: s.url, frames: s.frames }));
  const lastRound = state.rounds.at(-1);
  const important = map?.shots.filter((s) => s.important) ?? [];
  const kept = (from: number, to: number) => {
    if (!removed) return true;
    let n = 0;
    for (let id = from; id <= to; id++) if (!removed.has(id)) n++;
    return n >= (to - from + 1) * 0.5;
  };

  return (
    <section aria-labelledby="director-title" className="section-shell @container !p-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="director-body"
        className="flex w-full items-start justify-between gap-3 rounded-2xl p-4 text-left sm:p-5"
      >
        <span className="flex min-w-0 items-start gap-3">
          <span className="tile-icon grid h-9 w-9 flex-none place-items-center rounded-xl">
            <Eye className="h-4.5 w-4.5 text-accent-hi" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="eyebrow">Director de edición</span>
            <span id="director-title" className="block text-base font-semibold text-white">
              Lo que entendió de tu video
            </span>
            {map && (
              <span className="mt-1 block text-sm text-muted">
                <span className="font-semibold text-text">{VIDEO_KIND_LABELS[map.kind]}.</span> {h(map.summary)}
              </span>
            )}
          </span>
        </span>
        <span className="flex flex-none items-center gap-2">
          {lastRound && (
            <span className={cn("pill hidden font-mono sm:inline-flex", lastRound.score >= 85 ? "text-success" : lastRound.score >= 70 ? "text-warning" : "text-danger")} title="Puntaje de la segunda mirada">
              {formatNumber(lastRound.score)}/100
            </span>
          )}
          <ChevronDown className={cn("h-5 w-5 text-muted transition motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
        </span>
      </button>

      {open && (
        <div id="director-body" className="flex flex-col gap-6 border-t border-white/10 p-4 sm:p-5">
          {!map && <p className="text-sm text-muted">Este video se editó antes del director: no hay un mapa de lo que se ve. Puedes pedirle cambios con “Edítalo así”.</p>}

          {map && map.beats.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Sparkles className="h-4 w-4 text-accent-hi" aria-hidden /> La historia, por partes
              </h3>
              <ol className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]" aria-label="Partes de la historia">
                {map.beats.map((b, i) => (
                  <li key={`${b.from}-${i}`} className="flex-none">
                    <button
                      type="button"
                      onClick={() => onListen?.(b.from)}
                      disabled={!onListen}
                      className={cn("flex w-44 flex-col gap-1 rounded-xl border p-2.5 text-left text-xs transition hover:border-white/30 disabled:cursor-default @lg:w-52", BEAT_TONE[b.role] ?? "border-white/10 bg-white/[0.03] text-text")}
                    >
                      <span className="font-mono text-[10px] tracking-wide text-accent-glow uppercase">
                        {i + 1}. {BEAT_LABELS[b.role]}
                      </span>
                      <span className="line-clamp-3">{b.summary ? h(b.summary) : `“${excerpt(words, b.from, b.to, corrections)}”`}</span>
                    </button>
                  </li>
                ))}
              </ol>
              {(map.promise || map.cta || map.figures.length > 0) && (
                <dl className="grid gap-2 text-xs @lg:grid-cols-3">
                  {map.promise && (
                    <div className="rounded-xl bg-white/[0.03] p-2.5">
                      <dt className="text-muted">Promesa</dt>
                      <dd className="mt-0.5 text-text">{h(map.promise)}</dd>
                    </div>
                  )}
                  {map.figures.length > 0 && (
                    <div className="rounded-xl bg-white/[0.03] p-2.5">
                      <dt className="text-muted">Cifras que dices</dt>
                      <dd className="mt-0.5 line-clamp-3 text-text">{map.figures.slice(0, 4).join(" · ")}</dd>
                    </div>
                  )}
                  {map.cta && (
                    <div className="rounded-xl bg-white/[0.03] p-2.5">
                      <dt className="text-muted">Llamada a la acción</dt>
                      <dd className="mt-0.5 text-text">{h(map.cta)}</dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
          )}

          {map && (important.length > 0 || map.badTakes.length > 0) && (
            <div className="grid gap-4 @2xl:grid-cols-2">
              <div className="flex flex-col gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <ShieldCheck className="h-4 w-4 text-success" aria-hidden /> Lo importante que se ve
                </h3>
                {important.length ? (
                  <ul className="flex flex-col gap-2">
                    {important.map((s, i) => (
                      <li key={i} className="flex gap-3 rounded-xl bg-white/[0.03] p-2">
                        <FrameThumb sheets={thumbs} grid={grid} frame={s.frame} className="w-14 flex-none sm:w-16" label={`Cuadro de ${s.shows}`} />
                        <div className="min-w-0 text-xs">
                          <p className="font-semibold text-white">
                            {SHOT_KIND_LABELS[s.kind]} <span className="font-mono font-normal text-muted">{formatDuration(s.start)}–{formatDuration(s.end)}</span>
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-text/90">{h(s.shows)}</p>
                          <p className="mt-1 text-success">No se tapa con b-roll ni se corta.</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted">Nada que haya que cuidar en especial: eres tú hablando a cámara.</p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Film className="h-4 w-4 text-warning" aria-hidden /> Tomas malas
                </h3>
                {map.badTakes.length ? (
                  <ul className="flex flex-col gap-2">
                    {map.badTakes.map((b, i) => {
                      const stays = kept(b.from, b.to);
                      const covered = stays && coveredBy?.(b.from, b.to);
                      return (
                        <li key={i} className="flex gap-3 rounded-xl bg-white/[0.03] p-2">
                          <FrameThumb sheets={thumbs} grid={grid} frame={b.frame} className="w-14 flex-none sm:w-16" label={`Cuadro de la toma: ${BAD_TAKE_LABELS[b.kind]}`} />
                          <div className="min-w-0 text-xs">
                            <p className="font-semibold text-white">
                              {BAD_TAKE_LABELS[b.kind]} <span className="font-mono font-normal text-muted">{formatDuration(b.start)}–{formatDuration(b.end)}</span>
                            </p>
                            <p className="mt-0.5 line-clamp-2 text-text/90">{h(b.note)}</p>
                            <p className={cn("mt-1", stays && !covered ? "text-warning" : "text-success")}>{!stays ? "Cortada." : covered ? "Tapada con b-roll." : "Quedó en el video: revísala."}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-muted">No vimos tomas fuera de cuadro, borrosas ni mirando a otro lado.</p>
                )}
              </div>
            </div>
          )}

          {map && map.onScreenText.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Type className="h-4 w-4 text-accent-hi" aria-hidden /> Texto que ya está en tu video
              </h3>
              <ul className="flex flex-wrap gap-2 text-xs">
                {map.onScreenText.map((t, i) => (
                  <li key={i} className="rounded-xl bg-white/[0.03] px-2.5 py-1.5 text-text">
                    “{t.text}” <span className="text-muted">· {formatDuration(t.start)} · {t.band}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">Ahí no ponemos subtítulos encima.</p>
            </div>
          )}

          {lastRound && (
            <div className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                <ScanText className="h-4 w-4 text-accent-hi" aria-hidden /> Segunda mirada antes de entregártelo
              </h3>
              <ol className="flex flex-col gap-2">
                {state.rounds.map((r) => (
                  <li key={r.n} className="rounded-xl bg-white/[0.03] p-3 text-xs">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-white">Vuelta {r.n}</span>
                      <span className={cn("font-mono", r.score >= 85 ? "text-success" : r.score >= 70 ? "text-warning" : "text-danger")}>{formatNumber(r.score)}/100</span>
                      <span className="text-muted">· miró {formatNumber(r.frames)} cuadros</span>
                      {r.fixed && <span className="pill !py-0.5 text-[11px] text-accent-glow">corregido</span>}
                    </p>
                    <p className="mt-1 text-text/90">{h(r.verdict)}</p>
                    {r.issues.length > 0 && (
                      <ul className="mt-2 flex flex-col gap-1">
                        {r.issues.slice(0, 6).map((i, k) => (
                          <li key={k} className="flex gap-2">
                            <AlertTriangle className={cn("mt-0.5 h-3.5 w-3.5 flex-none", i.severity === "alta" ? "text-danger" : i.severity === "media" ? "text-warning" : "text-muted")} aria-hidden />
                            <span>
                              <span className="font-semibold text-white">{ISSUE_LABELS[i.kind]}</span> <span className="font-mono text-muted">{formatDuration(i.at)}</span> · {h(i.note)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-white/10 pt-5">
            <div>
              <h3 className="text-sm font-semibold text-white">Tu brief</h3>
              <p className="text-xs text-muted">{view.brief ? "Lo que escribiste guía cada decisión." : "No lo llenaste: esto es lo que entendió la IA. Confírmalo o cámbialo."}</p>
            </div>
            <BriefEditor projectId={projectId} brief={view.brief} inferred={map?.inferredBrief ?? null} budgetUsd={view.budgetUsd} canEdit={canEdit} />
          </div>

          <div className="flex flex-col gap-1 rounded-xl bg-white/[0.03] p-3 text-xs">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold text-white">Costo de IA de este video:</span>
              <span className="font-mono text-text">
                {formatUsd(cost.totalUsd)} de {formatUsd(cost.capUsd)}
              </span>
              {cost.simulated && <span className="pill !py-0.5 text-[11px] text-warning">estimado (IA simulada)</span>}
            </p>
            {cost.stages.length > 0 && (
              <p className="text-muted">
                {cost.stages.map((s) => `${s.label}: ${formatUsd(s.usd)}`).join(" · ")}
              </p>
            )}
            {state.degraded.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-muted">
                {state.degraded.map((d, i) => (
                  <li key={i}>{h(d)}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
