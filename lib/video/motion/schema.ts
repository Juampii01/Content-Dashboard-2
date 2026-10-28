/**
 * Esquema de una escena v2 (Zod). Una escena es lo que guarda el plan y lo que en la siguiente etapa escribe Claude:
 * duración, formato, modo, tema de marca y capas. Las capas son componentes prearmados (lo normal) o primitivas.
 *
 * Coordenadas de las primitivas: x, y, w, h son fracciones del lienzo (0–1), así la misma escena sirve en 9:16 y
 * 16:9. Los tamaños (texto, radios, trazos, distancias) van en unidades: 1 unidad = 1 px de un lienzo de 1080 de
 * lado corto. Los colores son tokens del tema ("accent", "text@0.6"), nunca hex.
 */
import { z } from "zod";
import { behaviorSchema } from "./animate";
import { iconNameSchema } from "./icons";
import { colorTokenSchema, themeColorsSchema, themeSchema } from "./theme";
import { COMPONENTS, type ComponentName } from "./components";
import { PROPS } from "./nodes";
import { easeSchema } from "./easing";
import { placeSchema } from "../canvas/transform";

export const MOTION_VERSION = 2 as const;

const frac = z.number().min(-0.5).max(1.5);
const size = z.number().min(0).max(3000);

const keySchema = z.object({ t: z.number().min(0).max(60), v: z.number(), ease: easeSchema.optional() });
const tracksSchema = z.partialRecord(z.enum(PROPS), z.array(keySchema).max(60));

const layerBase = {
  id: z.string().max(40).optional(),
  /** Centro (o esquina, con anchor) en fracción del lienzo. */
  x: frac.default(0.5),
  y: frac.default(0.5),
  anchor: z.enum(["center", "top-left"]).default("center"),
  opacity: z.number().min(0).max(1).optional(),
  rotation: z.number().min(-360).max(360).optional(),
  animate: z.array(behaviorSchema).max(12).default([]),
  tracks: tracksSchema.optional(),
  /**
   * Sincronía con la voz: la palabra (id de la transcripción) en la que entra la capa y, ya resuelto para el tramo, el
   * segundo de la escena en que se dice. Con `cue`, las animaciones de la capa se corren para que la primera arranque
   * ahí (manteniendo su orden).
   */
  cue_word: z.number().int().min(-1).optional(),
  cue: z.number().min(0).max(30).optional(),
  /** Sombra: "soft" separa del video (texto sobre la imagen); "glow" brilla con su propio color (neón). */
  shadow: z.enum(["soft", "glow"]).optional(),
};

export const rectLayer = z.object({
  type: z.literal("rect"),
  ...layerBase,
  w: frac,
  h: frac,
  radius: size.default(0),
  /** "pill": radio completo. */
  shape: z.enum(["rect", "pill"]).default("rect"),
  fill: colorTokenSchema.optional(),
  stroke: colorTokenSchema.optional(),
  strokeWidth: size.default(2),
  /** Con `fill` animado, crece desde este borde (barras). */
  grow: z.enum(["right", "left", "up", "down"]).optional(),
  card: z.boolean().default(false),
});

export const ellipseLayer = z.object({
  type: z.literal("ellipse"),
  ...layerBase,
  w: frac,
  h: frac.optional(),
  fill: colorTokenSchema.optional(),
  stroke: colorTokenSchema.optional(),
  strokeWidth: size.default(4),
  /** Arco en grados (0 = arriba): anillos de progreso. */
  arc: z.object({ start: z.number().default(0), sweep: z.number().min(-360).max(360) }).optional(),
});

export const lineLayer = z.object({
  type: z.literal("line"),
  ...layerBase,
  /** Puntos (fracciones del lienzo); con 2 puntos y `bend` sale una curva. */
  points: z.array(z.tuple([frac, frac])).min(2).max(24),
  bend: z.number().min(-1).max(1).default(0),
  /** Curva suave por todos los puntos (gráficos de línea). */
  smooth: z.boolean().default(false),
  color: colorTokenSchema.default("accent"),
  width: size.default(6),
  head: z.enum(["none", "end"]).default("none"),
  dash: z.array(size).max(4).optional(),
});

export const pathLayer = z.object({
  type: z.literal("path"),
  ...layerBase,
  /** Trazado SVG en unidades, relativo a (x, y). */
  d: z.string().min(1).max(4000),
  scale: z.number().min(0.01).max(50).default(1),
  fill: colorTokenSchema.optional(),
  stroke: colorTokenSchema.optional(),
  strokeWidth: size.default(4),
});

export const iconLayer = z.object({
  type: z.literal("icon"),
  ...layerBase,
  name: iconNameSchema,
  size: size.default(120),
  color: colorTokenSchema.default("accent"),
  weight: z.number().min(0.5).max(4).default(1.9),
  /** Dentro de un tile cuadrado redondeado. */
  tile: z.enum(["none", "accent", "soft", "outline"]).default("none"),
});

export const textLayer = z.object({
  type: z.literal("text"),
  ...layerBase,
  text: z.string().trim().min(1).max(240),
  /** Ancho de la caja (fracción) y alto máximo opcional. */
  w: frac.default(0.84),
  h: frac.optional(),
  size: size.default(64),
  minSize: size.optional(),
  font: z.enum(["display", "body"]).default("display"),
  weight: z.number().int().min(400).max(900).default(800),
  color: colorTokenSchema.default("text"),
  align: z.enum(["left", "center", "right"]).default("center"),
  leading: z.number().min(0.8).max(2).default(1.12),
  maxLines: z.number().int().min(1).max(8).default(3),
  uppercase: z.boolean().default(false),
  tracking: z.number().min(-0.1).max(0.4).optional(),
  emphasis: z.object({ words: z.string().trim().min(1).max(80), style: z.enum(["marker", "underline", "strike", "accent"]).default("marker"), color: colorTokenSchema.default("accent") }).optional(),
  /**
   * Caja detrás del texto, medida con el texto ya ajustado (etiquetas, títulos con fondo, llamados a la acción). Los
   * comportamientos de movimiento animan la caja y el texto juntos; los de texto (escribir, marcador, tachado) solo
   * el texto.
   */
  box: z
    .object({
      fill: colorTokenSchema,
      shape: z.enum(["rect", "pill"]).default("rect"),
      radius: size.default(18),
      padX: size.default(32),
      padY: size.default(18),
      stroke: colorTokenSchema.optional(),
      strokeWidth: size.default(3),
    })
    .optional(),
});

export const counterLayer = z.object({
  type: z.literal("counter"),
  ...layerBase,
  value: z.string().trim().min(1).max(14).regex(/\d/, "La cifra tiene que tener un número."),
  from: z.number().optional(),
  size: size.default(220),
  color: colorTokenSchema.default("text"),
  affixColor: colorTokenSchema.default("accent"),
  weight: z.number().int().min(400).max(900).default(900),
  align: z.enum(["left", "center", "right"]).default("center"),
});

export const imageLayer = z.object({
  type: z.literal("image"),
  ...layerBase,
  /** Clave de una imagen que entrega quien dibuja (no URLs). */
  src: z.string().min(1).max(200),
  w: frac,
  h: frac,
  radius: size.default(24),
  fit: z.enum(["cover", "contain"]).default("cover"),
});

export const componentLayer = z.object({
  type: z.literal("component"),
  id: z.string().max(40).optional(),
  component: z.enum(Object.keys(COMPONENTS) as [ComponentName, ...ComponentName[]]),
  props: z.record(z.string(), z.unknown()).default({}),
  /** Segundo en que empieza (todo el componente se corre). */
  at: z.number().min(0).max(30).default(0),
  /** Caja propia (fracciones). Si falta, la del modo y el formato. */
  region: z.object({ x: frac, y: frac, w: frac, h: frac }).optional(),
  /** Tamaño respecto del normal (1). Si no entra en su caja, el componente igual se achica. */
  scale: z.number().min(0.5).max(1.6).default(1),
  /**
   * Sincronía con la voz, por elemento (ítem de una lista, paso, barra, cifra, palabra de una frase; ver `cueTexts` de
   * cada componente): `cue_words` son los ids de palabra en que se dice cada uno (-1 = no se sabe) y `cues`, ya
   * resueltos para el tramo, los segundos de la escena. Con `cues`, el componente anima cada elemento en su segundo
   * en lugar de su reloj fijo.
   */
  cue_words: z.array(z.number().int().min(-1)).max(40).optional(),
  cues: z.array(z.number().min(0).max(30)).max(40).optional(),
});

export type PrimitiveLayer =
  | z.infer<typeof rectLayer>
  | z.infer<typeof ellipseLayer>
  | z.infer<typeof lineLayer>
  | z.infer<typeof pathLayer>
  | z.infer<typeof iconLayer>
  | z.infer<typeof textLayer>
  | z.infer<typeof counterLayer>
  | z.infer<typeof imageLayer>
  | GroupLayer;
export type GroupLayer = {
  type: "group";
  id?: string;
  x: number;
  y: number;
  anchor: "center" | "top-left";
  opacity?: number;
  rotation?: number;
  animate: z.infer<typeof behaviorSchema>[];
  tracks?: z.infer<typeof tracksSchema>;
  cue_word?: number;
  cue?: number;
  shadow?: "soft" | "glow";
  children: PrimitiveLayer[];
  clip?: { x: number; y: number; w: number; h: number; radius: number };
};

export const groupLayer: z.ZodType<GroupLayer, unknown> = z.lazy(() =>
  z.object({
    type: z.literal("group"),
    ...layerBase,
    children: z.array(primitiveLayer).max(40),
    clip: z.object({ x: frac, y: frac, w: frac, h: frac, radius: size.default(0) }).optional(),
  }),
) as unknown as z.ZodType<GroupLayer, unknown>;

export const primitiveLayer: z.ZodType<PrimitiveLayer, unknown> = z.lazy(() =>
  z.union([rectLayer, ellipseLayer, lineLayer, pathLayer, iconLayer, textLayer, counterLayer, imageLayer, groupLayer]),
) as unknown as z.ZodType<PrimitiveLayer, unknown>;

export const layerSchema = z.union([componentLayer, primitiveLayer]);
export type ComponentLayer = z.infer<typeof componentLayer>;
export type Layer = ComponentLayer | PrimitiveLayer;

export const sceneSchema = z.object({
  v: z.literal(MOTION_VERSION),
  /** Segundos (lo que dura el tramo del video). */
  duration: z.number().min(0.6).max(30),
  format: z.enum(["9:16", "16:9"]),
  mode: z.enum(["full", "overlay"]),
  /**
   * Solo en "overlay": arriba o abajo (abajo ocupa la franja de los subtítulos, que se ocultan). En 16:9 también
   * "left"/"right": el gráfico en esa mitad y la persona en la otra (en 9:16 se dibuja como "top").
   */
  position: z.enum(["top", "bottom", "left", "right"]).default("top"),
  theme: themeSchema,
  /**
   * Salida automática al final: "auto" (fundido y subida), "fade" (solo fundido), "sink" (fundido y bajada) o "zoom"
   * (fundido y se agranda). "none": cada capa decide.
   */
  exit: z.enum(["auto", "fade", "sink", "zoom", "none"]).default("auto"),
  /** Solo en "overlay": "none" quita el velo oscuro de la franja (textos sueltos sobre el video). Sin el campo, con velo. */
  veil: z.enum(["auto", "none"]).optional(),
  /**
   * Colores que mandan sobre los del tema (un color propio que eligió la persona, o blanco sobre el video). Se guardan
   * aparte del tema porque el tema se vuelve a poner con la marca antes de renderizar.
   */
  colors: themeColorsSchema.optional(),
  layers: z.array(layerSchema).min(1).max(40),
  /**
   * Dónde va y cómo entra y sale (lo cambia la persona en la revisión, lib/video/canvas/transform.ts). Sin el campo,
   * como siempre. La opacidad de la animación la aplica quien compone (ffmpeg o la vista previa).
   */
  place: placeSchema.optional(),
});
export type MotionSceneInput = z.input<typeof sceneSchema>;
export type MotionScene = z.output<typeof sceneSchema>;
