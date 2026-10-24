/**
 * Composiciones: animaciones que escribe Claude como un módulo JS chico con una API fija. Este archivo define el
 * contrato (lo que recibe el módulo y lo que devuelve el sandbox) y los límites. Sin servidor y sin dependencias: lo
 * importan la app, el navegador, el worker y el runtime que corre dentro del sandbox.
 *
 * El módulo:
 *   export default { duration?, background?: "video" | "none", params?: { clave: "texto" }, render(ctx, t, env) {…} }
 *
 * `ctx` NO es el lienzo real: es un grabador con la API de Canvas 2D (más drawVideo/drawPerson) que arma una lista de
 * dibujo. La lista sale del sandbox como datos y el motor de efectos la dibuja en el lienzo real, igual en la vista
 * previa (navegador) y en el render (skia-canvas en el worker). Así el código generado nunca toca nada de afuera.
 */

/** Versión de la API de composiciones (cambia si cambia el contrato del módulo o de la lista de dibujo). */
export const COMPOS_API_VERSION = 1;

export const COMPOS_LIMITS = {
  /** Largo máximo del código fuente. */
  codeChars: 24_000,
  /** Operaciones de dibujo por cuadro (sumando las capas). */
  opsPerFrame: 40_000,
  /** Capas auxiliares por cuadro. */
  layersPerFrame: 12,
  /** Texto por llamada a fillText. */
  textChars: 400,
  /** Tiempo por cuadro: en la validación (promedio y máximo) y en el render (corte duro del sandbox). */
  validateAvgMs: 45,
  validateMaxMs: 160,
  renderFrameMs: 400,
  /** Memoria del sandbox de Node (MB). */
  memoryMb: 160,
  /** Duración de una composición. */
  minSeconds: 0.5,
  maxSeconds: 12,
} as const;

/** Palabra del tramo, en segundos de la composición (0 = cuando empieza). */
export type ComposWord = { text: string; t0: number; t1: number; strong: boolean };

/** Imagen permitida (miniaturas de tus reels, imágenes de b-roll): se dibuja con ctx.drawImage(env.assets[i], …). */
export type ComposAsset = { id: string; width: number; height: number; kind: "thumb" | "image"; title: string };

/** Lo que el sandbox recibe para armar `env` (datos planos: viajan como JSON). */
export type ComposEnvData = {
  width: number;
  height: number;
  duration: number;
  seed: number;
  words: ComposWord[];
  params: Record<string, string>;
  brand: { accent: string; bg: string; surface: string; ink: string; muted: string; accentText: string; display: "Inter" | "Montserrat" };
  /** Cara de la persona (píxeles del video final): lo que no se tapa nunca. */
  face: { x: number; y: number; w: number; h: number };
  /** Franja de los subtítulos (para no dibujar encima si se ven). */
  captions: { y: number; h: number; visible: boolean };
  /** Si va a haber recorte de la persona (en la vista previa puede tardar en llegar). */
  mask: boolean;
  assets: ComposAsset[];
};

/** Un cuadro dibujado: la lista principal y las capas que usa (por clave "L<n>.<versión>"). */
export type ComposFrame = { o: unknown[]; l: Record<string, unknown[]>; n: number };

/** Resultado de un cuadro en el sandbox. */
export type ComposFrameResult = { ok: true; frame: ComposFrame; ms: number } | { ok: false; error: string; line: number | null; kind: "error" | "timeout" | "memory" | "limit" };

export const COMPOS_FAMILIES = ["Inter", "Montserrat", "Instrument Serif", "JetBrains Mono", "Caveat", "Anton"] as const;
export type ComposFamily = (typeof COMPOS_FAMILIES)[number];

export const COMPOSITE_OPS = [
  "source-over",
  "source-in",
  "source-out",
  "source-atop",
  "destination-over",
  "destination-in",
  "destination-out",
  "destination-atop",
  "lighter",
  "xor",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;

/** Filtros que se pueden usar en ctx.filter (los de blur van en píxeles del video final). */
export const FILTER_RE = /^(none|(\s*(blur\(\s*[\d.]+px\s*\)|(brightness|contrast|saturate|grayscale|sepia|invert|opacity)\(\s*[\d.]+%?\s*\)|hue-rotate\(\s*-?[\d.]+deg\s*\)))+\s*)$/;

/** Colores: hex, rgb(a), hsl(a) o un nombre. */
export const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/-]{1,60}\)|hsla?\([\d\s.,%/a-z-]{1,60}\)|[a-z]{3,20})$/i;

/**
 * La API que lee Claude (va en el contexto del prompt). Tiene que coincidir con runtime/index.ts.
 */
export const COMPOS_API_DOC = `API DE LAS COMPOSICIONES (versión ${COMPOS_API_VERSION})

Escribes UN módulo de JavaScript (ES2022, sin import ni require) que exporta un objeto:

export default {
  background: "video",          // "video" (por defecto): antes de render ya se dibujó el cuadro del video a pantalla completa. "none": pintas tú todo el fondo.
  params: { title: "TEXTO" },   // textos que la persona puede cambiar sin regenerar (claves en inglés, valores en español). Léelos SIEMPRE de env.params.
  render(ctx, t, env) { … }     // se llama en cada cuadro (30 por segundo). t = segundos desde que empieza (0 … env.duration).
};

REGLAS DURAS
- render tiene que ser PURO: el mismo t da el mismo dibujo (la vista previa salta a cualquier instante). Nada de estado entre cuadros.
- Aleatorio solo con env.rng(semilla) o env.noise(...). Math.random existe pero es determinista por composición.
- Prohibido: import, require, eval, Function, fetch, globalThis, self, window, process, Date, setTimeout, Promise, async/await, clases nativas raras, constructor/__proto__/prototype.
- Coordenadas en píxeles del video final: env.W × env.H (1080×1920 en 9:16, 1920×1080 en 16:9). env.u = 1 en un lado corto de 1080 (usa tamaños como 64 * env.u).
- Presupuesto: < 40 ms por cuadro y < ${COMPOS_LIMITS.opsPerFrame} operaciones. Nada de bucles por píxel.
- Nunca tapes la cara (env.face, con margen) salvo que la idea sea ir DETRÁS de la persona con ctx.drawPerson().

ctx: Canvas 2D estándar (save, restore, translate, scale, rotate, transform, setTransform, resetTransform, beginPath, closePath,
moveTo, lineTo, bezierCurveTo, quadraticCurveTo, arc, arcTo, ellipse, rect, roundRect, fill, stroke, clip, fillRect, strokeRect,
clearRect, fillText, strokeText, measureText, setLineDash, createLinearGradient, createRadialGradient, createConicGradient, drawImage)
y propiedades globalAlpha, globalCompositeOperation, filter ("blur(12px)", brightness, contrast, saturate, grayscale, hue-rotate…),
fillStyle, strokeStyle, lineWidth, lineCap, lineJoin, lineDashOffset, font, textAlign, textBaseline, letterSpacing ("4px"),
shadowBlur, shadowColor, shadowOffsetX, shadowOffsetY.
Extras:
- ctx.drawVideo(dx?, dy?, dw?, dh?) o ctx.drawImage(env.video, sx, sy, sw, sh, dx, dy, dw, dh): el cuadro del video (tamaño env.W×env.H). Sirve para zooms, pantalla dividida, espejos, desenfoques.
- ctx.drawPerson(dx?, dy?, dw?, dh?) o ctx.drawImage(env.person, …): SOLO la persona recortada (sin fondo). Para ir detrás de la persona: dibuja tu texto y después ctx.drawPerson(). Sin recorte (env.hasMask false) no dibuja nada.
- ctx.drawImage(env.silhouette("#ffffff", 14), 0, 0): la silueta de la persona engordada (bordes de sticker, contornos, sombras).
- ctx.drawImage(env.assets[i], dx, dy, dw, dh): imágenes permitidas (miniaturas de sus reels). Mira env.assets.length antes.
- const L = env.layer(): lienzo auxiliar del tamaño del video (misma API). ctx.drawImage(L, …) lo usa (recortes de glitch, máscaras con destination-in, 3D).
- Fuentes: env.fonts.sans ("Inter", 500–900), env.fonts.display (la de la marca, 500–900), env.fonts.serif ("Instrument Serif", 400 y italic),
  env.fonts.mono ("JetBrains Mono", 500/700), env.fonts.hand ("Caveat", 400/700), env.fonts.cut ("Anton", 400, condensada y gruesa).
  Usa env.font(peso, tamaño, familia, "italic"?) → '900 120px "Montserrat"'. measureText es exacto para estas fuentes.

env:
- env.W, env.H, env.u, env.vertical, env.duration, env.fps (30), env.seed
- env.brand = { accent, bg, surface, ink, muted, accentText, display } (colores hex de Mi marca: úsalos como paleta base salvo que la receta pida otros)
- env.words = [{ text, t0, t1, strong }] lo que dice la persona en este tramo (segundos de la composición). env.text = todo junto.
  env.wordAt(t) → la palabra que suena; env.timeOf("palabra" | /regex/, desde?) → t0 de la primera que coincide (o null). Úsalo para que cada cosa aparezca CUANDO SE DICE.
- env.params: los textos editables (con los valores que eligió la persona).
- env.freeY(altoDelBloque, "below" | "above") → { y, room, fits, where }: centro vertical de un bloque en el espacio libre más grande (debajo o arriba de la cara, sin pisar los subtítulos). Úsalo para ubicar tarjetas y textos; si fits es false, achica el bloque a room.
- env.face = { x, y, w, h, cx, cy }; env.safe = { x, y, w, h } (cara con margen); env.captions = { y, h, visible } (franja de subtítulos: si visible, no pongas texto ahí).
- env.hasMask, env.video, env.person, env.silhouette(color, engorde), env.assets, env.layer()

Utilidades (todas deterministas):
- env.clamp(v, a, b), env.lerp(a, b, p), env.map(v, a0, a1, b0, b1, clamp?), env.progress(t, inicio, duración) → 0…1
- env.ease.{linear, inQuad, outQuad, inOutQuad, inCubic, outCubic, inOutCubic, inQuart, outQuart, inOutQuart, inExpo, outExpo, inOutExpo, inSine, outSine, inOutSine, inBack, outBack, inOutBack, outElastic, outBounce}(p)
- env.spring(t, { stiffness = 170, damping = 18, mass = 1, from = 0, to = 1, velocity = 0 }) → valor del resorte en t (rebote natural).
- env.rng(semilla) → función () => 0…1; env.noise(x, y?, semilla?) → -1…1 suave (temblor, ondas).
- env.rgba(hex, alfa), env.mix(hexA, hexB, p) → color intermedio.
- env.fit(ctx, texto, (tamaño) => fuente, anchoMax, tamañoMax, tamañoMin?) → tamaño que entra. env.wrap(ctx, texto, anchoMax, renglonesMax?) → renglones.
- env.letters(ctx, texto) → [{ ch, x, w }] posición de cada letra con la fuente actual (para animar letra a letra).
- env.glitch(ctx, fuente, { intensity 0…1, seed, slices = 8, split = 12 }) dibuja la fuente (capa, env.video o env.person) cortada en franjas corridas con separación RGB.
- env.tint(fuente, color) → capa con la fuente teñida.
- env.particles({ seed, count, t, x, y, spread, speed, gravity, life, size }) → [{ x, y, size, alpha, angle }] partículas de una explosión en t.
- env.project(x, y, z, { cx, cy, fov = 1400 }) → { x, y, s } perspectiva simple.
- env.card3d(ctx, fuente, { x, y, w, h, rx, ry, fov = 1600, strips = 28, shade = 0.35 }) dibuja la capa/imagen como tarjeta 3D girada (grados en rx, ry).
- env.motionBlur(ctx, (ctx, tt) => { … }, t, { samples = 6, shutter = 1/60 }) dibuja varios instantes cercanos promediados (desenfoque de movimiento real).
- env.zoomBlur(ctx, fuente, { cx, cy, scale, amount = 0.08, samples = 8 }) zoom con desenfoque radial (para golpes y transiciones).
- env.font(peso, tamaño, familia, estilo?)
`;
