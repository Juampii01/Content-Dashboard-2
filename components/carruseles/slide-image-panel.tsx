"use client";

import { useRef, useState } from "react";
import { ImageOff, ImagePlus, Loader2, RefreshCw, Sparkles, Undo2, Upload, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import type { CarouselSlide } from "@/lib/db/schema";
import { downscaleImage, uploadImage } from "./upload";

/**
 * Imagen de un slide: escena para la IA (editable, siempre sin texto), generar u otra imagen, subir una foto propia
 * o quitarla. El texto nunca va en la imagen: lo dibuja la plantilla.
 */
export function SlideImagePanel({
  carouselId,
  slide,
  showsImages,
  optional,
  canEdit,
  disabled,
  generating,
  providerReady,
  onPatch,
  onGenerate,
  onUsePhotoTemplate,
  onCorrect,
}: {
  carouselId: string;
  slide: CarouselSlide;
  /** La plantilla de este slide dibuja la imagen. */
  showsImages: boolean;
  /** La imagen es opcional en esta plantilla (por ejemplo, Tweet). */
  optional: boolean;
  canEdit: boolean;
  disabled: boolean;
  generating: boolean;
  providerReady: boolean;
  onPatch: (patch: Partial<CarouselSlide>) => void;
  onGenerate: () => void;
  onUsePhotoTemplate: () => void;
  /** Corregir la imagen actual con un único cambio (1 imagen). */
  onCorrect?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return void toast.error("Sube una foto JPG, PNG o WebP.");
    if (file.size > 25 * 1024 * 1024) return void toast.error("La foto pesa más de 25 MB.");
    setUploading(true);
    try {
      const blob = await downscaleImage(file, 2000, 0.9);
      const res = await uploadImage(`/api/carruseles/subir?tipo=foto&carrusel=${carouselId}&slide=${encodeURIComponent(slide.id)}`, blob);
      onPatch({ imageUrl: res.url, imageSource: "upload" });
      toast.success("Foto lista. Guarda para conservarla.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No pudimos subir la foto.");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  if (!showsImages) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-dashed border-white/12 p-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-white">
          <ImageOff className="h-4 w-4 text-muted" aria-hidden />
          Esta plantilla no lleva imagen
        </p>
        <p className="text-xs text-muted">Para sumar una foto o una escena con IA, usa “Foto + texto”, “Tweet” o una plantilla tuya con foto.</p>
        {canEdit && (
          <div>
            <Button variant="ghost" size="sm" disabled={disabled} onClick={onUsePhotoTemplate} icon={<ImagePlus className="h-3.5 w-3.5" aria-hidden />}>
              Usar “Foto + texto” en este slide
            </Button>
          </div>
        )}
      </div>
    );
  }

  const busy = generating || uploading;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/10 p-3">
      <div className="flex items-start gap-3">
        <div className="relative w-[72px] flex-none overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]" style={{ aspectRatio: "4 / 5" }}>
          {slide.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- imagen privada servida por la app con sesión
            <img src={slide.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full w-full place-items-center text-placeholder">
              <ImagePlus className="h-5 w-5" aria-hidden />
            </span>
          )}
          {busy && (
            <span className="absolute inset-0 grid place-items-center bg-black/60">
              <Loader2 className="h-5 w-5 animate-spin text-white" aria-hidden />
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Imagen del slide{optional ? " (opcional)" : ""}</p>
          <p className="text-xs text-muted">
            {generating
              ? "Generando la imagen…"
              : uploading
                ? "Subiendo tu foto…"
                : slide.imageUrl
                  ? slide.imageSource === "ai"
                    ? slide.character
                      ? "Generada con IA con tu cara, sin texto."
                      : "Generada con IA, sin texto."
                    : "Tu foto."
                  : "Todavía no tiene imagen. Genera una escena con IA o sube tu foto."}
          </p>
        </div>
      </div>
      <Field
        label="Escena para la IA"
        htmlFor={`scene-${slide.id}`}
        hint={slide.character ? "Dónde estás y qué se ve alrededor, sin textos ni logos. Tu pose va arriba." : "Qué se ve, sin textos ni logos. Si la dejas vacía, la IA la propone."}
      >
        <Textarea
          id={`scene-${slide.id}`}
          value={slide.scenePrompt ?? ""}
          maxLength={600}
          disabled={!canEdit}
          onChange={(e) => onPatch({ scenePrompt: e.target.value })}
          placeholder="Escritorio ordenado con una libreta abierta, luz de ventana, vista cenital"
          className="!min-h-20 text-sm"
        />
      </Field>
      {canEdit && (
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant={slide.imageUrl ? "ghost" : "primary"}
            size="sm"
            disabled={disabled || busy || !providerReady}
            onClick={onGenerate}
            title={providerReady ? undefined : "Agrega tu clave de API de OpenAI en Ajustes"}
            icon={slide.imageUrl && slide.imageSource === "ai" ? <RefreshCw className="h-3.5 w-3.5" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
          >
            {slide.imageUrl && slide.imageSource === "ai" ? "Otra imagen" : "Generar imagen"}
          </Button>
          <Button variant="ghost" size="sm" disabled={disabled || busy} onClick={() => input.current?.click()} icon={<Upload className="h-3.5 w-3.5" aria-hidden />}>
            Subir mi foto
          </Button>
          {slide.imageUrl && onCorrect && (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled || busy || !providerReady}
              onClick={onCorrect}
              title={providerReady ? "Cambia una sola cosa de esta imagen (1 imagen)" : "Agrega tu clave de API de OpenAI en Ajustes"}
              icon={<Wand2 className="h-3.5 w-3.5" aria-hidden />}
            >
              Corregir
            </Button>
          )}
          {slide.prevImageUrl && (
            <Button
              variant="subtle"
              size="sm"
              disabled={disabled || busy}
              onClick={() => onPatch({ imageUrl: slide.prevImageUrl, imageSource: slide.prevImageSource ?? "ai", prevImageUrl: slide.imageUrl ?? null, prevImageSource: slide.imageSource ?? null })}
              title="Cambia entre esta imagen y la anterior"
              icon={<Undo2 className="h-3.5 w-3.5" aria-hidden />}
            >
              Volver a la anterior
            </Button>
          )}
          {slide.imageUrl && (
            <Button variant="subtle" size="sm" disabled={disabled || busy} onClick={() => onPatch({ imageUrl: null, imageSource: null })} icon={<ImageOff className="h-3.5 w-3.5" aria-hidden />}>
              Quitar
            </Button>
          )}
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        </div>
      )}
    </div>
  );
}
