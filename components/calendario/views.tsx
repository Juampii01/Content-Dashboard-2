"use client";

import { useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";
import { CalendarPlus, Inbox, Plus } from "lucide-react";
import { compareInDay, dayLong, weekdayShort } from "@/lib/calendar/dates";
import { calendarStatusColor, calendarStatusLabel, plannedFormatLabel } from "@/lib/calendar/labels";
import { formatCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EntryChip, linkState } from "./entry-chip";
import { PlatformIcon } from "./platform-icon";
import { dropId, type CalendarEntry } from "./shared";

type Common = {
  canEdit: boolean;
  onOpen: (id: string) => void;
  onCreate: (date: string | null, time?: string | null) => void;
};

function Droppable({ id, className, children, label, disabled }: { id: string; className?: string; children: ReactNode; label?: string; disabled?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled, data: { label } });
  return (
    <div ref={setNodeRef} data-drop-id={id} data-over={isOver || undefined} className={cn(className, isOver && "!bg-accent/15 ring-2 ring-accent-hi/70 ring-inset")}>
      {children}
    </div>
  );
}

// ─── Mes ───────────────────────────────────────────────────────────────────

const MAX_IN_CELL = 3;

export function MonthGrid({
  days,
  month,
  today,
  byDay,
  onMore,
  ...common
}: Common & { days: string[]; month: string; today: string; byDay: Map<string, CalendarEntry[]>; onMore: (day: string) => void }) {
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#050d2b]/70" aria-label="Calendario del mes" role="region">
      <div aria-hidden className="grid grid-cols-7 border-b border-white/10 bg-[#061238]">
        {days.slice(0, 7).map((d) => (
          <div key={d} className="px-2 py-2.5 text-center font-mono text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
            {weekdayShort(d)}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]} className="grid grid-cols-7 border-b border-white/[0.07] last:border-b-0">
          {week.map((day) => {
            const list = byDay.get(day) ?? [];
            const visible = list.slice(0, list.length > MAX_IN_CELL ? MAX_IN_CELL - 1 : MAX_IN_CELL);
            const hidden = list.length - visible.length;
            const outside = day.slice(0, 7) !== month.slice(0, 7);
            const isToday = day === today;
            return (
              <Droppable
                key={day}
                id={dropId.day(day)}
                label={dayLong(day)}
                className={cn("group/cell relative flex min-h-[7.75rem] flex-col gap-1 border-r border-white/[0.07] p-1.5 transition-colors last:border-r-0", outside && "bg-black/20", isToday && "bg-accent/[0.07]")}
              >
                <div aria-label={`${dayLong(day)}${isToday ? ", hoy" : ""}: ${list.length === 0 ? "nada programado" : `${list.length} pieza${list.length === 1 ? "" : "s"}`}`} className="flex items-center justify-between">
                  <span
                    className={cn(
                      "grid h-6 min-w-6 place-items-center rounded-full px-1 font-mono text-xs font-semibold tabular-nums",
                      isToday ? "bg-accent text-white" : outside ? "text-placeholder/70" : "text-muted",
                    )}
                  >
                    {Number(day.slice(8))}
                  </span>
                  {common.canEdit && (
                    <button
                      type="button"
                      onClick={() => common.onCreate(day)}
                      aria-label={`Agregar pieza el ${dayLong(day)}`}
                      className="grid h-6 w-6 place-items-center rounded-md text-muted opacity-0 transition group-hover/cell:opacity-100 hover:bg-white/10 hover:text-white focus-visible:opacity-100"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  {visible.map((e) => (
                    <EntryChip key={e.id} entry={e} onOpen={common.onOpen} draggable={common.canEdit} />
                  ))}
                  {hidden > 0 && (
                    <button type="button" onClick={() => onMore(day)} className="rounded-md px-1.5 py-0.5 text-left text-[11px] font-semibold text-accent-glow transition hover:bg-white/5 hover:text-white">
                      +{hidden} más
                    </button>
                  )}
                </div>
                {common.canEdit && (
                  // Clic en el espacio vacío del día: crear rápido.
                  <button type="button" tabIndex={-1} aria-hidden onClick={() => common.onCreate(day)} className="min-h-3 flex-1 cursor-copy rounded-md" />
                )}
              </Droppable>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Semana ────────────────────────────────────────────────────────────────

export function WeekGrid({ days, today, byDay, ...common }: Common & { days: string[]; today: string; byDay: Map<string, CalendarEntry[]> }) {
  const hours = (() => {
    let min = 7;
    let max = 22;
    for (const d of days) {
      for (const e of byDay.get(d) ?? []) {
        if (!e.scheduledTime) continue;
        const h = Number(e.scheduledTime.slice(0, 2));
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
    }
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  })();
  const at = (day: string, hour: number | null) => (byDay.get(day) ?? []).filter((e) => (hour == null ? !e.scheduledTime : e.scheduledTime && Number(e.scheduledTime.slice(0, 2)) === hour));

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#050d2b]/70">
      <div role="region" aria-label="Calendario de la semana">
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-white/10 bg-[#061238]" aria-hidden>
          <div />
          {days.map((d) => (
            <div key={d} className={cn("flex flex-col items-center gap-0.5 px-1 py-2", d === today && "text-white")}>
              <span className="font-mono text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">{weekdayShort(d)}</span>
              <span className={cn("grid h-7 min-w-7 place-items-center rounded-full px-1 text-sm font-semibold tabular-nums", d === today ? "bg-accent text-white" : "text-white")}>{Number(d.slice(8))}</span>
            </div>
          ))}
        </div>

        <Row label="Sin hora" hint="todo el día">
          {days.map((d) => (
            <Slot key={d} day={d} hour={null} entries={at(d, null)} today={today} {...common} tall />
          ))}
        </Row>
        {hours.map((h) => (
          <Row key={h} label={`${String(h).padStart(2, "0")}:00`}>
            {days.map((d) => (
              <Slot key={d} day={d} hour={h} entries={at(d, h)} today={today} {...common} />
            ))}
          </Row>
        ))}
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-white/[0.06] last:border-b-0">
      <div aria-hidden className="flex flex-col items-end px-2 pt-1.5 font-mono text-[10px] font-semibold text-placeholder tabular-nums">
        <span>{label}</span>
        {hint && <span className="sr-only">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Slot({ day, hour, entries, today, tall, canEdit, onOpen, onCreate }: Common & { day: string; hour: number | null; entries: CalendarEntry[]; today: string; tall?: boolean }) {
  const label = hour == null ? `${dayLong(day)}, sin hora` : `${dayLong(day)} a las ${String(hour).padStart(2, "0")}:00`;
  return (
    <Droppable
      id={dropId.slot(day, hour)}
      label={label}
      className={cn("group/slot relative flex flex-col gap-1 border-l border-white/[0.06] p-1 transition-colors", tall ? "min-h-14 bg-white/[0.015]" : "min-h-11", day === today && "bg-accent/[0.05]")}
    >
      {entries.sort(compareInDay).map((e) => (
        <EntryChip key={e.id} entry={e} onOpen={onOpen} draggable={canEdit} showTime={hour != null} />
      ))}
      {canEdit && (
        <button
          type="button"
          onClick={() => onCreate(day, hour == null ? null : `${String(hour).padStart(2, "0")}:00`)}
          aria-label={`Agregar pieza el ${label}`}
          className={cn("flex min-h-6 flex-1 items-center justify-center rounded-md text-muted opacity-0 transition hover:bg-white/5 hover:text-white focus-visible:opacity-100", entries.length === 0 && "group-hover/slot:opacity-100")}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </Droppable>
  );
}

// ─── Agenda (teléfono) ─────────────────────────────────────────────────────

export function Agenda({ days, today, byDay, showEmptyDays, onOpen, onCreate, canEdit }: Common & { days: string[]; today: string; byDay: Map<string, CalendarEntry[]>; showEmptyDays: boolean }) {
  const list = days.filter((d) => showEmptyDays || (byDay.get(d)?.length ?? 0) > 0 || d === today);
  if (list.length === 0 || list.every((d) => (byDay.get(d)?.length ?? 0) === 0 && !showEmptyDays)) {
    return (
      <div className="card flex flex-col items-center px-5 py-10 text-center">
        <CalendarPlus className="mb-3 h-6 w-6 text-accent-hi" aria-hidden />
        <p className="font-semibold text-white">Nada programado en estas fechas</p>
        <p className="mt-1 text-sm text-muted">Agrega tu próxima pieza o arma la semana con IA.</p>
      </div>
    );
  }
  return (
    <ol className="flex flex-col gap-4" aria-label="Agenda">
      {list.map((d) => {
        const entries = byDay.get(d) ?? [];
        return (
          <li key={d}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className={cn("text-sm font-semibold first-letter:uppercase", d === today ? "text-white" : "text-muted")}>
                {dayLong(d)}
                {d === today && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase normal-case">Hoy</span>}
              </h3>
              {canEdit && (
                <button type="button" onClick={() => onCreate(d)} aria-label={`Agregar pieza el ${dayLong(d)}`} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-white/5 hover:text-white">
                  <Plus className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
            {entries.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 px-4 py-3 text-sm text-placeholder">Nada programado</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {entries.map((e) => (
                  <li key={e.id}>
                    <AgendaCard entry={e} onOpen={onOpen} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function AgendaCard({ entry, onOpen }: { entry: CalendarEntry; onOpen: (id: string) => void }) {
  const linked = entry.targets.find((t) => t.linkStatus === "LINKED" && t.item);
  const link = linkState(entry);
  return (
    <button type="button" onClick={() => onOpen(entry.id)} className="card card-lift relative flex w-full items-start gap-3 overflow-hidden p-3.5 pl-5 text-left">
      <span aria-hidden className="absolute inset-y-2 left-2 w-1 rounded-full" style={{ background: calendarStatusColor[entry.status] }} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2 text-xs text-muted">
          {entry.scheduledTime && <span className="font-mono font-semibold text-accent-glow">{entry.scheduledTime}</span>}
          <span>{calendarStatusLabel[entry.status]}</span>
          <span aria-hidden>·</span>
          <span>{plannedFormatLabel[entry.format]}</span>
        </span>
        <span className="font-semibold text-white">{entry.title}</span>
        {entry.hook && entry.hook !== entry.title && <span className="line-clamp-2 text-sm text-muted">“{entry.hook}”</span>}
        {linked?.item && (
          <span className="text-xs font-semibold text-success">
            {formatCompact(linked.item.views)} visualizaciones{linked.item.perfScore ? ` · ×${linked.item.perfScore.toFixed(1)} tu mediana` : ""}
          </span>
        )}
        {link === "suggested" && <span className="text-xs font-semibold text-warning">Tiene una publicación por confirmar</span>}
      </span>
      <span className="flex flex-none items-center gap-1 pt-0.5">
        {entry.targets.map((t) => (
          <PlatformIcon key={t.platform} platform={t.platform} label />
        ))}
      </span>
    </button>
  );
}

// ─── Sin fecha ─────────────────────────────────────────────────────────────

export function UndatedPanel({ entries, canEdit, onOpen, onCreate, className }: Common & { entries: CalendarEntry[]; className?: string }) {
  return (
    <Droppable id={dropId.undated} label="Sin fecha" className={cn("flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#050d2b]/70 p-3.5 transition-colors", className)}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Inbox className="h-4 w-4 text-accent-hi" aria-hidden />
            Sin fecha
            <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-muted tabular-nums">{entries.length}</span>
          </h2>
          <p className="mt-0.5 text-xs text-muted">Ideas para programar más adelante.</p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => onCreate(null)} aria-label="Anotar una idea sin fecha" className="grid h-8 w-8 flex-none place-items-center rounded-lg text-muted transition hover:bg-white/10 hover:text-white">
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/12 px-3 py-4 text-center text-xs leading-relaxed text-placeholder">
          {canEdit ? "Arrastra aquí lo que todavía no tiene día, o anota una idea con el botón +." : "No hay ideas sin fecha."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {entries.map((e) => (
            <li key={e.id}>
              <EntryChip entry={e} onOpen={onOpen} draggable={canEdit} variant="card" />
            </li>
          ))}
        </ul>
      )}
    </Droppable>
  );
}

/** Lista simple de las piezas de un día (para "+N más"). */
export function DayList({ entries, onOpen }: { entries: CalendarEntry[]; onOpen: (id: string) => void }) {
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((e) => (
        <li key={e.id}>
          <AgendaCard entry={e} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
}

