"use client";

import "./slides.css";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { CarouselSlide } from "@/lib/db/schema";
import { initials, SLIDE_HEIGHT, SLIDE_WIDTH, type ResolvedTheme, type SlideIdentity, type TemplateKey } from "@/lib/carousels/theme";
import { cn } from "@/lib/utils";

/**
 * Plantillas de carrusel. Cada slide se dibuja en un nodo de 1080×1350 con estilos en línea:
 * el mismo componente sirve para la vista previa (escalada con `transform`) y para la exportación a JPG,
 * así lo que se ve es exactamente lo que se descarga.
 */
export type SlideProps = {
  slide: CarouselSlide;
  index: number;
  total: number;
  template: TemplateKey;
  theme: ResolvedTheme;
  identity: SlideIdentity;
};

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const SERIF = '"Playfair Carrusel", Georgia, serif';
const MIN_FIT = 0.42;

function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function isDark(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 140;
}

const px = (n: number) => `calc(var(--fit, 1) * ${n}px)`;
/** Igual que px, pero sin bajar de un mínimo legible en el teléfono (el texto de apoyo nunca queda diminuto). */
const pxMin = (n: number, min = 32) => `max(${min}px, calc(var(--fit, 1) * ${n}px))`;
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Prueba tamaños (variable --fit) hasta que el bloque de texto entra en su caja, a lo alto y a lo ancho. */
function fitText(b: HTMLDivElement, el: HTMLDivElement) {
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
function Fit({ children, fitKey, justify = "center", style }: { children: ReactNode; fitKey: string; justify?: CSSProperties["justifyContent"]; style?: CSSProperties }) {
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

/** Titular con la palabra resaltada en color (o con marcador de fondo). */
function Highlighted({ text, highlight, color, marker }: { text: string; highlight: string; color: string; marker?: { bg: string; fg: string } }) {
  const h = highlight.trim();
  const at = h ? text.toLocaleLowerCase("es").indexOf(h.toLocaleLowerCase("es")) : -1;
  if (at < 0) return <>{text}</>;
  const part = text.slice(at, at + h.length);
  return (
    <>
      {text.slice(0, at)}
      {marker ? (
        <span style={{ background: marker.bg, color: marker.fg, padding: "0 0.14em", margin: "0 -0.04em", borderRadius: "0.12em", boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}>{part}</span>
      ) : (
        <span style={{ color }}>{part}</span>
      )}
      {text.slice(at + h.length)}
    </>
  );
}

function Frame({ theme, children, style }: { theme: ResolvedTheme; children: ReactNode; style?: CSSProperties }) {
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

function Backdrop({ theme, variant = "glow" }: { theme: ResolvedTheme; variant?: "glow" | "grid" | "none" }) {
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

function Counter({ index, total, theme }: { index: number; total: number; theme: ResolvedTheme }) {
  return (
    <span style={{ fontFamily: MONO, fontSize: 26, fontWeight: 600, letterSpacing: "0.08em", color: theme.muted, whiteSpace: "nowrap" }}>
      {pad2(index + 1)} <span style={{ opacity: 0.5 }}>/</span> {pad2(total)}
    </span>
  );
}

function Arrow({ color, size = 34 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function Footer({ index, total, theme, identity, swipe = true }: { index: number; total: number; theme: ResolvedTheme; identity: SlideIdentity; swipe?: boolean }) {
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

function CtaBox({ slide, theme, size = 46 }: { slide: CarouselSlide; theme: ResolvedTheme; size?: number }) {
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

function fitKeyOf(p: SlideProps) {
  const s = p.slide;
  return [p.template, p.theme.font, s.type, s.kicker, s.headline, s.highlight, s.body, s.cta, p.identity.name, p.identity.handle].join("\u0001");
}

// ─── Editorial ────────────────────────────────────────────────────────────

function Editorial(p: SlideProps) {
  const { slide, theme } = p;
  const cover = slide.type === "cover";
  const quote = slide.type === "quote";
  const size = cover ? 128 : slide.type === "cta" ? 104 : quote ? 92 : 98;
  return (
    <Frame theme={theme} style={{ padding: "84px 92px 72px" }}>
      <Backdrop theme={theme} variant="grid" />
      <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center", height: 48, flex: "none" }}>
        <span style={{ fontFamily: MONO, fontSize: 26, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: theme.accent, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 760 }}>
          {slide.kicker || (cover ? "Carrusel" : "")}
        </span>
        {!cover && <Counter index={p.index} total={p.total} theme={theme} />}
      </div>
      <Fit fitKey={fitKeyOf(p)} justify={cover ? "flex-end" : "center"} style={{ position: "relative", padding: "40px 0 48px" }}>
        {quote && <div style={{ fontFamily: SERIF, fontSize: px(260), lineHeight: 0.7, color: theme.accent, height: px(150) }}>“</div>}
        <div style={{ width: px(96), height: px(10), borderRadius: 99, background: theme.accent, marginBottom: px(44), display: quote ? "none" : "block" }} />
        <h2 style={{ margin: 0, fontFamily: theme.fontFamily, fontSize: px(size), lineHeight: 1.02, fontWeight: theme.heavy, letterSpacing: theme.font === "playfair" ? "-0.015em" : "-0.035em", color: theme.text, fontStyle: quote && theme.font === "playfair" ? "italic" : "normal" }}>
          <Highlighted text={slide.headline} highlight={slide.highlight} color={theme.accent} />
        </h2>
        {slide.body.trim() && (
          <p style={{ margin: `${px(40)} 0 0`, fontSize: pxMin(42), lineHeight: 1.38, fontWeight: 450, color: theme.muted, fontFamily: '"Inter", sans-serif', maxWidth: "94%" }}>{slide.body}</p>
        )}
        {slide.type === "cta" && <CtaBox slide={slide} theme={theme} />}
      </Fit>
      <Footer {...p} />
    </Frame>
  );
}

// ─── Tweet ────────────────────────────────────────────────────────────────

function Avatar({ identity, theme, size }: { identity: SlideIdentity; theme: ResolvedTheme; size: number }) {
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

function VerifiedLike({ color }: { color: string }) {
  // Insignia decorativa propia (no imita la verificación de ninguna red): un punto con check en el color de acento.
  return (
    <svg width="38" height="38" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10" fill={color} />
      <path d="m8 12.5 2.6 2.5L16 9.5" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Tweet(p: SlideProps) {
  const { slide, theme, identity } = p;
  const cover = slide.type === "cover";
  return (
    <Frame theme={theme} style={{ padding: "96px 96px 72px", fontFamily: '"Inter", sans-serif' }}>
      <Fit fitKey={fitKeyOf(p)} justify="center">
        <div style={{ display: "flex", alignItems: "center", gap: px(28), marginBottom: px(52) }}>
          <Avatar identity={identity} theme={theme} size={128} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: px(46), fontWeight: 800, color: theme.text, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
              <span>{identity.name}</span>
              <VerifiedLike color={theme.accent} />
            </div>
            {identity.handle && <div style={{ fontSize: px(38), color: theme.muted, marginTop: 6, lineHeight: 1.15 }}>{identity.handle}</div>}
          </div>
        </div>
        {slide.kicker.trim() && !cover && (
          <div style={{ fontSize: px(34), fontWeight: 700, color: theme.accent, marginBottom: px(20), letterSpacing: "-0.01em" }}>{slide.kicker}</div>
        )}
        <p style={{ margin: 0, fontSize: px(cover ? 92 : 68), lineHeight: 1.2, fontWeight: 700, letterSpacing: "-0.022em", color: theme.text, fontFamily: theme.fontFamily }}>
          <Highlighted text={slide.headline} highlight={slide.highlight} color={theme.accent} />
        </p>
        {slide.body.trim() && <p style={{ margin: `${px(36)} 0 0`, fontSize: pxMin(52), lineHeight: 1.36, fontWeight: 400, color: theme.text, opacity: 0.92 }}>{slide.body}</p>}
        {slide.type === "cta" && <CtaBox slide={slide} theme={theme} size={44} />}
      </Fit>
      <div style={{ height: 2, background: alpha(theme.text, 0.12), margin: "0 0 32px", flex: "none" }} />
      <Footer {...p} />
    </Frame>
  );
}

// ─── Lista y datos ────────────────────────────────────────────────────────

function Lista(p: SlideProps) {
  const { slide, theme, index, total } = p;
  const cover = slide.type === "cover";
  const data = slide.type === "data";
  const numbered = slide.type === "item" || slide.type === "step";
  const contentCount = Math.max(1, total - 2);
  const big = data && slide.highlight.trim() ? slide.highlight.trim() : numbered ? pad2(index) : null;
  return (
    <Frame theme={theme} style={{ padding: "84px 92px 72px" }}>
      <Backdrop theme={theme} variant="glow" />
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 18, height: 48, flex: "none" }}>
        <span style={{ fontFamily: MONO, fontSize: 26, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: theme.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {slide.kicker || (slide.type === "step" ? `Paso ${index}` : cover ? "Guárdalo" : "")}
        </span>
      </div>
      <Fit fitKey={fitKeyOf(p)} justify="center" style={{ position: "relative", padding: "28px 0 40px" }}>
        {big && (
          <div style={{ fontSize: px(data ? 210 : 300), lineHeight: 0.9, fontWeight: theme.heavy, letterSpacing: "-0.06em", color: theme.accent, marginBottom: px(36), marginLeft: px(-8) }}>{big}</div>
        )}
        {cover && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: px(14), marginBottom: px(56) }}>
            {Array.from({ length: contentCount }, (_, i) => (
              <span key={i} style={{ fontFamily: MONO, fontSize: px(30), fontWeight: 700, color: i === 0 ? theme.accentText : theme.muted, background: i === 0 ? theme.accent : alpha(theme.text, 0.07), border: `2px solid ${i === 0 ? theme.accent : alpha(theme.text, 0.14)}`, borderRadius: px(16), padding: `${px(10)} ${px(18)}` }}>
                {pad2(i + 1)}
              </span>
            ))}
          </div>
        )}
        <h2 style={{ margin: 0, fontFamily: theme.fontFamily, fontSize: px(cover ? 118 : data ? 74 : 84), lineHeight: 1.04, fontWeight: theme.heavy, letterSpacing: theme.font === "playfair" ? "-0.015em" : "-0.032em", color: theme.text }}>
          {data ? slide.headline : <Highlighted text={slide.headline} highlight={slide.highlight} color={theme.accent} />}
        </h2>
        {slide.body.trim() && (
          <p style={{ margin: `${px(36)} 0 0`, fontSize: pxMin(42), lineHeight: 1.38, fontWeight: 450, color: theme.muted, fontFamily: '"Inter", sans-serif', paddingLeft: px(32), borderLeft: `${px(6)} solid ${theme.accent}` }}>{slide.body}</p>
        )}
        {slide.type === "cta" && <CtaBox slide={slide} theme={theme} />}
      </Fit>
      <div style={{ position: "relative", display: "flex", gap: 8, marginBottom: 30, flex: "none" }} aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} style={{ flex: 1, height: 8, borderRadius: 99, background: i <= index ? theme.accent : alpha(theme.text, 0.12) }} />
        ))}
      </div>
      <Footer {...p} />
    </Frame>
  );
}

// ─── Cita ─────────────────────────────────────────────────────────────────

function Cita(p: SlideProps) {
  const { slide, theme, identity } = p;
  const serif = theme.font === "inter" ? SERIF : theme.fontFamily;
  return (
    <Frame theme={theme} style={{ padding: "88px 100px 72px" }}>
      <Backdrop theme={theme} variant="glow" />
      <div aria-hidden style={{ position: "absolute", left: 64, top: 10, fontFamily: SERIF, fontSize: 620, lineHeight: 1, color: alpha(theme.accent, 0.9), fontWeight: 700 }}>“</div>
      <div style={{ height: 300, flex: "none" }} />
      <Fit fitKey={fitKeyOf(p)} justify="flex-start" style={{ position: "relative", paddingBottom: 40 }}>
        {slide.kicker.trim() && (
          <div style={{ fontFamily: MONO, fontSize: px(26), fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: theme.accent, marginBottom: px(32) }}>{slide.kicker}</div>
        )}
        <h2 style={{ margin: 0, fontFamily: serif, fontStyle: "italic", fontSize: px(slide.type === "cover" ? 104 : 88), lineHeight: 1.12, fontWeight: 600, letterSpacing: "-0.01em", color: theme.text }}>
          <Highlighted text={slide.headline} highlight={slide.highlight} color={theme.accent} />
        </h2>
        {slide.body.trim() && <p style={{ margin: `${px(40)} 0 0`, fontSize: pxMin(40), lineHeight: 1.4, fontWeight: 450, color: theme.muted, fontFamily: '"Inter", sans-serif' }}>{slide.body}</p>}
        {slide.type === "cta" ? (
          <CtaBox slide={slide} theme={theme} size={42} />
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: px(20), marginTop: px(52), fontFamily: '"Inter", sans-serif' }}>
            <span style={{ width: px(64), height: 3, background: theme.accent, borderRadius: 2 }} />
            <span style={{ fontSize: px(34), fontWeight: 700, color: theme.text }}>{identity.name}</span>
          </div>
        )}
      </Fit>
      <Footer {...p} />
    </Frame>
  );
}

// ─── Portada impacto ──────────────────────────────────────────────────────

function Impacto(p: SlideProps) {
  const { slide, theme, index } = p;
  const cover = slide.type === "cover";
  const fam = theme.font === "inter" ? '"Montserrat Carrusel", "Inter", sans-serif' : theme.fontFamily;
  return (
    <Frame theme={theme} style={{ padding: "80px 84px 72px" }}>
      <Backdrop theme={theme} variant="none" />
      {!cover && (
        <div aria-hidden style={{ position: "absolute", right: -30, bottom: 70, fontFamily: fam, fontWeight: 900, fontSize: 620, lineHeight: 0.8, letterSpacing: "-0.06em", color: alpha(theme.text, 0.05) }}>{pad2(index + 1)}</div>
      )}
      <div style={{ position: "relative", display: "flex", height: 56, alignItems: "center", flex: "none" }}>
        {(slide.kicker || cover) && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 12, border: `3px solid ${theme.text}`, borderRadius: 99, padding: "8px 24px", fontSize: 26, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: MONO, color: theme.text, whiteSpace: "nowrap" }}>
            <span style={{ width: 12, height: 12, borderRadius: 99, background: theme.accent }} />
            {slide.kicker || "Nuevo"}
          </span>
        )}
      </div>
      <Fit fitKey={fitKeyOf(p)} justify="center" style={{ position: "relative", padding: "40px 0" }}>
        <h2 style={{ margin: 0, fontFamily: fam, fontSize: px(cover ? 158 : 112), lineHeight: 0.98, fontWeight: 900, letterSpacing: "-0.03em", textTransform: "uppercase", color: theme.text }}>
          <Highlighted text={slide.headline} highlight={slide.highlight} color={theme.accent} marker={{ bg: theme.accent, fg: theme.accentText }} />
        </h2>
        {slide.body.trim() && <p style={{ margin: `${px(48)} 0 0`, fontSize: pxMin(44), lineHeight: 1.34, fontWeight: 500, color: theme.muted, fontFamily: '"Inter", sans-serif', maxWidth: "92%" }}>{slide.body}</p>}
        {slide.type === "cta" && <CtaBox slide={slide} theme={theme} size={48} />}
      </Fit>
      {cover ? (
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", background: theme.text, color: theme.bg, borderRadius: 28, padding: "26px 34px", flex: "none" }}>
          <span style={{ fontSize: 30, fontWeight: 800, fontFamily: '"Inter", sans-serif' }}>{p.identity.handle || p.identity.name}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: MONO, fontSize: 26, fontWeight: 800, letterSpacing: "0.14em" }}>
            DESLIZA
            <span style={{ width: 56, height: 56, borderRadius: 99, background: theme.accent, display: "grid", placeItems: "center" }}>
              <Arrow color={theme.accentText} size={30} />
            </span>
          </span>
        </div>
      ) : (
        <Footer {...p} />
      )}
    </Frame>
  );
}

const RENDERERS: Record<TemplateKey, (p: SlideProps) => ReactNode> = { editorial: Editorial, tweet: Tweet, lista: Lista, cita: Cita, impacto: Impacto };

export function Slide(props: SlideProps) {
  const Render = RENDERERS[props.template] ?? Editorial;
  return <Render {...props} />;
}

/**
 * Slide escalado al ancho de su contenedor (vista previa, miniaturas y lista).
 * El nodo interno mide siempre 1080×1350: el ajuste del texto no depende del tamaño en pantalla.
 */
export function ScaledSlide({ className, label, ...props }: SlideProps & { className?: string; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / SLIDE_WIDTH);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} role="img" aria-label={label ?? `Slide ${props.index + 1}: ${props.slide.headline}`} className={cn("relative aspect-[4/5] w-full overflow-hidden", className)}>
      <div aria-hidden style={{ position: "absolute", left: 0, top: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT, transform: `scale(${scale})`, transformOrigin: "0 0", visibility: scale ? "visible" : "hidden" }}>
        <Slide {...props} />
      </div>
    </div>
  );
}
