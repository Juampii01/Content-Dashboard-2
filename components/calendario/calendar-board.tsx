"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, CircleHelp, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ChipGroup } from "@/components/ui/filters";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { compareInDay, dayLong, monthTitle, rangeTitle, shiftAnchor, type CalendarView } from "@/lib/calendar/dates";
import { CALENDAR_STATUSES, calendarStatusColor, calendarStatusLabel, PLATFORMS, platformLabel, type CalendarPlatform, type CalendarStatus } from "@/lib/calendar/labels";
import { cn } from "@/lib/utils";
import { moveEntryAction } from "./actions";
import { DragPreview } from "./entry-chip";
import { EntryDialog, TargetLink } from "./entry-dialog";
import { PlanDialog } from "./plan-dialog";
import { PlatformIcon } from "./platform-icon";
import { calendarUrl, parseDropId, type CalendarEntry, type CreateDefaults, type Filters } from "./shared";
import { Agenda, DayList, MonthGrid, UndatedPanel, WeekGrid } from "./views";

type DialogState = { kind: "edit"; id: string } | { kind: "create"; defaults: CreateDefaults; key: number } | null;

const pad = (n: number) => String(n).padStart(2, "0");

/** Con puntero: la zona bajo el cursor. Con teclado (sin puntero): la zona que más se superpone. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

/** Con teclado, las flechas saltan a la zona vecina (día o franja horaria) en esa dirección. */
const keyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  const dir = ({ ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] } as Record<string, [number, number]>)[event.code];
  const rect = context.collisionRect;
  if (!dir || !rect) return undefined;
  event.preventDefault();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let best: { left: number; top: number; width: number; height: number } | null = null;
  let bestScore = Infinity;
  for (const container of context.droppableContainers.getEnabled()) {
    const r = context.droppableRects.get(container.id);
    if (!r) continue;
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    const along = dx * dir[0] + dy * dir[1];
    if (along <= 2) continue;
    const across = Math.abs(dir[0] ? dy : dx);
    const score = along + across * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  if (!best) return undefined;
  return { x: best.left + Math.max(2, (best.width - rect.width) / 2), y: best.top + 4 };
};

export function CalendarBoard({
  view,
  anchor,
  today,
  days,
  entries,
  undated,
  suggestions,
  pillars,
  canEdit,
  canPlan,
  initialFilters,
  create,
  createError,
}: {
  view: CalendarView;
  anchor: string;
  today: string;
  days: string[];
  entries: CalendarEntry[];
  undated: CalendarEntry[];
  suggestions: CalendarEntry[];
  pillars: string[];
  canEdit: boolean;
  canPlan: boolean;
  initialFilters: Filters;
  create: CreateDefaults | null;
  createError: string | null;
}) {
  const router = useRouter();
  const [navPending, startNav] = useTransition();

  // Estado local para mover piezas al instante. Cuando llegan datos nuevos del servidor, se reemplaza.
  const [items, setItems] = useState<CalendarEntry[]>(() => [...entries, ...undated]);
  const [source, setSource] = useState({ entries, undated });
  if (source.entries !== entries || source.undated !== undated) {
    setSource({ entries, undated });
    setItems([...entries, ...undated]);
  }

  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [dialog, setDialog] = useState<DialogState>(() => (create && canEdit ? { kind: "create", defaults: create, key: 0 } : null));
  const [moreDay, setMoreDay] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const createKey = useRef(1);
  const dragging = useRef(false);

  // La URL de "nuevo" se limpia al abrir: recargar la página no vuelve a abrir el diálogo.
  useEffect(() => {
    if (create || createError) window.history.replaceState(null, "", calendarUrl(view, anchor, initialFilters));
    if (createError) toast.error(createError);
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const matches = (e: CalendarEntry) =>
    (filters.statuses.length === 0 || filters.statuses.includes(e.status)) && (filters.platforms.length === 0 || e.targets.some((t) => filters.platforms.includes(t.platform)));

  const visible = items.filter(matches);
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const e of visible) {
      if (!e.scheduledDate) continue;
      const list = map.get(e.scheduledDate) ?? [];
      list.push(e);
      map.set(e.scheduledDate, list);
    }
    for (const list of map.values()) list.sort(compareInDay);
    return map;
  }, [visible]);
  const undatedList = visible.filter((e) => !e.scheduledDate).sort((a, b) => a.position - b.position);
  const hiddenByFilters = items.length - visible.length;

  function navigate(nextView: CalendarView, nextAnchor: string) {
    startNav(() => router.push(calendarUrl(nextView, nextAnchor, filters), { scroll: false }));
  }

  function updateFilters(next: Filters) {
    setFilters(next);
    window.history.replaceState(null, "", calendarUrl(view, anchor, next));
  }

  function openCreate(date: string | null, time?: string | null) {
    if (!canEdit) return;
    setDialog({ kind: "create", defaults: { scheduledDate: date, scheduledTime: time ?? null }, key: createKey.current++ });
  }

  // Atajos de teclado. No actúan mientras se escribe, hay un diálogo abierto o se arrastra una pieza.
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keyHandler.current = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || dragging.current) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']") || document.querySelector("dialog[open]")) return;
      const onPage = !target || target === document.body;
      const key = e.key.toLowerCase();
      if (key === "t") navigate(view, today);
      else if (key === "j" || (onPage && e.key === "ArrowRight")) navigate(view, shiftAnchor(view, anchor, 1));
      else if (key === "k" || (onPage && e.key === "ArrowLeft")) navigate(view, shiftAnchor(view, anchor, -1));
      else if (key === "m") navigate("mes", anchor);
      else if (key === "s") navigate("semana", anchor);
      else if (key === "n" && canEdit) openCreate(null);
      else return;
      e.preventDefault();
    };
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // ─── Arrastrar ──────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] } }),
  );

  const titleOf = (id: string | number) => items.find((e) => e.id === id)?.title ?? "la pieza";
  const zoneLabel = (over: { data: { current?: Record<string, unknown> } } | null) => (over?.data.current?.label as string | undefined) ?? "esa zona";
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Tomaste “${titleOf(active.id)}”. Usa las flechas para elegir el día, Espacio para soltarla y Escape para cancelar.`,
    onDragOver: ({ active, over }) => (over ? `“${titleOf(active.id)}” está sobre ${zoneLabel(over)}.` : `“${titleOf(active.id)}” no está sobre ningún día.`),
    onDragEnd: ({ active, over }) => (over ? `Soltaste “${titleOf(active.id)}” en ${zoneLabel(over)}.` : `Soltaste “${titleOf(active.id)}” sin moverla.`),
    onDragCancel: ({ active }) => `Cancelado. “${titleOf(active.id)}” volvió a su lugar.`,
  };

  async function onDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    dragging.current = false;
    if (!over) return;
    const target = parseDropId(String(over.id));
    const entry = items.find((e) => e.id === active.id);
    if (!target || !entry) return;

    let time = entry.scheduledTime;
    if (target.date === null || target.hour === null) time = null;
    else if (target.hour !== undefined) time = entry.scheduledTime && Number(entry.scheduledTime.slice(0, 2)) === target.hour ? entry.scheduledTime : `${pad(target.hour)}:00`;
    if (target.date === entry.scheduledDate && time === entry.scheduledTime) return;

    const position =
      target.date === entry.scheduledDate ? entry.position : Math.max(-1, ...items.filter((e) => e.scheduledDate === target.date && e.id !== entry.id).map((e) => e.position)) + 1;
    const previous = { scheduledDate: entry.scheduledDate, scheduledTime: entry.scheduledTime, position: entry.position };
    const patch = (values: typeof previous) => setItems((list) => list.map((e) => (e.id === entry.id ? { ...e, ...values } : e)));

    patch({ scheduledDate: target.date, scheduledTime: time, position });
    // Si falla (error del servidor o sin conexión), la pieza vuelve a su lugar.
    const res = await moveEntryAction(entry.id, target.date, target.hour === undefined ? undefined : time).catch(() => ({
      ok: false as const,
      error: "No pudimos mover la pieza. Revisa tu conexión y prueba de nuevo.",
    }));
    if (!res.ok) {
      patch(previous);
      toast.error(res.error);
    }
  }

  const activeEntry = activeId ? items.find((e) => e.id === activeId) : null;
  const editing = dialog?.kind === "edit" ? (items.find((e) => e.id === dialog.id) ?? suggestions.find((e) => e.id === dialog.id) ?? null) : null;
  const title = view === "mes" ? monthTitle(anchor) : rangeTitle(days[0]!, days[6]!);
  const isCurrent = days.includes(today) && (view === "semana" || anchor.slice(0, 7) === today.slice(0, 7));
  const unit = view === "mes" ? "mes" : "semana";

  return (
    <div className="flex flex-col gap-4">
      {/* Barra principal */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="!px-2" onClick={() => navigate(view, shiftAnchor(view, anchor, -1))} aria-label={`${view === "mes" ? "Mes" : "Semana"} anterior`} title={`${view === "mes" ? "Mes" : "Semana"} anterior (K)`}>
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate(view, today)} disabled={isCurrent} title="Ir a hoy (T)">
              Hoy
            </Button>
            <Button variant="ghost" size="sm" className="!px-2" onClick={() => navigate(view, shiftAnchor(view, anchor, 1))} aria-label={`${view === "mes" ? "Mes" : "Semana"} siguiente`} title={`${view === "mes" ? "Mes" : "Semana"} siguiente (J)`}>
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          <h2 className={cn("text-lg font-semibold whitespace-nowrap transition-opacity sm:text-xl", navPending && "opacity-60")} aria-live="polite">
            {title}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <SegmentedControl
            label="Vista"
            value={view}
            onValueChange={(v) => navigate(v, anchor)}
            options={[
              { value: "mes", label: "Mes", icon: <CalendarDays className="h-3.5 w-3.5" /> },
              { value: "semana", label: "Semana", icon: <CalendarRange className="h-3.5 w-3.5" /> },
            ]}
          />
          {canEdit && (
            <>
              <Button variant="ghost" onClick={() => setPlanOpen(true)} icon={<Sparkles className="h-4 w-4 text-accent-hi" aria-hidden />}>
                Planear mi semana
              </Button>
              <Button onClick={() => openCreate(null)} icon={<Plus className="h-4 w-4" aria-hidden />} title="Nueva pieza (N)">
                Nueva pieza
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Filtros y leyenda */}
      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 xl:flex-row xl:items-center xl:gap-6">
        <ChipGroup
          label="Red"
          showLabel
          allLabel="Todas"
          value={filters.platforms}
          onChange={(platforms) => updateFilters({ ...filters, platforms: platforms as CalendarPlatform[] })}
          options={PLATFORMS.map((p) => ({ value: p, label: platformLabel[p], icon: <PlatformIcon platform={p} className="h-3 w-3" /> }))}
        />
        <ChipGroup
          label="Estado"
          showLabel
          allLabel="Todos"
          value={filters.statuses}
          onChange={(statuses) => updateFilters({ ...filters, statuses: statuses as CalendarStatus[] })}
          options={CALENDAR_STATUSES.map((s) => ({ value: s, label: calendarStatusLabel[s], icon: <span className="h-2.5 w-2.5 rounded-full" style={{ background: calendarStatusColor[s] }} /> }))}
        />
        {hiddenByFilters > 0 && (
          <p className="text-xs text-muted xl:ml-auto" role="status">
            {hiddenByFilters === 1 ? "1 pieza oculta por los filtros" : `${hiddenByFilters} piezas ocultas por los filtros`} ·{" "}
            <button type="button" className="font-semibold text-accent-glow hover:text-white" onClick={() => updateFilters({ platforms: [], statuses: [] })}>
              Mostrar todo
            </button>
          </p>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-warning/35 bg-warning/[0.07] px-4 py-3 sm:flex-row sm:items-center" role="status">
          <CircleHelp className="hidden h-5 w-5 flex-none text-warning sm:block" aria-hidden />
          <p className="flex-1 text-sm text-text">
            <span className="font-semibold text-white">{suggestions.length === 1 ? "Encontramos 1 publicación" : `Encontramos ${suggestions.length} publicaciones`} que parece{suggestions.length === 1 ? "" : "n"} ser lo que planeaste.</span>{" "}
            Confírmalo y verás sus vistas reales en el calendario.
          </p>
          <Button size="sm" variant="ghost" onClick={() => setSuggestionsOpen(true)}>
            Revisar
          </Button>
        </div>
      )}

      <DndContext
        id="calendario"
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={({ active }) => {
          setActiveId(String(active.id));
          dragging.current = true;
        }}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          dragging.current = false;
        }}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: "Para mover la pieza, presiona Espacio, elige el día con las flechas y vuelve a presionar Espacio. Escape cancela. Enter la abre.",
          },
        }}
      >
        <div className={cn("grid gap-4 xl:grid-cols-[13.5rem_minmax(0,1fr)]", navPending && "pointer-events-none opacity-70 transition-opacity")} aria-busy={navPending}>
          <UndatedPanel
            entries={undatedList}
            canEdit={canEdit}
            onOpen={(id) => setDialog({ kind: "edit", id })}
            onCreate={openCreate}
            className="order-2 xl:order-1 xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:self-start xl:overflow-y-auto"
          />
          <div className="order-1 min-w-0 xl:order-2">
            <div className="hidden md:block">
              {view === "mes" ? (
                <MonthGrid days={days} month={anchor} today={today} byDay={byDay} canEdit={canEdit} onOpen={(id) => setDialog({ kind: "edit", id })} onCreate={openCreate} onMore={setMoreDay} />
              ) : (
                <WeekGrid days={days} today={today} byDay={byDay} canEdit={canEdit} onOpen={(id) => setDialog({ kind: "edit", id })} onCreate={openCreate} />
              )}
            </div>
            <div className="md:hidden">
              <Agenda
                days={view === "mes" ? days.filter((d) => d.slice(0, 7) === anchor.slice(0, 7)) : days}
                showEmptyDays={view === "semana"}
                today={today}
                byDay={byDay}
                canEdit={canEdit}
                onOpen={(id) => setDialog({ kind: "edit", id })}
                onCreate={openCreate}
              />
            </div>
            <p className="mt-3 hidden text-xs text-placeholder xl:block">
              Arrastra para cambiar de día. Con teclado: Espacio toma la pieza, las flechas la mueven y Espacio la suelta. Atajos: <kbd className="font-mono">T</kbd> hoy ·{" "}
              <kbd className="font-mono">J</kbd>/<kbd className="font-mono">K</kbd> {unit} siguiente o anterior · <kbd className="font-mono">M</kbd> mes · <kbd className="font-mono">S</kbd> semana
              {canEdit && (
                <>
                  {" "}
                  · <kbd className="font-mono">N</kbd> nueva pieza
                </>
              )}
            </p>
          </div>
        </div>
        <DragOverlay dropAnimation={null}>{activeEntry ? <DragPreview entry={activeEntry} variant={activeEntry.scheduledDate ? "compact" : "card"} /> : null}</DragOverlay>
      </DndContext>

      {dialog && (
        <EntryDialog
          key={dialog.kind === "edit" ? dialog.id : `new-${dialog.key}`}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          entry={dialog.kind === "edit" ? editing : null}
          defaults={dialog.kind === "create" ? dialog.defaults : null}
          pillars={pillars}
          canEdit={canEdit}
          onOpenEntry={(id) => setDialog({ kind: "edit", id })}
          onSaved={(_, created, date) => {
            // Si la pieza nueva cae fuera de lo que se ve, se lleva el calendario a esa fecha.
            if (created && date && !days.includes(date)) navigate(view, date);
          }}
        />
      )}

      <Dialog open={moreDay !== null} onOpenChange={(open) => !open && setMoreDay(null)} title={moreDay ? dayLong(moreDay) : ""} description="Todo lo programado para ese día.">
        {moreDay && (
          <DayList
            entries={byDay.get(moreDay) ?? []}
            onOpen={(id) => {
              setMoreDay(null);
              setDialog({ kind: "edit", id });
            }}
          />
        )}
      </Dialog>

      <Dialog
        open={suggestionsOpen}
        onOpenChange={setSuggestionsOpen}
        className="max-w-2xl"
        title="¿Son estas tus publicaciones?"
        description="Las encontramos cerca de la fecha que planeaste y con un texto parecido. Confírmalas para ver sus métricas reales."
      >
        {suggestions.length === 0 ? (
          <p className="text-sm text-muted">No hay nada pendiente. Todo está al día.</p>
        ) : (
          <ul className="flex flex-col gap-5">
            {suggestions.map((e) => (
              <li key={e.id} className="flex flex-col gap-2">
                <button
                  type="button"
                  className="text-left"
                  onClick={() => {
                    setSuggestionsOpen(false);
                    setDialog({ kind: "edit", id: e.id });
                  }}
                >
                  <span className="block font-semibold text-white hover:underline">{e.title}</span>
                  <span className="text-xs text-muted">Planeada para el {e.scheduledDate ? dayLong(e.scheduledDate) : "—"}</span>
                </button>
                {e.targets
                  .filter((t) => t.linkStatus === "SUGGESTED")
                  .map((t) => (
                    <TargetLink key={t.id} target={t} canEdit={canEdit} scheduled={e.scheduledDate} />
                  ))}
              </li>
            ))}
          </ul>
        )}
      </Dialog>

      <PlanDialog open={planOpen} onOpenChange={setPlanOpen} canPlan={canPlan} onDone={(weekStart) => navigate("semana", weekStart)} />
    </div>
  );
}
