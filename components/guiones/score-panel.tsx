"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { BarChart3, ChevronDown, Copy, Gauge, Lightbulb, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import type { ScoreExplanation } from "@/lib/ai/prompts/puntaje";
import { formatMultiplier, formatNumber } from "@/lib/format";
import { computeScore, hookKindLabel, verdictLabel, type HistoryPiece, type HookKind, type ScoreFormat, type ScoreResult } from "@/lib/scripts/score";
import { cn } from "@/lib/utils";
import { classifyHookAction, explainScoreAction, loadScoreHistoryAction } from "./score-actions";

/** Debajo de este parecido no se muestra la pieza: no se parece de verdad. */
const MIN_SHOWN = 0.25;
const platformShort: Record<HistoryPiece["platform"], string> = { INSTAGRAM: "Instagram", YOUTUBE: "YouTube", TIKTOK: "TikTok" };

function poolLabel(format: ScoreFormat): string {
  return format === "YT_LONG" ? "videos largos de YouTube" : "reels, TikToks y shorts";
}

function toneFor(score: number | null): string {
  if (score == null) return "text-muted";
  if (score >= 62) return "text-success";
  if (score >= 42) return "text-accent-glow";
  return "text-warning";
}

function ScoreMeter({ label, score, hint }: { label: string; score: number | null; hint: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <span className="eyebrow">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className={cn("text-3xl font-bold tabular-nums", toneFor(score))}>{score ?? "—"}</span>
        <span className="font-mono text-xs text-muted">/100</span>
      </span>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score ?? undefined}>
        <div className="h-full rounded-full bg-accent-hi transition-all" style={{ width: `${score ?? 0}%` }} />
      </div>
      <span className="text-xs text-muted">{hint}</span>
    </div>
  );
}

/** Barras horizontales con "× tu mediana" (tipos de gancho o rangos de duración). La línea marca ×1. */
function RatioBars({ rows, label }: { rows: { key: string; label: string; value: number | null; count: number; current: boolean; best: boolean }[]; label: string }) {
  const max = Math.max(2, ...rows.map((r) => r.value ?? 0));
  return (
    <ul className="flex flex-col gap-1.5" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(84px,auto)_1fr_auto] items-center gap-2 text-xs">
          <span className={cn("truncate", r.current ? "font-semibold text-white" : "text-muted")}>
            {r.label}
            {r.current && <span className="sr-only"> (el tuyo)</span>}
          </span>
          <span className="relative h-2 rounded-full bg-white/[0.06]">
            {r.value != null && <span className={cn("absolute inset-y-0 left-0 rounded-full", r.current ? "bg-accent-hi" : r.best ? "bg-success/70" : "bg-white/25")} style={{ width: `${(r.value / max) * 100}%` }} />}
            <span className="absolute inset-y-[-3px] w-px bg-white/40" style={{ left: `${(1 / max) * 100}%` }} aria-hidden />
          </span>
          <span className={cn("w-20 text-right font-mono tabular-nums", r.current ? "text-white" : "text-muted")}>
            {r.value == null ? (r.count ? `${r.count} pieza${r.count === 1 ? "" : "s"}` : "—") : formatMultiplier(r.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function hookHint(r: ScoreResult): string {
  if (r.hook.typeStat) return `${r.hook.typeLabel}: ${formatMultiplier(r.hook.typeStat.median)} tu mediana`;
  if (!r.hook.type || r.hook.type === "otro") return "Sin un tipo de gancho claro";
  return `Pocas piezas de ${r.hook.typeLabel.toLowerCase()} para comparar`;
}

function scriptHint(r: ScoreResult): string {
  if (r.script.bucket?.median != null) return `${r.script.bucket.label}: ${formatMultiplier(r.script.bucket.median)} tu mediana`;
  return "Sin piezas con duración para comparar";
}

/**
 * Panel "Puntaje contra tu historial" del editor de guiones. Calcula en el navegador con lib/scripts/score.ts
 * (se mueve mientras escribes) y usa la IA solo para volver a clasificar el gancho y para explicarlo.
 */
export function ScorePanel({
  hook,
  hookType,
  estimatedSeconds,
  format,
  canEdit,
  onHookTypeChange,
}: {
  hook: string;
  hookType: string | null;
  estimatedSeconds: number;
  format: ScoreFormat;
  canEdit: boolean;
  /** Si se vuelve a clasificar el gancho, el editor guarda el tipo nuevo. */
  onHookTypeChange?: (type: HookKind) => void;
}) {
  const detailId = useId();
  const [history, setHistory] = useState<HistoryPiece[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [typedHook] = useState(hook);
  const [classified, setClassified] = useState<{ text: string; type: HookKind } | null>(null);
  const [explanation, setExplanation] = useState<{ key: string; data: ScoreExplanation } | null>(null);
  const [busy, setBusy] = useState<"clasificar" | "explicar" | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    void loadScoreHistoryAction().then((res) => {
      if (!alive) return;
      if (res.ok) setHistory(res.data);
      else setLoadError(res.error);
    });
    return () => {
      alive = false;
    };
  }, []);

  function retry() {
    setLoadError(null);
    startTransition(async () => {
      const res = await loadScoreHistoryAction();
      if (res.ok) setHistory(res.data);
      else setLoadError(res.error);
    });
  }

  const knownType = (hookType && hookType in hookKindLabel ? hookType : null) as HookKind | null;
  const effectiveType = classified && classified.text === hook ? classified.type : knownType;
  const edited = hook.trim() !== typedHook.trim() && !(classified && classified.text === hook);
  const result = useMemo(() => (history ? computeScore(history, { hook, hookType: effectiveType, estimatedSeconds, format }) : null), [history, hook, effectiveType, estimatedSeconds, format]);
  const explainKey = `${hook}|${effectiveType}|${estimatedSeconds}|${format}`;

  function reclassify() {
    setBusy("clasificar");
    startTransition(async () => {
      const res = await classifyHookAction(hook);
      setBusy(null);
      if (!res.ok) return void toast.error(res.error);
      setClassified({ text: hook, type: res.data });
      onHookTypeChange?.(res.data);
      toast.success(`Gancho clasificado como ${hookKindLabel[res.data].toLowerCase()}.`);
    });
  }

  function explain() {
    setBusy("explicar");
    setOpen(true);
    startTransition(async () => {
      const res = await explainScoreAction({ hook, hookType: effectiveType, estimatedSeconds: Math.max(1, Math.round(estimatedSeconds)), format });
      setBusy(null);
      if (!res.ok) return void toast.error(res.error);
      setExplanation({ key: explainKey, data: res.data });
    });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Gancho copiado.");
    } catch {
      toast.error("No se pudo copiar. Selecciónalo y cópialo a mano.");
    }
  }

  return (
    <section className="card flex flex-col gap-4 p-5 sm:p-6" aria-labelledby={`${detailId}-title`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="tile-icon h-9 w-9">
            <Gauge className="h-4.5 w-4.5" aria-hidden />
          </span>
          <div>
            <h2 id={`${detailId}-title`} className="font-semibold text-white">
              Puntaje contra tu historial
            </h2>
            <p className="mt-0.5 text-sm text-muted">Compara este gancho y este guion con tus {poolLabel(format)} publicados. No es una predicción.</p>
          </div>
        </div>
        {result?.verdict && (
          <span className={cn("pill", result.verdict === "arriba" ? "!border-success/40 !text-success" : result.verdict === "abajo" ? "!border-warning/40 !text-warning" : "")}>{verdictLabel[result.verdict]}</span>
        )}
      </header>

      {loadError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-text">
          <span>{loadError}</span>
          <Button variant="ghost" size="sm" onClick={retry} icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}>
            Reintentar
          </Button>
        </div>
      ) : !result ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Calculando el puntaje">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : result.confidence === "sin-datos" ? (
        <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-muted">
          <p>
            Todavía tienes {result.poolSize === 0 ? "ninguna pieza" : `${result.poolSize} pieza${result.poolSize === 1 ? "" : "s"}`} de este formato con métricas para comparar. Con 8 o más
            te mostramos cómo se compara este guion con lo que ya te funcionó.
          </p>
          <Link href="/ajustes" className="self-start font-semibold text-accent-hi hover:text-white">
            Revisa tus redes conectadas
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <ScoreMeter label="Gancho" score={result.hook.score} hint={hookHint(result)} />
            <ScoreMeter label="Guion" score={result.script.score} hint={scriptHint(result)} />
          </div>

          <p className="text-xs text-placeholder">
            Comparado con {formatNumber(result.poolSize)} piezas tuyas del último año.
            {result.confidence === "pocos" && " Son pocos datos: tómalo como orientación."}
            {result.classified < result.poolSize / 2 && " Muchas piezas todavía no tienen su gancho clasificado (Métricas → Ganchos)."}
          </p>

          {edited && canEdit && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/10 px-4 py-2.5 text-sm text-text">
              <span>Cambiaste el gancho: el tipo puede ser otro.</span>
              <Button variant="ghost" size="sm" disabled={busy !== null || hook.trim().length < 3} onClick={reclassify} icon={<RefreshCw className={cn("h-3.5 w-3.5", busy === "clasificar" && "animate-spin")} aria-hidden />}>
                {busy === "clasificar" ? "Clasificando…" : "Volver a clasificar"}
              </Button>
            </div>
          )}

          {result.suggestions.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {result.suggestions.map((s) => (
                <li key={s} className="flex gap-2.5 text-sm leading-relaxed text-text">
                  <Lightbulb className="mt-0.5 h-4 w-4 flex-none text-accent-hi" aria-hidden />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          ) : (
            result.verdict === "arriba" && <p className="text-sm text-text">Va en línea con tus mejores piezas. Si te convence, grábalo así.</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="subtle" size="sm" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen((o) => !o)} icon={<ChevronDown className={cn("h-3.5 w-3.5 transition", open && "rotate-180")} aria-hidden />}>
              {open ? "Ocultar detalle" : "Ver detalle"}
            </Button>
            {canEdit && (
              <Button variant="ghost" size="sm" disabled={busy !== null} onClick={explain} icon={<Sparkles className={cn("h-3.5 w-3.5", busy === "explicar" && "animate-pulse")} aria-hidden />}>
                {busy === "explicar" ? "Explicando…" : "Explícamelo"}
              </Button>
            )}
          </div>

          <div id={detailId} hidden={!open} className="flex flex-col gap-5 border-t border-white/10 pt-4">
            {explanation && explanation.key === explainKey && (
              <div className="flex flex-col gap-2 rounded-xl border border-accent/30 bg-accent/[0.08] p-4 text-sm">
                <p className="eyebrow">Explicación</p>
                <p className="leading-relaxed text-text">{explanation.data.summary}</p>
                {explanation.data.tips.length > 0 && (
                  <ul className="list-disc pl-5 text-text">
                    {explanation.data.tips.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                )}
                {explanation.data.hookRewrite && (
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
                    <span className="text-white">«{explanation.data.hookRewrite}»</span>
                    <Button variant="subtle" size="sm" onClick={() => copy(explanation.data.hookRewrite!)} icon={<Copy className="h-3.5 w-3.5" aria-hidden />}>
                      Copiar
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-white">Tus tipos de gancho</p>
              {result.hook.bestType ? (
                <RatioBars label="Rendimiento por tipo de gancho" rows={typeRows(result)} />
              ) : (
                <p className="text-sm text-muted">Todavía no hay 3 piezas de un mismo tipo de gancho para comparar.</p>
              )}
              <p className="text-xs text-placeholder">× tu mediana de visualizaciones a los 7 días. La línea marca tu normal (×1).</p>
            </div>

            {result.hook.similar.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold text-white">
                  {result.hook.closeMatches > 0 ? `Se parece a ${result.hook.closeMatches === 1 ? "1 de tus mejores piezas" : `${result.hook.closeMatches} de tus mejores piezas`}` : "Parecido con tus mejores piezas"}
                </p>
                {result.hook.similar.every((x) => x.similarity < MIN_SHOWN) && (
                  <p className="text-sm text-muted">No se parece a ninguna de ellas: ni en el tipo de gancho, ni en las palabras, ni en la forma.</p>
                )}
                <ul className="flex flex-col gap-1.5">
                  {result.hook.similar.filter((x) => x.similarity >= MIN_SHOWN).map(({ piece, similarity }) => (
                    <li key={piece.id}>
                      <Link href={`/metricas/${piece.id}`} className="flex items-center gap-3 rounded-xl border border-white/10 px-3 py-2 text-sm transition hover:border-white/25">
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-1 text-text">{piece.text || "Sin texto"}</span>
                          <span className="text-xs text-placeholder">
                            {platformShort[piece.platform]} · {piece.hookType ? hookKindLabel[piece.hookType] : "Sin clasificar"} · parecido {Math.round(similarity * 100)} %
                          </span>
                        </span>
                        <span className="flex-none font-mono text-xs text-success">{formatMultiplier(piece.perf)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-placeholder">El parecido mira el tipo de gancho, las palabras en común y la forma (pregunta, cifra, si le hablas de «tú», largo).</p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-white">
                <BarChart3 className="h-4 w-4 text-accent-hi" aria-hidden /> Duración
              </p>
              <p className="text-sm text-muted">
                Este guion dura ≈<strong className="text-white">{Math.round(estimatedSeconds)} s</strong> hablado.
                {result.script.bestRange && (
                  <>
                    {" "}
                    Tus mejores piezas duran entre <strong className="text-white">{result.script.bestRange.from}</strong> y <strong className="text-white">{result.script.bestRange.to} s</strong>.
                  </>
                )}
              </p>
              {result.script.bucket ? (
                <RatioBars
                  label="Rendimiento por duración"
                  rows={result.script.buckets.map((b) => ({ key: b.label, label: b.label, value: b.median, count: b.count, current: b === result.script.bucket, best: b === result.script.bestBucket }))}
                />
              ) : (
                <p className="text-sm text-muted">Tus piezas todavía no traen su duración para comparar.</p>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/** Filas de las barras de tipos de gancho: los tipos con datos y, si no está entre ellos, el de este gancho. */
function typeRows(result: ScoreResult) {
  const rows: { key: string; label: string; value: number | null; count: number; current: boolean; best: boolean }[] = result.hookTypes.map((t) => ({ key: t.type, label: t.label, value: t.median, count: t.count, current: t.type === result.hook.type, best: t.type === result.hook.bestType?.type }));
  const type = result.hook.type;
  if (type && type !== "otro" && !rows.some((r) => r.current)) {
    const count = result.hookTypeCounts[type] ?? 0;
    rows.push({ key: type, label: hookKindLabel[type], value: null, count, current: true, best: false });
  }
  return rows;
}
