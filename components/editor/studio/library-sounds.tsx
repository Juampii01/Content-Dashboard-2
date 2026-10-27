"use client";

import { useMemo, useState } from "react";
import { GripVertical, Play, Plus } from "lucide-react";
import { SFX_CATEGORIES, SFX_CATEGORY_LABELS, SFX_LIBRARY, SFX_NAMES, searchSfx, type SfxCategory, type SfxName } from "@/lib/video/sfx-library";
import { cn } from "@/lib/utils";
import { Chip, SearchBox } from "../fx/fx-library";
import { playSfx } from "../sound/use-sound";
import { startLibraryDrag, type LibraryDrop } from "./studio-timeline";

/** Biblioteca → Sonidos: los efectos de sonido (propios y CC0) para escuchar, tocar para poner en el cabezal o arrastrar. */
export function LibrarySounds({ canEdit, onAdd }: { canEdit: boolean; onAdd: (item: LibraryDrop) => void }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<SfxCategory | "todos">("todos");
  const names = useMemo(() => searchSfx(q).filter((n) => cat === "todos" || SFX_LIBRARY[n].category === cat), [q, cat]);
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-xs text-muted">Sonidos propios del Estudio (sin derechos de autor). Suenan aunque los automáticos estén apagados y van en la pista de Sonido, donde los mueves o cambias su volumen.</p>
      <SearchBox value={q} onChange={setQ} label="Buscar sonidos" placeholder={`Buscar en ${SFX_NAMES.length} sonidos…`} />
      <div role="tablist" aria-label="Categorías de sonidos" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
        <Chip active={cat === "todos"} onClick={() => setCat("todos")} label="Todos" count={SFX_NAMES.length} />
        {SFX_CATEGORIES.map((c) => (
          <Chip key={c} active={cat === c} onClick={() => setCat(c)} label={SFX_CATEGORY_LABELS[c]} />
        ))}
      </div>
      {names.length === 0 ? (
        <p className="rounded-xl border border-white/10 p-3 text-sm text-muted">Ningún sonido coincide con «{q}».</p>
      ) : (
        <ul className="grid grid-cols-1 gap-1" aria-label="Sonidos">
          {names.map((n: SfxName) => (
            <li
              key={n}
              draggable={canEdit}
              onDragStart={(e) => {
                startLibraryDrag(e, { type: "sound", name: n });
              }}
              className={cn("flex items-center gap-1.5 rounded-xl border border-white/10 px-1.5 py-1 transition hover:border-white/25", canEdit && "cursor-grab active:cursor-grabbing")}
            >
              {canEdit && <GripVertical className="h-3.5 w-3.5 flex-none text-placeholder" aria-hidden />}
              <button type="button" onClick={() => void playSfx(n)} className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-white/[0.06] text-white hover:bg-white/[0.12]" aria-label={`Escuchar «${SFX_LIBRARY[n].label}»`}>
                <Play className="h-3 w-3" aria-hidden />
              </button>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold text-white">{SFX_LIBRARY[n].label}</span>
                <span className="block text-[10px] text-muted">{SFX_CATEGORY_LABELS[SFX_LIBRARY[n].category]}</span>
              </span>
              {canEdit && (
                <button type="button" onClick={() => onAdd({ type: "sound", name: n })} className="grid h-7 w-7 flex-none place-items-center rounded-lg text-muted hover:bg-white/[0.08] hover:text-white" aria-label={`Poner «${SFX_LIBRARY[n].label}» en el cabezal`} title="Poner en el cabezal">
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
