"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { ArrowUpRight, ExternalLink, Link2, Link2Off, Loader2, ScrollText, Search, Trash2, X } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { dayShort, isDay } from "@/lib/calendar/dates";
import {
  CALENDAR_STATUSES,
  calendarStatusColor,
  calendarStatusHint,
  calendarStatusLabel,
  defaultPlatformsFor,
  PLANNED_FORMATS,
  plannedFormatLabel,
  PLATFORMS,
  platformLabel,
  sourceLabel,
  type CalendarPlatform,
  type CalendarStatus,
  type PlannedFormat,
} from "@/lib/calendar/labels";
import { statusLabel as scriptStatusLabel, type ScriptStatus } from "@/lib/scripts/labels";
import { formatCompact, formatMultiplier } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  acceptSuggestionAction,
  deleteEntryAction,
  linkCandidatesAction,
  linkTargetAction,
  rejectSuggestionAction,
  saveEntryAction,
  searchScriptsAction,
  unlinkTargetAction,
} from "./actions";
import { PlatformIcon } from "./platform-icon";
import { sourceLinks, type CalendarEntry, type CalendarTarget, type CreateDefaults, type LinkedItem } from "./shared";

type Draft = {
  title: string;
  format: PlannedFormat;
  status: CalendarStatus;
  platforms: CalendarPlatform[];
  scheduledDate: string;
  scheduledTime: string;
  hook: string;
  pillar: string;
  notes: string;
  scriptId: string | null;
  scriptTitle: string | null;
};

function draftFrom(entry: CalendarEntry | null, defaults: CreateDefaults | null): Draft {
  if (entry) {
    return {
      title: entry.title,
      format: entry.format,
      status: entry.status,
      platforms: entry.targets.map((t) => t.platform),
      scheduledDate: entry.scheduledDate ?? "",
      scheduledTime: entry.scheduledTime ?? "",
      hook: entry.hook ?? "",
      pillar: entry.pillar ?? "",
      notes: entry.notes ?? "",
      scriptId: entry.scriptId,
      scriptTitle: entry.scriptTitle,
    };
  }
  const format = defaults?.format ?? "REEL";
  return {
    title: defaults?.title ?? "",
    format,
    status: defaults?.status ?? "IDEA",
    platforms: defaults?.platforms ?? defaultPlatformsFor[format],
    scheduledDate: defaults?.scheduledDate ?? "",
    scheduledTime: defaults?.scheduledTime ?? "",
    hook: defaults?.hook ?? "",
    pillar: defaults?.pillar ?? "",
    notes: "",
    scriptId: defaults?.scriptId ?? null,
    scriptTitle: defaults?.scriptTitle ?? null,
  };
}

/** Crear o editar una pieza del calendario. Con la pieza guardada, muestra su vínculo con la publicación real. */
export function EntryDialog({
  open,
  onOpenChange,
  entry,
  defaults,
  pillars,
  canEdit,
  onSaved,
  onOpenEntry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: CalendarEntry | null;
  defaults: CreateDefaults | null;
  pillars: string[];
  canEdit: boolean;
  onSaved?: (id: string, created: boolean, date: string | null) => void;
  onOpenEntry?: (id: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(entry, defaults));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const ids = useId();
  const editing = Boolean(entry);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const pillarOptions = draft.pillar && !pillars.includes(draft.pillar) ? [...pillars, draft.pillar] : pillars;
  const links = sourceLinks({
    scriptId: draft.scriptId,
    carouselId: entry?.carouselId ?? defaults?.carouselId ?? null,
    cloneVideoId: entry?.cloneVideoId ?? defaults?.cloneVideoId ?? null,
    videoProjectId: entry?.videoProjectId ?? defaults?.videoProjectId ?? null,
  });

  function togglePlatform(p: CalendarPlatform) {
    setDraft((d) => ({ ...d, platforms: d.platforms.includes(p) ? d.platforms.filter((x) => x !== p) : PLATFORMS.filter((x) => x === p || d.platforms.includes(x)) }));
  }

  function changeFormat(format: PlannedFormat) {
    // Si las redes eran las de por defecto del formato anterior, se cambian por las del nuevo.
    setDraft((d) => {
      const wasDefault = [...d.platforms].sort().join() === [...defaultPlatformsFor[d.format]].sort().join();
      return { ...d, format, platforms: wasDefault || d.platforms.length === 0 ? defaultPlatformsFor[format] : d.platforms };
    });
  }

  function save() {
    // Enter dos veces (o un doble clic) no crea la pieza dos veces.
    if (pending) return;
    setError(null);
    if (draft.title.trim().length < 2) return setError("Ponle un título a la pieza.");
    if (draft.platforms.length === 0) return setError("Elige al menos una red de destino.");
    if (draft.scheduledDate && !isDay(draft.scheduledDate)) return setError("La fecha no es válida.");
    startTransition(async () => {
      const res = await saveEntryAction({
        id: entry?.id,
        title: draft.title,
        notes: draft.notes,
        hook: draft.hook,
        pillar: draft.pillar,
        format: draft.format,
        status: draft.status,
        platforms: draft.platforms,
        scheduledDate: draft.scheduledDate || null,
        scheduledTime: draft.scheduledDate && draft.scheduledTime ? draft.scheduledTime : null,
        scriptId: draft.scriptId,
        carouselId: entry ? undefined : (defaults?.carouselId ?? null),
        cloneVideoId: entry ? undefined : (defaults?.cloneVideoId ?? null),
        videoProjectId: entry ? undefined : (defaults?.videoProjectId ?? null),
        source: entry ? undefined : (defaults?.source ?? "manual"),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(editing ? "Pieza guardada." : draft.scheduledDate ? `Programada para el ${dayShort(draft.scheduledDate)}.` : "Idea guardada en “Sin fecha”.");
      onSaved?.(res.data!.id, !editing, draft.scheduledDate || null);
      onOpenChange(false);
    });
  }

  function remove() {
    if (!entry) return;
    startTransition(async () => {
      const res = await deleteEntryAction(entry.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Pieza borrada del calendario.");
      onOpenChange(false);
    });
  }

  const readOnly = !canEdit;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      dismissOnBackdrop={false}
      className="max-w-2xl"
      title={editing ? (readOnly ? "Pieza del calendario" : "Editar pieza") : "Nueva pieza"}
      description={
        editing
          ? `${sourceLabel[entry!.source] ?? "Creada a mano"}${entry!.scheduledDate ? ` · ${dayShort(entry!.scheduledDate, true)}` : " · Sin fecha"}`
          : defaults?.sourceLabel
            ? `Precargada ${defaults.sourceLabel}. Revisa los datos y elige el día.`
            : "Anota la idea y elige cuándo sale. Puedes dejarla sin fecha y programarla después."
      }
      footer={
        confirmDelete ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text">¿Borrar esta pieza? El guion y las métricas no se tocan.</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={pending}>
                No, volver
              </Button>
              <Button onClick={remove} disabled={pending} className="!bg-none !bg-danger/90 !text-bg !shadow-none" icon={<Trash2 className="h-4 w-4" aria-hidden />}>
                Sí, borrar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            {editing && canEdit ? (
              <Button variant="subtle" onClick={() => setConfirmDelete(true)} className="!text-danger hover:!bg-danger/10" icon={<Trash2 className="h-4 w-4" aria-hidden />}>
                Borrar
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
                {readOnly ? "Cerrar" : "Cancelar"}
              </Button>
              {canEdit && (
                <Button onClick={save} disabled={pending} icon={pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : undefined}>
                  {editing ? "Guardar cambios" : "Agregar al calendario"}
                </Button>
              )}
            </div>
          </div>
        )
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (canEdit) save();
        }}
      >
        {defaults?.existing && !editing && (
          <Notice tone="warning" title="Esto ya está en tu calendario">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {defaults.existing.scheduledDate ? `Programado para el ${dayShort(defaults.existing.scheduledDate, true)}.` : "Está en “Sin fecha”."}
              {onOpenEntry && (
                <button type="button" className="font-semibold text-white underline underline-offset-2" onClick={() => onOpenEntry(defaults.existing!.id)}>
                  Abrir la pieza existente
                </button>
              )}
            </span>
          </Notice>
        )}

        <Field label="Título" htmlFor={`${ids}-title`}>
          <Input id={`${ids}-title`} value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="Ej.: 3 errores de la primera llamada" maxLength={160} autoFocus={!editing} disabled={readOnly} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Formato" htmlFor={`${ids}-format`}>
            <Select id={`${ids}-format`} value={draft.format} onChange={(e) => changeFormat(e.target.value as PlannedFormat)} disabled={readOnly}>
              {PLANNED_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {plannedFormatLabel[f]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Estado" htmlFor={`${ids}-status`} hint={calendarStatusHint[draft.status]}>
            <div className="relative">
              <span aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 h-2.5 w-2.5 -translate-y-1/2 rounded-full" style={{ background: calendarStatusColor[draft.status] }} />
              <Select id={`${ids}-status`} value={draft.status} onChange={(e) => set("status", e.target.value as CalendarStatus)} disabled={readOnly} className="!pl-9">
                {CALENDAR_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {calendarStatusLabel[s]}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2" disabled={readOnly}>
          <legend className="mb-1.5 text-sm font-semibold text-white">Redes de destino</legend>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <button key={p} type="button" aria-pressed={draft.platforms.includes(p)} onClick={() => togglePlatform(p)} className="chip !px-3.5 !py-2 !text-sm">
                <PlatformIcon platform={p} />
                {platformLabel[p]}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fecha" htmlFor={`${ids}-date`} hint={draft.scheduledDate ? undefined : "Sin fecha: queda en la lista para programar después."}>
            <div className="flex gap-2">
              <Input id={`${ids}-date`} type="date" value={draft.scheduledDate} onChange={(e) => set("scheduledDate", e.target.value)} disabled={readOnly} />
              {draft.scheduledDate && canEdit && (
                <Button variant="subtle" size="sm" onClick={() => setDraft((d) => ({ ...d, scheduledDate: "", scheduledTime: "" }))} aria-label="Quitar la fecha" className="flex-none">
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </div>
          </Field>
          <Field label="Hora (opcional)" htmlFor={`${ids}-time`} hint={draft.scheduledDate ? undefined : "Elige primero una fecha."}>
            <Input id={`${ids}-time`} type="time" value={draft.scheduledTime} onChange={(e) => set("scheduledTime", e.target.value)} disabled={readOnly || !draft.scheduledDate} step={300} />
          </Field>
        </div>

        <Field label="Gancho" htmlFor={`${ids}-hook`} hint="La primera frase: lo que se dice o se lee en los primeros 2 segundos.">
          <Textarea id={`${ids}-hook`} value={draft.hook} onChange={(e) => set("hook", e.target.value)} rows={2} className="!min-h-0" maxLength={600} disabled={readOnly} placeholder="Ej.: Si contestas el teléfono así, estás perdiendo pacientes." />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pilar" htmlFor={`${ids}-pillar`} hint={pillars.length === 0 ? "Define tus pilares en Mi marca para elegirlos aquí." : undefined}>
            <Select id={`${ids}-pillar`} value={draft.pillar} onChange={(e) => set("pillar", e.target.value)} disabled={readOnly}>
              <option value="">Sin pilar</option>
              {pillarOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
          <ScriptPicker
            scriptId={draft.scriptId}
            scriptTitle={draft.scriptTitle}
            disabled={readOnly}
            onChange={(s) =>
              setDraft((d) => ({
                ...d,
                scriptId: s?.id ?? null,
                scriptTitle: s?.title ?? null,
                title: d.title.trim() ? d.title : (s?.title ?? d.title),
                hook: d.hook.trim() ? d.hook : (s?.hook ?? d.hook),
                pillar: d.pillar ? d.pillar : (s?.pillar ?? ""),
              }))
            }
          />
        </div>

        <Field label="Notas" htmlFor={`${ids}-notes`}>
          <Textarea id={`${ids}-notes`} value={draft.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className="!min-h-0" maxLength={4000} disabled={readOnly} placeholder="Ideas de toma, referencias, lo que quieras recordar." />
        </Field>

        {links.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {links.map((l) => (
              <ButtonLink key={l.href} href={l.href} variant="ghost" size="sm" icon={<ArrowUpRight className="h-3.5 w-3.5" aria-hidden />}>
                {l.label}
              </ButtonLink>
            ))}
          </div>
        )}

        {entry && entry.targets.length > 0 && <PublishedSection entry={entry} canEdit={canEdit} />}

        {error && (
          <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// ─── Buscador de guiones ───────────────────────────────────────────────────

type ScriptHit = { id: string; title: string; status: string; format: string; hook: string | null; pillar: string | null };

function ScriptPicker({ scriptId, scriptTitle, disabled, onChange }: { scriptId: string | null; scriptTitle: string | null; disabled: boolean; onChange: (s: ScriptHit | null) => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ScriptHit[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function search(q: string) {
    setQuery(q);
    setOpen(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const n = ++seq.current;
      setLoading(true);
      const res = await searchScriptsAction(q);
      if (n !== seq.current) return;
      setLoading(false);
      setResults(res.ok ? (res.data ?? []) : []);
      setActive(0);
    }, 250);
  }

  function choose(hit: ScriptHit) {
    onChange(hit);
    setOpen(false);
    setQuery("");
  }

  if (scriptId) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-white">Guion vinculado</span>
        <div className="flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2">
          <ScrollText className="h-4 w-4 flex-none text-accent-hi" aria-hidden />
          <Link href={`/guiones/${scriptId}`} className="min-w-0 flex-1 truncate text-sm font-medium text-white hover:underline">
            {scriptTitle ?? "Guion"}
          </Link>
          {!disabled && (
            <button type="button" onClick={() => onChange(null)} aria-label="Quitar el guion vinculado" className="grid h-7 w-7 flex-none place-items-center rounded-md text-muted hover:bg-white/10 hover:text-white">
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={`${id}-q`} className="text-sm font-semibold text-white">
        Guion vinculado
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-placeholder" aria-hidden />
        <Input
          id={`${id}-q`}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && results?.[active] ? `${id}-opt-${active}` : undefined}
          value={query}
          disabled={disabled}
          placeholder="Buscar un guion…"
          className="!pl-10"
          onFocus={() => search(query)}
          onChange={(e) => search(e.target.value)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!open || !results?.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(results[active]!);
            } else if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
      </div>
      {open && (
        <ul id={`${id}-list`} role="listbox" className="popover absolute top-full right-0 left-0 z-30 mt-1 max-h-64 overflow-y-auto p-1.5">
          {loading && !results ? (
            <li className="px-3 py-2 text-sm text-muted">Buscando…</li>
          ) : results && results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">{query ? "No hay guiones con ese texto." : "Todavía no tienes guiones."}</li>
          ) : (
            results?.map((r, i) => (
              <li
                key={r.id}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(r)}
                onMouseEnter={() => setActive(i)}
                className={cn("cursor-pointer rounded-lg px-3 py-2", i === active && "bg-white/[0.07]")}
              >
                <span className="block truncate text-sm font-medium text-white">{r.title}</span>
                <span className="text-xs text-muted">{scriptStatusLabel[r.status as ScriptStatus] ?? r.status}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

// ─── Publicación real ──────────────────────────────────────────────────────

function Thumb({ src, className }: { src: string | null; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={cn("relative block flex-none overflow-hidden rounded-lg bg-white/[0.06] bg-[radial-gradient(circle_at_30%_20%,rgba(36,87,245,0.12),transparent_60%)]", className)}>
      {src && !broken && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => setBroken(true)} />
      )}
    </span>
  );
}

function ItemSummary({ item, platform }: { item: LinkedItem; platform: CalendarPlatform }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <Thumb src={item.thumbnail} className="h-16 w-12" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="line-clamp-2 text-sm font-medium text-white">{item.text}</span>
        <span className="text-xs text-muted">
          {platformLabel[platform]} · {item.day ? `publicada el ${dayShort(item.day, true)}` : "publicada"}
        </span>
      </span>
    </span>
  );
}

function PublishedSection({ entry, canEdit }: { entry: CalendarEntry; canEdit: boolean }) {
  return (
    <section aria-labelledby={`pub-${entry.id}`} className="flex flex-col gap-3 border-t border-white/10 pt-5">
      <div>
        <h3 id={`pub-${entry.id}`} className="text-sm font-semibold text-white">
          Publicación real
        </h3>
        <p className="mt-0.5 text-xs text-muted">Cuando la publiques, la unimos sola con su métrica. También puedes elegirla a mano.</p>
      </div>
      <ul className="flex flex-col gap-2">
        {entry.targets.map((t) => (
          <li key={t.id}>
            <TargetLink target={t} canEdit={canEdit} scheduled={entry.scheduledDate} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TargetLink({ target, canEdit, scheduled }: { target: CalendarTarget; canEdit: boolean; scheduled: string | null }) {
  const [pending, startTransition] = useTransition();
  const [picking, setPicking] = useState(false);
  const [candidates, setCandidates] = useState<Awaited<ReturnType<typeof linkCandidatesAction>> | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "Algo salió mal.");
      else {
        toast.success(done);
        setPicking(false);
      }
    });

  function openPicker() {
    setPicking(true);
    startTransition(async () => setCandidates(await linkCandidatesAction(target.id)));
  }

  if (target.linkStatus === "LINKED" && target.item) {
    const item = target.item;
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-success/30 bg-success/[0.06] p-3 sm:flex-row sm:items-center">
        <ItemSummary item={item} platform={target.platform} />
        <div className="flex flex-none items-center gap-4 sm:pl-2">
          <div className="text-right">
            <p className="text-lg leading-none font-bold text-white tabular-nums">{formatCompact(item.views)}</p>
            <p className="mt-1 text-[11px] text-muted">visualizaciones</p>
          </div>
          {item.perfScore != null && (
            <div className="text-right">
              <p className={cn("text-lg leading-none font-bold tabular-nums", item.perfScore >= 1 ? "text-success" : "text-warning")}>{formatMultiplier(item.perfScore)}</p>
              <p className="mt-1 text-[11px] text-muted">tu mediana</p>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <ButtonLink href={`/metricas/${item.id}`} variant="ghost" size="sm" icon={<ExternalLink className="h-3.5 w-3.5" aria-hidden />}>
              Métricas
            </ButtonLink>
            {canEdit && (
              <Button variant="subtle" size="sm" disabled={pending} onClick={() => run(() => unlinkTargetAction(target.id), "Desvinculada.")} icon={<Link2Off className="h-3.5 w-3.5" aria-hidden />}>
                Desvincular
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (target.linkStatus === "SUGGESTED" && target.item) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-warning/35 bg-warning/[0.07] p-3">
        <p className="text-sm font-semibold text-warning">¿Es esta tu publicación en {platformLabel[target.platform]}?</p>
        <ItemSummary item={target.item} platform={target.platform} />
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending} onClick={() => run(() => acceptSuggestionAction(target.id), "Listo: quedó vinculada con su métrica.")}>
              Sí, es esta
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => rejectSuggestionAction(target.id), "Descartada. No te la volvemos a sugerir.")}>
              No es esta
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm text-muted">
          <PlatformIcon platform={target.platform} />
          <span>
            <span className="font-semibold text-white">{platformLabel[target.platform]}</span> · {scheduled ? "todavía sin vincular" : "sin fecha"}
          </span>
        </span>
        {canEdit && !picking && (
          <Button variant="ghost" size="sm" onClick={openPicker} icon={<Link2 className="h-3.5 w-3.5" aria-hidden />}>
            Vincular a mano
          </Button>
        )}
      </div>
      {picking && (
        <div className="mt-3">
          {!candidates || pending ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Buscando tus publicaciones…
            </p>
          ) : !candidates.ok ? (
            <p className="text-sm text-danger">{candidates.error}</p>
          ) : candidates.data!.length === 0 ? (
            <p className="text-sm text-muted">No encontramos publicaciones de {platformLabel[target.platform]} cerca de esa fecha. Cuando sincronicemos la nueva, aparece aquí.</p>
          ) : (
            <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1" aria-label={`Publicaciones de ${platformLabel[target.platform]}`}>
              {candidates.data!.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => run(() => linkTargetAction(target.id, c.id), "Listo: quedó vinculada con su métrica.")}
                    className="flex w-full items-center gap-3 rounded-lg border border-white/10 p-2 text-left transition hover:border-accent-hi/50 hover:bg-white/[0.04]"
                  >
                    <Thumb src={c.thumbnail} className="h-12 w-9" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-sm font-medium text-white">{c.text}</span>
                      <span className="text-xs text-muted">
                        {dayShort(c.day, true)} · {formatCompact(c.views)} visualizaciones
                      </span>
                    </span>
                    <span className="text-xs font-semibold text-accent-glow">Elegir</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button variant="subtle" size="sm" className="mt-2" onClick={() => setPicking(false)}>
            Cancelar
          </Button>
        </div>
      )}
    </div>
  );
}
