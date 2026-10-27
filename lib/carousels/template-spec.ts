/**
 * Plantillas propias ("copiar el estilo de un carrusel"): el diseño de una referencia descrito como datos.
 *
 * El spec guarda solo diseño: paleta, fondo, fuentes, zonas (foto y texto) por tipo de slide, tamaños de letra,
 * adornos y la estructura (tipo de cada slide). Nunca el texto, las fotos ni los logos del original.
 * Lo dibuja `components/carruseles/custom-slide.tsx` con los textos del cliente, igual en la vista previa y en el ZIP.
 *
 * Sin dependencias de servidor: lo usan la app (validar lo que devuelve la IA) y el navegador (dibujar).
 */
import { z } from "zod";
import { FONTS, contrast, type FontKey, type Palette } from "./theme";

export const FONT_KEYS = Object.keys(FONTS) as [FontKey, ...FontKey[]];
const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const frac = z.number().min(0).max(1);

export const SLIDE_TYPE_KEYS = ["cover", "item", "step", "data", "quote", "cta"] as const;
export const LAYOUT_KEYS = ["cover", "content", "cta"] as const;
export type LayoutKey = (typeof LAYOUT_KEYS)[number];

export const layoutSchema = z.object({
  photo: z.object({
    /** Dónde va la imagen del slide. "full" = de fondo, con un velo para leer el texto. */
    position: z.enum(["none", "top", "bottom", "left", "right", "full"]),
    /** Fracción del slide que ocupa (alto en top/bottom, ancho en left/right). */
    size: z.number().min(0.15).max(1),
    /** Margen alrededor de la foto, en px sobre 1080 (0 = a sangre). */
    inset: z.number().min(0).max(140),
    radius: z.number().min(0).max(80),
    /** Velo oscuro sobre la foto (0 a 0,85). */
    overlay: z.number().min(0).max(0.85),
  }),
  /** Zona del texto en fracciones del slide. */
  text: z.object({ x: frac, y: frac, w: frac, h: frac, align: z.enum(["left", "center", "right"]), vAlign: z.enum(["top", "center", "bottom"]) }),
  headline: z.object({
    size: z.number().min(28).max(220),
    weight: z.number().int().min(300).max(900),
    uppercase: z.boolean(),
    italic: z.boolean(),
    tracking: z.number().min(-0.08).max(0.3),
    lineHeight: z.number().min(0.8).max(1.7),
  }),
  body: z.object({ size: z.number().min(18).max(80), weight: z.number().int().min(300).max(800), lineHeight: z.number().min(1).max(1.8) }),
  /** Etiqueta superior: estilo y si va arriba del todo o junto al titular. */
  kicker: z.object({ style: z.enum(["none", "plain", "mono", "pill", "bar"]), at: z.enum(["top", "inline"]) }),
  /** Caja detrás del texto. */
  panel: z.object({ kind: z.enum(["none", "card", "band"]), color: hex.nullable(), radius: z.number().min(0).max(80), opacity: z.number().min(0).max(1) }),
});
export type TemplateLayout = z.infer<typeof layoutSchema>;

export const templateSpecSchema = z.object({
  version: z.literal(1),
  palette: z.object({ bg: hex, surface: hex, text: hex, muted: hex, accent: hex, accentText: hex }),
  background: z.object({
    kind: z.enum(["solid", "gradient", "photo", "texture"]),
    colors: z.array(hex).min(1).max(3),
    angle: z.number().min(0).max(360),
    texture: z.enum(["none", "grain", "paper", "dots", "grid", "lines"]),
  }),
  fonts: z.object({ heading: z.enum(FONT_KEYS), body: z.enum(FONT_KEYS) }),
  padding: z.object({ x: z.number().min(24).max(200), y: z.number().min(24).max(200) }),
  /** Cómo se resalta la palabra clave del titular. */
  highlight: z.enum(["color", "marker", "underline", "italic"]),
  ornaments: z.object({
    numbering: z.enum(["none", "big", "badge", "plain"]),
    divider: z.boolean(),
    arrow: z.boolean(),
    frame: z.enum(["none", "border", "inset"]),
    sticker: z.boolean(),
    handle: z.enum(["none", "top", "bottom"]),
    counter: z.enum(["none", "top", "bottom"]),
    progress: z.boolean(),
    avatar: z.boolean(),
  }),
  usesPhoto: z.boolean(),
  layouts: z.object({ cover: layoutSchema, content: layoutSchema, cta: layoutSchema }),
  /** Estructura de la referencia: tipo de cada slide (sirve para "respetar la estructura"). */
  structure: z.array(z.object({ type: z.enum(SLIDE_TYPE_KEYS), layout: z.enum(LAYOUT_KEYS), photo: z.boolean() })).max(20),
  /** Descripción corta del estilo, en español, para mostrar en la lista. */
  notes: z.string().max(400),
});
export type TemplateSpec = z.infer<typeof templateSpecSchema>;

export function parseSpec(value: unknown): TemplateSpec | null {
  const parsed = templateSpecSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function layoutFor(spec: TemplateSpec, type: string): TemplateLayout {
  return type === "cover" ? spec.layouts.cover : type === "cta" ? spec.layouts.cta : spec.layouts.content;
}

export function referencePalette(spec: TemplateSpec): Palette {
  return spec.palette;
}

// ─── Normalizar lo que devuelve la IA ─────────────────────────────────────

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
};
const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T) : fallback);
const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const hexOr = (v: unknown, fallback: string) => (isHex(v) ? v.toLowerCase() : fallback);

function normalizeLayout(raw: Record<string, unknown> | undefined, base: TemplateLayout): TemplateLayout {
  const r = raw ?? {};
  const photo = (r.photo ?? {}) as Record<string, unknown>;
  const text = (r.text ?? {}) as Record<string, unknown>;
  const head = (r.headline ?? {}) as Record<string, unknown>;
  const body = (r.body ?? {}) as Record<string, unknown>;
  const kicker = (r.kicker ?? {}) as Record<string, unknown>;
  const panel = (r.panel ?? {}) as Record<string, unknown>;
  const x = clamp(text.x, 0, 0.9, base.text.x);
  const y = clamp(text.y, 0, 0.9, base.text.y);
  return {
    photo: {
      position: pick(photo.position, ["none", "top", "bottom", "left", "right", "full"] as const, base.photo.position),
      size: clamp(photo.size, 0.15, 1, base.photo.size),
      inset: clamp(photo.inset, 0, 140, base.photo.inset),
      radius: clamp(photo.radius, 0, 80, base.photo.radius),
      overlay: clamp(photo.overlay, 0, 0.85, base.photo.overlay),
    },
    text: {
      x,
      y,
      w: clamp(text.w, 0.1, 1 - x, Math.min(base.text.w, 1 - x)),
      h: clamp(text.h, 0.1, 1 - y, Math.min(base.text.h, 1 - y)),
      align: pick(text.align, ["left", "center", "right"] as const, base.text.align),
      vAlign: pick(text.vAlign, ["top", "center", "bottom"] as const, base.text.vAlign),
    },
    headline: {
      size: clamp(head.size, 28, 220, base.headline.size),
      weight: Math.round(clamp(head.weight, 300, 900, base.headline.weight) / 100) * 100,
      uppercase: typeof head.uppercase === "boolean" ? head.uppercase : base.headline.uppercase,
      italic: typeof head.italic === "boolean" ? head.italic : base.headline.italic,
      tracking: clamp(head.tracking, -0.08, 0.3, base.headline.tracking),
      lineHeight: clamp(head.lineHeight, 0.8, 1.7, base.headline.lineHeight),
    },
    body: {
      size: clamp(body.size, 18, 80, base.body.size),
      weight: Math.round(clamp(body.weight, 300, 800, base.body.weight) / 100) * 100,
      lineHeight: clamp(body.lineHeight, 1, 1.8, base.body.lineHeight),
    },
    kicker: { style: pick(kicker.style, ["none", "plain", "mono", "pill", "bar"] as const, base.kicker.style), at: pick(kicker.at, ["top", "inline"] as const, base.kicker.at) },
    panel: {
      kind: pick(panel.kind, ["none", "card", "band"] as const, base.panel.kind),
      color: isHex(panel.color) ? panel.color.toLowerCase() : base.panel.color,
      radius: clamp(panel.radius, 0, 80, base.panel.radius),
      opacity: clamp(panel.opacity, 0, 1, base.panel.opacity),
    },
  };
}

/**
 * Combina lo que propone la IA con el borrador medido (`base`): los campos que faltan o no son válidos quedan como
 * en el borrador, los números se acotan y los colores se revisan para que el texto se lea.
 */
export function normalizeSpec(raw: unknown, base: TemplateSpec): TemplateSpec {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pal = (r.palette ?? {}) as Record<string, unknown>;
  const bgRaw = (r.background ?? {}) as Record<string, unknown>;
  const fonts = (r.fonts ?? {}) as Record<string, unknown>;
  const padding = (r.padding ?? {}) as Record<string, unknown>;
  const orn = (r.ornaments ?? {}) as Record<string, unknown>;
  const layouts = (r.layouts ?? {}) as Record<string, Record<string, unknown>>;
  const palette = {
    bg: hexOr(pal.bg, base.palette.bg),
    surface: hexOr(pal.surface, base.palette.surface),
    text: hexOr(pal.text, base.palette.text),
    muted: hexOr(pal.muted, base.palette.muted),
    accent: hexOr(pal.accent, base.palette.accent),
    accentText: hexOr(pal.accentText, base.palette.accentText),
  };
  // El texto tiene que leerse sobre el fondo; si la IA se equivoca, se vuelve a lo medido.
  if (contrast(palette.text, palette.bg) < 3) palette.text = contrast(base.palette.text, palette.bg) >= 3 ? base.palette.text : contrast("#ffffff", palette.bg) > contrast("#111111", palette.bg) ? "#ffffff" : "#111111";
  if (contrast(palette.accentText, palette.accent) < 3) palette.accentText = contrast("#ffffff", palette.accent) >= contrast("#111111", palette.accent) ? "#ffffff" : "#111111";
  const colors = Array.isArray(bgRaw.colors) ? bgRaw.colors.filter(isHex).slice(0, 3).map((c) => c.toLowerCase()) : [];
  const structure = Array.isArray(r.structure)
    ? (r.structure as Record<string, unknown>[]).slice(0, 20).map((s, i) => ({
        type: pick(s?.type, SLIDE_TYPE_KEYS, base.structure[i]?.type ?? "item"),
        layout: pick(s?.layout, LAYOUT_KEYS, base.structure[i]?.layout ?? "content"),
        photo: typeof s?.photo === "boolean" ? s.photo : (base.structure[i]?.photo ?? false),
      }))
    : base.structure;
  const spec: TemplateSpec = {
    version: 1,
    palette,
    background: {
      kind: pick(bgRaw.kind, ["solid", "gradient", "photo", "texture"] as const, base.background.kind),
      colors: colors.length ? colors : base.background.colors,
      angle: clamp(bgRaw.angle, 0, 360, base.background.angle),
      texture: pick(bgRaw.texture, ["none", "grain", "paper", "dots", "grid", "lines"] as const, base.background.texture),
    },
    fonts: { heading: pick(fonts.heading, FONT_KEYS, base.fonts.heading), body: pick(fonts.body, FONT_KEYS, base.fonts.body) },
    padding: { x: clamp(padding.x, 24, 200, base.padding.x), y: clamp(padding.y, 24, 200, base.padding.y) },
    highlight: pick(r.highlight, ["color", "marker", "underline", "italic"] as const, base.highlight),
    ornaments: {
      numbering: pick(orn.numbering, ["none", "big", "badge", "plain"] as const, base.ornaments.numbering),
      divider: typeof orn.divider === "boolean" ? orn.divider : base.ornaments.divider,
      arrow: typeof orn.arrow === "boolean" ? orn.arrow : base.ornaments.arrow,
      frame: pick(orn.frame, ["none", "border", "inset"] as const, base.ornaments.frame),
      sticker: typeof orn.sticker === "boolean" ? orn.sticker : base.ornaments.sticker,
      handle: pick(orn.handle, ["none", "top", "bottom"] as const, base.ornaments.handle),
      counter: pick(orn.counter, ["none", "top", "bottom"] as const, base.ornaments.counter),
      progress: typeof orn.progress === "boolean" ? orn.progress : base.ornaments.progress,
      avatar: typeof orn.avatar === "boolean" ? orn.avatar : base.ornaments.avatar,
    },
    usesPhoto: typeof r.usesPhoto === "boolean" ? r.usesPhoto : base.usesPhoto,
    layouts: {
      cover: normalizeLayout(layouts.cover, base.layouts.cover),
      content: normalizeLayout(layouts.content, base.layouts.content),
      cta: normalizeLayout(layouts.cta, base.layouts.cta),
    },
    structure: structure.length ? structure : base.structure,
    notes: typeof r.notes === "string" && r.notes.trim() ? r.notes.trim().slice(0, 400) : base.notes,
  };
  return templateSpecSchema.parse(spec);
}
