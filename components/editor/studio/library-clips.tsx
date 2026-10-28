"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Film, Folder, Home, ImageIcon, Library, Loader2, Plus, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SignedOption } from "@/lib/dal/editor-media";
import { pathOf, type FolderItem } from "../library-folders";
import { studioLibraryAction } from "../media-actions";
import { startLibraryDrag, type LibraryDrop } from "./studio-timeline";

type Piece = SignedOption & { folderId: string | null };

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * Tu biblioteca dentro del Estudio (pestaña B-roll), como el panel de medios de un editor: carpetas, búsqueda y las
 * miniaturas de tus clips e imágenes. Tocar una pieza la pone en el cabezal; también se arrastra a la línea de tiempo.
 */
export function LibraryClips({ canEdit, onAdd }: { canEdit: boolean; onAdd: (item: LibraryDrop) => void }) {
  const [pieces, setPieces] = useState<Piece[] | null>(null);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | "video" | "image">("all");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    void studioLibraryAction().then((r) => {
      if (!alive) return;
      if (r.ok && r.data) {
        setPieces(r.data.options);
        setFolders(r.data.folders);
        setError(null);
      } else setError(r.ok ? "No pudimos cargar tu biblioteca." : r.error);
    });
    return () => {
      alive = false;
    };
  }, [tick]);

  const searching = q.trim().length >= 2;
  const shown = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return (pieces ?? []).filter((p) => {
      if (kind !== "all" && (p.kind ?? "video") !== kind) return false;
      if (!searching) return p.folderId === folder;
      const hay = norm(`${p.title ?? ""} ${p.moment?.what ?? ""}`);
      return words.every((w) => hay.includes(w));
    });
  }, [pieces, q, kind, folder, searching]);
  const subfolders = searching ? [] : folders.filter((f) => f.parentId === folder);
  const path = pathOf(folders, folder);

  if (error)
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-white/10 p-3 text-xs text-muted">
        {error}
        <Button size="sm" variant="ghost" icon={<RefreshCcw className="h-3.5 w-3.5" aria-hidden />} onClick={() => setTick((t) => t + 1)}>
          Reintentar
        </Button>
      </div>
    );
  if (!pieces)
    return (
      <p className="flex items-center gap-2 text-xs text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Cargando tu biblioteca…
      </p>
    );
  if (pieces.length === 0)
    return (
      <div className="rounded-xl border border-dashed border-white/15 p-3 text-xs text-muted">
        Todavía no tienes clips ni imágenes listos.{" "}
        <Link href="/editor/biblioteca" className="font-semibold text-accent-hi hover:underline">
          Súbelos a tu biblioteca
        </Link>{" "}
        y aparecen aquí para arrastrarlos al video.
      </div>
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <input className="field !h-8 min-w-0 flex-1 !text-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en tus clips…" aria-label="Buscar en tus clips e imágenes" />
        <select className="field !h-8 !w-auto !text-xs" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Tipo de pieza">
          <option value="all">Todo</option>
          <option value="video">Videos</option>
          <option value="image">Imágenes</option>
        </select>
      </div>
      {!searching && folders.length > 0 && (
        <nav aria-label="Carpetas" className="flex flex-wrap items-center gap-0.5 text-xs">
          <button type="button" onClick={() => setFolder(null)} className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-1", folder === null ? "bg-white/10 font-semibold text-white" : "text-muted hover:text-white")}>
            <Home className="h-3 w-3" aria-hidden /> Todo
          </button>
          {path.map((f) => (
            <span key={f.id} className="flex items-center">
              <ChevronRight className="h-3 w-3 text-placeholder" aria-hidden />
              <button type="button" onClick={() => setFolder(f.id)} className={cn("max-w-[8rem] truncate rounded-md px-1.5 py-1", f.id === folder ? "bg-white/10 font-semibold text-white" : "text-muted hover:text-white")}>
                {f.name}
              </button>
            </span>
          ))}
        </nav>
      )}
      {subfolders.length > 0 && (
        <ul className="grid grid-cols-2 gap-1.5" aria-label="Subcarpetas">
          {subfolders.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => setFolder(f.id)} className="flex w-full items-center gap-1.5 truncate rounded-lg border border-white/10 px-2 py-1.5 text-left text-xs text-text hover:border-white/30">
                <Folder className="h-3.5 w-3.5 flex-none text-muted" aria-hidden /> <span className="truncate">{f.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/15 px-2 py-4 text-center text-xs text-muted">{searching ? `Nada coincide con «${q}».` : "No hay piezas aquí."}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" aria-label="Tus clips e imágenes">
          {shown.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={!canEdit}
                draggable={canEdit}
                onDragStart={(e) => startLibraryDrag(e, { type: "clip", option: p })}
                onClick={() => onAdd({ type: "clip", option: p })}
                title={canEdit ? `${p.title ?? "Clip"}: tócalo para ponerlo en el cabezal o arrástralo a la línea de tiempo` : (p.title ?? "Clip")}
                className="group relative block aspect-[4/5] w-full overflow-hidden rounded-lg border border-white/10 bg-black/40 text-left transition hover:border-white/40 disabled:cursor-default"
              >
                {p.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbUrl} alt="" className="h-full w-full object-cover" loading="lazy" draggable={false} />
                ) : (
                  <span className="grid h-full w-full place-items-center text-placeholder">{p.kind === "image" ? <ImageIcon className="h-5 w-5" aria-hidden /> : <Film className="h-5 w-5" aria-hidden />}</span>
                )}
                <span className="absolute top-1 left-1 rounded bg-black/70 px-1 font-mono text-[10px] text-paper">{p.kind === "image" ? "Imagen" : formatDuration(p.duration)}</span>
                {canEdit && (
                  <span className="absolute top-1 right-1 grid h-5 w-5 place-items-center rounded bg-black/70 text-paper opacity-0 transition-opacity group-hover:opacity-100" aria-hidden>
                    <Plus className="h-3 w-3" />
                  </span>
                )}
                <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 to-transparent px-1.5 pt-4 pb-1 text-[11px] text-paper">{p.title ?? "Clip"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Link href="/editor/biblioteca" className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-hi hover:underline">
        <Library className="h-3.5 w-3.5" aria-hidden /> Subir u ordenar en tu biblioteca
      </Link>
    </div>
  );
}
