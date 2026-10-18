"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Film } from "lucide-react";
import { StatusBadge } from "@/components/ui/badges";
import { Progress } from "@/components/ui/feedback";
import { formatDuration, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { statusLabel, statusTone, type ProjectStatus } from "./labels";
import { useUploads } from "./upload-manager";

export type ListItem = {
  id: string;
  title: string;
  status: ProjectStatus;
  format: string;
  progress: number | null;
  stage: string | null;
  duration: number | null;
  outputDuration: number | null;
  posterUrl: string | null;
  errorMessage: string | null;
  updatedAt: string;
};

/** Lista de proyectos con progreso real: se actualiza sola mientras hay trabajos en curso. */
export function ProjectList({ projects }: { projects: ListItem[] }) {
  const router = useRouter();
  const uploads = useUploads();
  const active = projects.some((p) => p.status === "PROCESSING" || p.status === "RENDERING");

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => !document.hidden && router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [active, router]);

  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map((p) => {
        const upload = uploads.find((u) => u.projectId === p.id);
        const working = p.status === "PROCESSING" || p.status === "RENDERING";
        const uploading = p.status === "UPLOADING" && upload && upload.status !== "error";
        return (
          <li key={p.id}>
            <Link href={`/editor/${p.id}`} className="card card-lift flex h-full gap-4 p-4">
              <div className={cn("relative flex-none overflow-hidden rounded-xl bg-black/40", p.format === "16:9" ? "aspect-video w-32" : "aspect-[9/16] w-20")}>
                {p.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="grid h-full w-full place-items-center text-placeholder">
                    <Film className="h-6 w-6" aria-hidden />
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={statusTone[p.status]}>{uploading ? "Subiendo" : p.status === "UPLOADING" ? "Subida incompleta" : statusLabel[p.status]}</StatusBadge>
                </div>
                <h3 className="line-clamp-2 font-semibold text-white">{p.title}</h3>
                {working && <Progress value={p.progress ?? 0} label={p.stage ?? "En cola"} />}
                {uploading && upload && <Progress value={upload.total ? (upload.loaded / upload.total) * 100 : 0} label="Subiendo" />}
                {p.status === "FAILED" && p.errorMessage && <p className="line-clamp-2 text-xs text-danger">{p.errorMessage}</p>}
                {p.status === "AWAITING_REVIEW" && <p className="text-xs text-warning">Revisa los cortes y elige el gancho.</p>}
                <p className="mt-auto text-xs text-placeholder">
                  {p.status === "DONE" && p.outputDuration ? `${formatDuration(p.outputDuration)} · ` : p.duration ? `Original de ${formatDuration(p.duration)} · ` : ""}
                  {formatRelative(p.updatedAt)}
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

