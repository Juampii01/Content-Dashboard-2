"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, CalendarPlus, Check, Copy, ExternalLink, FileText, GalleryHorizontalEnd, Loader2, MessageSquareText, RefreshCw, Save, TriangleAlert } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { Input, Textarea } from "@/components/ui/field";
import { PlatformBadge, type PlatformKey } from "@/components/ui/platform";
import { toast } from "@/components/ui/toast";
import type { PackView, ScheduledInfo } from "@/lib/dal/repurpose";
import type { RepurposeCopy } from "@/lib/db/schema";
import { formatDate, formatDuration, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { retryPartAction, saveCopyAction, schedulePackAction } from "./actions";

type PartKey = keyof PackView["parts"];
type PieceKind = "guion" | "carrusel" | "editor";

const scriptFormat: Record<string, string> = { REEL: "Reel o TikTok", SHORT: "YouTube Short", YT_LONG: "YouTube largo", STORY: "Historias" };

/**
 * Resultado de "Sacarle todo el jugo": carrusel, textos por red y guiones de shorts, cada uno con su acción.
 * Mientras alguna parte se genera, la pantalla se actualiza sola; la persona puede salir y volver.
 */
export function PackScreen({ pack, canEdit }: { pack: PackView; canEdit: boolean }) {
  const router = useRouter();
  const [scheduling, startScheduling] = useTransition();

  useEffect(() => {
    if (!pack.generating) return;
    const timer = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(timer);
  }, [pack.generating, router]);

  const parts = Object.values(pack.parts);
  const done = parts.filter((p) => p.status !== "pending" || p.stale).length;
  const unscheduled =
    (pack.origin && !pack.scheduled[`${pack.origin.kind}:${pack.origin.id}`] ? 1 : 0) +
    (pack.carousel && !pack.scheduled[`carrusel:${pack.carousel.id}`] ? 1 : 0) +
    pack.shorts.filter((s) => !pack.scheduled[`guion:${s.id}`]).length;

  function scheduleAll() {
    startScheduling(async () => {
      const res = await schedulePackAction(pack.id);
      if (!res.ok) return void toast.error(res.error);
      const dates = res.data!.created.map((c) => c.date);
      if (!dates.length) return void toast.info("Todo ya estaba en tu calendario.");
      toast.success(dates.length === 1 ? "Listo: 1 pieza en tu calendario." : `Listo: ${dates.length} piezas en tu calendario.`, {
        description: `En tus próximos días libres: ${dates.map((d) => formatDate(d, { withYear: false })).join(", ")}.`,
      });
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <p className="eyebrow mb-1">{pack.sourceKind === "video" ? "Desde tu video" : pack.sourceKind === "guion" ? "Desde tu guion" : "Desde tu pieza publicada"}</p>
          <h2 className="truncate text-lg font-semibold text-white sm:text-xl">{pack.title}</h2>
          <p className="mt-1 text-sm text-muted" role="status" aria-live="polite">
            {pack.generating ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-accent-hi" aria-hidden /> Generando: {done} de 3 partes listas. Puedes salir y volver, sigue solo.
              </span>
            ) : (
              `Creado el ${formatDate(pack.createdAt)} · ${formatNumber(pack.pieces)} ${pack.pieces === 1 ? "pieza" : "piezas"} para programar`
            )}
          </p>
        </div>
        <div className="flex flex-none flex-wrap gap-2">
          {pack.sourceHref && (
            <ButtonLink href={pack.sourceHref} variant="ghost" icon={<ExternalLink className="h-4 w-4" aria-hidden />}>
              Ver el original
            </ButtonLink>
          )}
          {canEdit && (
            <Button onClick={scheduleAll} disabled={scheduling || pack.generating || unscheduled === 0} icon={scheduling ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarPlus className="h-4 w-4" aria-hidden />}>
              {unscheduled === 0 && !pack.generating ? "Todo está en el calendario" : "Agregar todo al calendario"}
            </Button>
          )}
        </div>
      </div>

      {pack.origin && (
        <OriginRow pack={pack} canEdit={canEdit} />
      )}

      <PartSection
        icon={<GalleryHorizontalEnd className="h-5 w-5" aria-hidden />}
        title="Carrusel para Instagram"
        description="El borrador ya está en Carruseles con la ficha de textos lista. Las imágenes las generas allí, con el flujo de siempre."
        part="carousel"
        pack={pack}
        canEdit={canEdit}
        loading="Escribiendo la ficha del carrusel…"
      >
        {pack.carousel ? (
          <div className="flex flex-col gap-4">
            <ol className="grid gap-2 sm:grid-cols-2">
              {pack.carousel.slides.map((s, i) => (
                <li key={s.id} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <span className="font-mono text-xs font-semibold text-accent-glow">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0">
                    {s.kicker && <span className="block text-[11px] font-semibold tracking-wide text-muted uppercase">{s.kicker}</span>}
                    <span className="block text-sm font-semibold text-white">{s.headline}</span>
                    {s.body && <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{s.body}</span>}
                    {s.cta && <span className="mt-1 block text-xs font-semibold text-accent-hi">{s.cta}</span>}
                  </span>
                </li>
              ))}
            </ol>
            <PieceActions
              pack={pack}
              kind="carrusel"
              id={pack.carousel.id}
              canEdit={canEdit}
              open={{ href: `/carruseles/${pack.carousel.id}`, label: "Abrir carrusel" }}
              extra={pack.carousel.caption ? <CopyButton text={[pack.carousel.caption, pack.carousel.hashtags.join(" ")].filter(Boolean).join("\n\n")} label="Copiar caption" /> : null}
            />
          </div>
        ) : pack.parts.carousel.status === "ready" ? (
          <p className="text-sm text-muted">El carrusel se archivó o se borró en Carruseles.</p>
        ) : null}
      </PartSection>

      <PartSection
        icon={<MessageSquareText className="h-5 w-5" aria-hidden />}
        title="Textos para publicar"
        description="El caption de Instagram y TikTok, y el título y la descripción para YouTube. Edítalos aquí y cópialos al publicar."
        part="copy"
        pack={pack}
        canEdit={canEdit}
        loading="Escribiendo los textos de cada red…"
      >
        {pack.copy && <CopyEditor packId={pack.id} initial={pack.copy} canEdit={canEdit} />}
      </PartSection>

      <PartSection
        icon={<FileText className="h-5 w-5" aria-hidden />}
        title="Guiones de shorts"
        description="Cada uno toma una idea del original y la vuelve una pieza que se entiende sola. Quedaron en Guiones, con sus ganchos."
        part="shorts"
        pack={pack}
        canEdit={canEdit}
        loading="Escribiendo los guiones de shorts…"
      >
        {pack.shorts.length ? (
          <ul className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {pack.shorts.map((s) => (
              <li key={s.id} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="pill">{scriptFormat[s.format] ?? s.format}</span>
                  {s.estimatedSeconds ? <span className="font-mono text-xs text-muted">≈ {formatDuration(s.estimatedSeconds)}</span> : null}
                </div>
                <h3 className="font-semibold text-white">{s.title}</h3>
                {s.angle && <p className="text-xs leading-relaxed text-muted">{s.angle}</p>}
                {s.hooks.length > 0 && (
                  <div>
                    <p className="eyebrow mb-1.5">Ganchos</p>
                    <ol className="flex flex-col gap-1.5">
                      {s.hooks.map((h, i) => (
                        <li key={i} className={cn("rounded-lg px-2.5 py-1.5 text-sm", i === 0 ? "border border-accent/40 bg-accent/10 text-white" : "text-text/85")}>
                          “{h.text}”
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                <div className="mt-auto">
                  <PieceActions pack={pack} kind="guion" id={s.id} canEdit={canEdit} open={{ href: `/guiones/${s.id}`, label: "Abrir guion" }} compact />
                </div>
              </li>
            ))}
          </ul>
        ) : pack.parts.shorts.status === "ready" ? (
          <p className="text-sm text-muted">Los guiones se archivaron en Guiones.</p>
        ) : null}
      </PartSection>
    </div>
  );
}

function OriginRow({ pack, canEdit }: { pack: PackView; canEdit: boolean }) {
  const origin = pack.origin!;
  return (
    <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs text-muted">{origin.kind === "editor" ? "Tu video editado" : "Tu guion original"}</p>
        <p className="truncate font-semibold text-white">{origin.title}</p>
      </div>
      <PieceActions pack={pack} kind={origin.kind} id={origin.id} canEdit={canEdit} open={{ href: origin.kind === "editor" ? `/editor/${origin.id}` : `/guiones/${origin.id}`, label: origin.kind === "editor" ? "Abrir video" : "Abrir guion" }} compact />
    </div>
  );
}

function PartSection({
  icon,
  title,
  description,
  part,
  pack,
  canEdit,
  loading,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  part: PartKey;
  pack: PackView;
  canEdit: boolean;
  loading: string;
  children: ReactNode;
}) {
  const state = pack.parts[part];
  const [retrying, startRetry] = useTransition();
  const failed = state.status === "failed" || state.stale;
  return (
    <section className="section-shell" aria-labelledby={`part-${part}`} aria-busy={state.status === "pending" && !state.stale}>
      <header className="mb-5 flex items-start gap-3">
        <span className="tile-icon h-10 w-10 flex-none">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 id={`part-${part}`} className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            {title}
            {state.status === "ready" && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                <Check className="h-3.5 w-3.5" aria-hidden /> Listo
              </span>
            )}
          </h2>
          <p className="mt-1 text-sm text-muted">{description}</p>
        </div>
      </header>
      {failed ? (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-text/90">
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-none text-danger" aria-hidden />
            {state.stale ? "La generación se interrumpió. Vuelve a intentarlo." : (state.error ?? "Algo falló. Vuelve a intentarlo.")}
          </p>
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              disabled={retrying}
              icon={<RefreshCw className={cn("h-4 w-4", retrying && "animate-spin")} aria-hidden />}
              onClick={() =>
                startRetry(async () => {
                  const res = await retryPartAction(pack.id, part);
                  if (!res.ok) toast.error(res.error);
                })
              }
            >
              Reintentar
            </Button>
          )}
        </div>
      ) : state.status === "pending" ? (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin text-accent-hi" aria-hidden /> {loading}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function ScheduledLabel({ info }: { info: ScheduledInfo }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-xl border border-success/35 bg-success/10 px-3 py-1.5 text-xs font-semibold text-success">
      <CalendarCheck className="h-3.5 w-3.5" aria-hidden />
      {info.date ? `En el calendario · ${formatDate(info.date, { withYear: false })}` : "En el calendario · sin fecha"}
    </span>
  );
}

function PieceActions({
  pack,
  kind,
  id,
  canEdit,
  open,
  extra,
  compact,
}: {
  pack: PackView;
  kind: PieceKind;
  id: string;
  canEdit: boolean;
  open: { href: string; label: string };
  extra?: ReactNode;
  compact?: boolean;
}) {
  const [pending, start] = useTransition();
  const info = pack.scheduled[`${kind}:${id}`];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ButtonLink href={open.href} variant="ghost" size={compact ? "sm" : "md"} icon={<ExternalLink className="h-4 w-4" aria-hidden />}>
        {open.label}
      </ButtonLink>
      {extra}
      {info ? (
        <a href={info.date ? `/calendario?fecha=${info.date}` : "/calendario"} className="rounded-xl focus-visible:outline-2">
          <ScheduledLabel info={info} />
        </a>
      ) : canEdit ? (
        <Button
          variant="subtle"
          size={compact ? "sm" : "md"}
          disabled={pending || pack.generating}
          icon={pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarPlus className="h-4 w-4" aria-hidden />}
          onClick={() =>
            start(async () => {
              const res = await schedulePackAction(pack.id, { kind, id });
              if (!res.ok) return void toast.error(res.error);
              const date = res.data!.created[0]?.date;
              toast.success(date ? `Agregado al calendario el ${formatDate(date, { withYear: false })}.` : "Ya estaba en tu calendario.");
            })
          }
        >
          Agregar al calendario
        </Button>
      ) : null}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={copied ? <Check className="h-4 w-4 text-success" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          toast.error("Tu navegador no dejó copiar. Selecciona el texto y cópialo a mano.");
        }
      }}
    >
      {copied ? "Copiado" : label}
    </Button>
  );
}

const tagsToText = (tags: string[]) => tags.join(" ");
const textToTags = (text: string) => text.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`));

function CopyEditor({ packId, initial, canEdit }: { packId: string; initial: RepurposeCopy; canEdit: boolean }) {
  const [copy, setCopy] = useState(initial);
  const [tags, setTags] = useState({ instagram: tagsToText(initial.instagram.hashtags), tiktok: tagsToText(initial.tiktok.hashtags), youtube: tagsToText(initial.youtube.hashtags) });
  const [dirty, setDirty] = useState(false);
  const [saving, startSaving] = useTransition();

  const edit = (fn: (c: RepurposeCopy) => RepurposeCopy) => {
    setCopy((c) => fn(structuredClone(c)));
    setDirty(true);
  };
  const editTags = (net: keyof typeof tags, value: string) => {
    setTags((t) => ({ ...t, [net]: value }));
    setDirty(true);
  };
  const current: RepurposeCopy = {
    instagram: { ...copy.instagram, hashtags: textToTags(tags.instagram) },
    tiktok: { ...copy.tiktok, hashtags: textToTags(tags.tiktok) },
    youtube: { ...copy.youtube, hashtags: textToTags(tags.youtube) },
  };

  function save() {
    startSaving(async () => {
      const res = await saveCopyAction(packId, current);
      if (!res.ok) return void toast.error(res.error);
      setDirty(false);
      toast.success("Textos guardados.");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <NetCard platform="INSTAGRAM" copyText={[current.instagram.caption, tagsToText(current.instagram.hashtags)].filter(Boolean).join("\n\n")}>
          <LabeledArea id={`${packId}-ig`} label="Caption" value={copy.instagram.caption} max={2200} rows={9} disabled={!canEdit} onChange={(v) => edit((c) => ((c.instagram.caption = v), c))} />
          <TagsInput id={`${packId}-ig-tags`} value={tags.instagram} disabled={!canEdit} onChange={(v) => editTags("instagram", v)} hint="De 3 a 5, específicos de tu tema." />
        </NetCard>
        <NetCard platform="TIKTOK" copyText={[current.tiktok.caption, tagsToText(current.tiktok.hashtags)].filter(Boolean).join(" ")}>
          <LabeledArea id={`${packId}-tt`} label="Caption" value={copy.tiktok.caption} max={300} rows={5} disabled={!canEdit} onChange={(v) => edit((c) => ((c.tiktok.caption = v), c))} soft />
          <TagsInput id={`${packId}-tt-tags`} value={tags.tiktok} disabled={!canEdit} onChange={(v) => editTags("tiktok", v)} hint="De 3 a 5." />
        </NetCard>
        <NetCard platform="YOUTUBE" copyText={[current.youtube.title, current.youtube.description, tagsToText(current.youtube.hashtags)].filter(Boolean).join("\n\n")}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${packId}-yt-title`} className="flex justify-between text-xs font-semibold text-white">
              Título <Counter value={copy.youtube.title.length} max={70} soft />
            </label>
            <Input id={`${packId}-yt-title`} value={copy.youtube.title} maxLength={100} disabled={!canEdit} onChange={(e) => edit((c) => ((c.youtube.title = e.target.value), c))} />
          </div>
          <LabeledArea id={`${packId}-yt`} label="Descripción" value={copy.youtube.description} max={5000} rows={7} disabled={!canEdit} onChange={(v) => edit((c) => ((c.youtube.description = v), c))} />
          <TagsInput id={`${packId}-yt-tags`} value={tags.youtube} disabled={!canEdit} onChange={(v) => editTags("youtube", v)} hint="Hasta 3: YouTube muestra los primeros sobre el título." />
        </NetCard>
      </div>
      {canEdit && (
        <div className="flex items-center justify-end gap-3">
          {dirty && <span className="text-xs text-muted">Tienes cambios sin guardar.</span>}
          <Button onClick={save} disabled={!dirty || saving} icon={saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}>
            Guardar cambios
          </Button>
        </div>
      )}
    </div>
  );
}

function NetCard({ platform, copyText, children }: { platform: PlatformKey; copyText: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between gap-2">
        <PlatformBadge platform={platform} />
        <CopyButton text={copyText} label="Copiar" />
      </div>
      {children}
    </div>
  );
}

function Counter({ value, max, soft }: { value: number; max: number; soft?: boolean }) {
  const over = value > max;
  return (
    <span className={cn("font-mono font-normal", over ? (soft ? "text-warning" : "text-danger") : "text-muted")} aria-label={`${formatNumber(value)} de ${formatNumber(max)} caracteres`}>
      {formatNumber(value)}/{formatNumber(max)}
    </span>
  );
}

function LabeledArea({ id, label, value, max, rows, disabled, onChange, soft }: { id: string; label: string; value: string; max: number; rows: number; disabled: boolean; onChange: (v: string) => void; soft?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex justify-between text-xs font-semibold text-white">
        {label} <Counter value={value.length} max={max} soft={soft} />
      </label>
      <Textarea id={id} value={value} rows={rows} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="min-h-0 text-sm leading-relaxed" />
    </div>
  );
}

function TagsInput({ id, value, disabled, onChange, hint }: { id: string; value: string; disabled: boolean; onChange: (v: string) => void; hint: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-white">
        Hashtags
      </label>
      <Input id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs" aria-describedby={`${id}-hint`} />
      <p id={`${id}-hint`} className="text-xs text-muted">
        {hint}
      </p>
    </div>
  );
}
