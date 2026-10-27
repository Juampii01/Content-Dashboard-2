"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Film, ImageIcon, Loader2 } from "lucide-react";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { libraryPickerAction, type LibraryPick } from "../library-mention-actions";

/**
 * Autocompletado de @ para nombrar algo de tu biblioteca en un mensaje a la IA («usa @oficina como referencia», «pon
 * @logo al final»). Busca por nombre, etiquetas y ficha. Al elegir, el texto queda con @nombre y la pieza se adjunta.
 */
const TOKEN = /(?:^|\s)@([\p{L}\p{N}_-]{0,40})$/u;

export function useLibraryMention(input: { text: string; setText: (t: string) => void; field: RefObject<HTMLTextAreaElement | null>; onPick: (item: LibraryPick) => void }) {
  const [query, setQuery] = useState<string | null>(null);
  const [items, setItems] = useState<LibraryPick[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);

  /** Lee el @ que se está escribiendo (justo antes del cursor). */
  function sync(text: string, caret: number | null) {
    const before = text.slice(0, caret ?? text.length);
    const m = TOKEN.exec(before);
    setQuery(m ? m[1]! : null);
  }

  useEffect(() => {
    if (query == null) return;
    const n = ++seq.current;
    const t = setTimeout(() => {
      setLoading(true);
      void libraryPickerAction(query)
        .then((r) => {
          if (n !== seq.current) return;
          setItems(r.ok ? r.items : []);
          setActive(0);
        })
        .finally(() => n === seq.current && setLoading(false));
    }, 180);
    return () => clearTimeout(t);
  }, [query]);

  function pick(item: LibraryPick) {
    const el = input.field.current;
    const caret = el?.selectionStart ?? input.text.length;
    const before = input.text.slice(0, caret).replace(/@([\p{L}\p{N}_-]{0,40})$/u, `@${item.slug} `);
    const next = before + input.text.slice(caret);
    input.setText(next);
    setQuery(null);
    input.onPick(item);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  }

  const open = query != null;
  /** Flechas, Enter y Tab eligen; Escape cierra. Devuelve true si la tecla fue para el menú. */
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!open) return false;
    if (e.key === "Escape") {
      e.preventDefault();
      setQuery(null);
      return true;
    }
    if (!items.length) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(items[active] ?? items[0]!);
      return true;
    }
    return false;
  }

  return { open, items, loading, active, setActive, pick, sync, onKeyDown, close: () => setQuery(null), query };
}

export type MentionApi = ReturnType<typeof useLibraryMention>;

export function MentionMenu({ api, id }: { api: MentionApi; id: string }) {
  if (!api.open) return null;
  return (
    <div className="absolute right-0 bottom-full left-0 z-30 mb-1.5 overflow-hidden rounded-xl border border-white/10 bg-card shadow-lg" role="listbox" id={id} aria-label="Tu biblioteca">
      <p className="border-b border-white/10 px-3 py-1.5 text-[11px] font-semibold text-muted">Tu biblioteca{api.query ? ` · «${api.query}»` : ""}</p>
      {api.loading && !api.items.length ? (
        <p className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Buscando…
        </p>
      ) : !api.items.length ? (
        <p className="px-3 py-2 text-xs text-muted">{api.query ? "Nada coincide. Prueba con otra palabra." : "Tu biblioteca está vacía. Sube clips o imágenes en Biblioteca."}</p>
      ) : (
        <ul className="max-h-64 overflow-y-auto py-1">
          {api.items.map((it, i) => (
            <li key={it.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === api.active}
                onMouseEnter={() => api.setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  api.pick(it);
                }}
                className={cn("flex w-full items-center gap-2.5 px-3 py-1.5 text-left", i === api.active ? "bg-white/[0.06]" : "hover:bg-white/[0.04]")}
              >
                <span className="grid h-9 w-9 flex-none place-items-center overflow-hidden rounded-lg bg-white/5">
                  {it.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.thumbUrl} alt="" className="h-full w-full object-cover" />
                  ) : it.kind === "video" ? (
                    <Film className="h-4 w-4 text-muted" aria-hidden />
                  ) : (
                    <ImageIcon className="h-4 w-4 text-muted" aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-white">
                    @{it.slug}
                    <span className="ml-1.5 font-normal text-muted">{it.kind === "video" ? `video · ${formatDuration(it.duration)}` : "imagen"}</span>
                  </span>
                  <span className="block truncate text-[11px] text-muted">{it.summary ?? (it.hasFicha ? it.title : "Todavía sin ficha")}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
