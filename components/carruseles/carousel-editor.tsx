"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarPlus,
  Copy,
  CopyPlus,
  Download,
  GripVertical,
  Hash,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Section } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Progress } from "@/components/ui/feedback";
import { DropdownMenu } from "@/components/ui/menu";
import { toast } from "@/components/ui/toast";
import type { CarouselSlide } from "@/lib/db/schema";
import { carouselStatusLabel, type CarouselStatus } from "@/lib/carousels/labels";
import {
  blankSlide,
  FONTS,
  newSlideId,
  PALETTES,
  resolveTheme,
  SLIDE_TYPES,
  TEMPLATE_KEYS,
  TEMPLATES,
  brandPalette,
  type BrandLook,
  type FontKey,
  type SlideIdentity,
  type SlideType,
  type TemplateKey,
} from "@/lib/carousels/theme";
import { captionWithHashtags, LIMITS, normalizeHashtag, validateCarousel, type CarouselWarning } from "@/lib/carousels/validate";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  captionAction,
  coverOptionsAction,
  deleteCarouselAction,
  duplicateCarouselAction,
  markExportedAction,
  rewriteSlideAction,
  saveCarouselAction,
  setCarouselStatusAction,
  type CarouselDraft,
} from "./actions";
import { buildZip, downloadBlob, ensureFonts, slugify } from "./export";
import { ScaledSlide, Slide } from "./slide";

type Theme = { palette?: string; accent?: string; font?: string };
type Look = BrandLook & { identity: SlideIdentity; bannedWords: string[] };
type Cover = { kicker: string; headline: string; highlight: string; body: string };

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado.`);
  } catch {
    toast.error("No se pudo copiar. Selecciona el texto y cópialo a mano.");
  }
}

function WarningList({ items }: { items: CarouselWarning[] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-1.5 flex flex-col gap-1">
      {items.map((w, i) => (
        <li key={i} className="flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
          <span>{w.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function CarouselEditor({
  carouselId,
  initial,
  look,
  sourceText,
  ctaKeyword,
  script,
  canEdit,
}: {
  carouselId: string;
  initial: { title: string; status: CarouselStatus; template: TemplateKey; theme: Theme; slides: CarouselSlide[]; caption: string; hashtags: string[] };
  look: Look;
  sourceText: string | null;
  ctaKeyword: string | null;
  script: { id: string; title: string } | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [status, setStatus] = useState<CarouselStatus>(initial.status);
  const [template, setTemplate] = useState<TemplateKey>(initial.template);
  const [theme, setTheme] = useState<Theme>(initial.theme);
  const [slides, setSlides] = useState<CarouselSlide[]>(initial.slides);
  const [caption, setCaption] = useState(initial.caption);
  const [hashtagText, setHashtagText] = useState(initial.hashtags.join(" "));
  const [selectedId, setSelectedId] = useState(initial.slides[0]?.id ?? "");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [rewrite, setRewrite] = useState<{ id: string; instruction: string } | null>(null);
  const [covers, setCovers] = useState<Cover[] | null>(null);
  const [coversOpen, setCoversOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const hashtags = useMemo(() => hashtagText.split(/[\s,]+/).map(normalizeHashtag).filter(Boolean), [hashtagText]);
  const resolved = useMemo(() => resolveTheme(theme as Record<string, string>, look), [theme, look]);
  const warnings = useMemo(() => validateCarousel({ slides, caption, hashtags, bannedWords: look.bannedWords, sourceText }), [slides, caption, hashtags, look.bannedWords, sourceText]);
  const selectedIndex = Math.max(0, slides.findIndex((s) => s.id === selectedId));
  const selected = slides[selectedIndex];
  const templateOf = (s: CarouselSlide): TemplateKey => (s.template && s.template in TEMPLATES ? (s.template as TemplateKey) : template);
  const slideWarnings = (id: string) => warnings.filter((w) => w.slideId === id);
  const globalWarnings = warnings.filter((w) => w.slideId === null);

  const touch = () => setDirty(true);
  const updateSlides = (fn: (s: CarouselSlide[]) => CarouselSlide[]) => {
    setSlides((s) => fn(structuredClone(s)));
    touch();
  };
  const patchSlide = (id: string, patch: Partial<CarouselSlide>) => updateSlides((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  // Aviso al salir con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const draft = (): CarouselDraft => ({ title: title.trim() || "Carrusel sin título", template, theme: theme as CarouselDraft["theme"], slides, caption, hashtags });

  async function save(silent = false): Promise<boolean> {
    const res = await saveCarouselAction(carouselId, draft());
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    setDirty(false);
    if (!silent) toast.success("Carrusel guardado.");
    router.refresh();
    return true;
  }

  // Guardar con Ctrl/Cmd + S.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (canEdit) void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit]);

  function move(id: string, delta: number) {
    updateSlides((list) => {
      const i = list.findIndex((s) => s.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) return list;
      [list[i], list[j]] = [list[j]!, list[i]!];
      return list;
    });
  }

  function dropOn(targetId: string) {
    if (!dragId || dragId === targetId) return;
    updateSlides((list) => {
      const from = list.findIndex((s) => s.id === dragId);
      const to = list.findIndex((s) => s.id === targetId);
      if (from < 0 || to < 0) return list;
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item!);
      return list;
    });
    setDragId(null);
  }

  function duplicate(id: string) {
    const copyId = newSlideId();
    updateSlides((list) => {
      const i = list.findIndex((s) => s.id === id);
      if (i < 0) return list;
      list.splice(i + 1, 0, { ...list[i]!, id: copyId });
      return list;
    });
    setSelectedId(copyId);
  }

  function remove(id: string) {
    const i = slides.findIndex((s) => s.id === id);
    updateSlides((list) => list.filter((s) => s.id !== id));
    const next = slides[i + 1] ?? slides[i - 1];
    if (next) setSelectedId(next.id);
  }

  function add() {
    const slide = blankSlide("item");
    updateSlides((list) => {
      // Antes del cierre, si el último es el CTA.
      const at = list[list.length - 1]?.type === "cta" ? list.length - 1 : list.length;
      list.splice(at, 0, slide);
      return list;
    });
    setSelectedId(slide.id);
  }

  function runRewrite(id: string, instruction: string) {
    setBusy(`slide-${id}`);
    startTransition(async () => {
      const res = await rewriteSlideAction(carouselId, slides, id, instruction);
      setBusy(null);
      if (!res.ok) return void toast.error(res.error);
      if (res.data) patchSlide(id, res.data);
      toast.success("Slide reescrito. Revisa y guarda.");
    });
  }

  function loadCovers() {
    setCovers(null);
    setCoversOpen(true);
    setBusy("portada");
    startTransition(async () => {
      const res = await coverOptionsAction(carouselId, slides);
      setBusy(null);
      if (!res.ok) {
        setCoversOpen(false);
        return void toast.error(res.error);
      }
      setCovers(res.data ?? []);
    });
  }

  function runCaption() {
    setBusy("caption");
    startTransition(async () => {
      const res = await captionAction(carouselId, slides);
      setBusy(null);
      if (!res.ok) return void toast.error(res.error);
      if (res.data) {
        setCaption(res.data.caption);
        setHashtagText(res.data.hashtags.join(" "));
        touch();
      }
      toast.success("Caption nuevo. Revisa y guarda.");
    });
  }

  function changeStatus(next: CarouselStatus) {
    setStatus(next);
    startTransition(async () => {
      const res = await setCarouselStatusAction(carouselId, next);
      if (!res.ok) toast.error(res.error);
    });
  }

  async function exportZip() {
    if (dirty && canEdit && !(await save(true))) return;
    setBusy("export");
    setExporting({ done: 0, total: slides.length });
    try {
      await ensureFonts(resolved.font);
      // Dos cuadros para que el escenario de exportación se monte y ajuste el texto con las fuentes ya cargadas.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const nodes = Array.from(stageRef.current?.querySelectorAll<HTMLElement>("[data-slide]") ?? []);
      if (nodes.length !== slides.length) throw new Error("stage");
      const blob = await buildZip(nodes, {
        background: resolved.bg,
        captionText: captionWithHashtags(caption, hashtags),
        onProgress: (done, total) => setExporting({ done, total }),
      });
      downloadBlob(blob, `${slugify(title)}.zip`);
      if (canEdit) {
        const res = await markExportedAction(carouselId);
        if (res.ok) setStatus("EXPORTED");
      }
      toast.success(`Listo: ${slides.length} imágenes de 1080 × 1350 y el caption en un ZIP.`);
    } catch (error) {
      console.error("[carruseles] exportar", error);
      toast.error("No pudimos armar las imágenes. Recarga la página y prueba de nuevo; si sigue, prueba con Chrome.");
    } finally {
      setBusy(null);
      setExporting(null);
    }
  }

  function doDuplicate() {
    startTransition(async () => {
      const res = await duplicateCarouselAction(carouselId);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Carrusel duplicado.");
      router.push(`/carruseles/${res.data}`);
    });
  }

  function doDelete() {
    startTransition(async () => {
      const res = await deleteCarouselAction(carouselId);
      if (!res.ok) return void toast.error(res.error);
      setDirty(false);
      toast.success("Carrusel borrado.");
      router.push("/carruseles");
    });
  }

  const disabled = !canEdit || busy !== null;
  const ws = selected ? slideWarnings(selected.id) : [];
  const fieldWarnings = (field: CarouselWarning["field"]) => ws.filter((w) => w.field === field);
  const marca = brandPalette(look.colors);

  return (
    <div className="flex flex-col gap-6 pb-24">
      {/* Cabecera */}
      <div className="card flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <Input aria-label="Título del carrusel" value={title} onChange={(e) => (setTitle(e.target.value), touch())} disabled={!canEdit} className="!border-transparent !bg-transparent !px-0 text-xl font-bold text-white" />
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              <span>
                {slides.length} slides · 1080 × 1350
              </span>
              {ctaKeyword && <span>· Palabra clave: <strong className="font-mono text-white">{ctaKeyword}</strong></span>}
              {script && (
                <a href={`/guiones/${script.id}`} className="text-accent-hi hover:text-white">
                  · Desde el guion: {script.title}
                </a>
              )}
              {warnings.length > 0 ? (
                <span className="flex items-center gap-1 text-warning">
                  · <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {warnings.length === 1 ? "1 aviso" : `${warnings.length} avisos`}
                </span>
              ) : (
                <span className="text-success">· Sin avisos</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Estado" value={status} onChange={(e) => changeStatus(e.target.value as CarouselStatus)} disabled={!canEdit} className="!w-auto !py-2 text-sm">
              {(Object.keys(carouselStatusLabel) as CarouselStatus[]).map((s) => (
                <option key={s} value={s}>
                  {carouselStatusLabel[s]}
                </option>
              ))}
            </Select>
            <Button onClick={() => void exportZip()} disabled={busy !== null || slides.length === 0} icon={<Download className="h-4 w-4" aria-hidden />}>
              {exporting ? `Preparando ${exporting.done} de ${exporting.total}…` : "Descargar ZIP"}
            </Button>
            <DropdownMenu
              label="Más acciones"
              align="end"
              trigger={<MoreHorizontal className="h-4 w-4" aria-hidden />}
              items={[
                { label: "Copiar caption", icon: <Copy className="h-4 w-4" />, onSelect: () => void copy(captionWithHashtags(caption, hashtags), "Caption") },
                { label: "Programar en Calendario", icon: <CalendarPlus className="h-4 w-4" />, onSelect: () => router.push(`/calendario?nuevo=1&carrusel=${carouselId}`) },
                { label: "Duplicar carrusel", icon: <CopyPlus className="h-4 w-4" />, onSelect: doDuplicate, disabled: !canEdit },
                { type: "separator" },
                { label: "Borrar carrusel", icon: <Trash2 className="h-4 w-4" />, onSelect: () => setConfirmDelete(true), disabled: !canEdit, danger: true },
              ]}
            />
          </div>
        </div>
        {exporting && <Progress value={(exporting.done / Math.max(1, exporting.total)) * 100} label="Dibujando tus slides en 1080 × 1350" />}
      </div>

      {/* Tira de miniaturas: navegación en el teléfono y vista de conjunto en la computadora */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1" role="listbox" aria-label="Slides del carrusel" aria-orientation="horizontal">
        <div className="flex gap-3">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={s.id === selected?.id}
              onClick={() => setSelectedId(s.id)}
              className={cn("relative w-[104px] flex-none overflow-hidden rounded-xl border-2 transition sm:w-[120px]", s.id === selected?.id ? "border-accent-hi" : "border-white/10 hover:border-white/30")}
            >
              <ScaledSlide slide={s} index={i} total={slides.length} template={templateOf(s)} theme={resolved} identity={look.identity} label={`Slide ${i + 1}`} />
              <span className="absolute top-1 left-1 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">{i + 1}</span>
              {slideWarnings(s.id).length > 0 && (
                <span className="absolute top-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-warning text-[10px] font-bold text-bg" title="Tiene avisos">
                  !
                </span>
              )}
            </button>
          ))}
          {canEdit && slides.length < 20 && (
            <button type="button" onClick={add} disabled={disabled} className="grid aspect-[4/5] w-[104px] flex-none place-items-center rounded-xl border-2 border-dashed border-white/15 text-muted transition hover:border-white/35 hover:text-white sm:w-[120px]" aria-label="Agregar slide">
              <Plus className="h-5 w-5" aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)_minmax(0,380px)] xl:grid-cols-[220px_minmax(0,1fr)_400px]">
        {/* Lista de slides */}
        <aside className="hidden lg:block" aria-label="Orden de los slides">
          <ol className="flex flex-col gap-1.5">
            {slides.map((s, i) => {
              const active = s.id === selected?.id;
              const n = slideWarnings(s.id).length;
              return (
                <li
                  key={s.id}
                  draggable={canEdit}
                  onDragStart={() => setDragId(s.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dropOn(s.id)}
                  onDragEnd={() => setDragId(null)}
                  className={cn("group rounded-xl border transition", active ? "border-accent/60 bg-accent/12" : "border-white/8 hover:border-white/20", dragId === s.id && "opacity-50")}
                >
                  <button type="button" onClick={() => setSelectedId(s.id)} className="flex w-full items-start gap-2 px-2.5 py-2 text-left" aria-current={active ? "true" : undefined}>
                    {canEdit && <GripVertical className="mt-0.5 h-4 w-4 flex-none cursor-grab text-placeholder" aria-hidden />}
                    <span className="font-mono text-[11px] font-bold text-accent-glow">{String(i + 1).padStart(2, "0")}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-semibold tracking-wide text-muted uppercase">{SLIDE_TYPES[s.type]}</span>
                      <span className="line-clamp-2 text-xs text-white">{s.headline || "Sin titular"}</span>
                    </span>
                    {n > 0 && <AlertTriangle className="h-3.5 w-3.5 flex-none text-warning" aria-label={`${n} avisos`} />}
                  </button>
                  {canEdit && active && (
                    <div className="flex items-center gap-0.5 border-t border-white/8 px-1.5 py-1">
                      <Button variant="subtle" size="sm" aria-label="Subir slide" disabled={i === 0 || disabled} onClick={() => move(s.id, -1)} className="!px-2">
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      <Button variant="subtle" size="sm" aria-label="Bajar slide" disabled={i === slides.length - 1 || disabled} onClick={() => move(s.id, 1)} className="!px-2">
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      <Button variant="subtle" size="sm" aria-label="Duplicar slide" disabled={disabled || slides.length >= 20} onClick={() => duplicate(s.id)} className="!px-2">
                        <CopyPlus className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      <Button variant="subtle" size="sm" aria-label="Borrar slide" disabled={disabled || slides.length <= 1} onClick={() => remove(s.id)} className="!px-2">
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {canEdit && (
            <Button variant="ghost" size="sm" className="mt-3 w-full" disabled={disabled || slides.length >= 20} onClick={add} icon={<Plus className="h-3.5 w-3.5" aria-hidden />}>
              Agregar slide
            </Button>
          )}
        </aside>

        {/* Campos del slide */}
        {selected && (
          <Section
            className="order-2 lg:order-none !p-5"
            title={`Slide ${selectedIndex + 1} · ${SLIDE_TYPES[selected.type]}`}
            actions={
              canEdit && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedIndex === 0 && (
                    <Button variant="ghost" size="sm" disabled={disabled} onClick={loadCovers} icon={<RefreshCw className={cn("h-3.5 w-3.5", busy === "portada" && "animate-spin")} aria-hidden />}>
                      Otra portada
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setRewrite({ id: selected.id, instruction: "" })} icon={<Wand2 className={cn("h-3.5 w-3.5", busy === `slide-${selected.id}` && "animate-pulse")} aria-hidden />}>
                    {busy === `slide-${selected.id}` ? "Reescribiendo…" : "Reescribir"}
                  </Button>
                </div>
              )
            }
          >
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Tipo" htmlFor="s-type">
                  <Select id="s-type" value={selected.type} onChange={(e) => patchSlide(selected.id, { type: e.target.value as SlideType })} disabled={!canEdit}>
                    {(Object.keys(SLIDE_TYPES) as SlideType[]).map((t) => (
                      <option key={t} value={t}>
                        {SLIDE_TYPES[t]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Plantilla de este slide" htmlFor="s-template">
                  <Select id="s-template" value={selected.template ?? ""} onChange={(e) => patchSlide(selected.id, { template: e.target.value || null })} disabled={!canEdit}>
                    <option value="">Igual al carrusel</option>
                    {TEMPLATE_KEYS.map((t) => (
                      <option key={t} value={t}>
                        {TEMPLATES[t].label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div>
                <Field label="Etiqueta superior" htmlFor="s-kicker" hint="Opcional. Corta: “Error #2”, “Paso 3”.">
                  <Input id="s-kicker" value={selected.kicker} onChange={(e) => patchSlide(selected.id, { kicker: e.target.value })} disabled={!canEdit} />
                </Field>
                <WarningList items={fieldWarnings("kicker")} />
              </div>
              <div>
                <Field label="Titular" htmlFor="s-headline">
                  <Textarea id="s-headline" value={selected.headline} onChange={(e) => patchSlide(selected.id, { headline: e.target.value })} disabled={!canEdit} className="!min-h-20 text-[15px] font-semibold" />
                </Field>
                <p className="mt-1 text-right font-mono text-[11px] text-placeholder">
                  {selected.headline.trim().length}/{LIMITS.headline}
                </p>
                <WarningList items={[...fieldWarnings("headline"), ...fieldWarnings("slides")]} />
              </div>
              <div>
                <Field label="Resaltado" htmlFor="s-highlight" hint="Una palabra o frase del titular que va en color.">
                  <Input id="s-highlight" value={selected.highlight} onChange={(e) => patchSlide(selected.id, { highlight: e.target.value })} disabled={!canEdit} />
                </Field>
                <WarningList items={fieldWarnings("highlight")} />
              </div>
              <div>
                <Field label="Texto de apoyo" htmlFor="s-body">
                  <Textarea id="s-body" value={selected.body} onChange={(e) => patchSlide(selected.id, { body: e.target.value })} disabled={!canEdit} className="!min-h-24" />
                </Field>
                <p className="mt-1 text-right font-mono text-[11px] text-placeholder">
                  {selected.body.trim().length}/{LIMITS.body}
                </p>
                <WarningList items={fieldWarnings("body")} />
              </div>
              {(selected.type === "cta" || selected.cta) && (
                <div>
                  <Field label="Llamado a la acción" htmlFor="s-cta" hint={ctaKeyword ? `Incluye tu palabra clave: ${ctaKeyword}.` : "Por ejemplo: Guárdalo para tu próxima llamada."}>
                    <Input id="s-cta" value={selected.cta} onChange={(e) => patchSlide(selected.id, { cta: e.target.value })} disabled={!canEdit} />
                  </Field>
                  <WarningList items={fieldWarnings("cta")} />
                </div>
              )}
              {canEdit && (
                <div className="flex flex-wrap gap-1.5 border-t border-white/8 pt-3 lg:hidden">
                  <Button variant="subtle" size="sm" disabled={selectedIndex === 0 || disabled} onClick={() => move(selected.id, -1)} icon={<ArrowUp className="h-3.5 w-3.5" aria-hidden />}>
                    Subir
                  </Button>
                  <Button variant="subtle" size="sm" disabled={selectedIndex === slides.length - 1 || disabled} onClick={() => move(selected.id, 1)} icon={<ArrowDown className="h-3.5 w-3.5" aria-hidden />}>
                    Bajar
                  </Button>
                  <Button variant="subtle" size="sm" disabled={disabled || slides.length >= 20} onClick={() => duplicate(selected.id)} icon={<CopyPlus className="h-3.5 w-3.5" aria-hidden />}>
                    Duplicar
                  </Button>
                  <Button variant="subtle" size="sm" disabled={disabled || slides.length <= 1} onClick={() => remove(selected.id)} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}>
                    Borrar
                  </Button>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Vista previa y diseño */}
        <div className="order-1 flex flex-col gap-4 lg:order-none lg:sticky lg:top-6 lg:self-start">
          {selected && (
            <div className="mx-auto w-full max-w-[400px] overflow-hidden rounded-2xl border border-white/10 shadow-[0_24px_60px_rgba(0,6,30,0.55)]">
              <ScaledSlide slide={selected} index={selectedIndex} total={slides.length} template={templateOf(selected)} theme={resolved} identity={look.identity} />
            </div>
          )}
          <div className="card flex flex-col gap-4 p-4">
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-white">Plantilla del carrusel</legend>
              <div className="grid grid-cols-5 gap-2">
                {TEMPLATE_KEYS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => (setTemplate(t), touch())}
                    disabled={!canEdit}
                    aria-pressed={template === t}
                    title={TEMPLATES[t].hint}
                    className={cn("flex flex-col gap-1 rounded-lg text-left transition disabled:cursor-not-allowed", template === t ? "text-white" : "text-muted hover:text-white")}
                  >
                    <span className={cn("block overflow-hidden rounded-md border-2", template === t ? "border-accent-hi" : "border-white/10")}>
                      {selected && <ScaledSlide slide={selected} index={selectedIndex} total={slides.length} template={t} theme={resolved} identity={look.identity} label={TEMPLATES[t].label} />}
                    </span>
                    <span className="truncate text-[10px] font-semibold">{TEMPLATES[t].label}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-white">Colores</legend>
              <div className="flex flex-wrap gap-2">
                {[["marca", { ...marca, label: "Mi marca" }] as const, ...Object.entries(PALETTES)].map(([key, p]) => {
                  const active = resolved.palette === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => (setTheme((t) => ({ ...t, palette: key, accent: undefined })), touch())}
                      aria-pressed={active}
                      className={cn("chip !gap-1.5 !px-2", active && "!border-accent-hi/70 !bg-accent/20 !text-white")}
                    >
                      <span className="flex overflow-hidden rounded-full border border-white/20" aria-hidden>
                        <span className="h-4 w-3" style={{ background: p.bg }} />
                        <span className="h-4 w-3" style={{ background: p.accent }} />
                      </span>
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <Field label="Fuente de los titulares" htmlFor="c-font">
                <Select id="c-font" value={resolved.font} onChange={(e) => (setTheme((t) => ({ ...t, font: e.target.value as FontKey })), touch())} disabled={!canEdit}>
                  {(Object.keys(FONTS) as FontKey[]).map((f) => (
                    <option key={f} value={f}>
                      {FONTS[f].label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Acento" htmlFor="c-accent">
                <input
                  id="c-accent"
                  type="color"
                  value={resolved.accent}
                  disabled={!canEdit}
                  onChange={(e) => (setTheme((t) => ({ ...t, accent: e.target.value })), touch())}
                  className="h-[46px] w-14 cursor-pointer rounded-xl border border-white/10 bg-black/30 p-1"
                />
              </Field>
            </div>
            {!look.colors && <p className="text-xs text-muted">“Mi marca” usa los colores de tu perfil de marca; mientras no los cargues, usa los de la app.</p>}
          </div>
        </div>
      </div>

      {/* Caption */}
      <Section
        title="Caption y hashtags"
        description="Lo que va debajo del carrusel. Se descarga en caption.txt junto con las imágenes."
        actions={
          <div className="flex flex-wrap gap-1.5">
            {canEdit && (
              <Button variant="ghost" size="sm" disabled={disabled} onClick={runCaption} icon={<Sparkles className={cn("h-3.5 w-3.5", busy === "caption" && "animate-pulse")} aria-hidden />}>
                {busy === "caption" ? "Escribiendo…" : "Nuevo caption"}
              </Button>
            )}
            <Button variant="subtle" size="sm" onClick={() => void copy(captionWithHashtags(caption, hashtags), "Caption")} icon={<Copy className="h-3.5 w-3.5" aria-hidden />}>
              Copiar caption
            </Button>
          </div>
        }
      >
        <div className="grid gap-4">
          <div>
            <Textarea aria-label="Caption" value={caption} onChange={(e) => (setCaption(e.target.value), touch())} disabled={!canEdit} className="!min-h-36" />
            <p className={cn("mt-1 text-right font-mono text-[11px]", caption.trim().length > LIMITS.caption ? "text-warning" : "text-placeholder")}>
              {formatNumber(caption.trim().length)}/{formatNumber(LIMITS.caption)}
            </p>
          </div>
          <Field label="Hashtags" htmlFor="c-tags" hint="Exactamente 5, separados por espacios.">
            <div className="relative">
              <Hash className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-placeholder" aria-hidden />
              <Input id="c-tags" value={hashtagText} onChange={(e) => (setHashtagText(e.target.value), touch())} disabled={!canEdit} className="!pl-10 font-mono text-sm" />
            </div>
          </Field>
          <WarningList items={globalWarnings} />
        </div>
      </Section>

      <div className="flex flex-wrap gap-2">
        <ButtonLink href={`/calendario?nuevo=1&carrusel=${carouselId}`} variant="ghost" icon={<CalendarPlus className="h-4 w-4" aria-hidden />}>
          Programar en Calendario
        </ButtonLink>
      </div>

      {canEdit && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-bg/90 px-4 py-3 backdrop-blur-xl lg:left-64">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <span className="text-sm text-muted" role="status">
              {busy === "export" ? "Armando el ZIP…" : busy ? "La IA está trabajando…" : dirty ? "Tienes cambios sin guardar." : "Todo guardado."}
            </span>
            <Button onClick={() => startTransition(async () => void (await save()))} disabled={!dirty || busy !== null} icon={<Save className="h-4 w-4" aria-hidden />}>
              Guardar
            </Button>
          </div>
        </div>
      )}

      {/* Escenario de exportación: los mismos slides a tamaño real, fuera de la pantalla */}
      {exporting && (
        <div ref={stageRef} aria-hidden style={{ position: "fixed", left: -30000, top: 0, pointerEvents: "none" }}>
          {slides.map((s, i) => (
            <div key={s.id} style={{ width: 1080, height: 1350 }}>
              <Slide slide={s} index={i} total={slides.length} template={templateOf(s)} theme={resolved} identity={look.identity} />
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={rewrite !== null}
        onOpenChange={(open) => !open && setRewrite(null)}
        title="Reescribir este slide"
        description="Dile qué cambiar o déjalo vacío para que lo haga más claro, concreto y corto."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRewrite(null)}>
              Cancelar
            </Button>
            <Button
              icon={<Wand2 className="h-4 w-4" aria-hidden />}
              onClick={() => {
                if (!rewrite) return;
                const { id, instruction } = rewrite;
                setRewrite(null);
                runRewrite(id, instruction);
              }}
            >
              Reescribir
            </Button>
          </>
        }
      >
        <Field label="Indicación (opcional)" htmlFor="slide-instruction">
          <Input id="slide-instruction" value={rewrite?.instruction ?? ""} onChange={(e) => setRewrite((r) => (r ? { ...r, instruction: e.target.value } : r))} placeholder="Más corto, con un ejemplo de un cliente, más polémico…" />
        </Field>
      </Dialog>

      <Dialog open={coversOpen} onOpenChange={setCoversOpen} title="Elige otra portada" description="Tres ganchos distintos para el primer slide. Al elegir uno, reemplaza la portada actual." className="!max-w-3xl">
        {!covers ? (
          <div className="grid gap-3 sm:grid-cols-3" aria-busy>
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton aspect-[4/5]" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {covers.map((c, i) => {
              const preview = { ...slides[0]!, ...c };
              return (
                <button
                  key={i}
                  type="button"
                  className="card card-lift overflow-hidden text-left"
                  onClick={() => {
                    patchSlide(slides[0]!.id, c);
                    setCoversOpen(false);
                    toast.success("Portada cambiada. Revisa y guarda.");
                  }}
                >
                  <ScaledSlide slide={preview} index={0} total={slides.length} template={templateOf(slides[0]!)} theme={resolved} identity={look.identity} />
                  <span className="block p-3 text-sm font-semibold text-white">{c.headline}</span>
                </button>
              );
            })}
          </div>
        )}
      </Dialog>

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="¿Borrar este carrusel?"
        description="Se borran sus slides y su caption. No se puede deshacer."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
            <Button
              className="!bg-none !bg-danger/80"
              icon={<Trash2 className="h-4 w-4" aria-hidden />}
              onClick={() => {
                setConfirmDelete(false);
                doDelete();
              }}
            >
              Borrar
            </Button>
          </>
        }
      />
    </div>
  );
}
