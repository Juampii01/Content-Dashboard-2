"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Copy, Download, ImagePlus, Loader2, RefreshCw, Sparkles, Star, Trash2, UserRound, Wand2 } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Section } from "@/components/ui/card";
import { Notice, Progress } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { formatMultiplier } from "@/lib/format";
import { isThumbFont, THUMB_FONTS, thumbTextIssues, thumbWords, type ThumbColors, type ThumbFontKey } from "@/lib/youtube/thumbnail-layout";
import { ANGLE_LABELS, checkTitle, TITLE_VISIBLE_MAX } from "@/lib/youtube/titles";
import type { ThumbnailConcept, ThumbnailLayoutKind, TitleBasis, TitleGroup } from "@/lib/youtube/types";
import { jobActive, useYtJob } from "@/lib/youtube/use-job";
import { generateBackgroundsAction, regenerateTitlesAction, removePhotoAction, retryCutoutAction, selectTitleAction, updateConceptAction } from "./actions";
import { captureThumbnail, downloadBlob, slugify } from "./export";
import { ScaledThumbnail, type CanvasPhoto } from "./thumbnail-canvas";

export type EditorPhoto = { key: string; url: string; cutoutUrl: string | null; cutoutStatus: "pending" | "ready" | "failed" | "none"; error: string | null };
export type EditorPackage = {
  id: string;
  title: string;
  format: "VIDEO" | "SHORT";
  sourceLabel: string;
  titles: TitleGroup[];
  titleBasis: TitleBasis | null;
  selectedTitle: string | null;
  concepts: (ThumbnailConcept & { backgroundUrl: string | null })[];
};

const LAYOUTS: { value: ThumbnailLayoutKind; label: string }[] = [
  { value: "texto-izquierda", label: "Texto a la izquierda" },
  { value: "texto-derecha", label: "Texto a la derecha" },
  { value: "texto-centro", label: "Texto al centro" },
];

/** Pantalla de un paquete: títulos por ángulo con su largo medido y 3 miniaturas editables y descargables. */
export function PackageEditor({
  pkg,
  photos,
  colors,
  brandFont,
  provider,
  initialJobId,
  canEdit,
  aiReady,
}: {
  pkg: EditorPackage;
  photos: EditorPhoto[];
  colors: ThumbColors;
  brandFont: ThumbFontKey;
  provider: { ready: boolean; label: string | null };
  initialJobId: string | null;
  canEdit: boolean;
  aiReady: boolean;
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(initialJobId);
  const [pending, start] = useTransition();
  const lastDone = useRef(0);

  const job = useYtJob(jobId, (state) => {
    const done = Array.isArray(state.output.done) ? state.output.done.length : 0;
    // Cada fondo aparece apenas sale, sin esperar a los demás.
    if (done !== lastDone.current) {
      lastDone.current = done;
      router.refresh();
    }
    if (jobActive(state)) return;
    if (state.status === "SUCCEEDED") toast.success("Listo: tus miniaturas ya tienen fondo.");
    else if (state.status === "FAILED") toast.error(state.error ?? "No pudimos generar los fondos.");
    setJobId(null);
    router.refresh();
  });

  // Mientras se recorta una foto, se vuelve a leer cada pocos segundos (el recorte tarda segundos).
  const cutting = photos.some((p) => p.cutoutStatus === "pending");
  useEffect(() => {
    if (!cutting) return;
    const t = setInterval(() => router.refresh(), 4000);
    const stop = setTimeout(() => clearInterval(t), 180_000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [cutting, router]);

  const generate = (conceptIds: string[]) =>
    start(async () => {
      const res = await generateBackgroundsAction(pkg.id, conceptIds);
      if (!res.ok) toast.error(res.error);
      else {
        lastDone.current = 0;
        setJobId(res.jobId);
        toast.info(conceptIds.length === 1 ? "Generando el fondo. Puedes salir y volver: te avisamos al terminar." : "Generando los fondos. Puedes salir y volver: te avisamos al terminar.");
      }
    });

  const missing = pkg.concepts.filter((c) => c.backgroundStatus !== "ready" && c.backgroundStatus !== "pending");
  const running = Boolean(jobId) && (!job || jobActive(job));

  return (
    <div className="flex flex-col gap-6">
      <TitlesSection pkg={pkg} canEdit={canEdit} aiReady={aiReady} />

      <Section
        title="Miniaturas"
        description="3 ideas con tu foto, tus colores y un texto grande de 2 a 4 palabras. El fondo lo genera tu ChatGPT (sin letras) y el texto lo dibuja la plantilla: lo cambias sin volver a generar."
        actions={
          canEdit && missing.length > 0 && provider.ready ? (
            <Button disabled={pending || running} onClick={() => generate(missing.map((c) => c.id))} icon={<Wand2 className="h-4 w-4" aria-hidden />}>
              {`Generar ${missing.length === 1 ? "el fondo" : `los ${missing.length} fondos`}`}
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-5">
          {!provider.ready && canEdit && (
            <Notice tone="warning" title="Para generar fondos, conecta tu ChatGPT">
              Mientras tanto usamos un fondo con los colores de tu marca: ya puedes descargar la miniatura.{" "}
              <ButtonLink href="/ajustes" variant="subtle" size="sm">
                Ir a Ajustes
              </ButtonLink>
            </Notice>
          )}
          {provider.ready && missing.length > 0 && !running && (
            <p className="text-xs text-muted">
              Cada fondo usa 1 imagen de {provider.label ?? "tu cuenta"}. Mientras no lo generes, la miniatura usa un fondo con los colores de tu marca.
            </p>
          )}
          {running && (
            <div className="rounded-xl border border-line p-4" role="status">
              <Progress value={job?.progress ?? 0} label={job?.retrying ? `Reintentando: ${job.retrying}` : (job?.stage ?? "En cola")} />
              <p className="mt-2 text-xs text-muted">Puedes salir de esta pantalla: te avisamos cuando estén listos.</p>
            </div>
          )}
          <PhotosStrip photos={photos} canEdit={canEdit} />
          <div className="grid gap-5 xl:grid-cols-3">
            {pkg.concepts.map((c, i) => (
              <ConceptCard key={c.id} index={i} packageId={pkg.id} concept={c} photos={photos} colors={colors} brandFont={brandFont} canEdit={canEdit} providerReady={provider.ready} busy={pending || running} onRegenerate={() => generate([c.id])} title={pkg.selectedTitle ?? pkg.title} />
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}

// ─── Títulos ──────────────────────────────────────────────────────────────

function TitlesSection({ pkg, canEdit, aiReady }: { pkg: EditorPackage; canEdit: boolean; aiReady: boolean }) {
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState(pkg.selectedTitle);
  const total = pkg.titles.reduce((n, g) => n + g.options.length, 0);

  const choose = (text: string) => {
    const next = selected === text ? null : text;
    setSelected(next);
    start(async () => {
      const res = await selectTitleAction(pkg.id, next);
      if (!res.ok) toast.error(res.error);
    });
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Título copiado.");
    } catch {
      toast.error("No pudimos copiar. Selecciona el texto y cópialo a mano.");
    }
  };

  return (
    <Section
      title={`Títulos (${total})`}
      description={`Agrupados por ángulo. Hasta ${TITLE_VISIBLE_MAX} caracteres se ven completos en el teléfono; lo que pasa de ahí se corta.`}
      actions={
        canEdit && aiReady ? (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await regenerateTitlesAction(pkg.id);
                if (!res.ok) toast.error(res.error);
                else toast.success("Listo: te escribimos otros títulos.");
              })
            }
            icon={<RefreshCw className={pending ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden />}
          >
            Otros títulos
          </Button>
        ) : undefined
      }
    >
      {pkg.titleBasis && (
        <div className="mb-5 rounded-xl border border-white/10 p-4 text-sm">
          <p className="font-semibold text-white">Basados en lo que mejor te funcionó</p>
          <p className="mt-0.5 text-xs text-muted">{pkg.titleBasis.note}.</p>
          {pkg.titleBasis.examples.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {pkg.titleBasis.examples.slice(0, 4).map((e, i) => (
                <li key={i} className="flex gap-2 text-xs text-text/90">
                  <span className="w-10 flex-none font-mono text-accent-glow">{formatMultiplier(e.ratio)}</span>
                  <span className="min-w-0 truncate">{e.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        {pkg.titles.map((group) => (
          <div key={group.angle} className="flex flex-col gap-2">
            <h3 className="eyebrow">{ANGLE_LABELS[group.angle]}</h3>
            <ul className="flex flex-col gap-2">
              {group.options.map((o) => {
                const check = checkTitle(o.text);
                const isSelected = selected === o.text;
                return (
                  <li key={o.id} className={cn("rounded-xl border p-3 transition", isSelected ? "border-accent bg-accent/10" : "border-white/10")}>
                    <div className="flex items-start gap-3">
                      <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-white">{o.text}</p>
                      <span
                        className={cn("flex-none rounded-md px-1.5 py-0.5 font-mono text-[11px]", check.fits ? "bg-white/5 text-muted" : "bg-warning/15 text-warning")}
                        aria-label={`${check.chars} de ${TITLE_VISIBLE_MAX} caracteres`}
                      >
                        {check.chars}/{TITLE_VISIBLE_MAX}
                      </span>
                    </div>
                    {!check.fits && (
                      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning">
                        <AlertTriangle className="mt-px h-3.5 w-3.5 flex-none" aria-hidden /> En el teléfono se ve: «{check.preview}»
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted">{o.why}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Button size="sm" variant="subtle" onClick={() => copy(o.text)} icon={<Copy className="h-3.5 w-3.5" aria-hidden />} aria-label={`Copiar «${o.text}»`}>
                        Copiar
                      </Button>
                      {canEdit && (
                        <Button size="sm" variant="subtle" onClick={() => choose(o.text)} aria-pressed={isSelected} icon={<Star className={cn("h-3.5 w-3.5", isSelected && "fill-current text-accent-hi")} aria-hidden />}>
                          {isSelected ? "Elegido" : "Elegir"}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── Fotos ────────────────────────────────────────────────────────────────

async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const max = 2000;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 4_000_000) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), type, 0.92));
}

function PhotosStrip({ photos, canEdit }: { photos: EditorPhoto[]; canEdit: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();

  const upload = async (file: File) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast.error("Sube una foto JPG, PNG o WebP.");
      return;
    }
    setUploading(true);
    try {
      const body = await shrink(file);
      const res = await fetch("/api/miniaturas/fotos", { method: "POST", body, headers: { "content-type": body.type || file.type } });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) toast.error(data.error ?? "No pudimos subir la foto.");
      else {
        toast.success("Foto guardada en Mi marca. Le quitamos el fondo en unos segundos.");
        router.refresh();
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <UserRound className="h-4 w-4 text-accent-hi" aria-hidden /> Tus fotos
          </h3>
          <p className="text-xs text-muted">Se guardan en Mi marca. Funcionan mejor de frente, con expresión y el fondo despejado: les quitamos el fondo solos.</p>
        </div>
        {canEdit && (
          <>
            <Button size="sm" variant="ghost" disabled={uploading} onClick={() => input.current?.click()} icon={uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ImagePlus className="h-4 w-4" aria-hidden />}>
              {uploading ? "Subiendo…" : "Subir foto"}
            </Button>
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void upload(f);
              }}
            />
          </>
        )}
      </div>
      {photos.length === 0 ? (
        <p className="text-sm text-muted">Todavía no subiste fotos. Sin foto, las miniaturas van solo con texto y fondo.</p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {photos.map((p) => (
            <li key={p.key} className="flex w-24 flex-col gap-1">
              <div className="relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-[repeating-conic-gradient(#0b1440_0%_25%,#07163f_0%_50%)] bg-[length:16px_16px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.cutoutUrl ?? p.url} alt="Foto del personaje" className="h-full w-full object-contain" />
                {p.cutoutStatus === "pending" && (
                  <span className="absolute inset-0 grid place-items-center bg-black/50" role="status" aria-label="Quitando el fondo">
                    <Loader2 className="h-5 w-5 animate-spin text-white" aria-hidden />
                  </span>
                )}
              </div>
              <p className={cn("text-[11px] leading-tight", p.cutoutStatus === "failed" ? "text-warning" : "text-muted")} title={p.error ?? undefined}>
                {p.cutoutStatus === "ready" ? "Sin fondo" : p.cutoutStatus === "pending" ? "Quitando el fondo…" : p.cutoutStatus === "failed" ? "Foto entera" : "Sin recortar"}
              </p>
              {canEdit && (
                <div className="flex gap-1">
                  {(p.cutoutStatus === "failed" || p.cutoutStatus === "none") && (
                    <Button size="sm" variant="subtle" className="!px-1.5" disabled={pending} aria-label="Volver a quitar el fondo" onClick={() => start(async () => void (await retryCutoutAction(p.key)))}>
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="subtle"
                    className="!px-1.5"
                    disabled={pending}
                    aria-label="Quitar foto"
                    onClick={() =>
                      start(async () => {
                        const res = await removePhotoAction(p.key);
                        if (!res.ok) toast.error(res.error);
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Una miniatura ────────────────────────────────────────────────────────

function ConceptCard({
  index,
  packageId,
  concept,
  photos,
  colors,
  brandFont,
  canEdit,
  providerReady,
  busy,
  onRegenerate,
  title,
}: {
  index: number;
  packageId: string;
  concept: EditorPackage["concepts"][number];
  photos: EditorPhoto[];
  colors: ThumbColors;
  brandFont: ThumbFontKey;
  canEdit: boolean;
  providerReady: boolean;
  busy: boolean;
  onRegenerate: () => void;
  title: string;
}) {
  const [draft, setDraft] = useState(() => ({ text: concept.text, highlight: concept.highlight, layout: concept.layout, font: concept.font ?? null, photoKey: concept.photoKey, scene: concept.scene }));
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const node = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const font: ThumbFontKey = draft.font && isThumbFont(draft.font) ? draft.font : brandFont;
  const photo = photos.find((p) => p.key === draft.photoKey) ?? null;
  const canvasPhoto: CanvasPhoto = photo ? (photo.cutoutUrl ? { url: photo.cutoutUrl, cutout: true } : { url: photo.url, cutout: false }) : null;
  const words = useMemo(() => thumbWords(draft.text), [draft.text]);
  const issues = thumbTextIssues(draft.text);

  // Guarda solo (medio segundo después del último cambio), juntando todos los cambios pendientes.
  // Nada de esto regenera el fondo.
  const queued = useRef<Partial<typeof draft>>({});
  const conceptId = concept.id;
  const flush = useCallback(() => {
    const patch = queued.current;
    queued.current = {};
    if (!Object.keys(patch).length) return;
    void updateConceptAction(packageId, conceptId, patch).then((res) => {
      setSaving(false);
      if (!res.ok) toast.error(res.error);
    });
  }, [packageId, conceptId]);
  const change = (patch: Partial<typeof draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (!canEdit) return;
    queued.current = { ...queued.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    setSaving(true);
    timer.current = setTimeout(flush, 600);
  };
  // Si la tarjeta se desmonta (por ejemplo, al llegar un fondo nuevo), lo pendiente se guarda igual.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      flush();
    },
    [flush],
  );

  const download = async () => {
    if (!node.current) return;
    setExporting(true);
    try {
      const blob = await captureThumbnail(node.current);
      downloadBlob(blob, `miniatura-${index + 1}-${slugify(title)}.jpg`);
    } catch {
      toast.error("No pudimos armar el JPG. Prueba de nuevo.");
    } finally {
      setExporting(false);
    }
  };

  const status = concept.backgroundStatus;
  return (
    <article className="card flex min-w-0 flex-col gap-4 p-4" aria-label={`Miniatura ${index + 1}: ${concept.name}`}>
      <div className="relative overflow-hidden rounded-xl border border-white/10">
        <ScaledThumbnail ref={node} label={`Vista previa: ${draft.text}`} text={draft.text} highlight={draft.highlight} layout={draft.layout} font={font} colors={colors} backgroundUrl={concept.backgroundUrl} photo={canvasPhoto} />
        {status === "pending" && (
          <div className="absolute inset-0 grid place-items-center bg-black/55" role="status">
            <span className="flex items-center gap-2 text-sm font-semibold text-white">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Generando el fondo…
            </span>
          </div>
        )}
      </div>
      <div>
        <p className="eyebrow">Idea {index + 1}</p>
        <h3 className="mt-1 font-semibold text-white">{concept.name}</h3>
        <p className="mt-0.5 text-sm text-muted">{concept.idea}</p>
        {status === "failed" && concept.backgroundError && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-warning" role="alert">
            <AlertTriangle className="mt-px h-3.5 w-3.5 flex-none" aria-hidden /> {concept.backgroundError}
          </p>
        )}
        {status !== "ready" && status !== "pending" && <p className="mt-1 text-xs text-placeholder">Fondo de muestra con tus colores (todavía sin generar).</p>}
      </div>

      {canEdit && (
        <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
          <Field label="Texto grande" htmlFor={`t-${concept.id}`} hint={issues[0] ?? `${words.length} palabras · se ve bien con 2 a 4`}>
            <Input id={`t-${concept.id}`} value={draft.text} maxLength={60} onChange={(e) => change({ text: e.target.value })} />
          </Field>
          <Field label="Palabra en color" htmlFor={`h-${concept.id}`}>
            <Select id={`h-${concept.id}`} value={draft.highlight} onChange={(e) => change({ highlight: e.target.value })}>
              <option value="">Ninguna</option>
              {words.map((w, i) => (
                <option key={`${w}-${i}`} value={w}>
                  {w}
                </option>
              ))}
              {draft.highlight && !words.includes(draft.highlight) && <option value={draft.highlight}>{draft.highlight}</option>}
            </Select>
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text">Ubicación del texto</span>
            <SegmentedControl label="Ubicación del texto" size="sm" options={LAYOUTS.map((l) => ({ value: l.value, label: l.label.replace("Texto a la ", "").replace("Texto al ", "") }))} value={draft.layout} onValueChange={(v) => change({ layout: v })} />
          </div>
          <Field label="Fuente" htmlFor={`f-${concept.id}`}>
            <Select id={`f-${concept.id}`} value={draft.font ?? ""} onChange={(e) => change({ font: (e.target.value || null) as typeof draft.font })}>
              <option value="">La de tu marca ({THUMB_FONTS[brandFont].label})</option>
              {(Object.keys(THUMB_FONTS) as ThumbFontKey[]).map((k) => (
                <option key={k} value={k}>
                  {THUMB_FONTS[k].label}
                </option>
              ))}
            </Select>
          </Field>
          {photos.length > 0 && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium text-text">Foto</legend>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => change({ photoKey: null })} aria-pressed={!draft.photoKey} className={cn("grid h-12 w-12 place-items-center rounded-lg border text-[10px] text-muted", !draft.photoKey ? "border-accent bg-accent/15 text-white" : "border-white/10 hover:border-line-strong")}>
                  Sin foto
                </button>
                {photos.map((p, i) => (
                  <button key={p.key} type="button" onClick={() => change({ photoKey: p.key, layout: draft.layout === "texto-centro" ? "texto-izquierda" : draft.layout })} aria-pressed={draft.photoKey === p.key} aria-label={`Usar la foto ${i + 1}`} className={cn("relative h-12 w-12 overflow-hidden rounded-lg border", draft.photoKey === p.key ? "border-accent ring-2 ring-accent/50" : "border-white/10 hover:border-line-strong")}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.cutoutUrl ?? p.url} alt="" className="h-full w-full object-cover" />
                    {draft.photoKey === p.key && <Check className="absolute right-0.5 top-0.5 h-3 w-3 text-white" aria-hidden />}
                  </button>
                ))}
              </div>
              {draft.photoKey && draft.layout === "texto-centro" && <p className="text-xs text-muted">Con el texto al centro no va la foto: elige izquierda o derecha.</p>}
            </fieldset>
          )}
          <details className="group rounded-xl border border-white/10 p-3">
            <summary className="cursor-pointer text-sm font-medium text-text">Fondo</summary>
            <div className="mt-3 flex flex-col gap-2">
              <Textarea aria-label="Escena del fondo" rows={3} value={draft.scene} onChange={(e) => change({ scene: e.target.value })} />
              <p className="text-xs text-muted">Describe el lugar y la luz. Nunca lleva letras ni personas: tu foto y el texto van encima.</p>
              {providerReady && (
                <Button size="sm" variant="ghost" disabled={busy || saving} onClick={onRegenerate} icon={<Sparkles className="h-4 w-4" aria-hidden />}>
                  {status === "ready" ? "Generar otro fondo (1 imagen)" : "Generar este fondo (1 imagen)"}
                </Button>
              )}
            </div>
          </details>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="text-xs text-placeholder" aria-live="polite">
          {saving ? "Guardando…" : canEdit ? "Cambios guardados" : ""}
        </span>
        <Button size="sm" disabled={exporting || status === "pending"} onClick={download} icon={exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}>
          {exporting ? "Armando…" : "Descargar JPG"}
        </Button>
      </div>
    </article>
  );
}
