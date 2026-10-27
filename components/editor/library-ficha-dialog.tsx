"use client";

import { useEffect, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import type { Ficha, FichaMoment } from "@/lib/video/library-ficha";
import { clipMediaAction, updateFichaAction } from "./media-actions";

/**
 * La ficha de una pieza de la biblioteca: lo que Claude vio (descripción, momentos con su tramo, colores, estilo, usos
 * y etiquetas), con el archivo y las hojas de cuadros que miró. La persona la corrige y se guarda: así se busca y se
 * elige por lo que de verdad se ve.
 */
const EMPTY: Ficha = { description: "", moments: [], colors: [], style: "", uses: [], tags: [], tagsEn: [] };
const list = (s: string, max: number) => s.split(",").map((x) => x.trim()).filter(Boolean).slice(0, max);

export function FichaDialog({
  open,
  onOpenChange,
  clip,
  canEdit,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clip: { id: string; title: string; kind: "video" | "image"; duration: number | null; ficha: Ficha | null };
  canEdit: boolean;
  onSaved: (ficha: Ficha) => void;
}) {
  const [draft, setDraft] = useState<Ficha>(clip.ficha ?? EMPTY);
  const [lists, setLists] = useState(() => ({ uses: (clip.ficha?.uses ?? []).join(", "), tags: (clip.ficha?.tags ?? []).join(", "), tagsEn: (clip.ficha?.tagsEn ?? []).join(", "), colors: (clip.ficha?.colors ?? []).join(", ") }));
  const [media, setMedia] = useState<{ mediaUrl: string | null; sheetUrls: string[] } | null>(null);
  const [pending, start] = useTransition();
  const dur = clip.duration ?? 0;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void clipMediaAction(clip.id).then((r) => alive && setMedia(r.ok && r.data ? r.data : { mediaUrl: null, sheetUrls: [] }));
    return () => {
      alive = false;
    };
  }, [open, clip.id]);

  const setMoment = (i: number, patch: Partial<FichaMoment>) => setDraft((d) => ({ ...d, moments: d.moments.map((m, k) => (k === i ? { ...m, ...patch } : m)) }));

  function save() {
    const ficha: Ficha = { ...draft, uses: list(lists.uses, 6), tags: list(lists.tags, 16).map((t) => t.toLowerCase()), tagsEn: list(lists.tagsEn, 12).map((t) => t.toLowerCase()), colors: list(lists.colors, 6) };
    start(async () => {
      const r = await updateFichaAction(clip.id, ficha);
      if (!r.ok) return void toast.error(r.error);
      if (r.data) onSaved(r.data.ficha);
      toast.success("Ficha guardada.");
      onOpenChange(false);
    });
  }

  const id = (k: string) => `ficha-${clip.id}-${k}`;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      dismissOnBackdrop={false}
      title={`Ficha de «${clip.title}»`}
      description="Lo que la IA vio en esta pieza. Corrígelo si algo no está bien: el editor elige y busca con esto."
      className="max-w-3xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {canEdit ? "Cancelar" : "Cerrar"}
          </Button>
          {canEdit && (
            <Button onClick={save} disabled={pending}>
              {pending ? "Guardando…" : "Guardar ficha"}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
          <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
            {!media ? (
              <Skeleton className="aspect-[9/12] w-full" />
            ) : media.mediaUrl && clip.kind === "video" ? (
              <video src={media.mediaUrl} controls muted playsInline preload="metadata" className="max-h-72 w-full object-contain" aria-label={`Clip ${clip.title}`} />
            ) : media.mediaUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={media.mediaUrl} alt={clip.title} className="max-h-72 w-full object-contain" />
            ) : null}
          </div>
          <Field label="Qué se ve" htmlFor={id("desc")}>
            <Textarea id={id("desc")} value={draft.description} maxLength={600} disabled={!canEdit} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} className="!min-h-36 text-sm" />
          </Field>
        </div>

        {clip.kind === "video" && (
          <section aria-labelledby={id("mom")} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 id={id("mom")} className="text-sm font-semibold text-white">
                Momentos del clip
              </h3>
              {canEdit && draft.moments.length < 16 && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Plus className="h-3.5 w-3.5" aria-hidden />}
                  onClick={() => setDraft((d) => {
                    const from = d.moments.at(-1)?.end ?? 0;
                    return { ...d, moments: [...d.moments, { start: Math.min(from, dur), end: Math.min(dur || from + 2, from + 2), what: "" }] };
                  })}
                >
                  Agregar momento
                </Button>
              )}
            </div>
            <p className="text-xs text-muted">Cada tramo con lo que se ve, en segundos del clip. El editor pone el clip desde el momento que muestra lo que dices.</p>
            {draft.moments.length === 0 && <p className="text-xs text-muted">Sin momentos todavía.</p>}
            <ul className="flex flex-col gap-2">
              {draft.moments.map((m, i) => (
                <li key={i} className="grid grid-cols-[4.5rem_4.5rem_1fr_auto] items-center gap-2">
                  <Input aria-label={`Desde (segundos) del momento ${i + 1}`} type="number" step="0.1" min={0} max={dur || 600} value={m.start} disabled={!canEdit} onChange={(e) => setMoment(i, { start: Number(e.target.value) })} className="!h-9 !text-sm" />
                  <Input aria-label={`Hasta (segundos) del momento ${i + 1}`} type="number" step="0.1" min={0} max={dur || 600} value={m.end} disabled={!canEdit} onChange={(e) => setMoment(i, { end: Number(e.target.value) })} className="!h-9 !text-sm" />
                  <Input aria-label={`Qué se ve en el momento ${i + 1}`} value={m.what} maxLength={240} disabled={!canEdit} onChange={(e) => setMoment(i, { what: e.target.value })} className="!h-9 !text-sm" />
                  {canEdit ? (
                    <button type="button" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-white/[0.06] hover:text-white" aria-label={`Quitar el momento ${i + 1}`} onClick={() => setDraft((d) => ({ ...d, moments: d.moments.filter((_, k) => k !== i) }))}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Estilo y encuadre" htmlFor={id("style")}>
            <Input id={id("style")} value={draft.style} maxLength={300} disabled={!canEdit} onChange={(e) => setDraft((d) => ({ ...d, style: e.target.value }))} />
          </Field>
          <Field label="Colores" htmlFor={id("colors")} hint="Separados por comas (#1f2a44, #f2f2f2).">
            <div className="flex items-center gap-2">
              <span className="flex flex-none gap-1" aria-hidden>
                {list(lists.colors, 6).map((c) => (
                  <span key={c} className="h-6 w-6 rounded-md border border-white/10" style={{ background: /^#[0-9a-f]{6}$/i.test(c) ? c : undefined }} />
                ))}
              </span>
              <Input id={id("colors")} value={lists.colors} disabled={!canEdit} onChange={(e) => setLists((l) => ({ ...l, colors: e.target.value }))} />
            </div>
          </Field>
          <Field label="Para qué sirve" htmlFor={id("uses")} hint="Temas de los que puedes hablar mientras se ve, separados por comas.">
            <Input id={id("uses")} value={lists.uses} disabled={!canEdit} onChange={(e) => setLists((l) => ({ ...l, uses: e.target.value }))} />
          </Field>
          <Field label="Etiquetas" htmlFor={id("tags")} hint="Separadas por comas.">
            <Input id={id("tags")} value={lists.tags} disabled={!canEdit} onChange={(e) => setLists((l) => ({ ...l, tags: e.target.value }))} />
          </Field>
          <Field label="Etiquetas en inglés" htmlFor={id("tagsen")} hint="Ayudan a encontrarla junto al stock.">
            <Input id={id("tagsen")} value={lists.tagsEn} disabled={!canEdit} onChange={(e) => setLists((l) => ({ ...l, tagsEn: e.target.value }))} />
          </Field>
        </div>

        {media && media.sheetUrls.length > 0 && (
          <details className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <summary className="cursor-pointer text-xs font-semibold text-muted">Cuadros que miró la IA</summary>
            <div className="mt-3 flex flex-col gap-2">
              {media.sheetUrls.map((u, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={u} src={u} alt={`Hoja de cuadros ${i + 1}`} className="w-full rounded-lg" loading="lazy" />
              ))}
            </div>
          </details>
        )}
      </div>
    </Dialog>
  );
}
