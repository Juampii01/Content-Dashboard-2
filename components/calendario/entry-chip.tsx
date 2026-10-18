"use client";

import { useDraggable } from "@dnd-kit/core";
import type { KeyboardEvent } from "react";
import { CircleCheck, CircleHelp, GripVertical } from "lucide-react";
import { calendarStatusColor, calendarStatusLabel, plannedFormatLabel, platformLabel } from "@/lib/calendar/labels";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "./platform-icon";
import type { CalendarEntry } from "./shared";

export function linkState(entry: CalendarEntry): "linked" | "suggested" | null {
  if (entry.targets.some((t) => t.linkStatus === "SUGGESTED")) return "suggested";
  if (entry.targets.some((t) => t.linkStatus === "LINKED")) return "linked";
  return null;
}

/** Descripción completa de la pieza para lectores de pantalla y para el `title` al pasar el mouse. */
export function entryDescription(entry: CalendarEntry): string {
  const nets = entry.targets.map((t) => platformLabel[t.platform]).join(", ");
  const link = linkState(entry);
  return [
    entry.title,
    calendarStatusLabel[entry.status],
    plannedFormatLabel[entry.format],
    entry.scheduledTime ? `a las ${entry.scheduledTime}` : null,
    nets || "sin red",
    link === "linked" ? "vinculada con su publicación" : link === "suggested" ? "tiene una publicación por confirmar" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Vista de la pieza: la usan los chips del calendario y la capa que se arrastra. */
export function ChipBody({ entry, variant = "compact", showTime = true }: { entry: CalendarEntry; variant?: "compact" | "card"; showTime?: boolean }) {
  const link = linkState(entry);
  const color = calendarStatusColor[entry.status];
  const icons = (
    <span className="flex flex-none items-center gap-1">
      <span className="flex items-center gap-0.5">
        {entry.targets.map((t) => (
          <PlatformIcon key={t.platform} platform={t.platform} className="h-3 w-3" />
        ))}
      </span>
      {link === "linked" && <CircleCheck aria-hidden className="h-3.5 w-3.5 text-success" />}
      {link === "suggested" && <CircleHelp aria-hidden className="h-3.5 w-3.5 text-warning" />}
    </span>
  );
  return (
    <>
      <span aria-hidden className="absolute inset-y-1.5 left-1 w-[3px] rounded-full" style={{ background: color }} />
      {variant === "card" ? (
        <>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="line-clamp-2 text-[13px] leading-snug font-medium text-white">{entry.title}</span>
            <span className="truncate text-[11px] text-muted">{[plannedFormatLabel[entry.format], entry.pillar].filter(Boolean).join(" · ")}</span>
          </span>
          {icons}
        </>
      ) : (
        // Dos líneas: el título se lee aunque la columna sea angosta; la hora y las redes van abajo.
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="line-clamp-2 text-[11.5px] leading-snug font-medium break-words text-white">{entry.title}</span>
          <span className="flex min-w-0 items-center justify-between gap-1">
            <span className="font-mono text-[10px] font-semibold text-accent-glow tabular-nums">{showTime && entry.scheduledTime ? entry.scheduledTime : ""}</span>
            {icons}
          </span>
        </span>
      )}
    </>
  );
}

const chipClass =
  "group/chip relative flex w-full min-w-0 items-center gap-1.5 rounded-lg border border-white/10 bg-[#0a1c4d] py-1.5 pr-1.5 pl-3 text-left transition-colors hover:border-white/25 hover:bg-[#0d2460] focus-visible:outline-2 focus-visible:outline-accent-hi";

/** Pieza dentro del calendario. Se arrastra con mouse, toque (manteniendo) o teclado (Espacio). Enter o clic la abre. */
export function EntryChip({
  entry,
  onOpen,
  draggable,
  variant = "compact",
  showTime = true,
}: {
  entry: CalendarEntry;
  onOpen: (id: string) => void;
  draggable: boolean;
  variant?: "compact" | "card";
  showTime?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entry.id,
    disabled: !draggable,
    attributes: { roleDescription: "pieza que se puede mover" },
  });
  const description = entryDescription(entry);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    listeners?.onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen(entry.id);
    }
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={description}
      title={description}
      onKeyDown={onKeyDown}
      onClick={() => onOpen(entry.id)}
      data-entry-id={entry.id}
      className={cn(chipClass, variant === "card" && "py-2", draggable && "cursor-grab active:cursor-grabbing", isDragging && "opacity-35")}
      style={{ touchAction: draggable ? "manipulation" : undefined }}
    >
      <ChipBody entry={entry} variant={variant} showTime={showTime} />
      {draggable && variant === "card" && <GripVertical aria-hidden className="h-3.5 w-3.5 flex-none text-placeholder opacity-0 transition group-hover/chip:opacity-100" />}
    </div>
  );
}

/** Copia de la pieza que sigue al cursor mientras se arrastra. */
export function DragPreview({ entry, variant }: { entry: CalendarEntry; variant: "compact" | "card" }) {
  return (
    <div className={cn(chipClass, "w-56 rotate-[1.5deg] cursor-grabbing border-accent-hi/60 shadow-[0_14px_34px_rgba(0,30,110,0.55)]", variant === "card" && "py-2")}>
      <ChipBody entry={entry} variant={variant} />
    </div>
  );
}
