"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ImageOff, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { platformMeta, type PlatformKey } from "./platform";

export type MediaAspect = "9:16" | "1:1" | "16:9" | "4:5";

const aspectClass: Record<MediaAspect, string> = {
  "9:16": "aspect-[9/16]",
  "1:1": "aspect-square",
  "16:9": "aspect-video",
  "4:5": "aspect-[4/5]",
};

/**
 * Miniatura de una pieza para la vista de cuadrícula: imagen con su proporción real, red,
 * métrica principal sobre la imagen, duración y un hueco para la insignia de pieza destacada (×3.2).
 * Si la imagen no carga (las URLs de las redes vencen), muestra un reemplazo en lugar del ícono roto.
 */
export function MediaThumbCard({
  src,
  title,
  aspect = "9:16",
  platform,
  metric,
  duration,
  badge,
  meta,
  href,
  onClick,
  className,
}: {
  src?: string | null;
  /** Caption o título de la pieza (se recorta a dos líneas). */
  title: string;
  aspect?: MediaAspect;
  platform?: PlatformKey;
  /** Métrica que se ve sobre la imagen (ej. { value: "12.4 mil", label: "visualizaciones" }). */
  metric?: { value: string; label: string; icon?: ReactNode };
  /** Duración en segundos (videos). */
  duration?: number | null;
  /** Hueco arriba a la derecha (ej. <OutlierBadge ratio={3.2} />). */
  badge?: ReactNode;
  /** Línea bajo el título (ej. fecha de publicación). */
  meta?: ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const showImage = src && !broken;
  const interactive = Boolean(href || onClick);

  const media = (
    <span className={cn("@container relative block overflow-hidden rounded-xl bg-[#0a1a45]", aspectClass[aspect])}>
      {showImage ? (
        // Miniaturas de dominios de terceros que cambian y vencen: next/image necesitaría declarar cada dominio.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          // Si la imagen falló antes de hidratar, onError ya no llega: se revisa al montar.
          ref={(img) => {
            if (img?.complete && img.naturalWidth === 0) setBroken(true);
          }}
          className={cn("h-full w-full object-cover transition duration-300", interactive && "group-hover:scale-[1.03]")}
        />
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_30%_20%,rgba(0,112,248,0.25),transparent_60%)] text-placeholder">
          <ImageOff aria-hidden className="h-6 w-6" />
          <span className="text-[11px] font-medium">Sin miniatura</span>
        </span>
      )}

      {/* Velo inferior para que la métrica se lea sobre cualquier imagen. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/80 to-transparent" />

      {platform && (
        <span className="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/55 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur">
          <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", platformMeta[platform].dot)} />
          {/* Con insignia a la derecha, en tarjetas angostas solo queda el punto para que no se pisen. */}
          <span className={cn(badge && "sr-only @[11rem]:not-sr-only")}>{platformMeta[platform].label}</span>
        </span>
      )}
      {badge && <span className="absolute top-2 right-2">{badge}</span>}

      <span className="absolute inset-x-2.5 bottom-2 flex items-end justify-between gap-2 text-white">
        {metric ? (
          <span className="flex items-center gap-1 text-sm leading-none font-semibold tabular-nums drop-shadow">
            {metric.icon ?? <Play aria-hidden className="h-3.5 w-3.5 fill-current" />}
            {metric.value}
            <span className="sr-only"> {metric.label}</span>
          </span>
        ) : (
          <span />
        )}
        {duration != null && (
          <span className="rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums">
            <span className="sr-only">Duración </span>
            {formatDuration(duration)}
          </span>
        )}
      </span>
    </span>
  );

  const body = (
    <>
      {media}
      <span className="block px-1 pt-2.5">
        <span className="line-clamp-2 text-sm leading-snug font-medium text-text">{title}</span>
        {meta && <span className="mt-1 block text-xs text-placeholder">{meta}</span>}
      </span>
    </>
  );

  const shell = cn(
    "group block rounded-2xl p-1.5 text-left transition",
    interactive && "hover:bg-white/[0.04] focus-visible:bg-white/[0.04]",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={shell}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(shell, "flex w-full flex-col justify-start")}>
        {body}
      </button>
    );
  }
  return <div className={shell}>{body}</div>;
}
