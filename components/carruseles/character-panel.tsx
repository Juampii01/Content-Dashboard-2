"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Check, ImagePlus, Loader2, RefreshCw, Shuffle, UserRound, UserRoundX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import type { CarouselSlide } from "@/lib/db/schema";
import { DEFAULT_POSES, pickPhotos, traitsLabel, type CharacterPhoto } from "@/lib/carousels/character";
import { cn } from "@/lib/utils";
import { downscaleImage } from "./upload";

/** Sube una foto del personaje a Mi marca (la misma lista que usan las miniaturas de YouTube). */
export async function uploadCharacterPhoto(file: File): Promise<void> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Sube una foto JPG, PNG o WebP.");
  if (file.size > 25 * 1024 * 1024) throw new Error("La foto pesa más de 25 MB.");
  const body = await downscaleImage(file, 2000, 0.9);
  let res: Response;
  try {
    res = await fetch("/api/miniaturas/fotos", { method: "POST", body, headers: { "content-type": body.type || file.type } });
  } catch {
    throw new Error("Se cortó la conexión mientras subíamos la foto. Prueba de nuevo.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "No pudimos subir la foto. Prueba de nuevo.");
}

/** Botón para subir fotos tuyas (se agregan a Mi marca). */
export function CharacterPhotoUpload({ disabled, label = "Subir fotos tuyas", variant = "ghost" }: { disabled?: boolean; label?: string; variant?: "ghost" | "primary" }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function upload(files: FileList) {
    setBusy(true);
    try {
      for (const f of Array.from(files).slice(0, 3)) await uploadCharacterPhoto(f);
      toast.success(files.length === 1 ? "Foto lista." : "Fotos listas.", { description: "Se guardaron en Mi marca." });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No pudimos subir la foto.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <>
      <Button variant={variant} size="sm" disabled={disabled || busy} onClick={() => input.current?.click()} icon={busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ImagePlus className="h-3.5 w-3.5" aria-hidden />}>
        {busy ? "Subiendo…" : label}
      </Button>
      <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => e.target.files?.length && void upload(e.target.files)} />
    </>
  );
}

/**
 * Tu personaje en este slide: si sale (su cara, con las fotos de Mi marca como referencia), su pose y qué foto se
 * usa como referencia principal (automática según la pose, o elegida a mano).
 */
export function CharacterPanel({
  slide,
  index,
  photos,
  canEdit,
  disabled,
  showsImages,
  onPatch,
  onUsePhotoTemplate,
}: {
  slide: CarouselSlide;
  index: number;
  photos: CharacterPhoto[];
  canEdit: boolean;
  disabled: boolean;
  /** La plantilla del slide dibuja imagen (si no, la cara no se vería). */
  showsImages: boolean;
  onPatch: (patch: Partial<CarouselSlide>) => void;
  onUsePhotoTemplate: () => void;
}) {
  const on = slide.character === true;
  const auto = photos.length ? pickPhotos(photos, slide.pose, index, null, 1)[0] : null;
  const primary = slide.photoKey && photos.some((p) => p.key === slide.photoKey) ? slide.photoKey : auto;

  function nextPose() {
    const current = DEFAULT_POSES.findIndex((p) => p === slide.pose);
    onPatch({ pose: DEFAULT_POSES[(current + 1 + (current < 0 ? index : 0)) % DEFAULT_POSES.length] });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/10 p-3" aria-label="Tu personaje en este slide">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-white">
          <UserRound className="h-4 w-4 text-accent-hi" aria-hidden />
          Tu personaje
        </p>
        <SegmentedControl
          label="¿Sale tu personaje en este slide?"
          size="sm"
          value={on ? "si" : "no"}
          onValueChange={(v) => canEdit && !disabled && onPatch({ character: v === "si", ...(v === "si" && !slide.pose?.trim() ? { pose: DEFAULT_POSES[index % DEFAULT_POSES.length] } : {}) })}
          options={[
            { value: "si", label: "Sale", icon: <UserRound className="h-3.5 w-3.5" aria-hidden /> },
            { value: "no", label: "No sale", icon: <UserRoundX className="h-3.5 w-3.5" aria-hidden /> },
          ]}
        />
      </div>

      {!on ? (
        <p className="text-xs text-muted">{slide.original?.person ? "En el original este slide muestra a una persona: puedes poner tu cara aquí." : "La imagen de este slide va sin personas."}</p>
      ) : photos.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-white/15 p-3">
          <p className="text-sm text-white">Sube de 1 a 3 fotos tuyas para que salga tu cara.</p>
          <p className="text-xs text-muted">Nítidas, con buena luz y la cara completa: una de frente y otra de tres cuartos funcionan mejor. Se guardan en Mi marca.</p>
          {canEdit && <CharacterPhotoUpload disabled={disabled} variant="primary" />}
        </div>
      ) : (
        <>
          {!showsImages && (
            <div className="flex flex-col items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
              La plantilla de este slide no lleva imagen: tu cara no se va a ver.
              {canEdit && (
                <Button variant="ghost" size="sm" disabled={disabled} onClick={onUsePhotoTemplate} icon={<ImagePlus className="h-3.5 w-3.5" aria-hidden />}>
                  Usar “Foto + texto” en este slide
                </Button>
              )}
            </div>
          )}
          <div>
            <Field label="Pose y gesto" htmlFor={`pose-${slide.id}`} hint="Ángulo, mirada, expresión y una sola acción con las manos.">
              <Textarea
                id={`pose-${slide.id}`}
                value={slide.pose ?? ""}
                maxLength={300}
                disabled={!canEdit}
                onChange={(e) => onPatch({ pose: e.target.value })}
                placeholder="De frente, mirando a cámara, señala con el índice el elemento principal"
                className="!min-h-16 text-sm"
              />
            </Field>
            {canEdit && (
              <Button variant="subtle" size="sm" className="mt-1.5" disabled={disabled} onClick={nextPose} icon={<Shuffle className="h-3.5 w-3.5" aria-hidden />}>
                Otra pose
              </Button>
            )}
          </div>
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-white">Foto de referencia de tu cara</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Foto de referencia">
              <button
                type="button"
                role="radio"
                aria-checked={!slide.photoKey}
                disabled={!canEdit || disabled}
                onClick={() => onPatch({ photoKey: null })}
                className={cn("flex h-[76px] w-[62px] flex-col items-center justify-center gap-1 rounded-lg border-2 text-[10px] font-semibold transition", !slide.photoKey ? "border-accent-hi bg-accent/15 text-white" : "border-white/10 text-muted hover:border-white/30")}
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
                Automática
              </button>
              {photos.map((p, i) => {
                const active = slide.photoKey === p.key;
                const isPrimary = primary === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={`Foto ${i + 1}: ${traitsLabel(p.traits)}${isPrimary ? " (la que se usa)" : ""}`}
                    title={traitsLabel(p.traits)}
                    disabled={!canEdit || disabled}
                    onClick={() => onPatch({ photoKey: p.key })}
                    className={cn("relative h-[76px] w-[62px] overflow-hidden rounded-lg border-2 transition", active ? "border-accent-hi" : isPrimary ? "border-accent/60" : "border-white/10 hover:border-white/30")}
                  >
                    {p.url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- foto privada servida por la app con sesión
                      <img src={p.url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="grid h-full w-full place-items-center bg-white/5 text-placeholder">
                        <UserRound className="h-4 w-4" aria-hidden />
                      </span>
                    )}
                    {isPrimary && (
                      <span className="absolute right-0.5 bottom-0.5 grid h-4 w-4 place-items-center rounded-full bg-accent text-white" aria-hidden>
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-muted">
              {slide.photoKey ? "Elegiste esta foto. " : "Elegimos la que mejor encaja con la pose. "}
              {primary ? `Se usa: ${traitsLabel(photos.find((p) => p.key === primary)?.traits ?? null).toLowerCase()}` : ""}
              {photos.length > 1 ? `, más otra foto para fijar tu cara.` : ". Con 2 o 3 fotos tu cara sale más parecida."}
            </p>
            {canEdit && photos.length < 3 && (
              <div className="mt-2">
                <CharacterPhotoUpload disabled={disabled} label="Sumar otra foto" />
              </div>
            )}
          </fieldset>
        </>
      )}
    </div>
  );
}
