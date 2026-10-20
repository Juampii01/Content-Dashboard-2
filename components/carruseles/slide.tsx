"use client";

import "./slides.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { customIdOf, isTemplate, SLIDE_HEIGHT, SLIDE_WIDTH, type TemplateKey } from "@/lib/carousels/theme";
import { cn } from "@/lib/utils";
import { useCustomTemplate } from "./custom-templates";
import { CustomSlide } from "./custom-slide";
import {
  alpha,
  Arrow,
  Avatar,
  Backdrop,
  Counter,
  CtaBox,
  Fit,
  fitKeyOf,
  Footer,
  Frame,
  Highlighted,
  MONO,
  pad2,
  px,
  pxMin,
  SERIF,
  SlideImage,
  VerifiedLike,
  type SlideProps,
} from "./slide-parts";

export type { SlideProps } from "./slide-parts";
export { SlideImage } from "./slide-parts";

/**
 * Plantillas de carrusel. Cada slide se dibuja en un nodo de 1080×1350 con estilos en línea:
 * el mismo componente sirve para la vista previa (escalada con `transform`) y para la exportación a JPG,
 * así lo que se ve es exactamente lo que se descarga.
 */

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
        {slide.imageUrl && (
          <div style={{ marginTop: px(40), height: px(460), borderRadius: px(32), overflow: "hidden", border: `2px solid ${alpha(theme.text, 0.12)}` }}>
            <SlideImage url={slide.imageUrl} theme={theme} />
          </div>
        )}
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

// ─── Foto + texto ─────────────────────────────────────────────────────────

function Foto(p: SlideProps) {
  const { slide, theme } = p;
  const cover = slide.type === "cover";
  return (
    <Frame theme={theme}>
      <div style={{ position: "relative", height: 900, flex: "none", overflow: "hidden" }}>
        <SlideImage url={slide.imageUrl} theme={theme} />
        <div aria-hidden style={{ position: "absolute", inset: "auto 0 0 0", height: 180, background: `linear-gradient(to bottom, transparent, ${theme.bg})` }} />
        {slide.kicker.trim() && (
          <span style={{ position: "absolute", left: 72, top: 64, display: "inline-flex", alignItems: "center", gap: 12, background: alpha(theme.bg, 0.78), color: theme.text, borderRadius: 99, padding: "10px 26px", fontFamily: MONO, fontSize: 24, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", whiteSpace: "nowrap", maxWidth: 820, overflow: "hidden", textOverflow: "ellipsis" }}>
            <span style={{ width: 12, height: 12, borderRadius: 99, background: theme.accent, flex: "none" }} />
            {slide.kicker}
          </span>
        )}
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "8px 76px 56px" }}>
        <Fit fitKey={fitKeyOf(p)} justify="center">
          <h2 style={{ margin: 0, fontFamily: theme.fontFamily, fontSize: px(cover ? 92 : 78), lineHeight: 1.04, fontWeight: theme.heavy, letterSpacing: theme.font === "playfair" || theme.font === "instrument" ? "-0.01em" : "-0.03em", color: theme.text }}>
            <Highlighted text={slide.headline} highlight={slide.highlight} color={theme.accent} />
          </h2>
          {slide.body.trim() && <p style={{ margin: `${px(20)} 0 0`, fontSize: pxMin(34, 28), lineHeight: 1.36, fontWeight: 450, color: theme.muted, fontFamily: '"Inter", sans-serif' }}>{slide.body}</p>}
          {slide.type === "cta" && <CtaBox slide={slide} theme={theme} size={38} />}
        </Fit>
        <Footer {...p} />
      </div>
    </Frame>
  );
}

const RENDERERS: Record<TemplateKey, (p: SlideProps) => ReactNode> = { editorial: Editorial, tweet: Tweet, lista: Lista, cita: Cita, impacto: Impacto, foto: Foto };

export function Slide(props: SlideProps) {
  const customId = customIdOf(props.template);
  const custom = useCustomTemplate(customId);
  if (customId) {
    if (custom) return <CustomSlide {...props} spec={custom.spec} />;
    // Plantilla propia borrada o todavía sin cargar: se dibuja con Editorial para no dejar el slide vacío.
    return <Editorial {...props} template="editorial" />;
  }
  const Render = isTemplate(props.template) ? RENDERERS[props.template] : Editorial;
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
