"use client";

import type { CSSProperties, ReactNode } from "react";
import { FONTS, SLIDE_HEIGHT as H, SLIDE_WIDTH as W, type ResolvedTheme } from "@/lib/carousels/theme";
import { layoutFor, type TemplateLayout, type TemplateSpec } from "@/lib/carousels/template-spec";
import { alpha, Arrow, Avatar, CtaBox, Fit, fitKeyOf, Frame, Highlighted, isDark, MONO, pad2, px, pxMin, SlideImage, VerifiedLike, type SlideProps } from "./slide-parts";

/**
 * Motor de las plantillas propias (copiadas de una referencia). Dibuja el spec con los textos del cliente:
 * fondo, zona de foto, zona de texto con ajuste automático, etiqueta, numeración, contador, handle y adornos.
 * Con la paleta "referencia" usa los colores del original; con cualquier otra, los de esa paleta (por ejemplo, Mi marca).
 */
type Props = SlideProps & { spec: TemplateSpec };

function backgroundStyle(spec: TemplateSpec, theme: ResolvedTheme): CSSProperties {
  const ref = theme.palette === "referencia";
  const b = spec.background;
  if (b.kind === "gradient") {
    const colors = ref && b.colors.length > 1 ? b.colors : [theme.bg, mixHex(theme.bg, theme.accent, isDark(theme.bg) ? 0.22 : 0.12)];
    return { background: `linear-gradient(${b.angle}deg, ${colors.join(", ")})` };
  }
  return { background: ref ? (b.colors[0] ?? theme.bg) : theme.bg };
}

function mixHex(a: string, b: string, t: number): string {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const ch = [16, 8, 0].map((s) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t));
  return `#${ch.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const GRAIN = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0.18 0"/></filter><rect width="240" height="240" filter="url(#n)"/></svg>')}")`;

function Texture({ spec, theme }: { spec: TemplateSpec; theme: ResolvedTheme }) {
  const t = spec.background.kind === "texture" && spec.background.texture === "none" ? "grain" : spec.background.texture;
  if (t === "none") return null;
  const ink = alpha(theme.text, isDark(theme.bg) ? 0.07 : 0.08);
  const styles: Record<string, CSSProperties> = {
    grain: { backgroundImage: GRAIN, backgroundSize: "240px 240px", opacity: 0.9 },
    paper: { backgroundImage: GRAIN, backgroundSize: "180px 180px", opacity: 0.55 },
    dots: { backgroundImage: `radial-gradient(${ink} 2.5px, transparent 2.5px)`, backgroundSize: "36px 36px" },
    grid: { backgroundImage: `linear-gradient(${ink} 2px, transparent 2px), linear-gradient(90deg, ${ink} 2px, transparent 2px)`, backgroundSize: "90px 90px" },
    lines: { backgroundImage: `repeating-linear-gradient(0deg, ${ink} 0 2px, transparent 2px 54px)` },
  };
  return <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", ...styles[t] }} />;
}

function photoRect(l: TemplateLayout["photo"]): CSSProperties | null {
  const i = l.inset;
  switch (l.position) {
    case "top":
      return { left: i, top: i, width: W - 2 * i, height: Math.round(l.size * H) - i };
    case "bottom":
      return { left: i, top: Math.round((1 - l.size) * H), width: W - 2 * i, height: Math.round(l.size * H) - i };
    case "left":
      return { left: i, top: i, width: Math.round(l.size * W) - i, height: H - 2 * i };
    case "right":
      return { left: Math.round((1 - l.size) * W), top: i, width: Math.round(l.size * W) - i, height: H - 2 * i };
    case "full":
      return { left: 0, top: 0, width: W, height: H };
    default:
      return null;
  }
}

function Kicker({ text, style, theme, number }: { text: string; style: TemplateLayout["kicker"]["style"]; theme: ResolvedTheme; number?: string | null }) {
  if (!text.trim() && !number) return null;
  const content = (
    <>
      {number && <span style={{ color: theme.accent }}>{number}</span>}
      {text}
    </>
  );
  const base: CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%", display: "inline-flex", alignItems: "center", gap: 14 };
  if (style === "pill")
    return <span style={{ ...base, border: `3px solid ${theme.text}`, borderRadius: 99, padding: "8px 24px", fontFamily: MONO, fontSize: 24, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: theme.text }}>{content}</span>;
  if (style === "bar")
    return (
      <span style={{ ...base, fontFamily: '"Inter", sans-serif', fontSize: 28, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: theme.accent }}>
        <span style={{ width: 8, height: 34, background: theme.accent, borderRadius: 4, flex: "none" }} />
        {content}
      </span>
    );
  if (style === "mono") return <span style={{ ...base, fontFamily: MONO, fontSize: 26, fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase", color: alpha(theme.text, 0.75) }}>{content}</span>;
  return <span style={{ ...base, fontFamily: '"Inter", sans-serif', fontSize: 30, fontWeight: 700, color: theme.accent }}>{content}</span>;
}

function Divider({ theme, width = 120 }: { theme: ResolvedTheme; width?: number }) {
  return <div aria-hidden style={{ width, height: 3, background: theme.text, borderRadius: 2, flex: "none" }} />;
}

export function CustomSlide(p: Props) {
  const { slide, theme, spec, identity, index, total } = p;
  const layout = layoutFor(spec, slide.type);
  const orn = spec.ornaments;
  const pad = spec.padding;
  const last = index === total - 1;
  const numbered = (slide.type === "item" || slide.type === "step" || slide.type === "data") && index > 0;
  const number = numbered ? pad2(index) : null;
  const body = FONTS[spec.fonts.body] ?? FONTS.inter;
  const thin = theme.font === "anton" || theme.font === "instrument";
  const headWeight = thin ? 400 : layout.headline.weight;
  const photo = layout.photo.position !== "none" ? photoRect(layout.photo) : null;
  const full = layout.photo.position === "full";
  const kickerTop = layout.kicker.at === "top" && layout.kicker.style !== "none";
  const textColor = full ? (isDark(theme.bg) ? theme.text : "#ffffff") : theme.text;
  const panel = layout.panel.kind !== "none";
  const panelColor = theme.palette === "referencia" && layout.panel.color ? layout.panel.color : theme.surface;
  const t = layout.text;
  const zone: CSSProperties = {
    position: "absolute",
    left: Math.round(t.x * W),
    top: Math.round(t.y * H),
    width: Math.round(t.w * W),
    height: Math.round(t.h * H),
    display: "flex",
    flexDirection: "column",
    ...(panel
      ? {
          background: alpha(panelColor, layout.panel.opacity),
          borderRadius: layout.panel.kind === "band" ? 0 : layout.panel.radius,
          padding: "44px 48px",
          boxSizing: "border-box",
          ...(layout.panel.kind === "band" ? { left: 0, width: W, paddingLeft: Math.round(t.x * W), paddingRight: Math.round(t.x * W) } : null),
        }
      : null),
  };
  const justify = t.vAlign === "top" ? "flex-start" : t.vAlign === "bottom" ? "flex-end" : "center";
  const counter = orn.counter !== "none" && (
    <span style={{ fontFamily: MONO, fontSize: 26, fontWeight: 500, letterSpacing: "0.08em", color: alpha(textColor, 0.7), whiteSpace: "nowrap" }}>
      {pad2(index + 1)} / {pad2(total)}
    </span>
  );
  const handle = orn.handle !== "none" && (identity.handle || identity.name) && <span style={{ fontFamily: '"Inter", sans-serif', fontSize: 28, fontWeight: 600, color: alpha(textColor, 0.7), whiteSpace: "nowrap" }}>{identity.handle || identity.name}</span>;
  const kicker = <Kicker text={slide.kicker} style={layout.kicker.style === "none" ? "plain" : layout.kicker.style} theme={{ ...theme, text: textColor }} number={orn.numbering === "plain" && number ? `${number}.` : null} />;

  const topRow: ReactNode[] = [];
  if (kickerTop && (slide.kicker.trim() || (orn.numbering === "plain" && number))) topRow.push(<span key="k" style={{ minWidth: 0 }}>{kicker}</span>);
  if (orn.handle === "top" && handle) topRow.push(<span key="h">{handle}</span>);
  if (orn.counter === "top" && counter) topRow.push(<span key="c" style={{ marginLeft: "auto" }}>{counter}</span>);
  const bottomRow: ReactNode[] = [];
  if (orn.handle === "bottom" && handle) bottomRow.push(<span key="h">{handle}</span>);
  if (orn.progress)
    bottomRow.push(
      <span key="p" aria-hidden style={{ display: "flex", gap: 6, flex: 1, maxWidth: 360 }}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} style={{ flex: 1, height: 6, borderRadius: 99, background: i <= index ? theme.accent : alpha(textColor, 0.15) }} />
        ))}
      </span>,
    );
  if (orn.counter === "bottom" && counter) bottomRow.push(<span key="c" style={{ marginLeft: "auto" }}>{counter}</span>);
  if (orn.arrow && !last)
    bottomRow.push(
      <span key="a" style={{ marginLeft: orn.counter === "bottom" ? 0 : "auto", display: "inline-flex" }}>
        <Arrow color={theme.accent} size={44} />
      </span>,
    );

  return (
    <Frame theme={{ ...theme, text: textColor }} style={{ ...backgroundStyle(spec, theme), fontFamily: body.family }}>
      <Texture spec={spec} theme={theme} />
      {photo && (
        <div style={{ position: "absolute", overflow: "hidden", borderRadius: layout.photo.radius, ...photo }}>
          <SlideImage url={slide.imageUrl} theme={theme} />
          {full && <div aria-hidden style={{ position: "absolute", inset: 0, background: `linear-gradient(to bottom, ${alpha("#000000", layout.photo.overlay * 0.5)}, ${alpha("#000000", layout.photo.overlay)})` }} />}
        </div>
      )}
      {orn.frame !== "none" && (
        <div aria-hidden style={{ position: "absolute", inset: orn.frame === "inset" ? 36 : 22, border: `${orn.frame === "inset" ? 2 : 4}px solid ${alpha(textColor, orn.frame === "inset" ? 0.35 : 0.85)}`, borderRadius: orn.frame === "inset" ? 28 : 0, pointerEvents: "none" }} />
      )}
      {orn.sticker && slide.type === "cover" && (
        <div aria-hidden style={{ position: "absolute", right: pad.x, top: pad.y + 40, width: 150, height: 150, borderRadius: 999, background: theme.accent, color: theme.accentText, display: "grid", placeItems: "center", transform: "rotate(-12deg)", fontFamily: MONO, fontWeight: 800, fontSize: 24, letterSpacing: "0.1em" }}>
          DESLIZA
        </div>
      )}
      {topRow.length > 0 && (
        <div style={{ position: "absolute", left: pad.x, right: pad.x, top: pad.y, display: "flex", flexDirection: "column", gap: 30 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>{topRow}</div>
          {kickerTop && orn.divider && <Divider theme={{ ...theme, text: textColor }} />}
        </div>
      )}
      <div style={zone}>
        <Fit fitKey={`${fitKeyOf(p)}\u0001${spec.notes}\u0001${index}`} justify={justify}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: t.align === "center" ? "center" : t.align === "right" ? "flex-end" : "flex-start", textAlign: t.align }}>
            {orn.avatar && (
              <div style={{ display: "flex", alignItems: "center", gap: px(26), marginBottom: px(52), textAlign: "left" }}>
                <Avatar identity={identity} theme={theme} size={124} />
                <div style={{ minWidth: 0, fontFamily: '"Inter", sans-serif' }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: px(44), fontWeight: 800, color: textColor, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
                    <span>{identity.name}</span>
                    <VerifiedLike color={theme.accent} />
                  </div>
                  {identity.handle && <div style={{ fontSize: px(36), color: theme.muted, marginTop: 6, lineHeight: 1.15 }}>{identity.handle}</div>}
                </div>
              </div>
            )}
            {orn.numbering === "big" && number && (
              <div style={{ fontFamily: theme.fontFamily, fontSize: px(Math.min(300, layout.headline.size * 2.2)), lineHeight: 0.9, fontWeight: headWeight, color: theme.accent, marginBottom: px(28), letterSpacing: "-0.04em" }}>{number}</div>
            )}
            {orn.numbering === "badge" && number && (
              <div style={{ width: px(84), height: px(84), borderRadius: 999, background: theme.accent, color: theme.accentText, display: "grid", placeItems: "center", fontFamily: MONO, fontWeight: 800, fontSize: px(34), marginBottom: px(30) }}>{number}</div>
            )}
            {!kickerTop && layout.kicker.style !== "none" && (slide.kicker.trim() || (orn.numbering === "plain" && number)) && <div style={{ marginBottom: px(30), maxWidth: "100%" }}>{kicker}</div>}
            {!kickerTop && orn.divider && <div style={{ marginBottom: px(36) }}><Divider theme={{ ...theme, text: textColor }} width={110} /></div>}
            <h2
              style={{
                margin: 0,
                fontFamily: theme.fontFamily,
                fontSize: px(layout.headline.size),
                lineHeight: layout.headline.lineHeight,
                fontWeight: headWeight,
                fontStyle: layout.headline.italic ? "italic" : "normal",
                letterSpacing: `${layout.headline.tracking}em`,
                textTransform: layout.headline.uppercase ? "uppercase" : "none",
                color: textColor,
                maxWidth: "100%",
              }}
            >
              <Highlighted
                text={slide.headline}
                highlight={slide.highlight}
                color={theme.accent}
                marker={spec.highlight === "marker" ? { bg: theme.accent, fg: theme.accentText } : undefined}
                mode={spec.highlight === "underline" ? "underline" : spec.highlight === "italic" ? "italic" : undefined}
              />
            </h2>
            {slide.body.trim() && (
              <p style={{ margin: `${px(Math.round(layout.body.size * 1.05))} 0 0`, fontFamily: body.family, fontSize: pxMin(layout.body.size, 26), lineHeight: layout.body.lineHeight, fontWeight: layout.body.weight, color: full ? alpha(textColor, 0.85) : theme.muted, maxWidth: "100%" }}>
                {slide.body}
              </p>
            )}
            {slide.type === "cta" && <CtaBox slide={slide} theme={theme} size={Math.max(34, Math.min(46, Math.round(layout.body.size * 1.1)))} />}
          </div>
        </Fit>
      </div>
      {bottomRow.length > 0 && <div style={{ position: "absolute", left: pad.x, right: pad.x, bottom: Math.max(40, pad.y * 0.75), display: "flex", alignItems: "center", gap: 24 }}>{bottomRow}</div>}
    </Frame>
  );
}
