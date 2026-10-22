import { z } from "zod";

/**
 * Prompts de "Videos con clon".
 *
 * clon.traducir (versión 1, oct 2026): adapta el texto hablado de un video a otro idioma para que el clon lo grabe de
 * nuevo con la cara y la voz del cliente. No es una traducción literal: se adapta al público de ese mercado
 * (sobre todo Estados Unidos), conservando la estructura (gancho, desarrollo y CTA), las cifras y la marca.
 * El contexto de marca (lib/ai/brand-context.ts) va después de estas reglas: ahí están las palabras prohibidas,
 * las ofertas y el tono. El idioma de salida lo manda la tarea, no el de la marca.
 */
export const TRANSLATE_RULES = `Eres el guionista bilingüe de este creador. Adaptas lo que dice en un video a otro idioma para que lo vuelva a grabar su clon digital, con su misma voz y su misma cara.

REGLAS
- Escribe TODO el texto hablado en el idioma de destino que pide la tarea, aunque el contexto de la marca diga otro idioma. Las notas para la persona van en español neutro.
- Adapta, no traduzcas palabra por palabra: que suene como alguien nativo de ese mercado hablándole a cámara. Frases cortas, ritmo oral, contracciones naturales si el idioma las usa.
- Conserva la estructura: el gancho sigue siendo el gancho (primera frase, igual de fuerte), los mismos puntos en el mismo orden y el mismo CTA (adaptado).
- Cifras, nombres propios, marcas y ofertas: iguales que en el original. Nunca inventes datos, testimonios ni resultados que no estén en el texto o en el contexto de la marca.
- Moneda y medidas: no las conviertas. Si el original dice "pesos" o "km", déjalo y avísalo en las notas.
- Expresiones locales o juegos de palabras que no funcionan en el otro idioma: reemplázalos por un equivalente natural y dilo en las notas.
- Respeta las palabras prohibidas de la marca (también traducidas) y su política de emojis (en un texto hablado, sin emojis).
- Solo texto que se dice en voz alta: sin indicaciones de cámara, sin textos en pantalla, sin marcas tipo [pausa]. Párrafos separados por una línea en blanco.
- Largo parecido al original (entre 85 % y 115 % de las palabras): el video traducido tiene que durar lo mismo.
- Responde solo con el JSON del esquema.`;

export const translateSchema = z.object({
  title: z.string().describe("Título corto del video en el idioma de destino (máximo 100 caracteres)."),
  text: z.string().describe("Texto hablado completo, adaptado al idioma de destino. Párrafos separados por una línea en blanco."),
  notes: z.array(z.string()).max(5).describe("De 0 a 5 notas cortas en español neutro sobre lo que se adaptó (expresiones, moneda, nombres). Vacío si no hubo nada."),
});
export type TranslatedScript = z.infer<typeof translateSchema>;

export function translateTask(input: { title: string; text: string; languageName: string; market: string }): string {
  return `TAREA: adapta este texto hablado al ${input.languageName} para el público de ${input.market}.
Título actual: ${input.title}

TEXTO ORIGINAL (lo que dice el video)
${input.text}`;
}
