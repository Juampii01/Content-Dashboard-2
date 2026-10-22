"use client";

import "./thumbnails.css";
import { forwardRef, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { THUMB_FONTS, THUMB_HEIGHT, THUMB_WIDTH, thumbnailLayout, type ThumbColors, type ThumbFontKey } from "@/lib/youtube/thumbnail-layout";
import type { ThumbnailLayoutKind } from "@/lib/youtube/types";

export type CanvasPhoto = { url: string; cutout: boolean } | null;

export type ThumbnailCanvasProps = {
  text: string;
  highlight: string;
  layout: ThumbnailLayoutKind;
  font: ThumbFontKey;
  colors: ThumbColors;
  backgroundUrl: string | null;
  photo: CanvasPhoto;
};

const SHADE: Record<"left" | "right" | "bottom", string> = {
  left: "linear-gradient(90deg, rgba(5,8,22,.88) 0%, rgba(5,8,22,.62) 38%, rgba(5,8,22,.12) 64%, rgba(5,8,22,0) 80%)",
  right: "linear-gradient(270deg, rgba(5,8,22,.88) 0%, rgba(5,8,22,.62) 38%, rgba(5,8,22,.12) 64%, rgba(5,8,22,0) 80%)",
  bottom: "linear-gradient(0deg, rgba(5,8,22,.85) 0%, rgba(5,8,22,.45) 55%, rgba(5,8,22,.1) 100%)",
};

/**
 * La miniatura a tamaño real (1280×720): fondo sin texto, velo para que se lea, foto del personaje (recortada o, si no,
 * con un degradado) y el texto dibujado por la plantilla. Es el mismo nodo para la vista previa y para el JPG.
 * Si el texto no entra en su caja, se achica solo hasta que entre.
 */
export const ThumbnailCanvas = forwardRef<HTMLDivElement, ThumbnailCanvasProps>(function ThumbnailCanvas({ text, highlight, layout, font, colors, backgroundUrl, photo }, ref) {
  const plan = thumbnailLayout({ text, highlight, layout, hasPhoto: Boolean(photo), font });
  const textRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const signature = `${text}|${highlight}|${layout}|${font}|${Boolean(photo)}`;

  // Ajuste fino en el navegador (la plantilla calcula con el ancho medio de la fuente; aquí se mide de verdad).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    let alive = true;
    const run = () => {
      if (!alive) return;
      let scale = 1;
      el.style.setProperty("--fit", "1");
      for (let i = 0; i < 14; i++) {
        // Se mide cada renglón (no el scroll de la caja: las letras de Anton sobresalen del renglón y lo engañan).
        const lines = [...el.children].map((c) => c.getBoundingClientRect());
        const ratio = el.getBoundingClientRect().width / (el.clientWidth || 1);
        const width = Math.max(0, ...lines.map((r) => r.width)) / ratio;
        const height = lines.reduce((sum, r) => sum + r.height, 0) / ratio;
        if (width <= el.clientWidth + 1 && height <= el.clientHeight + 1) break;
        scale *= 0.93;
        el.style.setProperty("--fit", String(scale));
      }
      setFit(scale);
    };
    run();
    // Con la fuente todavía cargando se mide con la de respaldo: se vuelve a medir cuando llega.
    void document.fonts?.ready.then(run);
    document.fonts?.addEventListener("loadingdone", run);
    return () => {
      alive = false;
      document.fonts?.removeEventListener("loadingdone", run);
    };
  }, [signature]);

  const t = plan.textBox;
  const p = plan.photoBox;
  const fadeTo = layout === "texto-derecha" ? "to left" : "to right";
  const textStyle: CSSProperties & Record<"--fit", string> = {
    position: "absolute",
    left: t.x,
    top: t.y,
    width: t.w,
    height: t.h,
    display: "flex",
    flexDirection: "column",
    justifyContent: layout === "texto-centro" ? "flex-end" : "center",
    alignItems: plan.align === "center" ? "center" : plan.align === "right" ? "flex-end" : "flex-start",
    textAlign: plan.align,
    fontFamily: plan.fontFamily,
    fontWeight: plan.fontWeight,
    fontSize: `calc(var(--fit) * ${plan.fontSize}px)`,
    lineHeight: plan.lineHeight,
    letterSpacing: font === "anton" || font === "oswald" ? "0.005em" : "-0.02em",
    overflow: "hidden",
    "--fit": String(fit),
  };

  return (
    <div
      ref={ref}
      style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT, position: "relative", overflow: "hidden", background: colors.shade, fontKerning: "normal" }}
      data-thumbnail
    >
      {backgroundUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={backgroundUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(70% 90% at ${layout === "texto-derecha" ? "20%" : "80%"} 30%, ${colors.accent}55 0%, transparent 60%), radial-gradient(60% 70% at 50% 120%, ${colors.accent}33 0%, transparent 70%), linear-gradient(135deg, #0b1440 0%, ${colors.shade} 70%)`,
          }}
        />
      )}
      <div aria-hidden style={{ position: "absolute", inset: 0, background: SHADE[plan.shade] }} />
      {photo && p && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo.url}
          alt=""
          style={{
            position: "absolute",
            left: p.x,
            top: p.y,
            width: p.w,
            height: p.h,
            objectFit: photo.cutout ? "contain" : "cover",
            objectPosition: photo.cutout ? "center bottom" : "center 20%",
            filter: photo.cutout ? "drop-shadow(0 0 2px rgba(255,255,255,.35)) drop-shadow(0 22px 40px rgba(0,0,0,.55))" : undefined,
            WebkitMaskImage: photo.cutout ? undefined : `linear-gradient(${fadeTo}, transparent 0%, #000 30%)`,
            maskImage: photo.cutout ? undefined : `linear-gradient(${fadeTo}, transparent 0%, #000 30%)`,
          }}
        />
      )}
      <div ref={textRef} style={textStyle}>
        {plan.lines.map((line, i) => (
          <div key={i} style={{ whiteSpace: "nowrap", textShadow: "0 6px 0 rgba(0,0,0,.45), 0 0 28px rgba(0,0,0,.55)", WebkitTextStroke: "2px rgba(0,0,0,.35)" }}>
            {line.map((w, k) => (
              <span key={k} style={{ color: w.highlight ? colors.accent : colors.text }}>
                {k > 0 ? " " : ""}
                {w.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

/** La miniatura escalada al ancho de su contenedor (vista previa). El nodo de adentro sigue midiendo 1280×720. */
export const ScaledThumbnail = forwardRef<HTMLDivElement, ThumbnailCanvasProps & { className?: string; label: string }>(function ScaledThumbnail({ className, label, ...props }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setScale((el.clientWidth || 320) / THUMB_WIDTH);
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={box} className={className} role="img" aria-label={label} style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
        <ThumbnailCanvas ref={ref} {...props} />
      </div>
    </div>
  );
});

/** Espera a que estén las fuentes de las miniaturas (con tildes y ñ) antes de capturar. */
export async function ensureThumbFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const sample = "ÁÉÍÓÚÑÜ¿¡0123456789 áéíóúñ";
  await Promise.all(Object.values(THUMB_FONTS).map((f) => document.fonts.load(`${f.weight} 100px ${f.family.split(",")[0]}`, sample).catch(() => undefined)));
  await document.fonts.ready;
}
