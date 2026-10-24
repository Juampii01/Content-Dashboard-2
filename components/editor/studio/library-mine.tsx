"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, Pencil, Star, Trash2, WandSparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { usePrefersReducedMotion } from "@/components/ui/hooks";
import { toast } from "@/components/ui/toast";
import { formatNumber } from "@/lib/format";
import { categoryLabel, EFFECT_CATEGORIES } from "@/lib/video/compos/library";
import type { MyEffect } from "@/lib/video/compos/library-service";
import { cn } from "@/lib/utils";
import { SearchBox } from "../fx/fx-library";
import { favoriteMyEffectAction, listMyEffectsAction, removeMyEffectAction, renameMyEffectAction } from "../my-effects-actions";
import { startLibraryDrag, type LibraryDrop } from "./studio-timeline";

// ─── Aviso de cambios (el inspector guarda o quita y la Biblioteca se actualiza) ───

let version = 0;
const listeners = new Set<() => void>();
/** Avisa que Mis efectos cambió (guardar o quitar desde el inspector): la Biblioteca vuelve a cargar la lista. */
export function myEffectsChanged() {
  version++;
  for (const l of listeners) l();
}
function useMyEffectsVersion() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => 0,
  );
}

/**
 * Mis efectos (arriba de todo en la Biblioteca): las animaciones que se crearon editando o copiando ediciones. Con
 * búsqueda, favoritos, muestra en bucle, renombrar y quitar. Tocar uno lo pone en el cabezal; también se arrastra a la
 * línea de tiempo (pista Animaciones), y sus textos se adaptan a lo que se dice en ese tramo.
 */
export function MyEffectsSection({ canEdit, onAdd }: { canEdit: boolean; onAdd: (item: LibraryDrop) => void }) {
  const [list, setList] = useState<MyEffect[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [onlyFav, setOnlyFav] = useState(false);
  const [cat, setCat] = useState<string | null>(null);
  const [removing, setRemoving] = useState<MyEffect | null>(null);
  const v = useMyEffectsVersion();

  const load = useCallback(async () => {
    const res = await listMyEffectsAction();
    if (res.ok) {
      setList(res.data);
      setError(null);
    } else setError(res.error);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial y cada vez que cambia Mis efectos
    void load();
  }, [load, v]);

  const shown = useMemo(() => {
    const words = q
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/\s+/)
      .filter(Boolean);
    return (list ?? []).filter((e) => {
      if (onlyFav && !e.favorite) return false;
      if (cat && e.category !== cat) return false;
      if (!words.length) return true;
      const hay = `${e.name} ${e.description} ${e.tags.join(" ")} ${categoryLabel(e.category)}`
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
      return words.every((w) => hay.includes(w));
    });
  }, [list, q, onlyFav, cat]);
  const cats = useMemo(() => EFFECT_CATEGORIES.filter((c) => (list ?? []).some((e) => e.category === c.key)), [list]);

  function patch(id: string, p: Partial<MyEffect>) {
    setList((cur) => (cur ? cur.map((e) => (e.id === id ? { ...e, ...p } : e)) : cur));
  }
  async function toggleFav(e: MyEffect) {
    patch(e.id, { favorite: !e.favorite });
    const res = await favoriteMyEffectAction(e.id, !e.favorite);
    if (!res.ok) {
      patch(e.id, { favorite: e.favorite });
      toast.error(res.error);
    }
  }
  async function rename(e: MyEffect, name: string) {
    const clean = name.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!clean || clean === e.name) return;
    patch(e.id, { name: clean });
    const res = await renameMyEffectAction(e.id, clean);
    if (!res.ok) {
      patch(e.id, { name: e.name });
      toast.error(res.error);
    }
  }
  async function remove(e: MyEffect) {
    setRemoving(null);
    setList((cur) => (cur ? cur.filter((x) => x.id !== e.id) : cur));
    const res = await removeMyEffectAction(e.id);
    if (!res.ok) {
      toast.error(res.error);
      void load();
    } else toast.success(`Quitamos «${e.name}» de Mis efectos.`, { description: "Los videos que ya lo usan no cambian, y no se vuelve a guardar solo." });
  }

  return (
    <section aria-labelledby="mis-efectos" className="flex flex-col gap-2.5 rounded-2xl border border-[#8b5cf6]/30 bg-[#8b5cf6]/[0.06] p-3" data-testid="my-effects">
      <div className="flex items-center justify-between gap-2">
        <h3 id="mis-efectos" className="flex items-center gap-1.5 text-sm font-semibold text-white">
          <WandSparkles className="h-4 w-4 text-[#b9a2ff]" aria-hidden /> Mis efectos
          {list && list.length > 0 && <span className="font-mono text-[11px] font-normal text-muted">{formatNumber(list.length)}</span>}
        </h3>
        {list && list.length > 0 && (
          <button
            type="button"
            aria-pressed={onlyFav}
            onClick={() => setOnlyFav((x) => !x)}
            className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-accent-hi", onlyFav ? "bg-warning/20 text-warning" : "text-muted hover:bg-white/[0.06] hover:text-white")}
          >
            <Star className={cn("h-3.5 w-3.5", onlyFav && "fill-current")} aria-hidden /> Favoritos
          </button>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {list === null && !error && <div className="skeleton h-24 rounded-xl" aria-label="Cargando Mis efectos" />}
      {list && list.length === 0 && (
        <p className="text-xs leading-relaxed text-muted">
          Todavía no tienes efectos guardados. Las animaciones que crea la IA (con «Copiar edición», «Edítalo así» o «Pide una animación aquí») se guardan solas aquí cuando renderizas el video, para que las uses en otros.
        </p>
      )}
      {list && list.length > 0 && (
        <>
          {list.length > 4 && <SearchBox value={q} onChange={setQ} label="Buscar en Mis efectos" placeholder={`Buscar en ${formatNumber(list.length)} efectos…`} />}
          {cats.length > 1 && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Categorías de Mis efectos">
              {[{ key: null, label: "Todos" }, ...cats].map((c) => (
                <button
                  key={c.key ?? "todos"}
                  type="button"
                  aria-pressed={cat === c.key}
                  onClick={() => setCat(c.key)}
                  className={cn("rounded-lg px-2 py-0.5 text-[11px] font-semibold transition focus-visible:outline-2 focus-visible:outline-accent-hi", cat === c.key ? "bg-[#8b5cf6] text-white" : "bg-white/[0.04] text-muted hover:text-white")}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
          {shown.length === 0 ? (
            <p className="text-xs text-muted">{onlyFav && !q ? "Todavía no marcaste favoritos: toca la estrella de un efecto." : `Ningún efecto coincide con «${q}».`}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-2" aria-label="Mis efectos">
              {shown.map((e) => (
                <MyEffectCard key={e.id} effect={e} canEdit={canEdit} onAdd={onAdd} onFav={() => toggleFav(e)} onRename={(n) => rename(e, n)} onRemove={() => setRemoving(e)} />
              ))}
            </ul>
          )}
        </>
      )}
      <Dialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`¿Quitar «${removing?.name ?? ""}» de Mis efectos?`}
        description="Los videos que ya lo usan no cambian. No se vuelve a guardar solo; si lo quieres de nuevo, usa «Guardar en mis efectos» en la animación."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancelar
            </Button>
            <Button variant="danger" icon={<Trash2 className="h-4 w-4" aria-hidden />} onClick={() => removing && remove(removing)}>
              Quitar
            </Button>
          </>
        }
      />
    </section>
  );
}

function MyEffectCard({ effect: e, canEdit, onAdd, onFav, onRename, onRemove }: { effect: MyEffect; canEdit: boolean; onAdd: (item: LibraryDrop) => void; onFav: () => void; onRename: (name: string) => void; onRemove: () => void }) {
  const reduced = usePrefersReducedMotion();
  const video = useRef<HTMLVideoElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(e.name);
  const drop: LibraryDrop = { type: "mine", id: e.id, name: e.name, duration: e.duration };
  // Muestra en bucle: siempre, salvo con movimiento reducido (ahí solo al pasar el mouse o con el foco).
  const play = (on: boolean) => {
    const el = video.current;
    if (!el || !reduced) return;
    if (on) void el.play().catch(() => undefined);
    else el.pause();
  };
  const meta = [categoryLabel(e.category), `${e.duration.toFixed(1).replace(".", ",")} s`, e.version > 1 ? `v${e.version}` : null].filter(Boolean).join(" · ");
  return (
    <li className="group relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-bg-deep transition hover:border-[#8b5cf6]/60" onMouseEnter={() => play(true)} onMouseLeave={() => play(false)}>
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => onAdd(drop)}
        onFocus={() => play(true)}
        onBlur={() => play(false)}
        draggable={canEdit}
        onDragStart={(ev) => startLibraryDrag(ev, drop)}
        aria-label={`Agregar «${e.name}» (${meta})`}
        title={e.description}
        className="relative block aspect-[9/12] w-full overflow-hidden bg-[radial-gradient(circle_at_50%_30%,rgba(139,92,246,.35),transparent_70%)] text-left focus-visible:outline-2 focus-visible:outline-accent-hi"
      >
        {e.sampleUrl ? (
          <video ref={video} src={e.sampleUrl} poster={e.posterUrl ?? undefined} muted loop playsInline autoPlay={!reduced} preload="metadata" className="pointer-events-none h-full w-full object-cover" aria-hidden />
        ) : e.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL firmada de corta duración
          <img src={e.posterUrl} alt="" className="pointer-events-none h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center p-2 text-center text-[11px] text-muted">
            <span className="flex flex-col items-center gap-1.5">
              <WandSparkles className="h-5 w-5 text-[#b9a2ff]" aria-hidden />
              La muestra aparece cuando renderices un video con este efecto.
            </span>
          </span>
        )}
        {e.usedCount > 0 && <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">{e.usedCount === 1 ? "1 video" : `${formatNumber(e.usedCount)} videos`}</span>}
      </button>
      {canEdit && (
        <button
          type="button"
          onClick={onFav}
          aria-pressed={e.favorite}
          aria-label={e.favorite ? `Quitar «${e.name}» de favoritos` : `Marcar «${e.name}» como favorito`}
          className={cn("absolute top-1.5 right-1.5 grid h-7 w-7 place-items-center rounded-lg bg-black/55 transition focus-visible:outline-2 focus-visible:outline-accent-hi", e.favorite ? "text-warning" : "text-white/80 hover:text-white")}
        >
          <Star className={cn("h-3.5 w-3.5", e.favorite && "fill-current")} aria-hidden />
        </button>
      )}
      <div className="flex min-w-0 flex-col gap-0.5 p-2">
        {editing ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(ev) => {
              ev.preventDefault();
              onRename(name);
              setEditing(false);
            }}
          >
            <input autoFocus value={name} maxLength={60} onChange={(ev) => setName(ev.target.value)} aria-label="Nombre del efecto" className="field h-7 min-w-0 flex-1 rounded-lg px-2 text-xs" onKeyDown={(ev) => ev.key === "Escape" && (setEditing(false), setName(e.name))} />
            <button type="submit" aria-label="Guardar el nombre" className="grid h-7 w-7 flex-none place-items-center rounded-lg text-success hover:bg-white/[0.06]">
              <Check className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button type="button" aria-label="Cancelar" onClick={() => (setEditing(false), setName(e.name))} className="grid h-7 w-7 flex-none place-items-center rounded-lg text-muted hover:bg-white/[0.06]">
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </form>
        ) : (
          <span className="truncate text-xs font-semibold text-white" title={e.name}>
            {e.name}
          </span>
        )}
        <span className="truncate font-mono text-[10px] text-muted">{meta}</span>
        {canEdit && !editing && (
          <span className="mt-0.5 flex gap-0.5 opacity-80 group-hover:opacity-100">
            <button type="button" onClick={() => (setName(e.name), setEditing(true))} aria-label={`Renombrar «${e.name}»`} className="grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-white/[0.06] hover:text-white">
              <Pencil className="h-3 w-3" aria-hidden />
            </button>
            <button type="button" onClick={onRemove} aria-label={`Quitar «${e.name}» de Mis efectos`} className="grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-white/[0.06] hover:text-danger">
              <Trash2 className="h-3 w-3" aria-hidden />
            </button>
          </span>
        )}
      </div>
    </li>
  );
}
