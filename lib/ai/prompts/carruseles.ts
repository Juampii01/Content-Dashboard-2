import { z } from "zod";
import { CAROUSEL_OBJECTIVES, type CarouselObjective } from "@/lib/carousels/labels";

/**
 * Prompts y esquemas de Carruseles. El contexto de marca (lib/ai/brand-context.ts) va después de estas
 * reglas y en caché. Las reglas vienen de carrusel-creator-pro (REGLAS.md), sin los parches que solo
 * servían al modelo de imagen: aquí el texto lo dibuja la plantilla, exacto.
 */
const slideSchema = z.object({
  type: z.enum(["cover", "item", "step", "data", "quote", "cta"]).describe("cover: portada. item: un punto de una lista. step: un paso de un proceso. data: una cifra protagonista. quote: una frase protagonista. cta: cierre con el llamado a la acción."),
  kicker: z.string().describe("Etiqueta corta arriba del titular (máximo 4 palabras), por ejemplo 'Error #2' o 'Paso 3'. Vacío si no aporta."),
  headline: z.string().describe("Titular del slide. Corto y legible en el teléfono: idealmente menos de 12 palabras."),
  highlight: z.string().describe("Una palabra o frase corta copiada EXACTA del titular, que va resaltada en color. Vacío si ninguna."),
  body: z.string().describe("Texto de apoyo de 1 o 2 frases (máximo 200 caracteres). Vacío en la portada si no hace falta."),
  cta: z.string().describe("Solo en el slide cta: la acción concreta, por ejemplo 'Comenta AGENDA y te lo mando'. Vacío en los demás."),
});
export type GeneratedSlide = z.infer<typeof slideSchema>;

const SCENE_HINT =
  "Escena para la imagen del slide, SIN NINGÚN TEXTO: qué se ve (objetos, lugar, metáfora visual), encuadre y luz, en 1 o 2 frases. Nada de letras, carteles, pantallas con texto, logos ni personas reconocibles.";
const ficheSlideSchema = slideSchema.extend({ scenePrompt: z.string().describe(SCENE_HINT) });

export const carouselSchema = z.object({
  title: z.string().describe("Título interno corto del carrusel."),
  slides: z.array(ficheSlideSchema).describe("Los slides en orden: el primero es cover y el último es cta."),
  caption: z.string().describe("Caption para Instagram: primera línea que engancha, cuerpo breve y el mismo CTA del cierre. Sin hashtags."),
  hashtags: z.array(z.string()).describe("Exactamente 5 hashtags relevantes para el nicho, sin repetir, con #."),
});
export type GeneratedCarousel = z.infer<typeof carouselSchema>;

export const slideOnlySchema = z.object({ slide: slideSchema });
export const coversSchema = z.object({
  covers: z.array(slideSchema.pick({ kicker: true, headline: true, highlight: true, body: true })).describe("Exactamente 3 portadas distintas entre sí."),
});
export const captionSchema = carouselSchema.pick({ caption: true, hashtags: true });

export const CAROUSEL_RULES = `Eres el redactor de carruseles de Instagram de este creador. Escribes como habla esta persona.

REGLAS DEL CARRUSEL
- La portada se entiende sola, sin contexto: entre 5 y 10 palabras, con una promesa o una tensión concreta. Prohibido "Hilo", "Te cuento", "En este post".
- Un solo ítem o idea por slide. Cada slide se entiende solo y empuja a pasar al siguiente.
- Titulares cortos, legibles en un teléfono. El texto de apoyo explica o da el ejemplo, en 1 o 2 frases.
- El último slide es el cierre: entre 5 y 10 palabras de titular y el CTA de la oferta con su palabra clave, si la hay.
- Nada de cifras inventadas: usa solo números que estén en el texto de origen o en el contexto de la marca. Si no hay un dato, escribe la idea sin número. Los conteos de la propia lista ("5 errores") sí se permiten.
- El campo highlight es una palabra o frase copiada exacta del titular, o vacío.
- Respeta las palabras prohibidas y el idioma de la marca. No uses emojis en los slides.
- Si hay un texto de referencia, toma la estructura y las ideas, nunca frases enteras.
- Responde solo con el JSON del esquema.`;

export function generateTask(input: {
  origin: "tema" | "guion" | "texto";
  topic: string;
  sourceText: string | null;
  beats: { purpose: string; text: string }[] | null;
  objective: CarouselObjective;
  slides: number;
  keyword: string | null;
  offer: string | null;
  /** Estructura de una plantilla copiada de una referencia: cantidad y tipo de cada slide, a respetar. */
  structure?: string[] | null;
}): string {
  const structure = input.structure?.length
    ? `ESTRUCTURA (copiada del diseño de referencia): exactamente ${input.structure.length} slides, con estos tipos en este orden: ${input.structure.map((t, i) => `${i + 1}. ${t}`).join(", ")}. El primero es la portada y el último el cierre.`
    : input.beats?.length
    ? `ESTRUCTURA (sale del guion): slide 1 = portada con el gancho; después un slide por cada bloque, en este orden; último slide = cierre con CTA. Total: ${input.beats.length + 2} slides.
${input.beats.map((b, i) => `${i + 2}. ${b.purpose}: ${b.text}`).join("\n")}`
    : `Número de slides: exactamente ${input.slides} (portada + ${input.slides - 2} de contenido + cierre).`;
  const sourceLabel = input.origin === "guion" ? "GUION DE ORIGEN" : input.origin === "texto" ? "TEXTO DE ORIGEN (un post o notas del creador)" : null;
  return `TAREA: escribe la ficha de un carrusel de Instagram (1080×1350).
Objetivo: ${CAROUSEL_OBJECTIVES[input.objective].label.toLowerCase()} (${CAROUSEL_OBJECTIVES[input.objective].hint})
${structure}
${input.keyword ? `Palabra clave del CTA: ${input.keyword} (el cierre pide comentarla o mandarla por DM).` : "Sin palabra clave: el cierre pide guardar, compartir o seguir, según el objetivo."}
${input.offer ? `Oferta del cierre: ${input.offer}.` : ""}

TEMA
${input.topic}

${sourceLabel && input.sourceText ? `${sourceLabel}\n<origen>\n${input.sourceText.slice(0, 8000)}\n</origen>` : ""}`.trim();
}

export function carouselAsText(slides: { type: string; kicker: string; headline: string; body: string; cta: string }[]): string {
  return slides.map((s, i) => `${i + 1}. [${s.type}] ${s.kicker ? `${s.kicker} · ` : ""}${s.headline}${s.body ? ` — ${s.body}` : ""}${s.cta ? ` (CTA: ${s.cta})` : ""}`).join("\n");
}

export function slideTask(all: string, index: number, slideJson: string, instruction: string): string {
  return `TAREA: reescribe solo el slide ${index + 1} de este carrusel. Mantén su tipo y su lugar en la historia. ${instruction ? `Indicación: ${instruction}.` : "Hazlo más claro, más concreto y más corto."}
CARRUSEL COMPLETO (para contexto):
${all}
SLIDE A REESCRIBIR (JSON):
${slideJson}`;
}

export function coversTask(all: string, current: string): string {
  return `TAREA: escribe 3 portadas nuevas para este carrusel, de ángulos distintos (por ejemplo: contraste, resultado y pregunta). Cada titular entre 5 y 10 palabras, que se entienda solo.
CARRUSEL:
${all}
PORTADA ACTUAL (no la repitas):
${current}`;
}

export function captionTask(all: string, keyword: string | null): string {
  return `TAREA: escribe un caption nuevo y 5 hashtags para este carrusel. Primera línea que engancha (distinta de la portada), cuerpo breve con el valor del carrusel y el mismo CTA del cierre${keyword ? ` con la palabra clave ${keyword}` : ""}. Máximo 2.200 caracteres. Los hashtags van aparte, no dentro del caption.
CARRUSEL:
${all}`;
}

// ─── Escenas para imágenes con IA ─────────────────────────────────────────

export const scenesSchema = z.object({
  scenes: z.array(
    z.object({
      index: z.number().int().describe("Número del slide, empezando en 1."),
      scenePrompt: z.string().describe(SCENE_HINT),
      pose: z.string().describe("Solo en los slides donde sale el creador: pose, gesto y mirada en una frase, con UNA sola acción de las manos. Vacío en los demás."),
    }),
  ),
});

/** `withCharacter`: slides (índices desde 0) donde sale el creador: su escena lo incluye y lleva pose. */
export function scenesTask(all: string, indexes: number[], withCharacter: number[] = []): string {
  const people = withCharacter.filter((i) => indexes.includes(i));
  return `TAREA: propone la escena de la imagen de estos slides: ${indexes.map((i) => i + 1).join(", ")}. La imagen va detrás o arriba del texto, que se dibuja aparte: la escena no lleva ningún texto. Que se entienda en menos de un segundo y acompañe la idea del slide.
${people.length ? `En los slides ${people.map((i) => i + 1).join(", ")} sale el creador (su cara, con sus fotos de referencia): la escena lo incluye haciendo algo que acompañe la idea, y propone su pose (ángulo, mirada, expresión y una sola acción de las manos), distinta entre slides seguidos. En los demás no sale ninguna persona.` : "No sale ninguna persona."}
CARRUSEL:
${all}`;
}

// ─── Copiar el estilo de un carrusel (plantillas desde referencia) ────────

export const STYLE_RULES = `Eres director de arte de carruseles de Instagram. Te paso los slides de un carrusel de referencia y las medidas que sacamos con OCR (cajas de texto, tamaños de letra, colores por zona, foto y adornos). Tu trabajo: describir su DISEÑO como plantilla reutilizable para dibujarlo con otros textos.

REGLAS
- Copias el diseño, nunca el contenido: no transcribas textos, nombres, @, cifras ni marcas del original, y no describas personas ni logos.
- Parte del BORRADOR medido: las posiciones, tamaños de letra (px sobre 1080 de ancho), colores y la fuente parecida ya están medidos. Corrígelo solo cuando las imágenes muestren claramente otra cosa.
- Fuentes: elige la más parecida entre las disponibles (inter, montserrat, playfair, instrument, oswald, anton, caveat, mono). instrument = serif editorial fina; playfair = serif de alto contraste; oswald = sans condensada; anton = display condensada y pesada; caveat = manuscrita; mono = monoespaciada.
- layouts.cover, layouts.content y layouts.cta: zona del texto (fracciones 0 a 1 del slide), alineación, dónde va la foto (none, top, bottom, left, right, full) y qué tamaño ocupa.
- structure: el tipo de cada slide de la referencia, en orden (cover, item, step, data, quote, cta).
- Adornos: numeración, línea divisoria, flecha, marco, sticker, handle, contador, barra de progreso y cabecera con avatar (tipo tweet), solo si se ven en la referencia.
- highlight: cómo resaltan la palabra clave (color, marker = fondo de color, underline, italic = cursiva de color).
- notes: una frase en español neutro que describa el estilo (sin nombrar la cuenta original).
- Responde solo con el JSON del esquema.`;

const loose = {
  frac: z.number().describe("Fracción del slide, de 0 a 1."),
  hex: z.string().describe("Color en hexadecimal, por ejemplo #0f1419."),
};
const styleLayout = z.object({
  photo: z.object({
    position: z.enum(["none", "top", "bottom", "left", "right", "full"]),
    size: z.number().describe("Fracción del slide que ocupa la foto (alto si va arriba o abajo; ancho si va a un lado)."),
    inset: z.number().describe("Margen alrededor de la foto en px (0 = a sangre)."),
    radius: z.number().describe("Radio de las esquinas de la foto en px."),
    overlay: z.number().describe("Velo oscuro sobre la foto, de 0 a 0.85 (solo si va de fondo)."),
  }),
  text: z.object({ x: loose.frac, y: loose.frac, w: loose.frac, h: loose.frac, align: z.enum(["left", "center", "right"]), vAlign: z.enum(["top", "center", "bottom"]) }),
  headline: z.object({
    size: z.number().describe("Tamaño del titular en px (sobre 1080 de ancho)."),
    weight: z.number().describe("Peso de 300 a 900."),
    uppercase: z.boolean(),
    italic: z.boolean(),
    tracking: z.number().describe("Espaciado entre letras en em (por ejemplo -0.02)."),
    lineHeight: z.number(),
  }),
  body: z.object({ size: z.number(), weight: z.number(), lineHeight: z.number() }),
  kicker: z.object({ style: z.enum(["none", "plain", "mono", "pill", "bar"]), at: z.enum(["top", "inline"]) }),
  panel: z.object({ kind: z.enum(["none", "card", "band"]), color: loose.hex.nullable(), radius: z.number(), opacity: z.number() }),
});
export const styleSchema = z.object({
  palette: z.object({ bg: loose.hex, surface: loose.hex, text: loose.hex, muted: loose.hex, accent: loose.hex, accentText: loose.hex }),
  background: z.object({ kind: z.enum(["solid", "gradient", "photo", "texture"]), colors: z.array(loose.hex), angle: z.number(), texture: z.enum(["none", "grain", "paper", "dots", "grid", "lines"]) }),
  fonts: z.object({ heading: z.enum(["inter", "montserrat", "playfair", "instrument", "oswald", "anton", "caveat", "mono"]), body: z.enum(["inter", "montserrat", "playfair", "instrument", "oswald", "anton", "caveat", "mono"]) }),
  padding: z.object({ x: z.number(), y: z.number() }),
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
  layouts: z.object({ cover: styleLayout, content: styleLayout, cta: styleLayout }),
  structure: z.array(z.object({ type: z.enum(["cover", "item", "step", "data", "quote", "cta"]), layout: z.enum(["cover", "content", "cta"]), photo: z.boolean() })),
  notes: z.string(),
});

/** El borrador va entre etiquetas para que el modo de prueba (AI_FAKE) pueda devolverlo tal cual. */
export function styleTask(input: { slides: number; measurements: string; draft: string }): string {
  return `TAREA: describe el diseño de este carrusel de ${input.slides} slides como plantilla. Las imágenes van en orden (slide 1, 2, 3…).

MEDIDAS (OCR y colores; sin el texto del original)
${input.measurements}

BORRADOR MEDIDO (corrígelo mirando las imágenes)
<borrador>${input.draft}</borrador>`;
}
