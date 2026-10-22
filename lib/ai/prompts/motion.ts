import { z } from "zod";
import { BEHAVIORS } from "@/lib/video/motion/animate";
import { COMPONENTS, COMPONENT_NAMES, type ComponentName } from "@/lib/video/motion/components";
import { ICON_NAMES, ICON_TAGS } from "@/lib/video/motion/icons";
import { THEME_TOKENS } from "@/lib/video/motion/theme";

/**
 * Prompts de los gráficos animados del b-roll con el motor de motion graphics (lib/video/motion), versión 1.
 *
 * Claude arma escenas con los componentes prearmados (y primitivas cuando hace falta), eligiendo íconos por su
 * etiqueta, modo y posición. Nunca escribe colores: usa tokens del tema y el tema sale de Mi marca en el servidor.
 * La respuesta es un esquema "plano" y permisivo (sin largos máximos) para que la salida estructurada no falle por
 * un texto largo: la escena se arma y se valida después (lib/video/motion-build.ts), y si hay problemas se le
 * explican a Claude para que la corrija (feature "video.motion.retry").
 *
 * Features: "video.motion.pedido" (la persona describe el gráfico), "video.motion.ajuste" (cambia el actual),
 * "video.motion.retry" (corrige escenas con problemas) y "video.broll.motion" (plan automático del b-roll).
 */
export const MOTION_PROMPT_VERSION = 1;

// ─── Esquema de la respuesta ──────────────────────────────────────────────
//
// Todo campo trae `.catch()`: si Claude se equivoca en un dato (un ícono que no existe, un color mal escrito), ese
// campo toma un valor seguro en lugar de tirar la respuesta entera, y una capa que no se entiende queda en null (se
// descarta). Lo que importa (que entre, que se lea, las cifras) se revisa después con el motor.

const str = (what: string) => z.string().catch("").describe(what);
const num = (what: string, fallback: number) => z.number().catch(fallback).describe(what);
const int = (what: string, fallback: number) => z.number().int().catch(fallback).describe(what);
const bool = (what: string) => z.boolean().catch(false).describe(what);
const pick = <const T extends readonly [string, ...string[]]>(values: T, what?: string) => {
  const s = z.enum(values).catch(values[0]);
  return what ? s.describe(what) : s;
};
const list = <T extends z.ZodType>(item: T, what: string) => z.array(item).catch([]).describe(what);

const iconAi = z.enum(ICON_NAMES).catch("sparkles").describe("Nombre exacto de un ícono de la lista ÍCONOS.");
const iconOrNone = pick(["", ...ICON_NAMES] as unknown as readonly [string, ...string[]], "Nombre de un ícono de la lista, o vacío.");
const tokenAi = pick(THEME_TOKENS, "Color del tema (nunca hex).");
const tokenOrNone = pick(["none", ...THEME_TOKENS] as unknown as readonly [string, ...string[]], "Color del tema, o none.");

const behaviorAi = z.object({
  type: pick(BEHAVIORS),
  at: num("Segundo en que empieza, desde el inicio del gráfico.", 0),
  dur: num("Duración en segundos; 0 = la de siempre.", 0),
  dir: pick(["none", "left", "right", "up", "down"], "Solo slide y wipe; en los demás, none."),
});
const animateAi = (what = "Animaciones de entrada.") => list(behaviorAi, what);

/** Props de cada componente (mismos nombres que el motor; los vacíos se toman como "sin ese texto"). */
const COMPONENT_PROPS = {
  statCard: z.object({ value: str("La cifra como se lee en pantalla: x2, +40%, 10K, 3/10."), label: str("Qué significa, en pocas palabras."), eyebrow: str("Rótulo chico arriba, o vacío."), icon: iconOrNone }),
  list: z.object({ title: str("Título corto o vacío."), items: list(z.string(), "2 a 5 puntos de 1 a 5 palabras."), marker: pick(["number", "icon"]), icons: list(iconAi, "Un ícono por punto si marker es icon; si no, vacío.") }),
  quote: z.object({ text: str("La frase, hasta 12 palabras."), highlight: str("1 a 3 palabras de la frase para resaltar, o vacío."), author: str("Vacío salvo que la frase sea de otra persona que se nombra.") }),
  keyword: z.object({ text: str("1 a 3 palabras."), label: str("Rótulo chico encima, o vacío."), emphasis: pick(["marker", "underline"]) }),
  comparison: z.object({
    left: z.object({ label: str("Rótulo de 1 o 2 palabras: Antes, Mito, Lo que hacías."), text: str("Lo que no funciona, hasta 8 palabras.") }),
    right: z.object({ label: str("Rótulo de 1 o 2 palabras: Después, Realidad."), text: str("Lo que sí funciona, hasta 8 palabras.") }),
  }),
  steps: z.object({ title: str("Título corto o vacío."), steps: list(z.string(), "2 a 4 pasos de 1 a 3 palabras."), icons: list(iconAi, "Un ícono por paso, o vacío.") }),
  funnel: z.object({ title: str("Título corto o vacío."), levels: list(z.object({ label: str("Nombre del nivel, 1 o 2 palabras."), value: str("Cifra dicha para ese nivel, o vacío.") }), "2 a 5 niveles, de arriba abajo.") }),
  dmNotification: z.object({
    name: str("Quién escribe: un nombre de pila genérico (Ana, Carlos) o 'Nuevo cliente'. Nunca una persona real o famosa."),
    message: str("El mensaje, hasta 12 palabras."),
    app: str("'Mensajes' u otra palabra genérica (nunca el nombre de una app de terceros)."),
    time: str("'ahora' o similar."),
    typing: bool("Muestra 'escribiendo…' antes del mensaje."),
    stack: int("0, 1 o 2 notificaciones apiladas detrás.", 1),
  }),
  barChart: z.object({
    title: str("Título corto o vacío."),
    bars: list(z.object({ label: str("Rótulo corto (mes, Antes, Ahora)."), value: num("Cifra dicha.", 0) }), "2 a 6 barras; solo valores dichos."),
    prefix: str("Antes de cada cifra ($) o vacío."),
    suffix: str("Después de cada cifra (%, K) o vacío."),
    highlight: int("Índice de la barra destacada; -1 = la última.", -1),
  }),
  lineChart: z.object({
    title: str("Título corto o vacío."),
    points: list(z.number(), "3 a 12 puntos que dibujan la forma de la curva (no se muestran como cifras)."),
    value: str("Cifra final dicha, o vacío."),
    startLabel: str("Rótulo del inicio, o vacío."),
    endLabel: str("Rótulo del final, o vacío."),
  }),
  checklist: z.object({ title: str("Título corto o vacío."), items: list(z.string(), "2 a 5 cosas de 1 a 5 palabras.") }),
  timeline: z.object({ title: str("Título corto o vacío."), items: list(z.object({ label: str("Hito: Mes 1, Hoy."), caption: str("Detalle corto o vacío.") }), "2 a 5 hitos.") }),
  iconBurst: z.object({ icon: iconAi, title: str("2 a 5 palabras."), caption: str("Detalle corto o vacío.") }),
  progress: z.object({ value: num("Porcentaje dicho, de 0 a 100.", 0), style: pick(["ring", "bar"]), label: str("Qué significa."), eyebrow: str("Rótulo chico o vacío.") }),
  beforeAfter: z.object({ from: str("Cifra de antes."), to: str("Cifra de después."), fromLabel: str("Antes / Mes 1 …"), toLabel: str("Ahora / Hoy …"), label: str("De qué son las cifras, en pocas palabras.") }),
} satisfies Record<ComponentName, z.ZodType>;

const componentLayers = COMPONENT_NAMES.map((name) =>
  z.object({
    kind: z.literal("component"),
    component: z.literal(name),
    at: num("Segundo en que entra (0 normalmente).", 0),
    scale: num("1 = tamaño normal; 0.7 a 1.4 si piden más chico o más grande.", 1),
    place: pick(["auto", "top", "bottom"], "Solo en modo full: dónde va en la pantalla. auto = centro."),
    props: COMPONENT_PROPS[name],
  }),
);

const point = z.object({ x: num("Fracción del ancho.", 0.5), y: num("Fracción del alto.", 0.5) });
const primitiveLayers = [
  z.object({
    kind: z.literal("text"),
    text: str("El texto, corto."),
    x: num("Centro, fracción del ancho (0 a 1).", 0.5),
    y: num("Centro, fracción del alto (0 a 1).", 0.5),
    w: num("Ancho de la caja, fracción del ancho (0.84 normal).", 0.84),
    size: num("Tamaño en unidades (1080 = lado corto): títulos 90 a 160, textos 48 a 70.", 72),
    weight: int("400 a 900.", 800),
    font: pick(["display", "body"]),
    color: tokenAi,
    align: pick(["center", "left", "right"]),
    uppercase: bool("Todo en mayúsculas."),
    emphasis_words: str("Palabras del texto a marcar, o vacío."),
    emphasis_style: pick(["none", "marker", "underline", "strike", "accent"]),
    animate: animateAi(),
  }),
  z.object({
    kind: z.literal("icon"),
    name: iconAi,
    x: num("Centro, fracción del ancho.", 0.5),
    y: num("Centro, fracción del alto.", 0.5),
    size: num("Unidades: 120 a 260.", 180),
    color: tokenAi,
    tile: pick(["none", "accent", "soft", "outline"]),
    animate: animateAi(),
  }),
  z.object({
    kind: z.literal("counter"),
    value: str("Cifra dicha, como se lee: +40%, 10K."),
    x: num("Centro, fracción del ancho.", 0.5),
    y: num("Centro, fracción del alto.", 0.5),
    size: num("Unidades: 160 a 320.", 220),
    color: tokenAi,
    animate: animateAi("Normalmente countUp."),
  }),
  z.object({
    kind: z.literal("line"),
    points: list(point, "2 a 12 puntos (fracciones del lienzo)."),
    bend: num("Curvatura con 2 puntos (-1 a 1); 0 = recta.", 0),
    color: tokenAi,
    width: num("Grosor en unidades (6 a 14).", 8),
    head: pick(["none", "end"], "end = flecha."),
    animate: animateAi("Normalmente draw."),
  }),
  z.object({
    kind: z.literal("shape"),
    shape: pick(["rect", "pill", "circle"]),
    x: num("Centro, fracción del ancho.", 0.5),
    y: num("Centro, fracción del alto.", 0.5),
    w: num("Ancho, fracción del ancho.", 0.5),
    h: num("Alto, fracción del alto.", 0.1),
    fill: tokenOrNone,
    stroke: tokenOrNone,
    card: bool("Tarjeta de la marca (superficie con borde fino y sombra)."),
    animate: animateAi(),
  }),
];

export const motionLayerAiSchema = z.union([...componentLayers, ...primitiveLayers] as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]);

export const motionSceneAiSchema = z.object({
  title: str("Nombre corto del gráfico para la persona (por ejemplo 'Embudo de ventas')."),
  mode: pick(["full", "overlay"]),
  position: pick(["top", "bottom"], "Solo en overlay: arriba (normal) o abajo."),
  layers: z
    .array(motionLayerAiSchema.catch(null as never))
    .catch([])
    .describe("Normalmente un componente; primitivas solo si hace falta."),
});

/** Respuesta a un pedido o un ajuste de la persona, ya leída (no va a la API: ver el formato de cable). */
export const motionRequestAiSchema = motionSceneAiSchema.extend({
  refusal: str("Vacío si se puede hacer. Si el pedido no se puede (ver LÍMITES), una frase amable que explique por qué."),
  alternative: str("Si hay refusal: un pedido parecido que sí se pueda, escrito como lo pediría la persona. Si no, vacío."),
  note: str("Opcional: una frase si cambiaste algo del pedido (por ejemplo, una cifra que no se dice). Si no, vacío."),
});


export type MotionLayerAi = { kind: "component"; component: ComponentName; at: number; scale: number; place: "auto" | "top" | "bottom"; props: Record<string, unknown> } | MotionPrimitiveAi;
type BehaviorAi = { type: string; at: number; dur: number; dir: string };
export type MotionPrimitiveAi =
  | { kind: "text"; text: string; x: number; y: number; w: number; size: number; weight: number; font: "display" | "body"; color: string; align: "center" | "left" | "right"; uppercase: boolean; emphasis_words: string; emphasis_style: "none" | "marker" | "underline" | "strike" | "accent"; animate: BehaviorAi[] }
  | { kind: "icon"; name: string; x: number; y: number; size: number; color: string; tile: "none" | "accent" | "soft" | "outline"; animate: BehaviorAi[] }
  | { kind: "counter"; value: string; x: number; y: number; size: number; color: string; animate: BehaviorAi[] }
  | { kind: "line"; points: { x: number; y: number }[]; bend: number; color: string; width: number; head: "none" | "end"; animate: BehaviorAi[] }
  | { kind: "shape"; shape: "rect" | "pill" | "circle"; x: number; y: number; w: number; h: number; fill: string; stroke: string; card: boolean; animate: BehaviorAi[] };
export type MotionSceneAi = { title: string; mode: "full" | "overlay"; position: "top" | "bottom"; layers: MotionLayerAi[] };
export type MotionRequestAi = MotionSceneAi & { refusal: string; alternative: string; note: string };

// ─── Formato de cable (lo que viaja a la API) ─────────────────────────────
//
// La salida estructurada de Anthropic compila el esquema a una gramática con un tamaño máximo: la unión de 15
// componentes con 103 íconos cada uno la supera ("The compiled grammar is too large"). Por eso a la API va un esquema
// chico: cada capa es { kind, component, spec } y `spec` es el JSON (en texto) del resto de la capa. Al volver, cada
// spec se lee con los esquemas detallados de arriba (permisivos) y la capa que no se entiende se descarta.

const LAYER_KINDS = ["component", "text", "icon", "counter", "line", "shape"] as const;

const layerWireSchema = z.object({
  kind: z.enum(LAYER_KINDS),
  component: z.string().describe("Si kind es component: nombre exacto del CATÁLOGO. Si no, vacío."),
  spec: z.string().describe('JSON en una línea con el resto de la capa. Componente: {"at":0,"scale":1,"place":"auto","props":{…}}. Primitiva: todos sus campos menos kind.'),
});
export const sceneWireSchema = z.object({
  title: z.string().describe("Nombre corto del gráfico para la persona (por ejemplo 'Embudo de ventas')."),
  mode: z.enum(["full", "overlay"]),
  position: z.enum(["top", "bottom"]).describe("Solo en overlay: arriba (normal) o abajo."),
  layers: z.array(layerWireSchema).describe("Normalmente un componente; primitivas solo si hace falta."),
});
export type MotionLayerWire = z.infer<typeof layerWireSchema>;
export type MotionSceneWire = z.infer<typeof sceneWireSchema>;

/** Respuesta a un pedido o un ajuste (formato de cable). */
export const motionRequestWireSchema = sceneWireSchema.extend({
  refusal: z.string().describe("Vacío si se puede hacer. Si el pedido no se puede (ver LÍMITES), una frase amable que explique por qué."),
  alternative: z.string().describe("Si hay refusal: un pedido parecido que sí se pueda, escrito como lo pediría la persona. Si no, vacío."),
  note: z.string().describe("Opcional: una frase si cambiaste algo del pedido (por ejemplo, una cifra que no se dice). Si no, vacío."),
});
/** Corrección de escenas con problemas (formato de cable, mismo orden que en la tarea). */
export const motionRetryWireSchema = z.object({ graphics: z.array(sceneWireSchema).describe("Una escena corregida por cada GRÁFICO de la tarea, en el mismo orden.") });

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Una capa de cable → capa detallada (o null si no se entiende). */
export function layerFromWire(l: MotionLayerWire): MotionLayerAi | null {
  let spec: Record<string, unknown> | null = null;
  try {
    spec = asRecord(JSON.parse(l.spec || "{}"));
  } catch {
    return null;
  }
  if (!spec) return null;
  let raw: Record<string, unknown>;
  if (l.kind === "component") {
    const { at, scale, place, props, component, kind: _kind, ...rest } = spec;
    void _kind;
    raw = { kind: "component", component: l.component || component, at, scale, place, props: asRecord(props) ?? rest };
  } else {
    raw = { ...spec, kind: l.kind };
  }
  const parsed = motionLayerAiSchema.safeParse(raw);
  return parsed.success ? (parsed.data as MotionLayerAi) : null;
}

/** Escena de cable → escena detallada (las capas que no se entienden se descartan). */
export function sceneFromWire(w: MotionSceneWire | null | undefined): MotionSceneAi | null {
  if (!w) return null;
  const scene = motionSceneAiSchema.parse({ title: w.title, mode: w.mode, position: w.position, layers: [] }) as MotionSceneAi;
  scene.layers = (w.layers ?? []).map(layerFromWire).filter((l): l is MotionLayerAi => Boolean(l));
  return scene;
}

/** Escena detallada → cable (para las respuestas simuladas y las pruebas). */
export function sceneToWire(s: MotionSceneAi): MotionSceneWire {
  return {
    title: s.title,
    mode: s.mode,
    position: s.position,
    layers: s.layers.map((l) => {
      if (l.kind === "component") return { kind: "component" as const, component: l.component, spec: JSON.stringify({ at: l.at, scale: l.scale, place: l.place, props: l.props }) };
      const { kind, ...rest } = l;
      return { kind, component: "", spec: JSON.stringify(rest) };
    }),
  };
}

export function motionRequestFromWire(w: z.infer<typeof motionRequestWireSchema>): MotionRequestAi {
  return { ...(sceneFromWire(w) as MotionSceneAi), refusal: w.refusal ?? "", alternative: w.alternative ?? "", note: w.note ?? "" };
}

// ─── Reglas (contexto en caché) ───────────────────────────────────────────

const catalog = COMPONENT_NAMES.map((name) => {
  const def = COMPONENTS[name];
  return `- ${name} (${def.label}): ${def.hint}\n  forma: ${JSON.stringify(def.example)}`;
}).join("\n");

const icons = ICON_NAMES.map((name) => `${name}${ICON_TAGS[name] ? `: ${ICON_TAGS[name]}` : ""}`).join(" · ");

const example = (scene: MotionSceneAi) => JSON.stringify(sceneToWire(scene));
const comp = (component: ComponentName, props: Record<string, unknown>, extra: Partial<{ at: number; scale: number; place: "auto" | "top" | "bottom" }> = {}): MotionLayerAi => ({ kind: "component", component, at: 0, scale: 1, place: "auto", props, ...extra });

const GOOD = [
  {
    said: "pasamos de dos a diez clientes por mes",
    scene: example({ title: "De 2 a 10 clientes", mode: "full", position: "top", layers: [comp("beforeAfter", { from: "2", to: "10", fromLabel: "Antes", toLabel: "Ahora", label: "clientes por mes" })] }),
  },
  {
    said: "no te faltan anuncios, te falta un sistema",
    scene: example({
      title: "Anuncios tachado, sistema",
      mode: "full",
      position: "top",
      layers: [
        { kind: "text", text: "ANUNCIOS", x: 0.5, y: 0.36, w: 0.84, size: 150, weight: 900, font: "display", color: "muted", align: "center", uppercase: true, emphasis_words: "ANUNCIOS", emphasis_style: "strike", animate: [{ type: "fadeUp", at: 0, dur: 0, dir: "none" }, { type: "strike", at: 0.5, dur: 0, dir: "none" }] },
        { kind: "text", text: "SISTEMA", x: 0.5, y: 0.52, w: 0.84, size: 170, weight: 900, font: "display", color: "accent", align: "center", uppercase: true, emphasis_words: "", emphasis_style: "none", animate: [{ type: "pop", at: 0.95, dur: 0, dir: "none" }] },
      ],
    }),
  },
  {
    said: "y de repente te escriben: quiero información del programa",
    scene: example({ title: "Mensaje de un cliente", mode: "overlay", position: "top", layers: [comp("dmNotification", { name: "Nuevo cliente", message: "Quiero información del programa", app: "Mensajes", time: "ahora", typing: true, stack: 1 })] }),
  },
  {
    said: "el seguimiento es lo que cierra la venta",
    scene: example({ title: "Seguimiento", mode: "overlay", position: "top", layers: [comp("keyword", { text: "Seguimiento", label: "Lo que cierra la venta", emphasis: "marker" })] }),
  },
];

export const MOTION_RULES = `Eres el director de motion graphics de este creador. Diseñas gráficos animados cortos (1,5 a 6 segundos) que aparecen sobre su video de Reels, TikTok o YouTube mientras su voz sigue. Tienen que verse premium, limpios y entenderse en 2 segundos.

QUÉ ARMAS
Un gráfico es una escena con capas. Lo normal es UN componente del CATÁLOGO: ya trae diseño, tamaños, zona segura y animación cuidada. Las primitivas (text, icon, counter, line, shape) son para lo que ningún componente resuelve (por ejemplo, una palabra tachada y otra debajo) o para un detalle de apoyo junto a un componente.

DIRECCIÓN
- Una idea por gráfico. Si el tramo dice dos cosas, muestra la más fuerte. Máximo un componente por gráfico.
- Textos cortísimos: se leen en 2 segundos. Títulos de 2 a 5 palabras, ítems de 1 a 4 palabras, frases de hasta 12 palabras. Sin punto final. Título vacío si no suma.
- Jerarquía clara: una cosa grande (la cifra, la palabra clave) y el resto chico.
- Ritmo variado: en un mismo video no repitas el mismo componente seguido y alterna pantalla completa con sobre el video.
- Con primitivas, cada elemento entra con su animación y en cascada ("at": 0, 0.3, 0.6…): textos con fadeUp, cifras con countUp, íconos con pop, líneas y flechas con draw, tachados con strike, resaltados con highlight.
- Cifras: solo las que la persona dice en ese tramo (con números o con palabras: "el doble" = x2, "tres de cada diez" = 3/10) o las que escribe en su pedido. Nunca inventes, redondees hacia arriba ni completes datos: en barras, líneas y embudos no inventes valores intermedios (si dice "de 2 a 10", son dos barras: 2 y 10). Si no hay cifra, usa un componente sin números.
- Íconos: elige por significado con la lista ÍCONOS y escribe el nombre exacto.
- Colores: solo tokens del tema (accent, text, muted, surface, positive, negative, accent2…). Nunca hex: los colores y la fuente salen de la marca.
- Idioma de los textos: el de la marca (ver IDIOMA). Por defecto español neutro con trato de "tú": sin voseo ni español de España, "video" sin tilde. Respeta las palabras prohibidas de la marca. Sin emojis.

MODO Y POSICIÓN
- "full": pantalla completa con el fondo de la marca. Para cifras, listas, comparaciones, embudos, barras, pasos, líneas de tiempo y todo lo que tenga varias líneas.
- "overlay": sobre el video, con un velo; se sigue viendo la cara. Para una palabra clave, una frase corta, una notificación o un ícono. position "top" (lo normal) o "bottom" (la franja de los subtítulos, que se ocultan mientras se ve).
- place (componentes, solo en full): "auto" (centro), "top" o "bottom" si lo piden.
- scale (componentes): 1 normal; de 0.7 a 1.4 si piden más chico o más grande.

PRIMITIVAS
- Coordenadas en fracciones del lienzo (0 a 1); x, y es el centro. Tamaños en unidades (1080 = el lado corto).
- Zona segura en 9:16: x entre 0.08 y 0.92, y entre 0.08 y 0.80. Abajo a la derecha están los botones de Reels (x > 0.86, y > 0.6): ahí nada de texto. En overlay, el contenido va entre y 0.07 y 0.35 (top) o entre 0.57 y 0.82 (bottom). En 16:9, x entre 0.06 y 0.94, y entre 0.08 y 0.9.
- Deja aire entre elementos: que no se pisen.
- text: emphasis_words marca palabras del mismo texto con emphasis_style (marker = resaltador, underline, strike = tachado, accent = color de acento).

CAMPOS DE CADA PRIMITIVA (todos van en spec)
- text: text, x, y, w (ancho de la caja; 0.84 normal), size (títulos 90 a 160, textos 48 a 70), weight (400 a 900), font (display | body), color (token), align (center | left | right), uppercase (true | false), emphasis_words, emphasis_style (none | marker | underline | strike | accent), animate.
- icon: name (nombre exacto de ÍCONOS), x, y, size (120 a 260), color (token), tile (none | accent | soft | outline), animate.
- counter: value (cifra dicha, como se lee: +40%, 10K), x, y, size (160 a 320), color (token), animate (normalmente countUp).
- line: points (2 a 12 puntos {x, y} en fracciones), bend (curvatura con 2 puntos, -1 a 1; 0 = recta), color (token), width (6 a 14), head (none | end = flecha), animate (normalmente draw).
- shape: shape (rect | pill | circle), x, y, w, h (fracciones), fill (token o none), stroke (token o none), card (true = tarjeta de la marca), animate.
- animate: lista de {type, at, dur, dir}. type: ${BEHAVIORS.join(", ")}. at = segundo en que empieza; dur = 0 para la duración de siempre; dir (left | right | up | down) solo en slide y wipe, en los demás none.

FORMATO DE RESPUESTA
Cada capa va como {"kind", "component", "spec"}. kind es component, text, icon, counter, line o shape. component es el nombre del CATÁLOGO (vacío en las primitivas). spec es un texto con el JSON del resto de la capa, en una línea: para un componente {"at":0,"scale":1,"place":"auto","props":{…}} con las props de su forma; para una primitiva, todos sus campos menos kind. Los gráficos que te muestran en las tareas (GRÁFICO ACTUAL, Escena) vienen en la forma legible, con los campos sueltos: respóndelos siempre en este formato.

LÍMITES (no se pueden hacer)
- Personas, caras, cuerpos o personajes dibujados.
- Fotos o video realistas (escenas filmadas, productos fotografiados).
- Logos o marcas de terceros (Instagram, WhatsApp, Nike…): usa un ícono genérico (por ejemplo message-circle en lugar del logo de una app).
- Cifras que la persona no dice en el tramo ni escribe en su pedido.
Si un pedido entra en un límite: deja layers vacío, explica en "refusal" con una frase amable y corta (qué no se puede y por qué) y propone en "alternative" un pedido parecido que sí se pueda. Si solo una parte no se puede (por ejemplo, una cifra inventada), haz el resto sin esa parte y avísalo en "note".

CATÁLOGO DE COMPONENTES (nombre, para qué sirve y la forma de sus props; los textos y cifras de las formas son ejemplos, nunca los copies)
${catalog}

ÍCONOS (nombre: significado)
${icons}

EJEMPLOS BUENOS
${GOOD.map((g) => `- Dice "${g.said}" →\n  ${g.scene}`).join("\n")}

EJEMPLOS MALOS (no hagas esto)
- statCard con "+300%" cuando la persona no dijo ningún porcentaje: cifra inventada.
- barChart con 2, 4, 7 y 10 cuando solo dijo "de 2 a 10": valores intermedios inventados.
- Una lista de 5 ítems de 8 palabras en overlay: no se lee en 2 segundos ni entra.
- Un embudo y unas barras en el mismo gráfico: dos ideas.
- Un texto de primitiva en x 0.95 o y 0.9: fuera de la zona segura.
- "color": "#FF0000": los colores salen de la marca.
- dmNotification con el nombre de una persona famosa o el logo de una app.`;

// ─── Tareas ───────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toFixed(1);

/** Contexto común de un tramo: lo que se dice, el formato y la duración. */
function tramo(input: { spoken: string; around: string; format: string; duration: number }): string {
  return `TRAMO
- Formato: ${input.format}
- Dura: ${fmt(input.duration)} s
- Lo que dice la persona en el tramo: "${input.spoken}"
${input.around && input.around !== input.spoken ? `- Frase completa alrededor (contexto): "${input.around}"` : ""}`.trim();
}

/** La persona describe el gráfico que quiere para un tramo. */
export function motionRequestTask(input: { request: string; spoken: string; around: string; format: string; duration: number }): string {
  return `Arma el gráfico que pide la persona para este tramo de su video.

${tramo(input)}

PEDIDO DE LA PERSONA
<pedido>
${input.request}
</pedido>

Sigue el pedido (componente, textos, posición) mientras no rompa la DIRECCIÓN ni los LÍMITES. Si el pedido es vago, elige el mejor componente para lo que dice el tramo.`;
}

/** La persona pide un cambio sobre el gráfico actual. */
export function motionAdjustTask(input: { request: string; spoken: string; around: string; format: string; duration: number; current: MotionSceneAi }): string {
  return `Ajusta el gráfico actual según lo que pide la persona. Cambia solo lo que pide y deja el resto igual.

${tramo(input)}

GRÁFICO ACTUAL
<escena>
${JSON.stringify(input.current)}
</escena>

CAMBIO QUE PIDE
<pedido>
${input.request}
</pedido>

Si el cambio no se puede hacer con este componente (por ejemplo, cambiar la dirección de una flecha que el componente dibuja siempre igual), haz lo más parecido que sí se pueda (otro componente o primitivas) y explícalo en "note".`;
}

/** Escenas que no pasaron la validación, con sus problemas explicados, para que Claude las corrija. */
export function motionRetryTask(items: { spoken: string; format: string; duration: number; scene: MotionSceneAi; problems: string[]; request?: string }[]): string {
  return `Estos gráficos tienen problemas: corrígelos. Mantén la idea y cambia lo mínimo (acortar textos, menos elementos, otro modo, otro componente más simple). Devuelve una escena por cada GRÁFICO, en el mismo orden.

${items
  .map(
    (it, i) => `GRÁFICO ${i + 1}
- Formato: ${it.format} · dura ${fmt(it.duration)} s
- Lo que dice la persona: "${it.spoken}"
${it.request ? `- Lo que pidió: "${it.request}"\n` : ""}- Escena:
${JSON.stringify(it.scene)}
- Problemas:
${it.problems.map((p) => `  · ${p}`).join("\n")}`,
  )
  .join("\n\n")}`;
}

// ─── Plan automático del b-roll (feature "video.broll.motion") ───────────

/**
 * Reglas del plan de b-roll con el motor nuevo: dónde va cada b-roll y si es una toma (stock o biblioteca) o un
 * gráfico. La tarea es la misma que la del plan anterior (brollTask en editor.ts).
 */
export const BROLL_MOTION_RULES = `Eres el editor de b-roll de este creador. El b-roll tapa por unos segundos al creador mientras su voz sigue. Hay dos tipos:
- "stock": una toma de video real (por ejemplo, alguien atendiendo un teléfono mientras dice "contestan el teléfono"), del banco de videos o de los clips propios del creador.
- "graphic": un gráfico animado con la marca (ver las reglas de motion graphics más abajo). Sirve para lo conceptual, que no se puede filmar: cifras, listas, contrastes, procesos, frases e ideas clave.

CUÁNDO USAR CADA UNO
- Cifra o resultado dicho → graphic (statCard, beforeAfter, progress, barChart).
- Enumera cosas → list o checklist. Proceso o sistema → steps o funnel. Contraste (antes y después, mito y realidad, "no es X, es Y") → comparison o primitivas con un tachado.
- Un mensaje o pedido de un cliente → dmNotification. Una idea clave → keyword o quote en overlay.
- Algo concreto que se puede mostrar (un objeto, un lugar, una acción) → stock.
- En contenido conceptual (ventas, anuncios, sistemas, negocios) prefiere gráficos; deja el stock para lo que se ve.
- Nunca en frases emocionales o personales donde importa ver la cara (ahí, si hace falta, keyword o quote en overlay).

REGLAS DEL PLAN
- Nunca dentro de los rangos PROHIBIDO (gancho, apertura y llamado a la acción): ahí se ve al creador.
- Cada tramo dura entre DURACIÓN mínima y máxima (los gráficos, entre GRÁFICOS mínima y máxima), empieza y termina en palabras de la misma frase y no se superpone con otro.
- Separa los b-roll de forma pareja a lo largo del video, más o menos con la cantidad pedida.
- Las cifras de cada gráfico tienen que estar en lo que se dice en ESE tramo.
- query_en (siempre, también en los gráficos, por si el creador prefiere una toma): 2 a 5 palabras en inglés, concretas y visuales, como se busca en un banco de videos. Sin marcas ni personas famosas.
- keywords: 2 a 4 palabras en español, en minúsculas, para buscar en los clips propios del creador.
- En los tramos "stock", graphic va en null.
- Usa solo ids que existan. "why" va en una frase corta para el creador, en español neutro con trato de "tú".`;

export const brollMotionWireSchema = z.object({
  broll: z
    .array(
      z.object({
        from_word: z.number().int(),
        to_word: z.number().int(),
        kind: z.enum(["stock", "graphic"]),
        query_en: z.string().describe("Consulta en inglés para bancos de videos de stock, 2 a 5 palabras."),
        keywords: z.array(z.string()).describe("2 a 4 palabras clave en español para la biblioteca."),
        graphic: sceneWireSchema.nullable().describe("La escena si kind es graphic; null si es stock."),
        why: z.string().describe("Por qué ahí, en una frase."),
      }),
    )
    .describe("Tramos de b-roll en orden, sin superponerse."),
});
export type BrollMotionAiOutput = { broll: { from_word: number; to_word: number; kind: "stock" | "graphic"; query_en: string; keywords: string[]; graphic: MotionSceneAi | null; why: string }[] };

export function brollMotionFromWire(w: z.infer<typeof brollMotionWireSchema>): BrollMotionAiOutput {
  return { broll: w.broll.map((b) => ({ ...b, graphic: b.kind === "graphic" ? sceneFromWire(b.graphic) : null })) };
}
