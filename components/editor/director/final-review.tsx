"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Eye, TriangleAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { formatDuration, formatNumber } from "@/lib/format";
import { ISSUE_LABELS, type FinalReview } from "@/lib/video/director/types";
import { cn } from "@/lib/utils";
import { editAction } from "../director-actions";
import { FrameThumb, gridFor } from "./frame-thumb";

/**
 * Revisión final del video exportado: la IA miró cuadros del MP4. Si algo quedó mal, el aviso con la sugerencia y un
 * botón para arreglarlo (vuelve a pasar por el director y queda para revisar).
 */
export function FinalReviewCard({ projectId, review, sheets, format, canEdit }: { projectId: string; review: FinalReview; sheets: { url: string }[]; format: "9:16" | "16:9"; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const grid = format === "9:16" ? gridFor(1080, 1920) : gridFor(1920, 1080);
  const thumbs = sheets.map((s) => ({ url: s.url, frames: [] as number[] }));
  const nearest = (t: number) => {
    if (!review.frames?.length) return null;
    let best = 0;
    review.frames.forEach((f, i) => {
      if (Math.abs(f - t) < Math.abs(review.frames[best]! - t)) best = i;
    });
    return best + 1;
  };
  const issues = review.issues.filter((i) => i.severity !== "baja");
  const minor = review.issues.length - issues.length;

  function fix(instruction: string) {
    start(async () => {
      const r = await editAction(projectId, instruction, "fix");
      if (!r.ok) return void toast.error(r.error);
      router.refresh();
    });
  }

  return (
    <section className="card flex flex-col gap-4 p-5" aria-labelledby="final-review-title">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {review.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-success" aria-hidden /> : <Eye className="mt-0.5 h-5 w-5 flex-none text-warning" aria-hidden />}
          <div>
            <h3 id="final-review-title" className="text-sm font-semibold text-white">
              {review.ok ? "La IA revisó el video final" : "La IA encontró algo para mejorar"}
            </h3>
            <p className="text-sm text-muted">{review.verdict}</p>
          </div>
        </div>
        <span className={cn("pill flex-none font-mono", review.score >= 85 ? "text-success" : review.score >= 70 ? "text-warning" : "text-danger")}>{formatNumber(review.score)}/100</span>
      </div>
      {issues.length > 0 && (
        <ul className="flex flex-col gap-2">
          {issues.map((i, k) => (
            <li key={k} className="flex gap-3 rounded-xl bg-white/[0.03] p-2.5">
              {thumbs.length > 0 && <FrameThumb sheets={thumbs} grid={grid} frame={nearest(i.at)} className={format === "9:16" ? "w-12 flex-none" : "w-20 flex-none"} label={`Cuadro del segundo ${i.at.toFixed(1)}`} />}
              <div className="min-w-0 flex-1 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <TriangleAlert className={cn("h-3.5 w-3.5", i.severity === "alta" ? "text-danger" : "text-warning")} aria-hidden />
                  <span className="font-semibold text-white">{ISSUE_LABELS[i.kind]}</span>
                  <span className="font-mono text-xs text-muted">{formatDuration(i.at)}</span>
                </p>
                <p className="mt-0.5 text-text/90">{i.note}</p>
                <p className="mt-0.5 text-xs text-muted">Sugerencia: {i.fix}</p>
                {canEdit && (
                  <Button size="sm" variant="ghost" className="mt-2 !h-8 !px-2.5" disabled={pending} icon={<Wrench className="h-3.5 w-3.5" aria-hidden />} onClick={() => fix(i.fix)}>
                    Arreglarlo
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {minor > 0 && <p className="text-xs text-muted">Además, {minor === 1 ? "un detalle menor" : `${formatNumber(minor)} detalles menores`} que no hace falta tocar.</p>}
      {issues.length > 1 && canEdit && (
        <Button variant="ghost" className="self-start" disabled={pending} icon={<Wrench className="h-4 w-4" aria-hidden />} onClick={() => fix(issues.map((i) => i.fix).join(" "))}>
          Arreglar todo
        </Button>
      )}
      {review.by === "reglas" && <p className="text-xs text-muted">Revisado con las verificaciones automáticas (sin IA con visión).</p>}
    </section>
  );
}
