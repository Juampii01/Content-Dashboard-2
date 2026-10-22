"use client";

import Link from "next/link";
import { Clapperboard, Loader2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/badges";
import type { CloneVideoItem } from "@/lib/dal/clone";
import { formatDuration, formatRelative } from "@/lib/format";
import { aspectLabel, cloneStatusLabel, cloneStatusTone, isInProgress } from "@/lib/heygen/labels";
import { languageLabel } from "@/lib/heygen/languages";
import { ENGINES, formatUsd, TRANSLATION_MODES, type EngineKey } from "@/lib/heygen/pricing";
import { useClonePolling } from "./use-clone-polling";

/** Miniatura del video, o un marcador mientras se genera. Los archivos se piden a nuestra ruta protegida. */
export function CloneThumb({ item, className = "" }: { item: CloneVideoItem; className?: string }) {
  return (
    <div className={`relative grid aspect-video place-items-center overflow-hidden bg-black/40 ${className}`}>
      {item.hasThumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/clon/${item.id}/archivo?tipo=miniatura`}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : isInProgress(item.status) ? (
        <div className="flex flex-col items-center gap-2 text-xs text-muted">
          <Loader2 className="h-5 w-5 animate-spin text-accent-hi motion-reduce:animate-none" aria-hidden />
          {item.kind === "translation"
            ? !item.sentToHeyGen
              ? "Subiendo tu video a HeyGen"
              : "HeyGen está traduciendo tu video"
            : item.status === "QUEUED"
              ? "Esperando turno en HeyGen"
              : "HeyGen está grabando a tu clon"}
        </div>
      ) : (
        <Clapperboard className="h-6 w-6 text-placeholder" aria-hidden />
      )}
    </div>
  );
}

export function CloneVideoList({ initial }: { initial: CloneVideoItem[] }) {
  const items = useClonePolling(initial);
  return (
    <ul className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-live="polite">
      {items.map((item) => {
        const engine = ENGINES[item.engine as EngineKey];
        const seconds = item.durationSeconds ?? item.estimatedSeconds;
        return (
          <li key={item.id}>
            <Link href={`/clon/${item.id}`} className="card card-lift flex h-full flex-col overflow-hidden">
              <div className="relative">
                <CloneThumb item={item} />
                <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                  <StatusBadge
                    tone={cloneStatusTone[item.status]}
                    icon={isInProgress(item.status) ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : undefined}
                    className="backdrop-blur"
                  >
                    {cloneStatusLabel[item.status]}
                  </StatusBadge>
                  {item.language && (
                    <span className="pill !bg-black/60 !text-[11px] backdrop-blur">
                      {item.kind === "translation" ? "Traducción · " : ""}
                      {languageLabel(item.language)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <h3 className="line-clamp-2 font-semibold text-white">{item.title}</h3>
                <p className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted">
                  <span>
                    {item.kind === "translation"
                      ? `Traducción ${TRANSLATION_MODES[item.source?.mode ?? "speed"].label.toLowerCase()}`
                      : engine
                        ? `${engine.label} (${engine.model})`
                        : item.engine}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{aspectLabel[item.aspectRatio]?.label ?? item.aspectRatio}</span>
                  {seconds != null && (
                    <>
                      <span aria-hidden>·</span>
                      <span>
                        {item.durationSeconds != null ? "" : "≈ "}
                        {formatDuration(seconds)}
                      </span>
                    </>
                  )}
                </p>
                {item.status === "FAILED" && item.errorMessage && <p className="line-clamp-2 text-xs text-danger">{item.errorMessage}</p>}
                <div className="mt-auto flex items-center justify-between gap-3 pt-1 text-xs text-placeholder">
                  <span suppressHydrationWarning>{formatRelative(item.createdAt)}</span>
                  {item.estimatedCostUsd != null && (
                    <span className="font-mono text-muted" title="Costo estimado antes de generar">
                      ≈ {formatUsd(item.estimatedCostUsd)}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
