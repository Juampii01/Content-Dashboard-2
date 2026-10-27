"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, Check, Download, FileText, Languages, Loader2, RotateCcw, Scissors } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badges";
import { Notice } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import type { CloneVideoItem } from "@/lib/dal/clone";
import { formatDate, formatDuration, formatNumber, formatRelative } from "@/lib/format";
import { aspectLabel, cloneStatusLabel, cloneStatusTone, isInProgress } from "@/lib/heygen/labels";
import { languageLabel } from "@/lib/heygen/languages";
import { ENGINES, formatUsd, TRANSLATION_MODES, type EngineKey } from "@/lib/heygen/pricing";
import { cn } from "@/lib/utils";
import { retryCloneVideoAction } from "./actions";
import { useClonePolling } from "./use-clone-polling";

const stages = [
  { key: "SENT", label: "Enviado a HeyGen" },
  { key: "QUEUED", label: "En cola" },
  { key: "PROCESSING", label: "Generando" },
  { key: "COMPLETED", label: "Listo" },
] as const;

const translationStages = [
  { key: "SENT", label: "Subiendo el video" },
  { key: "QUEUED", label: "En cola" },
  { key: "PROCESSING", label: "Traduciendo" },
  { key: "COMPLETED", label: "Listo" },
] as const;

function StageTracker({ status, translation, sent }: { status: CloneVideoItem["status"]; translation: boolean; sent: boolean }) {
  const list = translation ? translationStages : stages;
  const current = translation && !sent ? 0 : status === "QUEUED" ? 1 : status === "PROCESSING" ? 2 : 3;
  return (
    <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Avance del video">
      {list.map((stage, i) => {
        const done = i < current || status === "COMPLETED";
        const active = i === current && status !== "COMPLETED";
        return (
          <li key={stage.key} className="flex items-center gap-2.5" aria-current={active ? "step" : undefined}>
            <span
              className={cn(
                "grid h-7 w-7 flex-none place-items-center rounded-full border-2 font-mono text-[11px] font-bold",
                done && "border-accent-hi bg-accent-hi text-bg",
                active && "animate-ping-soft border-accent-hi bg-accent text-paper motion-reduce:animate-none",
                !done && !active && "border-white/20 text-muted",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
            </span>
            <span className={cn("text-sm", active ? "font-semibold text-white" : done ? "text-text" : "text-muted")}>{stage.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-text">{children}</dd>
    </div>
  );
}

export function CloneVideoDetail({
  initial,
  scriptText,
  scriptTitle,
  storageReady,
  canEdit,
}: {
  initial: CloneVideoItem;
  scriptText: string;
  scriptTitle: string | null;
  storageReady: boolean;
  canEdit: boolean;
}) {
  const [item] = useClonePolling([initial]);
  const video = item!;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showText, setShowText] = useState(false);
  const engine = ENGINES[video.engine as EngineKey];
  const translation = video.kind === "translation";
  const sourceHref = video.source?.id ? (video.source.type === "editor" ? `/editor/${video.source.id}` : video.source.type === "clone" ? `/clon/${video.source.id}` : null) : null;
  const vertical = video.aspectRatio === "9:16";
  const fileUrl = (tipo: string, download = false) => `/api/clon/${video.id}/archivo?tipo=${tipo}${download ? "&descargar=1" : ""}`;

  const retry = () =>
    start(async () => {
      const res = await retryCloneVideoAction(video.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Enviado de nuevo a HeyGen.");
      if (res.data.id !== video.id) router.push(`/clon/${res.data.id}`);
      else router.refresh();
    });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <section className="card flex flex-col gap-5 p-5 sm:p-6" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StatusBadge tone={cloneStatusTone[video.status]} icon={isInProgress(video.status) ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : undefined}>
              {cloneStatusLabel[video.status]}
            </StatusBadge>
            <span className="text-xs text-muted" suppressHydrationWarning>
              {video.status === "COMPLETED" && video.completedAt ? `Listo ${formatRelative(video.completedAt)}` : `Enviado ${formatRelative(video.createdAt)}`}
            </span>
          </div>

          {isInProgress(video.status) && (
            <>
              <StageTracker status={video.status} translation={translation} sent={video.sentToHeyGen} />
              <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Generando el video" aria-valuetext={cloneStatusLabel[video.status]}>
                <div className="bar-shine h-full w-full rounded-full bg-accent/60" />
              </div>
              <p className="text-sm text-muted">
                {translation && !video.sentToHeyGen
                  ? "Estamos subiendo tu video a tu cuenta de HeyGen. Después HeyGen escucha tu voz, la clona y la pasa al otro idioma."
                  : "HeyGen no informa un porcentaje: te mostramos la etapa en la que está. Suele tardar unos minutos por cada minuto de video."}{" "}
                Puedes salir de esta pantalla: seguimos revisando, te avisamos cuando esté listo y el video queda en tu lista.
              </p>
            </>
          )}

          {video.status === "FAILED" && (
            <div className="flex flex-col gap-3">
              <Notice tone="danger" title="El video no se pudo generar">
                {video.errorMessage ?? "HeyGen no informó el motivo."}
              </Notice>
              {video.retriedInto ? (
                <ButtonLink href={`/clon/${video.retriedInto}`} variant="ghost" className="self-start">
                  Ver el reintento
                </ButtonLink>
              ) : (
                canEdit && (
                  <Button className="self-start" onClick={retry} disabled={pending} icon={<RotateCcw className="h-4 w-4" aria-hidden />}>
                    {pending ? "Reintentando…" : "Reintentar"}
                  </Button>
                )
              )}
            </div>
          )}

          {video.status === "COMPLETED" && video.hasVideo && (
            <>
              <div className={cn("mx-auto w-full overflow-hidden rounded-2xl border border-white/10 bg-black", vertical ? "max-w-[360px]" : "")}>
                <video
                  key={video.id}
                  controls
                  playsInline
                  preload="metadata"
                  poster={video.hasThumbnail ? fileUrl("miniatura") : undefined}
                  className={cn("block w-full", vertical ? "aspect-[9/16]" : video.aspectRatio === "1:1" ? "aspect-square" : "aspect-video")}
                >
                  <source src={fileUrl("video")} type="video/mp4" />
                  {video.hasSubtitles && <track kind="captions" src={fileUrl("srt")} srcLang={translation ? "und" : "es"} label={translation ? languageLabel(video.language) : "Español"} />}
                  Tu navegador no puede reproducir este video. Descárgalo para verlo.
                </video>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={fileUrl("video", true)} className="btn" download>
                  <Download className="h-4 w-4" aria-hidden />
                  Descargar MP4
                </a>
                {video.hasSubtitles && (
                  <a href={fileUrl("srt", true)} className="btn-ghost" download>
                    <FileText className="h-4 w-4" aria-hidden />
                    Descargar SRT
                  </a>
                )}
              </div>
              {!video.filesStored && (
                <Notice tone="info">
                  {storageReady
                    ? "Todavía estamos copiando el video a tu almacenamiento. Mientras tanto se ve desde HeyGen."
                    : "Este video está guardado solo en tu cuenta de HeyGen (esta instalación no tiene almacenamiento de archivos). Si lo borras allí, se pierde: descárgalo para tener una copia."}
                </Notice>
              )}
            </>
          )}
        </section>

        {video.status === "COMPLETED" && (
          <section className="section-shell">
            <h2 className="text-lg font-semibold">¿Qué sigue?</h2>
            <p className="mt-1 text-sm text-muted">Agrégale b-roll y subtítulos con estilo en el editor, déjalo programado o llévalo a otro idioma.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <ButtonLink href={`/editor/nuevo?clon=${video.id}`} icon={<Scissors className="h-4 w-4" aria-hidden />}>
                Usar en el editor
              </ButtonLink>
              <ButtonLink href={`/calendario?nuevo=1&clon=${video.id}`} variant="ghost" icon={<CalendarPlus className="h-4 w-4" aria-hidden />}>
                Programar en Calendario
              </ButtonLink>
              {canEdit && (
                <ButtonLink href={`/clon/traducir?video=${video.id}`} variant="ghost" icon={<Languages className="h-4 w-4" aria-hidden />}>
                  Traducir a otro idioma
                </ButtonLink>
              )}
            </div>
          </section>
        )}
      </div>

      <aside className="flex flex-col gap-6">
        <section className="card p-5">
          <h2 className="mb-2 font-semibold text-white">Detalles</h2>
          <dl className="divide-y divide-white/10">
            {translation ? (
              <>
                <Detail label="Idioma">{languageLabel(video.language)}</Detail>
                <Detail label="Calidad">{TRANSLATION_MODES[video.source?.mode ?? "speed"].label}</Detail>
                <Detail label="Labios">{TRANSLATION_MODES[video.source?.mode ?? "speed"].lipsync ? "Sincronizados" : "Sin tocar (solo audio)"}</Detail>
                <Detail label="Voz">La tuya, clonada del video</Detail>
                <Detail label="Formato">{aspectLabel[video.aspectRatio]?.label ?? video.aspectRatio}</Detail>
              </>
            ) : (
              <>
                <Detail label="Avatar">{video.avatarName ?? "—"}</Detail>
                <Detail label="Motor">{engine ? `${engine.label} (${engine.model})` : video.engine}</Detail>
                {video.language && <Detail label="Idioma">{languageLabel(video.language)}</Detail>}
                <Detail label="Formato">{aspectLabel[video.aspectRatio]?.label ?? video.aspectRatio}</Detail>
                <Detail label="Resolución">{video.resolution}</Detail>
                <Detail label="Velocidad de voz">{`${formatNumber(video.speed, { digits: 2 })}×`}</Detail>
                <Detail label="Subtítulos en el video">{video.captions ? "Sí" : "No (solo archivo SRT)"}</Detail>
              </>
            )}
            {video.source && (
              <Detail label="Video original">
                {sourceHref ? (
                  <Link href={sourceHref} className="text-accent-hi hover:underline">
                    {video.source.title}
                  </Link>
                ) : (
                  video.source.title
                )}
              </Detail>
            )}
            <Detail label={video.durationSeconds != null ? "Duración" : "Duración estimada"}>{formatDuration(video.durationSeconds ?? video.estimatedSeconds)}</Detail>
            <Detail label="Costo estimado">{formatUsd(video.estimatedCostUsd)}</Detail>
            <Detail label="Creado">{formatDate(video.createdAt)}</Detail>
          </dl>
          <p className="mt-3 text-xs text-placeholder">
            {translation ? "HeyGen cobra la traducción por la duración del video original." : "El costo real lo cobra HeyGen según los segundos generados."} Lo ves en tu panel de uso de HeyGen.
          </p>
        </section>

        {!translation && (
          <section className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-white">Texto hablado</h2>
              <Button variant="subtle" size="sm" onClick={() => setShowText((v) => !v)} aria-expanded={showText}>
                {showText ? "Ocultar" : "Ver texto"}
              </Button>
            </div>
            {video.scriptId && (
              <p className="mt-1 text-xs text-muted">
                Del guion{" "}
                <Link href={`/guiones/${video.scriptId}`} className="font-semibold text-accent-hi hover:underline">
                  {scriptTitle ?? "original"}
                </Link>
              </p>
            )}
            {showText && <p className="mt-3 text-sm leading-relaxed whitespace-pre-line text-text/90">{scriptText}</p>}
          </section>
        )}
      </aside>
    </div>
  );
}
