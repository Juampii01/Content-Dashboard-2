"use client";

import { useState, useTransition } from "react";
import { Clapperboard, ExternalLink, Library, Play, RefreshCcw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { Notice, Skeleton } from "@/components/ui/feedback";
import { SegmentedControl } from "@/components/ui/tabs";
import { formatDuration } from "@/lib/format";
import type { OutputBroll } from "@/lib/video/effects";
import type { BrollItem, BrollOption, VideoFormat, Word } from "@/lib/video/types";
import { cn } from "@/lib/utils";
import { libraryOptionsAction, searchBrollAction } from "./media-actions";

/** Alternativa con las URLs listas para el navegador (las de la biblioteca vienen firmadas). */
export type SignedOption = BrollOption & { thumbUrl: string | null; previewUrl: string | null };
export const optionKey = (o: Pick<BrollOption, "source" | "id">) => `${o.source}:${o.id}`;

/**
 * Lista de b-roll de la revisión: cada toma con su miniatura, el texto que tapa, su origen (con la atribución
 * de Pexels) y las acciones para cambiarla, moverla o quitarla.
 */
export function BrollPanel({
  items,
  segments,
  signed,
  words,
  corrections,
  canEdit,
  activeId,
  onActivate,
  onRemove,
  onChange,
  format,
}: {
  items: BrollItem[];
  segments: OutputBroll[];
  signed: Record<string, SignedOption>;
  words: Word[];
  corrections: Record<string, string>;
  canEdit: boolean;
  activeId: string | null;
  onActivate: (id: string) => void;
  onRemove: (id: string) => void;
  onChange: (id: string) => void;
  format: VideoFormat;
}) {
  return (
    <section aria-labelledby="broll-title" className="flex flex-col gap-3">
      <div>
        <h2 id="broll-title" className="text-base font-semibold">
          B-roll
        </h2>
        <p className="text-sm text-muted">Tomas de apoyo sobre lo que dices; tu voz sigue debajo. Cámbialas, quítalas o agrega otras seleccionando palabras en el texto.</p>
      </div>
      {items.length === 0 ? (
        <p className="card p-4 text-sm text-muted">
          Este video no tiene b-roll. Selecciona unas palabras en la transcripción y toca <span className="font-semibold text-white">Poner b-roll aquí</span>.
        </p>
      ) : (
        <ul className={cn("grid gap-2", format === "9:16" ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3")}>
          {items.map((item) => {
            const choice = item.choice ? (signed[optionKey(item.choice)] ?? { ...item.choice, thumbUrl: item.choice.thumb ?? null, previewUrl: item.choice.preview ?? null }) : null;
            const seg = segments.find((s) => s.id === item.id);
            const text = words.slice(item.from_word, item.to_word + 1).map((w) => corrections[String(w.id)] ?? w.text).join(" ");
            return (
              <li key={item.id}>
                <div className={cn("card flex h-full gap-3 p-3 transition", activeId === item.id && "!border-accent bg-accent/10")}>
                  <button type="button" onClick={() => onActivate(item.id)} className="relative aspect-[9/16] w-14 flex-none overflow-hidden rounded-lg bg-black/40" aria-label="Ver este b-roll en la vista previa">
                    {choice?.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={choice.thumbUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Clapperboard className="m-auto mt-6 h-5 w-5 text-placeholder" aria-hidden />
                    )}
                    <span className="absolute inset-0 grid place-items-center bg-black/20 opacity-0 transition hover:opacity-100">
                      <Play className="h-4 w-4 text-white" aria-hidden />
                    </span>
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="line-clamp-2 text-sm font-semibold text-white">“{text}”</p>
                    <p className="font-mono text-[11px] text-muted">
                      {seg ? `${formatDuration(seg.start)}–${formatDuration(seg.end)}` : choice ? "Cae sobre palabras cortadas" : "Sin clip"}
                    </p>
                    {choice ? <SourceLine option={choice} /> : <p className="text-xs text-warning">Elige un clip o quítalo.</p>}
                    {canEdit && (
                      <div className="mt-auto flex flex-wrap gap-1 pt-1">
                        <Button size="sm" variant="ghost" className="!h-8 !px-2.5" icon={<RefreshCcw className="h-3.5 w-3.5" aria-hidden />} onClick={() => onChange(item.id)}>
                          Cambiar
                        </Button>
                        <Button size="sm" variant="subtle" className="!h-8 !px-2.5" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => onRemove(item.id)} aria-label="Quitar este b-roll">
                          Quitar
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Origen del clip; los de Pexels llevan la atribución que pide su guía. */
function SourceLine({ option }: { option: BrollOption }) {
  if (option.source === "library") {
    return (
      <p className="flex items-center gap-1 truncate text-xs text-muted">
        <Library className="h-3 w-3 flex-none" aria-hidden />
        <span className="truncate">Tu biblioteca · {option.title ?? "clip"}</span>
      </p>
    );
  }
  return (
    <p className="truncate text-xs text-muted">
      <a href={option.credit?.page ?? stockHome(option.source)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-accent-hi hover:underline">
        Video de {option.credit?.name ?? stockLabel(option.source)} en {stockLabel(option.source)} <ExternalLink className="h-3 w-3" aria-hidden />
      </a>
    </p>
  );
}

const stockLabel = (source: BrollOption["source"]) => (source === "pixabay" ? "Pixabay" : "Pexels");
const stockHome = (source: BrollOption["source"]) => (source === "pixabay" ? "https://pixabay.com" : "https://www.pexels.com");

type Tab = "sugeridos" | "biblioteca" | "buscar";

/** Selector de clip para un tramo: sugeridos (4 a 6), los de la biblioteca o una búsqueda nueva. */
export function BrollPicker({
  item,
  signed,
  format,
  minDuration,
  onPick,
  onClose,
}: {
  item: BrollItem | null;
  signed: Record<string, SignedOption>;
  format: VideoFormat;
  minDuration: number;
  onPick: (option: SignedOption) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("sugeridos");
  const [library, setLibrary] = useState<SignedOption[] | null>(null);
  const [results, setResults] = useState<SignedOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [previewing, setPreviewing] = useState<string | null>(null);

  if (!item) return null;
  const suggested = item.options.map((o) => signed[optionKey(o)] ?? { ...o, thumbUrl: o.thumb ?? null, previewUrl: o.preview ?? null });

  function openLibrary() {
    setTab("biblioteca");
    if (library) return;
    start(async () => {
      const r = await libraryOptionsAction();
      if (r.ok && r.data) setLibrary(r.data.options);
      else setNotice(r.ok ? null : r.error);
    });
  }

  function search() {
    setNotice(null);
    start(async () => {
      const r = await searchBrollAction({ query: query || item!.query_en, keywords: item!.keywords, format, minDuration });
      if (!r.ok) {
        setNotice(r.error);
        return;
      }
      setResults(r.data?.options ?? []);
      setNotice(r.data?.warning ?? null);
    });
  }

  const list = tab === "sugeridos" ? suggested : tab === "biblioteca" ? library : results;
  return (
    <Dialog
      open={Boolean(item)}
      onOpenChange={(open) => !open && onClose()}
      title="Elige el b-roll"
      description={`Para “${item.query_en}”. Toca un clip para usarlo; con el botón de reproducir lo ves antes.`}
      className="max-w-3xl"
    >
      <div className="flex flex-col gap-4">
        <SegmentedControl
          label="Origen de los clips"
          value={tab}
          onValueChange={(v) => (v === "biblioteca" ? openLibrary() : setTab(v))}
          options={[
            { value: "sugeridos", label: "Sugeridos" },
            { value: "biblioteca", label: "Mi biblioteca" },
            { value: "buscar", label: "Buscar" },
          ]}
        />
        {tab === "buscar" && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <label htmlFor="broll-query" className="sr-only">
              Qué quieres mostrar
            </label>
            <Input id="broll-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Por ejemplo: ${item.query_en}`} maxLength={100} />
            <Button type="submit" disabled={pending} icon={<Search className="h-4 w-4" aria-hidden />}>
              Buscar
            </Button>
          </form>
        )}
        {tab === "buscar" && <p className="-mt-2 text-xs text-muted">En inglés encuentra más videos de stock. También busca en las etiquetas de tu biblioteca.</p>}
        {notice && <Notice tone="warning">{notice}</Notice>}
        {pending && !list ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="aspect-[9/16]" />
            ))}
          </div>
        ) : list && list.length > 0 ? (
          <ul className={cn("grid gap-3", format === "9:16" ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-1 sm:grid-cols-2")}>
            {list.map((o) => {
              const chosen = item.choice && optionKey(item.choice) === optionKey(o);
              const key = optionKey(o);
              return (
                <li key={key}>
                  <div className={cn("group relative overflow-hidden rounded-xl border bg-black/40", chosen ? "border-accent ring-2 ring-accent/60" : "border-white/10")}>
                    <button type="button" onClick={() => onPick(o)} className={cn("block w-full", format === "9:16" ? "aspect-[9/16]" : "aspect-video")} aria-label={`Usar ${o.source !== "library" ? `el video de ${o.credit?.name ?? stockLabel(o.source)}` : (o.title ?? "este clip")}`}>
                      {previewing === key && o.previewUrl ? (
                        <video src={o.previewUrl} autoPlay muted loop playsInline className="h-full w-full object-cover" />
                      ) : o.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={o.thumbUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <Clapperboard className="m-auto h-6 w-6 text-placeholder" aria-hidden />
                      )}
                    </button>
                    {chosen && <span className="pointer-events-none absolute top-2 left-2 rounded-md bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-white">Elegido</span>}
                    {o.previewUrl && (
                      <button
                        type="button"
                        onClick={() => setPreviewing(previewing === key ? null : key)}
                        className="absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
                        aria-label={previewing === key ? "Detener la vista previa" : "Ver el clip"}
                      >
                        <Play className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    )}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pt-6 pb-1.5 text-[11px] text-white">
                      <span className="font-mono">{formatDuration(o.duration)}</span> · {o.source !== "library" ? `${o.credit?.name ?? stockLabel(o.source)} · ${stockLabel(o.source)}` : (o.title ?? "Tu biblioteca")}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-white/10 p-4 text-sm text-muted">
            {tab === "biblioteca" ? "Tu biblioteca no tiene clips listos. Súbelos en Editor → Biblioteca de b-roll." : tab === "buscar" ? (results ? "No encontramos clips. Prueba con otras palabras." : "Escribe qué quieres mostrar y toca Buscar.") : "No hay sugerencias para este tramo. Busca otra cosa o elige uno de tu biblioteca."}
          </p>
        )}
      </div>
    </Dialog>
  );
}
