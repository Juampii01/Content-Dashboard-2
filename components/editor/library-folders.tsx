"use client";

import { useMemo, useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Folder, FolderInput, FolderOpen, FolderPlus, Home, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu } from "@/components/ui/menu";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { createFolderAction, deleteFolderAction, moveClipsAction, moveFolderAction, renameFolderAction } from "./media-actions";

export type FolderItem = { id: string; name: string; parentId: string | null; clips: number };

/** Tipo de dato que viaja al arrastrar piezas o carpetas de la biblioteca. */
export const DRAG_CLIPS = "application/x-novacut-clips";
export const DRAG_FOLDER = "application/x-novacut-folder";

/** El camino desde la raíz hasta la carpeta (para la ruta de navegación). */
export function pathOf(folders: FolderItem[], id: string | null): FolderItem[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: FolderItem[] = [];
  let cur = id ? byId.get(id) : undefined;
  for (let i = 0; cur && i < 10; i++) {
    out.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

/** La carpeta y todas las de adentro (a cualquier nivel). */
export function subtree(folders: FolderItem[], id: string): Set<string> {
  const out = new Set([id]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        changed = true;
      }
    }
  }
  return out;
}

/** Lo que se suelta sobre una carpeta: piezas (se mueven ahí) o una carpeta (va adentro). */
function useDrop(target: string | null, onDone: () => void) {
  const [over, setOver] = useState(false);
  const [, start] = useTransition();
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (![...e.dataTransfer.types].some((t) => t === DRAG_CLIPS || t === DRAG_FOLDER)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        setOver(false);
        const clips = e.dataTransfer.getData(DRAG_CLIPS);
        const folder = e.dataTransfer.getData(DRAG_FOLDER);
        if (!clips && !folder) return;
        e.preventDefault();
        start(async () => {
          if (clips) {
            const ids = JSON.parse(clips) as string[];
            const r = await moveClipsAction(ids, target);
            if (!r.ok) toast.error(r.error);
            else toast.success(ids.length === 1 ? "Pieza movida." : `${ids.length} piezas movidas.`);
          } else if (folder && folder !== target) {
            const r = await moveFolderAction(folder, target);
            if (!r.ok) toast.error(r.error);
          }
          onDone();
        });
      },
    },
  };
}

/**
 * Barra de carpetas de la biblioteca: la ruta («Todo › Oficina › Fotos»), las subcarpetas de la carpeta abierta como
 * tarjetas, y crear, renombrar, mover y borrar. Las piezas y las carpetas se arrastran sobre una carpeta (o sobre un
 * tramo de la ruta) para moverlas.
 */
export function FolderBar({ folders, current, onOpen, canEdit, rootCount }: { folders: FolderItem[]; current: string | null; onOpen: (id: string | null) => void; canEdit: boolean; rootCount: number }) {
  const router = useRouter();
  const path = pathOf(folders, current);
  const children = useMemo(() => folders.filter((f) => f.parentId === current), [folders, current]);
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of folders) m.set(f.id, [...subtree(folders, f.id)].reduce((n, id) => n + (folders.find((x) => x.id === id)?.clips ?? 0), 0));
    return m;
  }, [folders]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<FolderItem | null>(null);
  const [deleting, setDeleting] = useState<FolderItem | null>(null);
  const [moving, setMoving] = useState<FolderItem | null>(null);
  const [pending, start] = useTransition();
  const refresh = () => router.refresh();

  function create() {
    start(async () => {
      const r = await createFolderAction({ name, parentId: current });
      if (!r.ok) return void toast.error(r.error);
      setCreating(false);
      setName("");
      refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Carpetas de la biblioteca" className="flex flex-wrap items-center gap-1 text-sm">
        <Crumb label="Todo" icon={<Home className="h-3.5 w-3.5" aria-hidden />} target={null} active={current === null} onOpen={onOpen} onDone={refresh} />
        {path.map((f) => (
          <span key={f.id} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-placeholder" aria-hidden />
            <Crumb label={f.name} target={f.id} active={f.id === current} onOpen={onOpen} onDone={refresh} />
          </span>
        ))}
        {canEdit && (
          <Button size="sm" variant="ghost" className="ml-auto" icon={<FolderPlus className="h-3.5 w-3.5" aria-hidden />} onClick={() => setCreating(true)}>
            Nueva carpeta
          </Button>
        )}
      </nav>

      {(children.length > 0 || creating) && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6" aria-label="Subcarpetas">
          {children.map((f) => (
            <li key={f.id}>
              <FolderTile
                folder={f}
                total={totals.get(f.id) ?? 0}
                canEdit={canEdit}
                onOpen={() => onOpen(f.id)}
                onRename={() => setRenaming(f)}
                onMove={() => setMoving(f)}
                onDelete={() => setDeleting(f)}
                onDone={refresh}
              />
            </li>
          ))}
          {creating && (
            <li>
              <form
                className="card flex h-full items-center gap-2 p-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  create();
                }}
              >
                <FolderPlus className="h-4 w-4 flex-none text-muted" aria-hidden />
                <input
                  autoFocus
                  className="field !h-8 !text-sm"
                  value={name}
                  maxLength={60}
                  placeholder="Nombre de la carpeta"
                  aria-label="Nombre de la carpeta nueva"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && (setCreating(false), setName(""))}
                  onBlur={() => !name.trim() && setCreating(false)}
                  disabled={pending}
                />
                {pending && <Loader2 className="h-4 w-4 animate-spin text-muted motion-reduce:animate-none" aria-label="Creando" />}
              </form>
            </li>
          )}
        </ul>
      )}
      {current === null && children.length === 0 && !creating && canEdit && rootCount > 6 && (
        <p className="text-xs text-muted">Consejo: crea carpetas (Oficina, Producto, Fotos del equipo…) y arrastra tus piezas adentro para encontrarlas rápido.</p>
      )}

      <NameDialog
        open={Boolean(renaming)}
        title="Renombrar carpeta"
        initial={renaming?.name ?? ""}
        onClose={() => setRenaming(null)}
        onSave={(n) =>
          start(async () => {
            const r = await renameFolderAction(renaming!.id, n);
            if (!r.ok) return void toast.error(r.error);
            setRenaming(null);
            refresh();
          })
        }
        busy={pending}
      />
      <MoveDialog
        open={Boolean(moving)}
        title={moving ? `Mover «${moving.name}» a…` : ""}
        folders={folders}
        exclude={moving ? subtree(folders, moving.id) : new Set()}
        current={moving?.parentId ?? null}
        onClose={() => setMoving(null)}
        onPick={(target) =>
          start(async () => {
            const r = await moveFolderAction(moving!.id, target);
            if (!r.ok) return void toast.error(r.error);
            setMoving(null);
            refresh();
          })
        }
        busy={pending}
      />
      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? `¿Borrar la carpeta «${deleting.name}»?` : ""}
        description="No se borra ninguna pieza: lo que tiene adentro (piezas y subcarpetas) pasa a la carpeta de arriba."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const target = deleting!;
                  const r = await deleteFolderAction(target.id);
                  if (!r.ok) return void toast.error(r.error);
                  setDeleting(null);
                  if (current && subtree(folders, target.id).has(current)) onOpen(target.parentId);
                  refresh();
                })
              }
            >
              {pending ? "Borrando…" : "Borrar carpeta"}
            </Button>
          </>
        }
      />
    </div>
  );
}

function Crumb({ label, icon, target, active, onOpen, onDone }: { label: string; icon?: React.ReactNode; target: string | null; active: boolean; onOpen: (id: string | null) => void; onDone: () => void }) {
  const drop = useDrop(target, onDone);
  return (
    <button
      type="button"
      {...drop.props}
      onClick={() => onOpen(target)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex max-w-[14rem] items-center gap-1.5 truncate rounded-lg px-2 py-1 transition-colors",
        active ? "bg-white/10 font-semibold text-white" : "text-muted hover:bg-white/5 hover:text-white",
        drop.over && "ring-2 ring-accent",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function FolderTile({ folder, total, canEdit, onOpen, onRename, onMove, onDelete, onDone }: { folder: FolderItem; total: number; canEdit: boolean; onOpen: () => void; onRename: () => void; onMove: () => void; onDelete: () => void; onDone: () => void }) {
  const drop = useDrop(folder.id, onDone);
  return (
    <div
      {...drop.props}
      draggable={canEdit}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_FOLDER, folder.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={cn("card group flex items-center gap-2 p-2 pr-1 transition-[box-shadow,transform]", drop.over && "scale-[1.02] ring-2 ring-accent")}
    >
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 text-left hover:bg-white/5" aria-label={`Abrir la carpeta ${folder.name}`}>
        {drop.over ? <FolderOpen className="h-5 w-5 flex-none text-accent" aria-hidden /> : <Folder className="h-5 w-5 flex-none text-muted" aria-hidden />}
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-white">{folder.name}</span>
          <span className="block text-[11px] text-muted">{total === 1 ? "1 pieza" : `${total} piezas`}</span>
        </span>
      </button>
      {canEdit && (
        <DropdownMenu
          label={`Opciones de la carpeta ${folder.name}`}
          align="end"
          trigger={<MoreHorizontal className="h-4 w-4" aria-hidden />}
          items={[
            { label: "Renombrar", icon: <Pencil className="h-3.5 w-3.5" aria-hidden />, onSelect: onRename },
            { label: "Mover a…", icon: <FolderInput className="h-3.5 w-3.5" aria-hidden />, onSelect: onMove },
            { type: "separator" },
            { label: "Borrar carpeta", icon: <Trash2 className="h-3.5 w-3.5" aria-hidden />, onSelect: onDelete, danger: true },
          ]}
        />
      )}
    </div>
  );
}

function NameDialog({ open, title, initial, onClose, onSave, busy }: { open: boolean; title: string; initial: string; onClose: () => void; onSave: (name: string) => void; busy: boolean }) {
  const [value, setValue] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setValue(initial);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={busy || !value.trim()} onClick={() => onSave(value)}>
            {busy ? "Guardando…" : "Guardar"}
          </Button>
        </>
      }
    >
      <input className="field" value={value} maxLength={60} aria-label="Nombre de la carpeta" onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && value.trim() && onSave(value)} autoFocus />
    </Dialog>
  );
}

/** Elegir una carpeta de destino (árbol con sangría). `exclude`: carpetas que no se pueden elegir. */
export function MoveDialog({ open, title, folders, exclude, current, onClose, onPick, busy }: { open: boolean; title: string; folders: FolderItem[]; exclude: Set<string>; current?: string | null; onClose: () => void; onPick: (id: string | null) => void; busy: boolean }) {
  const rows = useMemo(() => {
    const out: { f: FolderItem; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const f of folders.filter((x) => x.parentId === parent).sort((a, b) => a.name.localeCompare(b.name, "es"))) {
        if (exclude.has(f.id)) continue;
        out.push({ f, depth });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [folders, exclude]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={title} description="Elige la carpeta de destino.">
      <ul className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto" aria-label="Carpetas">
        <li>
          <button type="button" disabled={busy || current === null} onClick={() => onPick(null)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-white/5 disabled:opacity-50">
            <Home className="h-4 w-4 text-muted" aria-hidden /> Todo (sin carpeta)
          </button>
        </li>
        {rows.map(({ f, depth }) => (
          <li key={f.id}>
            <button
              type="button"
              disabled={busy || f.id === current}
              onClick={() => onPick(f.id)}
              className="flex w-full items-center gap-2 rounded-lg py-2 pr-2 text-left text-sm hover:bg-white/5 disabled:opacity-50"
              style={{ paddingLeft: `${0.5 + depth * 1.1}rem` }}
            >
              <Folder className="h-4 w-4 flex-none text-muted" aria-hidden />
              <span className="truncate">{f.name}</span>
              {f.id === current && <span className="ml-auto text-[11px] text-muted">Aquí está</span>}
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="px-2 py-3 text-sm text-muted">Todavía no hay carpetas. Créalas con «Nueva carpeta».</li>}
      </ul>
    </Dialog>
  );
}
