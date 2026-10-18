"use client";

import { useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Lightbulb, RefreshCw, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/format";
import type { PieceAnalysis } from "@/lib/db/schema";
import { analyzePieceAction } from "./actions";

/** Panel "¿Por qué funcionó?": diagnóstico con datos, aprendizajes e ideas que se convierten en guion con un clic. */
export function PieceAnalysisPanel({
  id,
  analysis,
  analyzedAt,
  wentWell,
  canEdit,
  aiReady,
}: {
  id: string;
  analysis: PieceAnalysis | null;
  analyzedAt: string | null;
  wentWell: boolean | null;
  canEdit: boolean;
  aiReady: boolean;
}) {
  const [pending, start] = useTransition();
  const question = wentWell === false ? "¿Por qué no funcionó?" : "¿Por qué funcionó?";
  const run = () =>
    start(async () => {
      const res = await analyzePieceAction(id);
      if (!res.ok) toast.error(res.error);
    });

  if (!analysis) {
    return (
      <section className="card flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="tile-icon flex-none">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-white">{question}</h2>
            <p className="mt-1 max-w-xl text-sm text-muted">
              Comparamos cada número de esta pieza con la mediana de tus piezas parecidas y te decimos qué repetir, qué cambiar y 3 ideas para la próxima.
            </p>
          </div>
        </div>
        {canEdit && aiReady ? (
          <Button onClick={run} disabled={pending} icon={<Sparkles className={pending ? "h-4 w-4 animate-pulse" : "h-4 w-4"} aria-hidden />}>
            {pending ? "Analizando…" : "Analizar con IA"}
          </Button>
        ) : (
          <span className="text-xs text-muted">{aiReady ? "Solo editores pueden analizar." : "La IA no está configurada en esta instalación."}</span>
        )}
      </section>
    );
  }

  return (
    <section className="card flex flex-col gap-6 p-6" aria-busy={pending}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow mb-2">{question}</p>
          <p className="max-w-3xl text-lg font-semibold leading-snug text-white">{analysis.verdict}</p>
        </div>
        {canEdit && aiReady && (
          <Button variant="subtle" size="sm" className="self-start" onClick={run} disabled={pending} icon={<RefreshCw className={pending ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden />}>
            {pending ? "Analizando…" : "Volver a analizar"}
          </Button>
        )}
      </header>

      <ul className="grid gap-3 md:grid-cols-2">
        {analysis.drivers.map((d, i) => (
          <li key={i} className="flex gap-3 rounded-xl border border-white/10 p-4">
            {d.effect === "positivo" ? (
              <ThumbsUp className="mt-0.5 h-4 w-4 flex-none text-success" aria-label="Sumó" />
            ) : (
              <ThumbsDown className="mt-0.5 h-4 w-4 flex-none text-warning" aria-label="Restó" />
            )}
            <div>
              <p className="text-sm font-semibold text-white">{d.factor}</p>
              <p className="mt-1 text-sm text-muted">{d.evidence}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-white">El gancho</h3>
          <p className="text-sm leading-relaxed text-text/90">{analysis.hook}</p>
          <h3 className="mb-2 mt-5 text-sm font-semibold text-white">Para tus próximas piezas</h3>
          <ol className="space-y-2">
            {analysis.lessons.map((l, i) => (
              <li key={i} className="flex gap-3 text-sm text-text/90">
                <span className="font-mono text-xs leading-5 text-accent-glow">{String(i + 1).padStart(2, "0")}</span>
                {l}
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
            <Lightbulb className="h-4 w-4 text-accent-hi" aria-hidden /> 3 ideas para la próxima
          </h3>
          <ul className="space-y-2">
            {analysis.ideas.map((idea, i) => (
              <li key={i}>
                <Link
                  href={`/guiones/nuevo?desde=${id}&idea=${encodeURIComponent(`${idea.title}. Gancho: ${idea.hook}. ${idea.angle}`)}`}
                  className="group flex items-start justify-between gap-3 rounded-xl border border-white/10 p-4 transition hover:border-line-strong hover:bg-white/[0.03]"
                >
                  <span>
                    <span className="block text-sm font-semibold text-white">{idea.title}</span>
                    <span className="mt-1 block text-sm text-text/90">“{idea.hook}”</span>
                    <span className="mt-1 block text-xs text-muted">{idea.angle}</span>
                  </span>
                  <span className="flex flex-none items-center gap-1 text-xs font-semibold text-accent-hi opacity-80 group-hover:opacity-100">
                    Escribir <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {analyzedAt && <p className="text-xs text-placeholder">Analizado {formatRelative(analyzedAt)} con los números de ese momento.</p>}
    </section>
  );
}
