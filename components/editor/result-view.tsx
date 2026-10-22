"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, CheckCircle2, Citrus, Download, FileText, PencilLine, TriangleAlert } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { formatBytes, formatDuration, formatNumber } from "@/lib/format";
import type { OutputMeta } from "@/lib/dal/video";
import { cn } from "@/lib/utils";
import { reopenAction } from "./actions";
import { FinalReviewCard } from "./director/final-review";
import type { FinalReview } from "@/lib/video/director/types";

export function ResultView({
  projectId,
  format,
  output,
  posterUrl,
  canEdit,
  auto = false,
  finalReview = null,
  finalSheets = [],
}: {
  /** Revisión final de la IA (cuadros del MP4), si se hizo. */
  finalReview?: FinalReview | null;
  finalSheets?: { url: string }[];
  /** Se exportó con "Hazlo por mí" (sin pasar por la revisión). */
  auto?: boolean;
  projectId: string;
  format: "9:16" | "16:9";
  output: { url: string; downloadUrl: string; srtUrl: string | null; creditsUrl?: string | null; meta: OutputMeta };
  posterUrl: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const meta = output.meta;
  const qc = meta.qc;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,auto)_minmax(0,1fr)]">
      <div className="mx-auto w-full" style={{ maxWidth: format === "9:16" ? 380 : 720 }}>
        <video
          src={output.url}
          poster={posterUrl ?? undefined}
          controls
          playsInline
          preload="metadata"
          className="w-full rounded-2xl border border-white/10 bg-black"
          style={{ aspectRatio: format === "9:16" ? "9 / 16" : "16 / 9" }}
          aria-label="Video editado"
        />
      </div>

      <div className="flex flex-col gap-5">
        <div className="card flex flex-col gap-4 p-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-success" aria-hidden />
            <div>
              <h2 className="text-lg font-semibold">Tu video está listo</h2>
              <p className="text-sm text-muted">
                {auto ? "Lo editamos y exportamos solo, con tus valores por defecto. " : ""}Descárgalo para publicarlo o prográmalo en el calendario.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={output.downloadUrl} download className="btn">
              <Download className="h-4 w-4" aria-hidden /> Descargar MP4
            </a>
            {output.srtUrl && (
              <a href={output.srtUrl} download className="btn-ghost">
                <FileText className="h-4 w-4" aria-hidden /> Subtítulos (SRT)
              </a>
            )}
            {output.creditsUrl && (
              <a href={output.creditsUrl} download className="btn-ghost">
                <FileText className="h-4 w-4" aria-hidden /> Créditos del b-roll
              </a>
            )}
            <ButtonLink href={`/calendario?nuevo=1&video=${projectId}`} variant="ghost" icon={<CalendarPlus className="h-4 w-4" aria-hidden />}>
              Programar en Calendario
            </ButtonLink>
            <ButtonLink href={`/jugo?video=${projectId}`} variant="ghost" icon={<Citrus className="h-4 w-4" aria-hidden />}>
              Sacarle todo el jugo
            </ButtonLink>
          </div>
          {canEdit && (
            <Button
              variant="subtle"
              className="self-start !px-0"
              disabled={pending}
              icon={<PencilLine className="h-4 w-4" aria-hidden />}
              onClick={() =>
                start(async () => {
                  const result = await reopenAction(projectId);
                  if (!result.ok) toast.error(result.error);
                  else router.refresh();
                })
              }
            >
              Revisar y volver a exportar
            </Button>
          )}
        </div>

        {finalReview && <FinalReviewCard projectId={projectId} review={finalReview} sheets={finalSheets} format={format} canEdit={canEdit} />}

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Duración", value: formatDuration(meta.duration) },
            { label: "Tamaño", value: meta.width && meta.height ? `${meta.width}×${meta.height}` : "—" },
            { label: "Sonoridad", value: meta.lufs != null ? `${formatNumber(meta.lufs, { digits: 1 })} LUFS` : "—" },
            { label: "Archivo", value: formatBytes(meta.bytes) },
          ].map((s) => (
            <div key={s.label} className="card px-4 py-3">
              <dt className="text-xs text-muted">{s.label}</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-white tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>

        {qc && (
          <section className="card p-5" aria-labelledby="qc-title">
            <h3 id="qc-title" className="mb-3 text-sm font-semibold text-white">
              Control de calidad
            </h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {qc.checks.map((c) => (
                <li key={c.name} className="flex items-start gap-2 text-sm">
                  {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-success" aria-hidden /> : <TriangleAlert className="mt-0.5 h-4 w-4 flex-none text-warning" aria-hidden />}
                  <span>
                    <span className={cn("font-semibold", c.ok ? "text-white" : "text-warning")}>{c.name}</span>
                    <span className="block text-xs text-muted">{c.detail}</span>
                  </span>
                  <span className="sr-only">{c.ok ? "correcto" : "revisar"}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
