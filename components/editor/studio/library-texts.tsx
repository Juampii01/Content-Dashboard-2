"use client";

import { useMemo, useState } from "react";
import type { GraphicLook } from "@/lib/video/graphics";
import { TEXT_PRESET_KEYS, TEXT_PRESETS, TEXT_SECONDS, textScene, type TextPresetKey } from "@/lib/video/text-presets";
import type { VideoFormat } from "@/lib/video/types";
import { cn } from "@/lib/utils";
import { GraphicCanvas } from "../graphic-canvas";
import { startLibraryDrag, type LibraryDrop } from "./studio-timeline";

/** Momento de la muestra quieta: ya entró todo y todavía no sale. */
const READ_AT = 1.7;

/**
 * Biblioteca → Textos: los 12 estilos de texto dibujados con el mismo motor que el render (con tu marca y en el formato
 * del video). Quietos en su momento de lectura; al pasar el mouse o con el foco, se animan. Tocar uno lo pone en el
 * cabezal; también se arrastran a la línea de tiempo.
 */
export function LibraryTexts({ look, format, canEdit, onAdd }: { look: GraphicLook; format: VideoFormat; canEdit: boolean; onAdd: (item: LibraryDrop) => void }) {
  const scenes = useMemo(() => Object.fromEntries(TEXT_PRESET_KEYS.map((k) => [k, textScene({ preset: k, text: TEXT_PRESETS[k].sample, ...(TEXT_PRESETS[k].sub ? { sub: TEXT_PRESETS[k].sub } : {}) }, look, { format })])), [look, format]);
  const [live, setLive] = useState<TextPresetKey | null>(null);
  const vertical = format === "9:16";
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label="Estilos de texto" className={cn("grid gap-2", vertical ? "grid-cols-[repeat(auto-fill,minmax(104px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(160px,1fr))]")}>
        {TEXT_PRESET_KEYS.map((k) => (
          <li key={k}>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => onAdd({ type: "text", preset: k })}
              draggable={canEdit}
              onDragStart={(e) => startLibraryDrag(e, { type: "text", preset: k })}
              onMouseEnter={() => setLive(k)}
              onMouseLeave={() => setLive((v) => (v === k ? null : v))}
              onFocus={() => setLive(k)}
              onBlur={() => setLive((v) => (v === k ? null : v))}
              title={TEXT_PRESETS[k].hint}
              className="group flex w-full flex-col gap-1.5 rounded-xl border border-white/10 p-1.5 text-left transition hover:border-white/30 focus-visible:outline-2 focus-visible:outline-accent-hi disabled:cursor-default"
            >
              <span className={cn("relative block w-full overflow-hidden rounded-lg", vertical ? "aspect-[9/16]" : "aspect-video")} style={{ background: "linear-gradient(160deg, #7c8794 0%, #b9a88f 48%, #3c4639 100%)" }}>
                <GraphicCanvas spec={scenes[k]!} format={format} duration={TEXT_SECONDS} time={live === k ? undefined : READ_AT} scale={vertical ? 0.16 : 0.12} label={`Muestra: ${TEXT_PRESETS[k].label}`} />
              </span>
              <span className="px-0.5">
                <span className="block truncate text-xs font-semibold text-white">{TEXT_PRESETS[k].label}</span>
                <span className="line-clamp-2 block text-[11px] leading-snug text-muted">{TEXT_PRESETS[k].hint}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">Usan la fuente y los colores de tu marca. Al tocarlo, escribe tu texto en el panel y muévelo en el video.</p>
    </div>
  );
}
