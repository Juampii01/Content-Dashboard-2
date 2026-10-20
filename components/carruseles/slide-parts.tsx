"use client";

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { CarouselSlide } from "@/lib/db/schema";
import { initials, SLIDE_HEIGHT, SLIDE_WIDTH, type ResolvedTheme, type SlideIdentity, type TemplateRef } from "@/lib/carousels/theme";

/**
 * Piezas comunes de las plantillas de carrusel (de fábrica y propias): marco de 1080×1350, ajuste automático del texto,
 * resaltado, contador, flecha, caja de CTA y avatar. Todo con estilos en línea: lo que se ve es lo que se exporta.
 */
export type SlideProps = {
  slide: CarouselSlide;
  index: number;
  total: number;
  template: TemplateRef;
  theme: ResolvedTheme;
  identity: SlideIdentity;
};

export const MONO = '"JetBrains Mono", ui-monospace, monospace';
export const SERIF = '"Playfair Carrusel", Georgia, serif';
export const MIN_FIT = 0.42;

export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function isDark(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 140;
}

export const px = (n: number) => `calc(var(--fit, 1) * ${n}px)`;
/** Igual que px, pero sin bajar de un mínimo legible en el teléfono (el texto de apoyo nunca queda diminuto). */
export const pxMin = (n: number, min = 32) => `max(${min}px, calc(var(--fit, 1) * ${n}px))`;
export const pad2 = (n: number) => String(n).padStart(2, "0");

/** Prueba tamaños (variable --fit) hasta que el bloque de texto entra en su caja, a lo alto y a lo ancho. */
export function fitText(b: HTMLDivElement, el: HTMLDivElement) {
  const fits = () => el.scrollHeight <= b.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
  el.style.setProperty("--fit", "1");
  if (fits()) {
    el.dataset.fit = "1";
    return;
  }
  let lo = MIN_FIT;
  let hi = 1;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    el.style.setProperty("--fit", String(mid));
    if (fits()) lo = mid;
    else hi = mid;
  }
  const value = String(Math.floor(lo * 1000) / 1000);
  el.style.setProperty("--fit", value);
  el.dataset.fit = value;
}

/**
 * Ajuste automático: baja el tamaño de todo el bloque de texto hasta que entra en su caja (una palabra muy larga
 * también cuenta). Corre igual en la vista previa y en la exportación, y otra vez cuando terminan de cargar las fuentes.
 */
export function Fit({ children, fitKey, justify = "center", style }: { children: ReactNode; fitKey: string; justify?: CSSProperties["justifyContent"]; style?: CSSProperties }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const run = () => {
      if (box.current && inner.current) fitText(box.current, inner.current);
    };
    run();
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    let alive = true;
    fonts?.ready.then(() => alive && run());
    fonts?.addEventListener?.("loadingdone", run);
    return () => {
      alive = false;
      fonts?.removeEventListener?.("loadingdone", run);
    };
  }, [fitKey]);
  return (
    <div ref={box} style={{ flex: "1 1 0", minHeight: 0, display: "flex", flexDirection: "column", justifyContent: justify, overflow: "hidden", ...style }}>
      <div ref={inner} data-fit-box="" style={{ width: "100%", overflowWrap: "normal", wordBreak: "normal", hyphens: "manual" }}>
        {children}
      </div>
    </div>
  );
}

/**
 * Titular con la palabra resaltada en color, con marcador de fondo, subrayada o en cursiva de color
 * (las dos últimas las usan las plantillas copiadas de una referencia).
 */
export function Highlighted({ text, highlight, color, marker, mode }: { text: string; highlight: string; color: string; marker?: { bg: string; fg: string }; mode?: "underline" | "italic" }) {
  const h = highlight.trim();
  const at = h ? text.toLocaleLowerCase("es").indexOf(h.toLocaleLowerCase("es")) : -1;
  if (at < 0) return <>{text}</>;
  const part = text.slice(at, at + h.length);
  return (
    <>
      {text.slice(0, at)}
      {marker ? (
        <span style={{ background: marker.bg, color: marker.fg, padding: "0 0.14em", margin: "0 -0.04em", borderRadius: "0.12em", boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}>{part}</span>
      ) : mode === "underline" ? (
        <span style={{ textDecorationLine: "underline", textDecorationColor: color, textDecorationThickness: "0.09em", textUnderlineOffset: "0.12em" }}>{part}</span>
      ) : mode === "italic" ? (
        <span style={{ color, fontStyle: "italic" }}>{part}</span>
      ) : (
        <span style={{ color }}>{part}</span>
      )}
      {text.slice(at + h.length)}
    </>
  );
}

export function Frame({ theme, children, style }: { theme: ResolvedTheme; children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      data-slide=""
      style={{
        position: "relative",
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
        overflow: "hidden",
        background: theme.bg,
        color: theme.text,
        fontFamily: theme.fontFamily,
        fontKerning: "normal",
        WebkitFontSmoothing: "antialiased",
        textRendering: "geometricPrecision",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Backdrop({ theme, variant = "glow" }: { theme: ResolvedTheme; variant?: "glow" | "grid" | "none" }) {
  if (variant === "none") return null;
  const dark = isDark(theme.bg);
  return (
    <>
      <div aria-hidden style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse 75% 45% at 88% -4%, ${alpha(theme.accent, dark ? 0.22 : 0.1)}, transparent 70%)` }} />
      {variant === "grid" && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `linear-gradient(${alpha(theme.text, dark ? 0.045 : 0.05)} 2px, transparent 2px), linear-gradient(90deg, ${alpha(theme.text, dark ? 0.045 : 0.05)} 2px, transparent 2px)`,
            backgroundSize: "90px 90px",
            backgroundPosition: "-2px -2px",
          }}
        />
      )}
    </>
  );
}

export function Counter({ index, total, theme }: { index: number; total: number; theme: ResolvedTheme }) {
  return (
    <span style={{ fontFamily: MONO, fontSize: 26, fontWeight: 600, letterSpacing: "0.08em", color: theme.muted, whiteSpace: "nowrap" }}>
      {pad2(index + 1)} <span style={{ opacity: 0.5 }}>/</span> {pad2(total)}
    </span>
  );
}

export function Arrow({ color, size = 34 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export function Footer({ index, total, theme, identity, swipe = true }: { index: number; total: number; theme: ResolvedTheme; identity: SlideIdentity; swipe?: boolean }) {
  const last = index === total - 1;
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, height: 56, flex: "none" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 28, fontWeight: 600, color: theme.muted, fontFamily: '"Inter", sans-serif', whiteSpace: "nowrap" }}>
        <span style={{ width: 12, height: 12, borderRadius: 99, background: theme.accent }} />
        {identity.handle || identity.name}
      </span>
      {swipe && !last ? (
        <span style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 26, fontWeight: 700, color: theme.muted, fontFamily: MONO, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          {index === 0 ? "Desliza" : <Counter index={index} total={total} theme={theme} />}
          <Arrow color={theme.accent} />
        </span>
      ) : (
        <Counter index={index} total={total} theme={theme} />
      )}
    </div>
  );
}

export function CtaBox({ slide, theme, size = 46 }: { slide: CarouselSlide; theme: ResolvedTheme; size?: number }) {
  if (!slide.cta.trim()) return null;
  return (
    <div
      style={{
        marginTop: px(56),
        display: "inline-flex",
        alignItems: "center",
        gap: px(22),
        background: theme.accent,
        color: theme.accentText,
        borderRadius: px(30),
        padding: `${px(30)} ${px(44)}`,
        fontSize: px(size),
        fontWeight: 800,
        lineHeight: 1.15,
        letterSpacing: "-0.01em",
        fontFamily: '"Inter", sans-serif',
        maxWidth: "100%",
        boxSizing: "border-box",
      }}
    >
      <span>{slide.cta}</span>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={theme.accentText} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: "none", width: px(size), height: px(size) }}>
        <path d="M7 17 17 7" />
        <path d="M8 7h9v9" />
      </svg>
    </div>
  );
}

export function fitKeyOf(p: SlideProps) {
  const s = p.slide;
  return [p.template, p.theme.font, s.type, s.kicker, s.headline, s.highlight, s.body, s.cta, p.identity.name, p.identity.handle].join("\u0001");
}
export function Avatar({ identity, theme, size }: { identity: SlideIdentity; theme: ResolvedTheme; size: number }) {
  if (identity.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- se exporta a imagen: necesita un <img> normal del mismo origen
    return <img src={identity.avatarUrl} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: 999, objectFit: "cover", flex: "none", display: "block" }} />;
  }
  return (
    <span style={{ width: size, height: size, borderRadius: 999, background: theme.accent, color: theme.accentText, display: "grid", placeItems: "center", fontSize: size * 0.38, fontWeight: 800, fontFamily: '"Inter", sans-serif', flex: "none", letterSpacing: "-0.02em" }}>
      {initials(identity.name)}
    </span>
  );
}

export function VerifiedLike({ color }: { color: string }) {
  // Insignia decorativa propia (no imita la verificación de ninguna red): un punto con check en el color de acento.
  return (
    <svg width="38" height="38" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10" fill={color} />
      <path d="m8 12.5 2.6 2.5L16 9.5" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Imagen del slide (foto subida o escena con IA) o, si falta, un hueco que lo avisa sin romper el diseño. */
export function SlideImage({ url, theme, style, radius = 0 }: { url: string | null | undefined; theme: ResolvedTheme; style?: CSSProperties; radius?: number }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- se exporta a imagen: necesita un <img> normal del mismo origen
    return <img src={url} alt="" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", borderRadius: radius, ...style }} />;
  }
  const dark = isDark(theme.bg);
  return (
    <div
      data-image-placeholder=""
      style={{
        width: "100%",
        height: "100%",
        borderRadius: radius,
        background: `linear-gradient(135deg, ${alpha(theme.accent, dark ? 0.28 : 0.18)}, ${alpha(theme.text, dark ? 0.06 : 0.05)} 60%), repeating-linear-gradient(45deg, ${alpha(theme.text, 0.05)} 0 2px, transparent 2px 28px)`,
        display: "grid",
        placeItems: "center",
        ...style,
      }}
    >
      <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke={alpha(theme.text, 0.35)} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
      </svg>
    </div>
  );
}
