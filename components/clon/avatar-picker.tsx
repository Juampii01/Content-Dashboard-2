"use client";

import { useEffect, useState } from "react";
import { Check, ImageOff, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { avatarTypeLabel } from "@/lib/heygen/labels";
import { cn } from "@/lib/utils";
import { listAvatarsAction, type AvatarOption } from "./actions";

type Ownership = "private" | "public";
type PageState = { items: AvatarOption[]; nextToken: string | null; error: string | null; loadingMore: boolean };

/** Grilla de avatares de la cuenta de HeyGen, con paginación por cursor. "Mis avatares" primero. */
export function AvatarPicker({ selectedId, onSelect }: { selectedId: string | null; onSelect: (avatar: AvatarOption) => void }) {
  const [ownership, setOwnership] = useState<Ownership>("private");
  const [pages, setPages] = useState<Partial<Record<Ownership, PageState>>>({});
  const [reloadKey, setReloadKey] = useState(0);
  const current = pages[ownership];

  useEffect(() => {
    if (pages[ownership] && !pages[ownership]!.error) return;
    let cancelled = false;
    listAvatarsAction({ ownership }).then((res) => {
      if (cancelled) return;
      setPages((prev) => ({
        ...prev,
        [ownership]: res.ok
          ? { items: res.data.items, nextToken: res.data.nextToken, error: null, loadingMore: false }
          : { items: [], nextToken: null, error: res.error, loadingMore: false },
      }));
    });
    return () => {
      cancelled = true;
    };
    // `pages` no va en las dependencias: solo se carga al cambiar de pestaña o al reintentar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownership, reloadKey]);

  const loadMore = async () => {
    if (!current?.nextToken) return;
    setPages((prev) => ({ ...prev, [ownership]: { ...current, loadingMore: true } }));
    const res = await listAvatarsAction({ ownership, token: current.nextToken });
    setPages((prev) => ({
      ...prev,
      [ownership]: res.ok
        ? { items: [...current.items, ...res.data.items], nextToken: res.data.nextToken, error: null, loadingMore: false }
        : { ...current, error: res.error, loadingMore: false },
    }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="segmented self-start" role="radiogroup" aria-label="Qué avatares mostrar">
        {(
          [
            ["private", "Mis avatares"],
            ["public", "Avatares de HeyGen"],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={ownership === value} className="segmented-item" onClick={() => setOwnership(value)}>
            {label}
          </button>
        ))}
      </div>

      {current?.error && (
        <Notice tone="danger">
          <p>{current.error}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
            onClick={() => {
              setPages((prev) => ({ ...prev, [ownership]: undefined }));
              setReloadKey((k) => k + 1);
            }}
          >
            Reintentar
          </Button>
        </Notice>
      )}

      {!current ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true" aria-label="Cargando avatares">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton aspect-[3/4]" />
          ))}
        </div>
      ) : current.items.length === 0 && !current.error ? (
        <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-muted">
          {ownership === "private"
            ? "Tu cuenta de HeyGen todavía no tiene avatares propios. Crea tu clon en HeyGen (mira «¿Todavía no tienes tu clon?» en Videos con clon) o prueba con un avatar de HeyGen."
            : "HeyGen no devolvió avatares públicos."}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" role="radiogroup" aria-label="Avatares">
          {current.items.map((avatar) => {
            const unusable = avatar.status === "processing" || avatar.status === "failed";
            const selected = avatar.id === selectedId;
            return (
              <li key={avatar.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={unusable}
                  onClick={() => onSelect(avatar)}
                  className={cn(
                    "group relative flex w-full flex-col overflow-hidden rounded-2xl border text-left transition disabled:cursor-not-allowed disabled:opacity-55",
                    selected ? "border-accent-hi bg-accent/15 ring-2 ring-accent-hi/40" : "border-white/10 bg-white/[0.02] hover:border-white/30",
                  )}
                >
                  <div className="relative aspect-[3/4] bg-black/30">
                    {avatar.previewImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatar.previewImage} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full place-items-center text-placeholder">
                        <ImageOff className="h-6 w-6" aria-hidden />
                      </div>
                    )}
                    {selected && (
                      <span className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-full bg-accent-hi text-bg">
                        <Check className="h-4 w-4" aria-hidden />
                      </span>
                    )}
                    {unusable && (
                      <span className="absolute inset-x-2 bottom-2 rounded-lg bg-black/70 px-2 py-1 text-center text-[11px] font-semibold text-warning">
                        {avatar.status === "processing" ? "Todavía entrenando" : "Falló en HeyGen"}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 p-3">
                    <span className="line-clamp-1 text-sm font-semibold text-white">{avatar.name}</span>
                    <span className="text-xs text-muted">{avatarTypeLabel[avatar.type] ?? "Avatar"}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {current?.nextToken && (
        <Button
          variant="ghost"
          size="sm"
          className="self-center"
          onClick={loadMore}
          disabled={current.loadingMore}
          icon={current.loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : undefined}
        >
          {current.loadingMore ? "Cargando…" : "Ver más avatares"}
        </Button>
      )}
    </div>
  );
}
