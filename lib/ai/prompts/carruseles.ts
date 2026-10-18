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

export const carouselSchema = z.object({
  title: z.string().describe("Título interno corto del carrusel."),
  slides: z.array(slideSchema).describe("Los slides en orden: el primero es cover y el último es cta."),
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
}): string {
  const structure = input.beats?.length
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
