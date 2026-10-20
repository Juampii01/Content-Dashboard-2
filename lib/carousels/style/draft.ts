/**
 * Borrador de plantilla a partir de las medidas del worker (Tesseract + colores, ver worker/carruseles/medidas.py).
 *
 * Es determinista: posiciones, tamaños de letra, colores, fuente más parecida, foto y adornos salen de lo medido.
 * Claude con visión lo corrige y completa mirando las imágenes (tipo de cada slide, jerarquía, adornos); si la IA
 * falla o no está, el borrador ya es una plantilla usable.
 */
import { z } from "zod";
import { contrast, FONTS, type FontKey } from "../theme";
import { type LayoutKey, type TemplateLayout, type TemplateSpec, templateSpecSchema } from "../template-spec";

const block = z.object({
  role: z.string().optional(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  lines: z.number(),
  font_px: z.number(),
  line_height: z.number().nullable().optional(),
  chars: z.number(),
  color: z.string(),
  back: z.string().optional(),
  highlight: z.string().nullable().optional(),
  align: z.enum(["left", "center", "right"]),
  upper_ratio: z.number(),
});
const fontGuess = z.object({ font: z.string(), score: z.number(), weight: z.number().nullable().optional() });
const slide = z.object({
  index: z.number(),
  aspect: z.number(),
  background: z.object({ kind: z.string(), color: z.string(), colors: z.array(z.string()), angle: z.number() }),
  palette: z.array(z.object({ hex: z.string(), share: z.number() })),
  text_blocks: z.array(block),
  photo: z.object({ present: z.boolean(), share: z.number().optional(), x: z.number().optional(), y: z.number().optional(), w: z.number().optional(), h: z.number().optional() }),
  fonts: z.object({ headline: z.array(fontGuess), body: z.array(fontGuess) }).partial(),
  ornaments: z.object({
    hlines: z.array(z.object({ y: z.number(), x: z.number(), w: z.number(), thickness: z.number(), color: z.string() })),
    frame: z.boolean(),
    handle: z.object({ x: z.number(), y: z.number() }).passthrough().nullable(),
    avatar: z.boolean().optional(),
    big_number: z.boolean(),
    counter: z.object({ x: z.number(), y: z.number() }).nullable().optional(),
  }),
});
export const measurementsSchema = z.object({
  version: z.number(),
  summary: z.object({
    slides: z.number(),
    background: z.string(),
    background_kind: z.string().nullable().optional(),
    text: z.string(),
    body: z.string().nullable().optional(),
    accent: z.string().nullable().optional(),
    fonts: z.object({ headline: z.string().nullable(), body: z.string().nullable() }).partial(),
    uses_photo: z.boolean(),
  }),
  slides: z.array(slide).min(1).max(20),
});
export type Measurements = z.infer<typeof measurementsSchema>;
type MSlide = Measurements["slides"][number];
type MBlock = MSlide["text_blocks"][number];

const HEX = /^#[0-9a-f]{6}$/i;
const W = 1080;
const H = 1350;

function median(values: number[], fallback: number): number {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return fallback;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

function mix(a: string, b: string, t: number): string {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const ch = [16, 8, 0].map((s) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t));
  return `#${ch.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const isFont = (v: unknown): v is FontKey => typeof v === "string" && v in FONTS;
const SERIF_FONTS: FontKey[] = ["playfair", "instrument"];

function roleOf(index: number, total: number): LayoutKey {
  if (index === 0) return "cover";
  if (index === total - 1 && total >= 3) return "cta";
  return "content";
}

function photoLayout(s: MSlide): TemplateLayout["photo"] {
  const p = s.photo;
  if (!p.present || p.x == null || p.y == null || p.w == null || p.h == null) return { position: "none", size: 0.5, inset: 0, radius: 0, overlay: 0 };
  const inset = p.x > 0.02 && p.x < 0.15 ? Math.round(p.x * W) : 0;
  const radius = inset ? 24 : 0;
  if ((p.share ?? 0) > 0.8) return { position: "full", size: 1, inset: 0, radius: 0, overlay: 0.45 };
  if (p.w > 0.8 && p.y < 0.08) return { position: "top", size: Math.min(0.9, p.y + p.h), inset, radius, overlay: 0 };
  if (p.w > 0.8 && p.y + p.h > 0.92) return { position: "bottom", size: Math.min(0.9, 1 - p.y), inset, radius, overlay: 0 };
  if (p.h > 0.75 && p.x < 0.08) return { position: "left", size: Math.min(0.8, p.x + p.w), inset, radius, overlay: 0 };
  if (p.h > 0.75 && p.x + p.w > 0.92) return { position: "right", size: Math.min(0.8, 1 - p.x), inset, radius, overlay: 0 };
  // Foto suelta en el medio: se trata como foto arriba del tamaño medido.
  return { position: "top", size: Math.min(0.85, p.y + p.h), inset: inset || 72, radius: 24, overlay: 0 };
}

function layoutFrom(slides: MSlide[], role: LayoutKey, pad: { x: number; y: number }, fallback?: TemplateLayout): TemplateLayout {
  const blocks = slides.flatMap((s) => s.text_blocks.filter((b) => b.role === "headline" || b.role === "body" || b.role === "kicker" || b.role === "number"));
  const heads = slides.flatMap((s) => s.text_blocks.filter((b) => b.role === "headline"));
  const bodies = slides.flatMap((s) => s.text_blocks.filter((b) => b.role === "body"));
  const kickers = slides.flatMap((s) => s.text_blocks.filter((b) => b.role === "kicker"));
  const photos = slides.map(photoLayout);
  const photo = photos.find((p) => p.position !== "none") ?? photos[0] ?? { position: "none" as const, size: 0.5, inset: 0, radius: 0, overlay: 0 };
  if (!blocks.length && fallback) return { ...fallback, photo };

  // Zona disponible para el texto: lo que deja la foto, menos el margen.
  const px = pad.x / W;
  const py = pad.y / H;
  let y0 = py;
  let y1 = 1 - py;
  let x0 = px;
  let x1 = 1 - px;
  if (photo.position === "top") y0 = photo.size + 0.02;
  if (photo.position === "bottom") y1 = 1 - photo.size - 0.02;
  if (photo.position === "left") x0 = photo.size + px * 0.6;
  if (photo.position === "right") x1 = 1 - photo.size - px * 0.6;
  // Si la etiqueta va arriba del todo (lejos del titular), el texto empieza debajo de ella.
  const headTop = median(heads.map((b) => b.y), 0.4);
  const kickerTop = median(kickers.map((b) => b.y), -1);
  const kickerAt: "top" | "inline" = kickers.length && headTop - kickerTop > 0.18 ? "top" : "inline";
  if (kickerAt === "top" && photo.position !== "top") y0 = Math.max(y0, kickerTop + 0.07);
  const textBlocks = blocks.filter((b) => !(kickerAt === "top" && b.role === "kicker"));
  const top = median(textBlocks.map((b) => b.y), (y0 + y1) / 2);
  const bottom = median(textBlocks.map((b) => b.y + b.h), (y0 + y1) / 2);
  const center = (top + bottom) / 2;
  const rel = (center - y0) / Math.max(0.05, y1 - y0);
  const vAlign: "top" | "center" | "bottom" = rel < 0.36 ? "top" : rel > 0.64 ? "bottom" : "center";
  const aligns = heads.map((b) => b.align);
  const align = (["left", "center", "right"] as const).reduce((best, a) => (aligns.filter((x) => x === a).length > aligns.filter((x) => x === best).length ? a : best), "left" as "left" | "center" | "right");

  const headSize = median(heads.map((b) => b.font_px), role === "cover" ? 104 : 84);
  const upper = median(heads.map((b) => b.upper_ratio), 0) > 0.8;
  const lineHeight = median(heads.map((b) => b.line_height ?? NaN), upper ? 1 : 1.08);
  const bodySize = median(bodies.map((b) => b.font_px), 38);
  const bodyLh = median(bodies.map((b) => b.line_height ?? NaN), 1.4);
  const kickerUpper = median(kickers.map((b) => b.upper_ratio), 1) > 0.8;
  // Caja detrás del texto: el fondo inmediato del titular es distinto del fondo del slide (y no hay foto detrás).
  const backs = heads.map((b) => b.back).filter((c): c is string => Boolean(c && HEX.test(c)));
  const slideBg = slides[0]?.background.color ?? "#000000";
  const panelColor = backs.length ? backs[0]! : null;
  const panel = panelColor && photo.position !== "full" && contrast(panelColor, slideBg) > 1.35 && contrast(panelColor, slideBg) < 21 ? { kind: "card" as const, color: panelColor, radius: 28, opacity: 1 } : { kind: "none" as const, color: null, radius: 0, opacity: 1 };

  return {
    photo,
    text: { x: x0, y: y0, w: Math.max(0.2, x1 - x0), h: Math.max(0.15, y1 - y0), align, vAlign },
    headline: { size: Math.round(Math.min(220, Math.max(28, headSize))), weight: 700, uppercase: upper, italic: false, tracking: upper ? 0.005 : -0.015, lineHeight: Math.min(1.6, Math.max(0.85, Number(lineHeight.toFixed(2)))) },
    body: { size: Math.round(Math.min(80, Math.max(18, bodySize))), weight: 400, lineHeight: Math.min(1.8, Math.max(1.1, Number(bodyLh.toFixed(2)))) },
    kicker: { style: kickers.length ? (kickerUpper ? "mono" : "plain") : "none", at: kickerAt },
    panel,
  };
}

/** Borrador de spec a partir de las medidas. */
export function draftSpec(m: Measurements): TemplateSpec {
  const s = m.summary;
  const total = m.slides.length;
  const bg = HEX.test(s.background) ? s.background : "#111111";
  const dark = contrast("#ffffff", bg) > contrast("#111111", bg);
  const text = HEX.test(s.text) && contrast(s.text, bg) >= 3 ? s.text : dark ? "#ffffff" : "#111111";
  const muted = s.body && HEX.test(s.body) && contrast(s.body, bg) >= 2.2 ? s.body : mix(text, bg, 0.35);
  const accent = s.accent && HEX.test(s.accent) ? s.accent : dark ? "#4da3ff" : "#0070f8";
  const heading: FontKey = isFont(s.fonts.headline) ? s.fonts.headline : "inter";
  const body: FontKey = isFont(s.fonts.body) ? s.fonts.body : SERIF_FONTS.includes(heading) || heading === "anton" || heading === "caveat" ? "inter" : heading;

  const byRole: Record<LayoutKey, MSlide[]> = { cover: [], content: [], cta: [] };
  m.slides.forEach((sl, i) => byRole[roleOf(i, total)].push(sl));
  const leftMargins = m.slides.flatMap((sl) => sl.text_blocks.filter((b) => b.role === "headline" && b.align === "left").map((b) => b.x * W));
  const topMargins = m.slides.flatMap((sl) => sl.text_blocks.filter((b) => !sl.photo.present || (sl.photo.y ?? 0) > 0.1).map((b) => b.y * H));
  const pad = { x: Math.round(Math.min(160, Math.max(40, median(leftMargins, 88)))), y: Math.round(Math.min(160, Math.max(40, topMargins.length ? Math.min(...topMargins) : 88))) };

  const content = layoutFrom(byRole.content.length ? byRole.content : m.slides, "content", pad);
  const cover = layoutFrom(byRole.cover, "cover", pad, content);
  const cta = layoutFrom(byRole.cta.length ? byRole.cta : byRole.content, "cta", pad, content);
  // Peso del titular: el de la fuente medida (las serif editoriales van finas).
  const weightGuess = m.slides.flatMap((sl) => (sl.fonts.headline ?? []).filter((f) => f.font === heading).map((f) => f.weight ?? null)).find((w) => w != null);
  for (const l of [cover, content, cta]) l.headline.weight = weightGuess ?? (SERIF_FONTS.includes(heading) || heading === "anton" ? 400 : 700);

  const firstBg = m.slides.find((sl) => !sl.photo.present)?.background ?? m.slides[0]!.background;
  const kind = s.background_kind === "gradient" || s.background_kind === "texture" ? s.background_kind : m.slides.every((sl) => (sl.photo.share ?? 0) > 0.8) ? "photo" : "solid";
  const hlines = m.slides.flatMap((sl) => sl.ornaments.hlines.filter((l) => l.w < 0.35 && l.thickness <= 8));
  const counters = m.slides.map((sl) => sl.ornaments.counter).filter(Boolean) as { x: number; y: number }[];
  const handles = m.slides.map((sl) => sl.ornaments.handle).filter(Boolean) as { x: number; y: number }[];
  const avatar = m.slides.filter((sl) => sl.ornaments.avatar).length >= Math.max(1, total / 2);
  const highlights = m.slides.flatMap((sl) => sl.text_blocks.filter((b) => b.highlight));

  const spec: TemplateSpec = {
    version: 1,
    palette: {
      bg,
      surface: mix(bg, text, 0.07),
      text,
      muted,
      accent,
      accentText: contrast("#ffffff", accent) >= contrast("#111111", accent) ? "#ffffff" : "#111111",
    },
    background: {
      kind,
      colors: (kind === "gradient" ? firstBg.colors : [firstBg.color]).filter((c) => HEX.test(c)).slice(0, 3).concat(HEX.test(firstBg.color) ? [] : [bg]).slice(0, 3),
      angle: firstBg.angle,
      texture: kind === "texture" ? "grain" : "none",
    },
    fonts: { heading, body },
    padding: pad,
    highlight: highlights.length && SERIF_FONTS.includes(heading) ? "italic" : "color",
    ornaments: {
      numbering: m.slides.some((sl) => sl.ornaments.big_number) ? "big" : "none",
      divider: hlines.length >= Math.max(1, total / 2),
      arrow: false,
      frame: m.slides.filter((sl) => sl.ornaments.frame).length >= Math.max(1, total / 2) ? "border" : "none",
      sticker: false,
      handle: avatar ? "none" : handles.length >= Math.max(1, total / 2) ? (median(handles.map((h) => h.y), 1) < 0.5 ? "top" : "bottom") : "none",
      counter: counters.length >= Math.max(1, (total - 1) / 2) ? (median(counters.map((c) => c.y), 1) < 0.5 ? "top" : "bottom") : "none",
      progress: false,
      avatar,
    },
    usesPhoto: s.uses_photo,
    layouts: { cover, content, cta },
    structure: m.slides.map((sl, i) => {
      const layout = roleOf(i, total);
      const number = sl.ornaments.big_number;
      return { type: layout === "cover" ? "cover" : layout === "cta" ? "cta" : number ? "step" : "item", layout, photo: sl.photo.present };
    }),
    notes: describe({ bg, heading, accent, photo: s.uses_photo, avatar, kind }),
  };
  if (!spec.background.colors.length) spec.background.colors = [bg];
  return templateSpecSchema.parse(spec);
}

function describe(d: { bg: string; heading: FontKey; accent: string; photo: boolean; avatar: boolean; kind: string }): string {
  const fondo = d.kind === "gradient" ? "degradado" : d.kind === "texture" ? "con textura" : d.kind === "photo" ? "de foto" : "liso";
  const parts = [`Fondo ${fondo} ${d.bg}`, `titulares en ${FONTS[d.heading].label}`, `acento ${d.accent}`];
  if (d.photo) parts.push("con foto");
  if (d.avatar) parts.push("cabecera con foto de perfil");
  return `${parts.join(", ")}.`;
}
