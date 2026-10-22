/**
 * Edición de cada b-roll en la revisión: ubicación (pantalla completa, dividida, tarjeta o a un lado), encuadre del
 * clip dentro de su marco, look (filtro, opacidad, brillo, contraste, saturación) y tiempo (entrada, salida, punto del
 * clip y transición).
 *
 * Es la única fuente de verdad de la geometría y del color: la vista previa del navegador (CSS y un filtro SVG) y el
 * render del worker (grafo de ffmpeg y una LUT 3D) usan los mismos números que salen de aquí. La app calcula las cajas
 * en píxeles de salida y la matriz de color; el worker solo las ejecuta. Sin servidor ni navegador.
 *
 * Un plan guardado antes no tiene `edit`: los valores por defecto dan exactamente el comportamiento de antes
 * (pantalla completa, recorte al centro, sin filtro, fundido de 0,2 s).
 */
import { z } from "zod";
import type { VideoFormat } from "./types";

export const BROLL_LAYOUTS = ["full", "split", "card", "side"] as const;
export type BrollLayout = (typeof BROLL_LAYOUTS)[number];
export const CARD_POSITIONS = ["top-left", "top-center", "top-right", "bottom-left", "bottom-right"] as const;
export type CardPosition = (typeof CARD_POSITIONS)[number];
export const CARD_SHAPES = ["auto", "horizontal", "square", "vertical"] as const;
export type CardShape = (typeof CARD_SHAPES)[number];
export const LOOK_FILTERS = ["none", "bw", "duotone", "warm", "cool"] as const;
export type LookFilter = (typeof LOOK_FILTERS)[number];
export const TRANSITIONS = ["fade", "cut", "zoom"] as const;
export type BrollTransition = (typeof TRANSITIONS)[number];

export const frameSchema = z.object({
  /** Recorte del clip dentro de su marco: -1 muestra el borde izquierdo (o el de arriba), 1 el derecho (o el de abajo). */
  x: z.number().min(-1).max(1).default(0),
  y: z.number().min(-1).max(1).default(0),
  /** 1 = el clip cubre justo su marco; más es acercar. */
  zoom: z.number().min(1).max(3).default(1),
});

export const lookSchema = z.object({
  filter: z.enum(LOOK_FILTERS).default("none"),
  /** Cuánto del filtro se aplica (0 a 1). */
  strength: z.number().min(0).max(1).default(1),
  opacity: z.number().min(0.2).max(1).default(1),
  /** Ajustes finos: 0 es neutro. */
  brightness: z.number().min(-0.3).max(0.3).default(0),
  contrast: z.number().min(-0.5).max(0.5).default(0),
  saturation: z.number().min(-1).max(1).default(0),
});

export const brollEditSchema = z.object({
  layout: z.enum(BROLL_LAYOUTS).default("full"),
  /** Pantalla dividida: el clip arriba o abajo (la persona en la otra mitad). */
  split_clip: z.enum(["top", "bottom"]).default("top"),
  /** A un lado (16:9): el clip a la izquierda o a la derecha. */
  side_clip: z.enum(["left", "right"]).default("left"),
  /** Parte de la pantalla que ocupa el clip en "split" y "side". */
  split_ratio: z.number().min(0.3).max(0.7).default(0.5),
  card_position: z.enum(CARD_POSITIONS).default("top-right"),
  /** Ancho de la tarjeta respecto del ancho del video. */
  card_size: z.number().min(0.3).max(0.85).default(0.55),
  card_shape: z.enum(CARD_SHAPES).default("auto"),
  frame: frameSchema.prefault({}),
  look: lookSchema.prefault({}),
  /** Corre el inicio o el final del tramo (segundos; negativo = antes). */
  start_delta: z.number().min(-3).max(3).default(0),
  end_delta: z.number().min(-3).max(3).default(0),
  /** Segundo del clip desde el que se ve. */
  clip_start: z.number().min(0).max(600).default(0),
  transition: z.enum(TRANSITIONS).default("fade"),
});

export type BrollFrame = z.output<typeof frameSchema>;
export type BrollLook = z.output<typeof lookSchema>;
export type BrollEdit = z.output<typeof brollEditSchema>;
export type BrollEditInput = z.input<typeof brollEditSchema>;

export const DEFAULT_EDIT: BrollEdit = brollEditSchema.parse({});
export const DEFAULT_LOOK: BrollLook = DEFAULT_EDIT.look;

/** La edición completa (con todos los valores) a partir de lo guardado; sin nada, la de siempre. */
export function resolveEdit(edit: BrollEditInput | null | undefined): BrollEdit {
  if (!edit) return DEFAULT_EDIT;
  const parsed = brollEditSchema.safeParse(edit);
  return parsed.success ? parsed.data : DEFAULT_EDIT;
}

/** ¿Cambia algo respecto de lo de siempre? (para no mandar ni guardar nada de más). */
export function isDefaultEdit(edit: BrollEdit): boolean {
  return JSON.stringify(edit) === JSON.stringify(DEFAULT_EDIT);
}

// ─── Geometría ────────────────────────────────────────────────────────────

export const OUTPUT_SIZE: Record<VideoFormat, { w: number; h: number }> = { "9:16": { w: 1080, h: 1920 }, "16:9": { w: 1920, h: 1080 } };

/** Caja en píxeles del video final. */
export type PxBox = { x: number; y: number; w: number; h: number };

export type BrollGeometry = {
  /** Ubicación efectiva ("side" en vertical pasa a "split"). */
  layout: BrollLayout;
  /** Dónde va el clip. */
  clip: PxBox;
  /** Pantalla dividida o a un lado: qué parte del video de la persona (`from`) va a qué lugar (`to`). */
  person: { from: PxBox; to: PxBox } | null;
  /** Tarjeta: radio de las esquinas, sombra (desplazamiento y desenfoque) y borde fino, en píxeles. */
  card: { radius: number; shadowY: number; shadowBlur: number; shadowAlpha: number; border: number; borderAlpha: number } | null;
};

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Ubicaciones que tienen sentido en cada formato. */
export function layoutsFor(format: VideoFormat): BrollLayout[] {
  return format === "16:9" ? ["full", "split", "card", "side"] : ["full", "split", "card"];
}

/** Relación de aspecto (ancho/alto) de la tarjeta. "auto" sigue al clip: horizontal, cuadrada o vertical. */
export function cardAspect(shape: CardShape, clipAspect: number): number {
  if (shape === "horizontal") return 16 / 9;
  if (shape === "square") return 1;
  if (shape === "vertical") return 4 / 5;
  if (!Number.isFinite(clipAspect) || clipAspect <= 0) return 16 / 9;
  return clipAspect >= 1.2 ? 16 / 9 : clipAspect <= 0.85 ? 4 / 5 : 1;
}

/**
 * Cajas del clip (y de la persona) en el video final. `clipAspect`: ancho/alto del clip (para la tarjeta "auto").
 * `focusY`: altura de la cara (0 a 1) para encuadrar a la persona en la pantalla dividida.
 */
export function brollGeometry(edit: BrollEdit, format: VideoFormat, clipAspect: number, focusY = 0.42): BrollGeometry {
  const { w: W, h: H } = OUTPUT_SIZE[format];
  const vertical = H > W;
  let layout: BrollLayout = edit.layout;
  let splitClip = edit.split_clip;
  if (layout === "side" && vertical) {
    layout = "split";
    splitClip = edit.side_clip === "left" ? "top" : "bottom";
  }
  const full: PxBox = { x: 0, y: 0, w: W, h: H };
  if (layout === "split") {
    const ch = even(H * edit.split_ratio);
    const ph = H - ch;
    const fy = clamp(focusY, 0.2, 0.8);
    const from: PxBox = { x: 0, y: even(clamp(fy * H - ph / 2, 0, H - ph)), w: W, h: ph };
    const clipTop = splitClip === "top";
    return { layout, clip: { x: 0, y: clipTop ? 0 : ph, w: W, h: ch }, person: { from, to: { x: 0, y: clipTop ? ch : 0, w: W, h: ph } }, card: null };
  }
  if (layout === "side") {
    const cw = even(W * edit.split_ratio);
    const pw = W - cw;
    const from: PxBox = { x: even((W - pw) / 2), y: 0, w: pw, h: H };
    const clipLeft = edit.side_clip === "left";
    return { layout, clip: { x: clipLeft ? 0 : pw, y: 0, w: cw, h: H }, person: { from, to: { x: clipLeft ? cw : 0, y: 0, w: pw, h: H } }, card: null };
  }
  if (layout === "card") {
    const aspect = cardAspect(edit.card_shape, clipAspect);
    // Margenes: en vertical lejos del encabezado y de la interfaz de Reels de abajo.
    const mx = W * (vertical ? 0.06 : 0.04);
    const top = H * (vertical ? 0.08 : 0.07);
    const bottom = H * (vertical ? 0.8 : 0.93);
    const maxW = W - mx * 2;
    const maxH = bottom - top;
    let w = W * edit.card_size;
    let h = w / aspect;
    if (w > maxW) {
      w = maxW;
      h = w / aspect;
    }
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    w = even(w);
    h = even(h);
    const pos = edit.card_position;
    const x = pos.endsWith("left") ? mx : pos.endsWith("right") ? W - mx - w : (W - w) / 2;
    const y = pos.startsWith("top") ? top : bottom - h;
    const u = Math.min(W, H) / 1080;
    return {
      layout,
      clip: { x: even(x), y: even(y), w, h },
      person: null,
      card: { radius: Math.round(36 * u), shadowY: Math.round(18 * u), shadowBlur: Math.round(48 * u), shadowAlpha: 0.5, border: Math.max(2, Math.round(2 * u)), borderAlpha: 0.22 },
    };
  }
  return { layout: "full", clip: full, person: null, card: null };
}

/**
 * Persona a un lado de un gráfico del motor (16:9, sobre el video, a la izquierda o a la derecha): la mitad opuesta
 * de la pantalla muestra a la persona encuadrada al centro. null en los demás casos.
 */
export function graphicSideGeometry(format: VideoFormat, mode: string | undefined, position: string | undefined): BrollGeometry["person"] {
  if (format !== "16:9" || mode !== "overlay" || (position !== "left" && position !== "right")) return null;
  const { w: W, h: H } = OUTPUT_SIZE[format];
  const pw = even(W / 2);
  return { from: { x: even((W - pw) / 2), y: 0, w: pw, h: H }, to: { x: position === "left" ? W - pw : 0, y: 0, w: pw, h: H } };
}

/**
 * Recorte del clip dentro de su marco (lo mismo que hace el worker): el clip se escala para cubrir el marco por el zoom y
 * se corre según x/y. Devuelve el tamaño escalado y el desplazamiento del recorte, en píxeles del marco.
 */
export function frameCrop(srcW: number, srcH: number, boxW: number, boxH: number, frame: BrollFrame): { sw: number; sh: number; cx: number; cy: number } {
  const w = srcW > 0 ? srcW : boxW;
  const h = srcH > 0 ? srcH : boxH;
  const s = Math.max(boxW / w, boxH / h) * clamp(frame.zoom, 1, 3);
  const sw = Math.max(boxW, w * s);
  const sh = Math.max(boxH, h * s);
  return { sw, sh, cx: ((sw - boxW) / 2) * (1 + clamp(frame.x, -1, 1)), cy: ((sh - boxH) / 2) * (1 + clamp(frame.y, -1, 1)) };
}

// ─── Color ────────────────────────────────────────────────────────────────

/** Matriz afín de color 3×4 (filas r, g, b; columnas r, g, b, desplazamiento), en valores de 0 a 1 (sRGB). */
export type ColorMatrix = [number, number, number, number, number, number, number, number, number, number, number, number];

const IDENTITY: ColorMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
/** Luminancia Rec. 709 (la de los videos HD). */
const LUMA = [0.2126, 0.7152, 0.0722] as const;

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0.44, 0.97];
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const mixRgb = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** a∘b: primero b, después a. */
function compose(a: ColorMatrix, b: ColorMatrix): ColorMatrix {
  const out = new Array(12).fill(0) as ColorMatrix;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out[r * 4 + c] = a[r * 4]! * b[c]! + a[r * 4 + 1]! * b[4 + c]! + a[r * 4 + 2]! * b[8 + c]!;
    out[r * 4 + 3] = a[r * 4]! * b[3]! + a[r * 4 + 1]! * b[7]! + a[r * 4 + 2]! * b[11]! + a[r * 4 + 3]!;
  }
  return out;
}

const lerpMatrix = (a: ColorMatrix, b: ColorMatrix, t: number): ColorMatrix => a.map((v, i) => v + (b[i]! - v) * t) as ColorMatrix;

/** Colores del duotono de la marca: sombras casi negras teñidas con el acento y luces con el acento aclarado. */
export function duotoneColors(accent: string): { dark: string; light: string } {
  const a = hexRgb(accent);
  const toHex = (c: [number, number, number]) => `#${c.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, "0")).join("")}`;
  return { dark: toHex(mixRgb(a, [0, 0, 0], 0.84)), light: toHex(mixRgb(a, [1, 1, 1], 0.42)) };
}

function filterMatrix(filter: LookFilter, accent: string): ColorMatrix {
  switch (filter) {
    case "bw":
      return [...LUMA, 0, ...LUMA, 0, ...LUMA, 0] as ColorMatrix;
    case "duotone": {
      const { dark, light } = duotoneColors(accent);
      const d = hexRgb(dark);
      const l = hexRgb(light);
      const row = (c: number) => [LUMA[0] * (l[c]! - d[c]!), LUMA[1] * (l[c]! - d[c]!), LUMA[2] * (l[c]! - d[c]!), d[c]!];
      return [...row(0), ...row(1), ...row(2)] as ColorMatrix;
    }
    case "warm":
      return [1.08, 0, 0, 0.03, 0, 1.01, 0, 0.012, 0, 0, 0.84, 0];
    case "cool":
      return [0.9, 0, 0, 0, 0, 1, 0, 0.01, 0, 0, 1.1, 0.035];
    default:
      return IDENTITY;
  }
}

/**
 * Matriz del look: filtro (mezclado con el original según la intensidad), saturación, contraste y brillo, en ese orden.
 * null si el look es neutro (no se toca el color). La opacidad va aparte.
 */
export function lookMatrix(look: BrollLook, accent: string): ColorMatrix | null {
  const neutral = (look.filter === "none" || look.strength <= 0) && look.brightness === 0 && look.contrast === 0 && look.saturation === 0;
  if (neutral) return null;
  let m: ColorMatrix = look.filter === "none" ? IDENTITY : lerpMatrix(IDENTITY, filterMatrix(look.filter, accent), clamp(look.strength, 0, 1));
  if (look.saturation !== 0) {
    const s = 1 + look.saturation;
    const sat = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => (1 - s) * LUMA[c]! + (r === c ? s : 0)).concat(0)) as ColorMatrix;
    m = compose(sat, m);
  }
  if (look.contrast !== 0) {
    const k = 1 + look.contrast;
    m = compose([k, 0, 0, 0.5 * (1 - k), 0, k, 0, 0.5 * (1 - k), 0, 0, k, 0.5 * (1 - k)], m);
  }
  if (look.brightness !== 0) m = compose([1, 0, 0, look.brightness, 0, 1, 0, look.brightness, 0, 0, 1, look.brightness], m);
  return m.map((v) => Math.round(v * 1e5) / 1e5) as ColorMatrix;
}

/** Valores para `<feColorMatrix type="matrix">` (4×5, con la fila de alfa sin cambios). */
export function svgMatrixValues(m: ColorMatrix): string {
  return [m[0], m[1], m[2], 0, m[3], m[4], m[5], m[6], 0, m[7], m[8], m[9], m[10], 0, m[11], 0, 0, 0, 1, 0].join(" ");
}

// ─── Tiempo ───────────────────────────────────────────────────────────────

export const TRANSITION_TIMING = {
  /** Fundido normal. */
  fade: 0.2,
  /** Fundido corto que acompaña al zoom de entrada. */
  zoomFade: 0.12,
  /** Duración y escala inicial del zoom de entrada. */
  zoomSeconds: 0.5,
  zoomFrom: 1.15,
} as const;

/** Duración del fundido de entrada y salida para un tramo (lo mismo en la vista previa y en el render). */
export function fadeSeconds(transition: BrollTransition, duration: number): number {
  if (transition === "cut") return 0;
  return Math.min(transition === "zoom" ? TRANSITION_TIMING.zoomFade : TRANSITION_TIMING.fade, duration / 4);
}

/** Opacidad del b-roll en el instante t (segundos desde su inicio): fundido de entrada y salida por la opacidad del look. */
export function brollAlpha(edit: Pick<BrollEdit, "transition"> & { look?: Pick<BrollLook, "opacity"> }, t: number, duration: number): number {
  const fade = fadeSeconds(edit.transition, duration);
  const opacity = edit.look?.opacity ?? 1;
  if (fade <= 0) return opacity;
  return opacity * clamp(Math.min(t / fade, (duration - t) / fade), 0, 1);
}

/** Escala del contenido del clip por el zoom de entrada (1 cuando ya entró). Curva de salida cúbica, igual que en ffmpeg. */
export function entranceScale(transition: BrollTransition, t: number): number {
  if (transition !== "zoom") return 1;
  const p = clamp(t / TRANSITION_TIMING.zoomSeconds, 0, 1);
  return 1 + (TRANSITION_TIMING.zoomFrom - 1) * (1 - p) ** 3;
}

// ─── Presets ──────────────────────────────────────────────────────────────

export const LOOK_PRESETS: { id: string; label: string; look: Partial<BrollLook> }[] = [
  { id: "natural", label: "Natural", look: { filter: "none" } },
  { id: "marca", label: "Tu marca", look: { filter: "duotone", strength: 0.85 } },
  { id: "bn", label: "Blanco y negro", look: { filter: "bw", contrast: 0.12 } },
  { id: "calido", label: "Cálido", look: { filter: "warm", saturation: 0.08 } },
  { id: "frio", label: "Frío", look: { filter: "cool", saturation: -0.1 } },
  { id: "suave", label: "Suave", look: { filter: "none", saturation: -0.35, contrast: -0.12, brightness: -0.04 } },
];

export function presetLook(id: string): BrollLook {
  const p = LOOK_PRESETS.find((x) => x.id === id);
  return lookSchema.parse({ ...(p?.look ?? {}) });
}

/** Qué preset coincide con un look (para marcarlo como elegido). */
export function matchingPreset(look: BrollLook): string | null {
  for (const p of LOOK_PRESETS) {
    const ref = presetLook(p.id);
    if (ref.filter === look.filter && ref.strength === look.strength && ref.brightness === look.brightness && ref.contrast === look.contrast && ref.saturation === look.saturation) return p.id;
  }
  return null;
}

export const LAYOUT_LABELS: Record<BrollLayout, { label: string; hint: string }> = {
  full: { label: "Pantalla completa", hint: "El clip tapa todo el video; tu voz sigue debajo." },
  split: { label: "Pantalla dividida", hint: "El clip en una mitad y tú en la otra." },
  card: { label: "Tarjeta", hint: "El clip flota sobre tu video, con bordes redondeados." },
  side: { label: "A un lado", hint: "El clip a un lado y tú al otro." },
};

export const TRANSITION_LABELS: Record<BrollTransition, string> = { fade: "Fundido", cut: "Corte", zoom: "Zoom de entrada" };

// ─── Para el worker ───────────────────────────────────────────────────────

/** Lo que el worker necesita para dibujar un b-roll tal como se ve en la vista previa (todo en píxeles de salida). */
export type BrollRenderEdit = {
  layout: BrollLayout;
  box: PxBox;
  person: BrollGeometry["person"];
  /** Color de fondo bajo el clip en pantalla dividida o a un lado (se ve si el clip es translúcido). */
  ground: string;
  card: BrollGeometry["card"];
  frame: BrollFrame;
  /** Matriz de color 3×4 (o null: sin cambios). */
  color: ColorMatrix | null;
  opacity: number;
  transition: BrollTransition;
  fade: number;
  clipStart: number;
  zoom: { from: number; seconds: number } | null;
};

/**
 * Edición de un tramo lista para el worker. `clipWidth`/`clipHeight`: tamaño del clip elegido (decide la forma de la
 * tarjeta "auto"); `graphic`: si es un gráfico del motor, su modo y posición (los gráficos solo usan el tiempo y, en
 * 16:9 a un lado, la persona en la otra mitad). `accent` y `ground`: colores de Mi marca.
 */
export function brollRenderEdit(input: {
  edit: BrollEdit;
  format: VideoFormat;
  duration: number;
  clipWidth: number;
  clipHeight: number;
  focusY?: number;
  accent: string;
  ground: string;
  graphic?: { mode?: string; position?: string } | null;
}): BrollRenderEdit {
  const { edit, format, duration } = input;
  const { w: W, h: H } = OUTPUT_SIZE[format];
  if (input.graphic) {
    const transition: BrollTransition = edit.transition === "cut" ? "cut" : "fade";
    return {
      layout: "full",
      box: { x: 0, y: 0, w: W, h: H },
      person: graphicSideGeometry(format, input.graphic.mode, input.graphic.position),
      ground: input.ground,
      card: null,
      frame: DEFAULT_EDIT.frame,
      color: null,
      opacity: 1,
      transition,
      fade: fadeSeconds(transition, duration),
      clipStart: 0,
      zoom: null,
    };
  }
  const geo = brollGeometry(edit, format, clipAspectOf(input.clipWidth, input.clipHeight), input.focusY);
  return {
    layout: geo.layout,
    box: geo.clip,
    person: geo.person,
    ground: input.ground,
    card: geo.card,
    frame: edit.frame,
    color: lookMatrix(edit.look, input.accent),
    opacity: edit.look.opacity,
    transition: edit.transition,
    fade: fadeSeconds(edit.transition, duration),
    clipStart: edit.clip_start,
    zoom: edit.transition === "zoom" ? { from: TRANSITION_TIMING.zoomFrom, seconds: TRANSITION_TIMING.zoomSeconds } : null,
  };
}

/** Ancho/alto de un clip (16:9 si no se sabe). */
export const clipAspectOf = (w: number | null | undefined, h: number | null | undefined) => (w && h && w > 0 && h > 0 ? w / h : 16 / 9);

/** Resumen corto de la edición para la lista de b-roll ("Tarjeta · Tu marca"). null si es la de siempre. */
export function editSummary(edit: BrollEdit, format: VideoFormat): string | null {
  if (isDefaultEdit(edit)) return null;
  const parts: string[] = [];
  const layout = format === "9:16" && edit.layout === "side" ? "split" : edit.layout;
  if (layout !== "full") parts.push(LAYOUT_LABELS[layout].label);
  const preset = matchingPreset(edit.look);
  if (preset && preset !== "natural") parts.push(LOOK_PRESETS.find((p) => p.id === preset)!.label);
  else if (!preset) parts.push("Look propio");
  if (edit.look.opacity < 1) parts.push(`${Math.round(edit.look.opacity * 100)} %`);
  if (edit.frame.zoom > 1 || edit.frame.x !== 0 || edit.frame.y !== 0) parts.push("Encuadre");
  if (edit.transition !== "fade") parts.push(TRANSITION_LABELS[edit.transition]);
  if (edit.start_delta !== 0 || edit.end_delta !== 0 || edit.clip_start !== 0) parts.push("Tiempo");
  return parts.length ? parts.join(" · ") : null;
}
