/**
 * Galería de subtítulos animados ("Caja", "Hormozi", "Karaoke", "Palabra a palabra", "Minimal" y "Resaltador").
 *
 * Una sola fuente de verdad para la vista previa (HTML, components/editor/caption-overlay.tsx) y el render
 * (ASS, worker/video/ass.py): este archivo arma, para cada bloque de subtítulos, en qué renglón va cada palabra y
 * sus pistas de animación (color, opacidad, escala, caja, resaltador y emoji) como fotogramas clave con tiempos
 * absolutos del video final. Entre dos claves el valor cambia en línea recta, igual que `\t` de ASS sin `accel`.
 * La vista previa evalúa las mismas claves en cada cuadro y el worker las traduce a etiquetas `\t`: por eso se ven
 * iguales. Lo único que mide cada lado por su cuenta es el ancho de las palabras (la misma fuente en los dos).
 *
 * Este archivo no importa nada de servidor.
 */
import type { CaptionBlock, TimedWord, VideoFormat } from "./types";

export const CAPTION_STYLE_KEYS = ["caja", "hormozi", "karaoke", "palabra", "minimal", "resaltador"] as const;
export type CaptionStyleKey = (typeof CAPTION_STYLE_KEYS)[number];

export function isCaptionStyle(key: string): key is CaptionStyleKey {
  return (CAPTION_STYLE_KEYS as readonly string[]).includes(key);
}

export type CaptionFamily = "Montserrat" | "Inter";
export type CaptionFont = { family: CaptionFamily; weight: 600 | 800 | 900 };

/** Diseño resuelto de un estilo (con los colores y la fuente de la marca). Medidas en em o en fracción del cuadro. */
export type CaptionLook = {
  v: 1;
  style: CaptionStyleKey;
  font: CaptionFont;
  /** Tamaño de la fuente (1 em) sobre la altura del cuadro. */
  size: number;
  textCase: "upper" | "lower" | "none";
  /** Alto de cada renglón, en em. */
  lineHeight: number;
  /** Espacio entre palabras, en em. */
  gap: number;
  /** Ancho máximo del bloque, en fracción del ancho del cuadro (si un renglón no entra, el bloque se achica). */
  maxWidth: number;
  /** Centro vertical del bloque, en fracción de la altura (0 arriba, 1 abajo). */
  y: number;
  /** Color del texto, del contorno y su grosor (em; 0 = sin contorno). */
  text: string;
  outline: number;
  outlineColor: string;
  /** Sombra (en em): desplazamiento vertical, desenfoque y opacidad. */
  shadow: { y: number; blur: number; color: string; alpha: number } | null;
  /** Píldora detrás de la palabra activa. */
  box: { color: string; radius: number; padX: number; padY: number } | null;
  /** Resaltador detrás de la palabra clave (alto en em, centrado en el renglón). */
  marker: { color: string; alpha: number; height: number; padX: number; radius: number } | null;
  /** Emoji encima de las palabras clave (imágenes de Noto Emoji, las mismas en la vista previa y en el render). */
  emoji: boolean;
};

export type Key = { t: number; v: number };
export type ColorKey = { t: number; c: string };

/** Una palabra lista para dibujar: renglón, tamaño relativo y sus pistas. */
export type WordTrack = {
  text: string;
  line: number;
  /** Multiplicador del tamaño de la fuente (las palabras clave de "Hormozi" van más grandes). */
  size: number;
  color: ColorKey[];
  alpha: Key[];
  scale: Key[];
  box: { alpha: Key[]; scale: Key[] } | null;
  marker: { grow: Key[] } | null;
  /** Nombre del emoji (archivo `<nombre>.png` en public/emoji y worker/assets/emoji) y su opacidad. */
  emoji: { name: string; alpha: Key[] } | null;
};

export type LaidBlock = { start: number; end: number; lines: number; words: WordTrack[] };

type StyleDef = {
  label: string;
  description: string;
  /** Palabras y caracteres máximos por bloque, y caracteres por renglón (en 9:16; en 16:9 el doble). */
  words: number;
  chars: number;
  lineChars: number;
  /** Usa la fuente de títulos de Mi marca (Montserrat o Inter); si no, la fija del estilo. */
  brandFont: boolean;
  font: CaptionFont;
  size: Record<VideoFormat, number>;
  y: Record<VideoFormat, number>;
  textCase: CaptionLook["textCase"];
};

const Y_V = 0.665;
const Y_H = 0.8;

export const CAPTION_STYLES: Record<CaptionStyleKey, StyleDef> = {
  caja: {
    label: "Caja",
    description: "Una píldora de tu color salta de palabra en palabra mientras hablas.",
    words: 3, chars: 22, lineChars: 13, brandFont: true, font: { family: "Montserrat", weight: 800 },
    size: { "9:16": 0.04, "16:9": 0.058 }, y: { "9:16": Y_V, "16:9": Y_V + 0.13 }, textCase: "upper",
  },
  hormozi: {
    label: "Hormozi",
    description: "Mayúsculas grandes con contorno. La palabra clave, en tu color y más grande.",
    words: 3, chars: 18, lineChars: 11, brandFont: false, font: { family: "Montserrat", weight: 900 },
    size: { "9:16": 0.05, "16:9": 0.072 }, y: { "9:16": Y_V, "16:9": Y_H }, textCase: "upper",
  },
  karaoke: {
    label: "Karaoke",
    description: "Ves la frase completa y las palabras se van pintando a medida que las dices.",
    words: 5, chars: 34, lineChars: 18, brandFont: true, font: { family: "Montserrat", weight: 800 },
    size: { "9:16": 0.037, "16:9": 0.054 }, y: { "9:16": Y_V, "16:9": Y_H }, textCase: "none",
  },
  palabra: {
    label: "Palabra a palabra",
    description: "Una sola palabra enorme a la vez, que entra con un salto.",
    words: 1, chars: 14, lineChars: 14, brandFont: false, font: { family: "Montserrat", weight: 900 },
    size: { "9:16": 0.066, "16:9": 0.092 }, y: { "9:16": 0.62, "16:9": 0.76 }, textCase: "upper",
  },
  minimal: {
    label: "Minimal",
    description: "Minúsculas finas con sombra suave. Las palabras aparecen cuando las dices.",
    words: 5, chars: 34, lineChars: 20, brandFont: false, font: { family: "Inter", weight: 600 },
    size: { "9:16": 0.033, "16:9": 0.048 }, y: { "9:16": Y_V, "16:9": Y_H }, textCase: "lower",
  },
  resaltador: {
    label: "Resaltador",
    description: "Un marcador de tu color se pinta detrás de la palabra clave.",
    words: 4, chars: 26, lineChars: 15, brandFont: true, font: { family: "Montserrat", weight: 800 },
    size: { "9:16": 0.039, "16:9": 0.056 }, y: { "9:16": Y_V, "16:9": Y_H }, textCase: "none",
  },
};

const WHITE = "#FFFFFF";
const BLACK = "#000000";
const DARK = "#0B1020";

const hexOk = (c: string | null | undefined): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);

/** Texto legible sobre el acento: oscuro si el acento es claro. */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.45 ? DARK : WHITE;
}

/** Diseño de un estilo con la marca: color de acento, fuente de títulos ("montserrat" | "inter") y si van emojis. */
export function captionLook(style: CaptionStyleKey, options: { format: VideoFormat; accent: string; brandFont?: "montserrat" | "inter"; emoji?: boolean }): CaptionLook {
  const def = CAPTION_STYLES[style];
  const accent = hexOk(options.accent) ? options.accent.toUpperCase() : "#FFD84D";
  const family: CaptionFamily = def.brandFont ? (options.brandFont === "inter" ? "Inter" : "Montserrat") : def.font.family;
  const base: CaptionLook = {
    v: 1,
    style,
    font: { family, weight: def.font.weight },
    size: def.size[options.format],
    textCase: def.textCase,
    lineHeight: 1.18,
    gap: 0.28,
    maxWidth: options.format === "9:16" ? 0.8 : 0.76,
    y: def.y[options.format],
    text: WHITE,
    outline: 0.06,
    outlineColor: BLACK,
    shadow: { y: 0.05, blur: 0, color: BLACK, alpha: 0.45 },
    box: null,
    marker: null,
    emoji: Boolean(options.emoji),
  };
  switch (style) {
    case "caja":
      return { ...base, gap: 0.34, outline: 0.05, shadow: { y: 0.05, blur: 0.12, color: BLACK, alpha: 0.4 }, box: { color: accent, radius: 0.2, padX: 0.16, padY: 0.06 } };
    case "hormozi":
      return { ...base, lineHeight: 1.08, gap: 0.24, outline: 0.09, shadow: { y: 0.07, blur: 0, color: BLACK, alpha: 0.85 } };
    case "karaoke":
      return { ...base, outline: 0.055 };
    case "palabra":
      return { ...base, outline: 0.075, shadow: { y: 0.06, blur: 0, color: BLACK, alpha: 0.7 } };
    case "minimal":
      return { ...base, lineHeight: 1.24, gap: 0.26, outline: 0, shadow: { y: 0.06, blur: 0.3, color: BLACK, alpha: 0.75 } };
    case "resaltador":
      return { ...base, gap: 0.3, outline: 0.045, shadow: null, marker: { color: accent, alpha: 0.92, height: 1.04, padX: 0.1, radius: 0.12 } };
  }
}

/** Parámetros para cortar bloques (captions.ts). */
export function styleBlockLimits(style: CaptionStyleKey): { words: number; chars: number } {
  return { words: CAPTION_STYLES[style].words, chars: CAPTION_STYLES[style].chars };
}

export function applyCase(text: string, textCase: CaptionLook["textCase"]): string {
  return textCase === "upper" ? text.toLocaleUpperCase("es") : textCase === "lower" ? text.toLocaleLowerCase("es") : text;
}

// ─── Emojis ────────────────────────────────────────────────────────────────

/**
 * Emoji para una palabra clave (raíz en minúsculas y sin tildes → nombre del archivo). Solo los que están en
 * EMOJI_NAMES, que son los PNG generados con worker/scripts/make_emoji.py (Noto Color Emoji, OFL).
 */
const EMOJI_RULES: [RegExp, string][] = [
  [/^(dinero|plata|ingres|ganan|factur|sueldo|pago|cobr|precio|money)/, "dinero"],
  [/^(vend|venta|client|compra)/, "carrito"],
  [/^(crec|escal|aument|subi|mas$|result|exito|exitos)/, "grafico"],
  [/^(idea|creativ|truco|secreto|clave)/, "idea"],
  [/^(viral|fuego|brutal|increibl|explot)/, "fuego"],
  [/^(tiempo|hora|minuto|rapid|dia|dias|semana)/, "reloj"],
  [/^(error|mal|nunca|prohib|evita|no$)/, "cruz"],
  [/^(bien|correct|siempre|listo|si$|funciona)/, "check"],
  [/^(meta|objetiv|enfoq|foco)/, "diana"],
  [/^(energ|poder|potenc|fuerz)/, "rayo"],
  [/^(amor|ama|encant|pasion)/, "corazon"],
  [/^(ia$|inteligen|robot|automat|chatgpt|claude)/, "robot"],
  [/^(atencion|cuidado|alerta|ojo)/, "alerta"],
  [/^(cohete|lanz|despeg)/, "cohete"],
  [/^(pens|cerebro|ment|aprend)/, "cerebro"],
  [/^(feliz|alegr|sonr)/, "sonrisa"],
  [/^(celul|telefon|instagram|tiktok|reel|redes)/, "telefono"],
  [/^(trabaj|empres|negocio|oficin)/, "maletin"],
];
export const EMOJI_NAMES = ["dinero", "carrito", "grafico", "idea", "fuego", "reloj", "cruz", "check", "diana", "rayo", "corazon", "robot", "alerta", "cohete", "cerebro", "sonrisa", "telefono", "maletin"] as const;

export function emojiFor(word: string): string | null {
  const w = word
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ]/g, "");
  if (w.length < 2) return null;
  for (const [re, name] of EMOJI_RULES) if (re.test(w)) return name;
  return null;
}

// ─── Pistas ────────────────────────────────────────────────────────────────

const FADE = 0.05;

/** Valor de una pista en un instante (lineal entre claves; antes de la primera, la primera; después, la última). */
export function valueAt(keys: Key[], t: number): number {
  if (!keys.length) return 1;
  if (t <= keys[0]!.t) return keys[0]!.v;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!;
    if (t < b.t) {
      const a = keys[i - 1]!;
      return b.t === a.t ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
    }
  }
  return keys[keys.length - 1]!.v;
}

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};

export function colorAt(keys: ColorKey[], t: number): string {
  if (!keys.length) return WHITE;
  const channel = (i: 0 | 1 | 2) => valueAt(keys.map((k) => ({ t: k.t, v: rgb(k.c)[i] })), t);
  const hex = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${hex(channel(0))}${hex(channel(1))}${hex(channel(2))}`.toUpperCase();
}

/** Redondeo a milésimas (las claves viajan en el JSON del trabajo). */
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Claves en orden, sin repetidas, con el tiempo dentro del bloque. */
function clean<T extends { t: number }>(keys: T[], start: number, end: number, same: (a: T, b: T) => boolean): T[] {
  const sorted = keys.map((k) => ({ ...k, t: r3(Math.max(start, Math.min(end, k.t))) })).sort((a, b) => a.t - b.t);
  const out: T[] = [];
  for (const k of sorted) {
    const last = out[out.length - 1];
    if (last && last.t === k.t && same(last, k)) continue;
    out.push(k);
  }
  // Una clave igual a la anterior y a la siguiente no aporta nada.
  return out.filter((k, i) => i === 0 || i === out.length - 1 || !(same(out[i - 1]!, k) && same(k, out[i + 1]!)));
}
const cleanKeys = (keys: Key[], start: number, end: number) => clean(keys, start, end, (a, b) => Math.abs(a.v - b.v) < 1e-4);
const cleanColors = (keys: ColorKey[], start: number, end: number) => clean(keys, start, end, (a, b) => a.c === b.c);

/** Producto de dos pistas (muestreado en todas sus claves). */
function mul(a: Key[], b: Key[]): Key[] {
  const times = [...new Set([...a, ...b].map((k) => k.t))].sort((x, y) => x - y);
  return times.map((t) => ({ t, v: valueAt(a, t) * valueAt(b, t) }));
}

/** Cambio a `to` en [from, from+dur] y vuelta a `base` en [until, until+dur] (si hay `until`). */
function pulse(base: number, to: number, from: number, until: number | null, dur = FADE): Key[] {
  const keys: Key[] = [{ t: from, v: base }, { t: from + dur, v: to }];
  if (until != null) keys.push({ t: until, v: to }, { t: until + dur, v: base });
  return keys;
}

function colorPulse(base: string, to: string, from: number, until: number | null, dur = FADE): ColorKey[] {
  const keys: ColorKey[] = [{ t: from, c: base }, { t: from + dur, c: to }];
  if (until != null) keys.push({ t: until, c: to }, { t: until + dur, c: base });
  return keys;
}

/** Salto de escala: de `from` a `peak` y a 1. */
function pop(at: number, from: number, peak: number, up = 0.09, settle = 0.08): Key[] {
  return [{ t: at, v: from }, { t: at + up, v: peak }, { t: at + up + settle, v: 1 }];
}

/** Renglón de cada palabra: hasta 2 renglones, cortados donde los dos quedan más parejos. */
export function lineBreaks(texts: string[], lineChars: number): number[] {
  const total = texts.reduce((n, t) => n + t.length, 0) + Math.max(0, texts.length - 1);
  if (texts.length < 2 || total <= lineChars) return texts.map(() => 0);
  let best = 1;
  let bestMax = Infinity;
  for (let cut = 1; cut < texts.length; cut++) {
    const a = texts.slice(0, cut).reduce((n, t) => n + t.length + 1, -1);
    const b = texts.slice(cut).reduce((n, t) => n + t.length + 1, -1);
    if (Math.max(a, b) < bestMax) {
      bestMax = Math.max(a, b);
      best = cut;
    }
  }
  return texts.map((_, i) => (i < best ? 0 : 1));
}

/** Índice de la palabra clave del bloque para "Resaltador": las resaltadas del plan o, en bloques largos, la más larga. */
function keywordIndexes(words: TimedWord[], fallback: boolean): Set<number> {
  const marked = words.map((w, i) => (w.emphasis ? i : -1)).filter((i) => i >= 0);
  if (marked.length || !fallback || words.length < 3) return new Set(marked);
  let best = -1;
  words.forEach((w, i) => {
    const len = w.text.replace(/[^\p{L}\p{N}]/gu, "").length;
    if (len >= 6 && (best < 0 || len > words[best]!.text.replace(/[^\p{L}\p{N}]/gu, "").length)) best = i;
  });
  return new Set(best >= 0 ? [best] : []);
}

/**
 * Pistas de animación de un bloque con un estilo. `accent` es el color de acento de la marca (los diseños de caja y
 * resaltador ya lo traen; los demás estilos lo usan para la palabra activa o la clave).
 */
export function captionTracks(look: CaptionLook, block: CaptionBlock, format: VideoFormat, accentHex: string): LaidBlock {
  const accent = hexOk(accentHex) ? accentHex.toUpperCase() : (look.box?.color ?? look.marker?.color ?? "#FFD84D");
  const onAccent = textOn(accent);
  const def = CAPTION_STYLES[look.style];
  const words = block.words;
  const n = words.length;
  const start = block.start;
  const end = block.end;
  const act = (i: number) => (i === 0 ? start : Math.max(start, words[i]!.start));
  const next = (i: number) => (i + 1 < n ? act(i + 1) : null);
  const texts = words.map((w) => applyCase(w.text, look.textCase));
  const lines = lineBreaks(texts, def.lineChars * (format === "16:9" ? 2 : 1));
  const keywords = keywordIndexes(words, look.style === "resaltador");
  const entrance: Key[] = [{ t: start, v: 0 }, { t: start + 0.08, v: 1 }];

  const tracks: WordTrack[] = words.map((w, i) => {
    const a = act(i);
    const nx = next(i);
    let color: ColorKey[] = [{ t: start, c: look.text }];
    let alpha: Key[] = entrance;
    let scale: Key[] = [{ t: start, v: 1 }];
    let size = 1;
    let box: WordTrack["box"] = null;
    let marker: WordTrack["marker"] = null;
    switch (look.style) {
      case "caja":
        scale = pop(start, 0.9, 1.03, 0.07, 0.06);
        color = [{ t: start, c: look.text }, ...colorPulse(look.text, onAccent, a, nx, 0.03)];
        box = { alpha: pulse(0, 1, a, nx, 0.03), scale: pop(a, 0.8, 1.08, 0.08, 0.06) };
        break;
      case "hormozi":
        size = w.emphasis ? 1.18 : 1;
        color = [{ t: start, c: w.emphasis ? accent : look.text }];
        scale = mul(pop(start, 0.72, 1.07, 0.08, 0.07), pulse(1, 1.1, a, nx, 0.07));
        break;
      case "karaoke":
        alpha = mul(entrance, pulse(0.42, 1, a, null, 0.06));
        color = [{ t: start, c: look.text }, ...colorPulse(look.text, accent, a, nx, 0.06)];
        break;
      case "palabra":
        alpha = [{ t: start, v: 0 }, { t: start + 0.06, v: 1 }];
        scale = pop(start, 0.55, 1.12, 0.09, 0.08);
        color = [{ t: start, c: w.emphasis ? accent : look.text }];
        break;
      case "minimal":
        alpha = [{ t: a, v: 0 }, { t: a + 0.15, v: 1 }];
        color = [{ t: start, c: w.emphasis ? accent : look.text }];
        break;
      case "resaltador":
        if (keywords.has(i)) {
          marker = { grow: [{ t: a, v: 0 }, { t: a + 0.18, v: 1 }] };
          color = [{ t: start, c: look.text }, ...colorPulse(look.text, onAccent, a + 0.06, null, 0.1)];
        }
        break;
    }
    // Solo en el primer renglón: encima de la palabra, sin tapar el texto de arriba.
    const emojiName = look.emoji && lines[i] === 0 && (w.emphasis || (look.style === "resaltador" && keywords.has(i))) ? emojiFor(w.text) : null;
    return {
      text: texts[i]!,
      line: lines[i]!,
      size,
      color: cleanColors(color, start, end),
      alpha: cleanKeys(alpha, start, end),
      scale: cleanKeys(scale, start, end),
      box: box ? { alpha: cleanKeys(box.alpha, start, end), scale: cleanKeys(box.scale, start, end) } : null,
      marker: marker ? { grow: cleanKeys(marker.grow, start, end) } : null,
      emoji: emojiName ? { name: emojiName, alpha: cleanKeys([{ t: a, v: 0 }, { t: a + 0.1, v: 1 }], start, end) } : null,
    };
  });
  // Un solo emoji por bloque (el primero), para no recargar.
  let seen = false;
  for (const t of tracks) {
    if (t.emoji && seen) t.emoji = null;
    if (t.emoji) seen = true;
  }
  return { start: r3(start), end: r3(end), lines: Math.max(...lines) + 1, words: tracks };
}
