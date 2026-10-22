"use client";

import Link from "next/link";
import { Film, Link2, Scissors, Upload } from "lucide-react";
import { StatusBadge, type StatusTone } from "@/components/ui/badges";
import { Progress } from "@/components/ui/feedback";
import { formatDuration, formatRelative } from "@/lib/format";
import { useAutoRefresh } from "../use-auto-refresh";
import { useLongUploads } from "./upload-store";

export type LongVideoItem = {
  id: string;
  title: string;
  status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
  sourceKind: string;
  sourceName: string | null;
  sourceUrl: string | null;
  duration: number | null;
  posterUrl: string | null;
  clips: number;
  best: number | null;
  errorMessage: string | null;
  job: { progress: number; stage: string | null; status: string } | null;
  updatedAt: string;
};

export const longStatusLabel: Record<LongVideoItem["status"], string> = { UPLOADING: "Subiendo", PROCESSING: "Buscando momentos", READY: "Clips listos", FAILED: "Con error" };
export const longStatusTone: Record<LongVideoItem["status"], StatusTone> = { UPLOADING: "neutral", PROCESSING: "info", READY: "success", FAILED: "danger" };

/** Videos largos ya subidos; se actualiza solo mientras alguno se procesa. */
export function LongVideoList({ videos }: { videos: LongVideoItem[] }) {
  const uploads = useLongUploads();
  useAutoRefresh(videos.some((v) => v.status === "PROCESSING"), 4000);
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Videos largos">
      {videos.map((v) => {
        const upload = uploads.find((u) => u.id === v.id);
        return (
          <li key={v.id}>
            <Link href={`/editor/clips/${v.id}`} className="card card-lift flex h-full flex-col overflow-hidden focus-visible:outline-2 focus-visible:outline-accent-hi">
              <div className="relative aspect-video w-full overflow-hidden border-b border-white/10 bg-black/40">
                {v.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <span className="grid h-full w-full place-items-center text-placeholder">
                    <Film className="h-7 w-7" aria-hidden />
                  </span>
                )}
                {v.duration != null && <span className="absolute right-2 bottom-2 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white">{formatDuration(v.duration)}</span>}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge tone={longStatusTone[v.status]}>{longStatusLabel[v.status]}</StatusBadge>
                  {v.status === "READY" && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                      <Scissors className="h-3.5 w-3.5" aria-hidden />
                      {v.clips === 1 ? "1 clip" : `${v.clips} clips`}
                    </span>
                  )}
                </div>
                <h3 className="line-clamp-2 font-semibold text-white">{v.title}</h3>
                <p className="flex items-center gap-1.5 truncate text-xs text-muted">
                  {v.sourceKind === "link" ? <Link2 className="h-3.5 w-3.5 flex-none" aria-hidden /> : <Upload className="h-3.5 w-3.5 flex-none" aria-hidden />}
                  <span className="truncate">{v.sourceKind === "link" ? (v.sourceUrl ?? "Link") : (v.sourceName ?? "Video subido")}</span>
                </p>
                {v.status === "UPLOADING" &&
                  (upload ? (
                    <Progress value={(upload.loaded / Math.max(1, upload.total)) * 100} label={upload.status === "error" ? (upload.error ?? "La subida falló") : "Subiendo"} />
                  ) : (
                    <p className="text-xs text-muted">La subida no terminó. Ábrelo para volver a intentarlo o borrarlo.</p>
                  ))}
                {v.status === "PROCESSING" && <Progress value={v.job?.progress ?? 0} label={v.job?.status === "QUEUED" ? "En cola" : (v.job?.stage ?? "En cola")} />}
                {v.status === "FAILED" && <p className="line-clamp-2 text-xs text-danger">{v.errorMessage ?? "No pudimos procesar el video."}</p>}
                <span className="mt-auto pt-1 text-xs text-placeholder">{formatRelative(v.updatedAt)}</span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
