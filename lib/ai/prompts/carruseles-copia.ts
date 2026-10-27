import { z } from "zod";

/**
 * Prompts y esquemas de "Copiar un carrusel" y de lo que se portó de carrusel-creator-pro (motor/PROMPT_FICHA.txt,
 * PROMPT_DESCRIPCION.txt, PROMPT_VARIACIONES.txt y REGLAS.md), adaptados a esta app:
 * - El texto lo dibuja la plantilla (exacto): la ficha no lleva casillas que solo servían al modelo de imagen
 *   (manos y ropa por slide, "texto_escena", palabras prohibidas para el generador).
 * - La imagen va siempre sin texto; la escena y la pose del personaje van aparte.
 * - Español neutro (o el idioma de la marca), sin voseo.
 */
const TYPES = ["cover", "item", "step", "data", "quote", "cta"] as const;

const copySlide = z.object({
  originalText: z.string().describe("TODO el texto que se lee en este slide del original, copiado letra por letra en su idioma, cifras incluidas tal cual. Vacío si no tiene texto."),
  role: z.enum(TYPES).describe("Qué papel cumple en el original: cover, item, step, data, quote o cta."),
  visual: z.string().describe("Qué se ve en el slide original y cómo está armado (composición, jerarquía, recursos visuales: capturas, iconos, flechas, objetos, fondo), en 1 o 2 frases. Sin nombrar la cuenta ni copiar su texto."),
  person: z.boolean().describe("true si en el slide original aparece una persona (su cara o su cuerpo)."),
  type: z.enum(TYPES).describe("Tipo del slide en TU versión (normalmente el mismo rol)."),
  kicker: z.string().describe("Etiqueta corta arriba del titular (máximo 4 palabras). Vacío si no aporta."),
  headline: z.string().describe("Titular de tu versión. Corto y legible en el teléfono."),
  highlight: z.string().describe("Palabra o frase corta copiada EXACTA del titular, que va resaltada. Vacío si ninguna."),
  body: z.string().describe("Texto de apoyo de tu versión, 1 o 2 frases (máximo 200 caracteres). Vacío si no hace falta."),
  cta: z.string().describe("Solo en el cierre: la acción concreta con la palabra clave. Vacío en los demás."),
  character: z.boolean().describe("true si en este slide sale el creador (su cara)."),
  pose: z.string().describe("Si character es true: pose, gesto y mirada en una frase, con UNA sola acción de las manos (por ejemplo: 'de frente, mirando a cámara, señala con el índice el elemento principal'). Vacío si character es false."),
  scenePrompt: z.string().describe("Escena de la imagen de TU slide, SIN NINGÚN TEXTO: parte de la idea visual del original (misma composición y recursos), con tu tema. Si sale el creador, dónde está y qué hace en la escena. Nada de letras, carteles, pantallas con texto ni logos."),
});

export const copySchema = z.object({
  title: z.string().describe("Título interno corto de tu versión."),
  original: z.object({
    handle: z.string().describe("El @ de la cuenta original si se ve en algún slide (por ejemplo @cuenta). Vacío si no se ve."),
    language: z.string().describe("Idioma del original (por ejemplo: inglés, español)."),
    topic: z.string().describe("De qué trata el original, en una frase."),
    cta: z.string().describe("La palabra que el original pide comentar, si pide alguna. Vacío si no."),
  }),
  slides: z.array(copySlide).describe("Un objeto por slide del original, en el mismo orden y la misma cantidad."),
  caption: z.string().describe("Descripción de Instagram de tu versión, sin hashtags."),
  hashtags: z.array(z.string()).describe("Exactamente 5 hashtags, en minúscula y sin tildes, con #."),
});
export type CopyResult = z.infer<typeof copySchema>;

export const COPY_RULES = `Eres el redactor de carruseles de Instagram de este creador. Te paso los slides de un carrusel viral de OTRA cuenta (imágenes, en orden) y los datos de su marca. Tu trabajo: leer cada slide con cuidado y escribir la FICHA de su versión de ese carrusel.

CÓMO LEER EL ORIGINAL
- originalText: copia todo el texto de cada slide letra por letra, en su idioma, con sus cifras tal cual. Es la fuente para comprobar que no se inventa ninguna cifra.
- visual: describe qué se ve y cómo está armado (para que la imagen nueva siga la misma idea). Sin copiar su texto ni nombrar la cuenta.
- person: si aparece una persona en ese slide.

CÓMO ESCRIBIR TU VERSIÓN
- Copias la ESTRUCTURA y la idea de cada slide (el gancho, el orden, la cantidad de información, el papel de cada slide), con el tema llevado al ángulo y al público de esta marca. Nunca copias frases enteras del original: las reescribes con su tono.
- Mismo número de slides que el original, en el mismo orden. El primero es la portada y el último el cierre.
- Idioma: el de la marca (español neutro por defecto, trato de "tú", sin voseo ni españolismos, "video" sin tilde). Los textos en inglés del original se traducen; solo se quedan en su idioma los nombres propios de herramientas, repositorios y marcas.
- Portada y cierre: titular de 5 a 10 palabras. Interiores: si el original numera herramientas o pasos, el titular es el número y el nombre tal cual ("2. OLLAMA", "1. ABRE LA APP").
- highlight: una parte del titular copiada letra por letra.
- body: 200 caracteres como máximo, una idea por slide.
- NINGUNA cifra que no esté en el original o en el contexto de la marca. Si el original da estrellas, precios o números, úsalos tal cual (puedes cambiar el formato: 1.2K = 1.200). Si no hay dato, escribe la idea sin número. Los conteos de la propia lista ("5 herramientas") sí se permiten.
- Nunca copies el @, el nombre ni el logo de la cuenta original, ni su "sígueme", su web o su contador de slides.
- Cierre: pide comentar la palabra clave que te indiquen. Si no te indican ninguna y el original pide comentar una palabra, usa la misma o su traducción natural.
- Respeta las palabras prohibidas de la marca. Sin emojis en los slides.

EL PERSONAJE (la cara del creador en la imagen)
- Sigue al original: character = true en los slides donde el original muestra a una persona (ahí va el creador en su lugar); false donde no hay ninguna persona (un objeto, una captura, un icono o solo texto): esos se quedan sin la cara de nadie.
- Si el original no muestra a nadie en ningún slide, pon character = true en el cierre para que la marca dé la cara.
- pose: una frase con ángulo (de frente, tres cuartos o de perfil), mirada, expresión según la emoción del slide y UNA sola acción de las manos. Que no se repita entre slides seguidos.

LA ESCENA (scenePrompt)
- La imagen va siempre SIN TEXTO: el texto lo dibuja la plantilla aparte. Describe la escena a partir de la idea visual del original, con tu tema: objetos, lugar, metáfora, encuadre y luz. Sin letras, carteles, pantallas con texto ni logos.

LA DESCRIPCIÓN (caption)
- Primera línea con las palabras clave del tema, dichas con naturalidad (es lo que se ve sin pulsar "más" y donde busca Instagram). Uno o dos párrafos cortos con lo que enseñan los slides. Una frase que lo lleve al ángulo de la marca. El llamado a la acción con la palabra clave. "📌 Guárdalo para ..." con un motivo concreto. Sin cifras que no estén en la ficha, máximo 1.500 caracteres, sin listas con guiones.
- hashtags: exactamente 5, en minúscula y sin tildes, mezclando generales del nicho y concretos del tema, al menos uno en español.

Responde solo con el JSON del esquema.`;

export function copyTask(input: { slides: number; keyword: string | null; character: "auto" | "siempre" | "nunca"; hasPhotos: boolean; caption: string | null }): string {
  const character =
    input.character === "nunca" || !input.hasPhotos
      ? `PERSONAJE: ${input.hasPhotos ? "esta vez no sale el creador" : "el creador todavía no subió sus fotos"}: character = false en todos los slides y pose vacía.`
      : input.character === "siempre"
        ? "PERSONAJE: el creador sale en TODOS los slides (character = true en cada uno, con su pose)."
        : "PERSONAJE: sigue al original (regla de arriba).";
  return `TAREA: lee los ${input.slides} slides del carrusel original (imágenes adjuntas, en orden: slide 1, 2, 3…) y escribe la ficha de tu versión.
${input.keyword ? `Palabra clave del CTA: ${input.keyword} (el cierre pide comentarla).` : "Palabra clave del CTA: la del original, si pide comentar una; si no, el cierre pide guardar o compartir."}
${character}
${input.caption ? `TEXTO DEL POST ORIGINAL (debajo del carrusel; también sirve como fuente de cifras):\n<post>\n${input.caption.slice(0, 3000)}\n</post>` : ""}`.trim();
}

// ─── Fotos del personaje ──────────────────────────────────────────────────

export const photoTraitsSchema = z.object({
  photos: z.array(
    z.object({
      index: z.number().int().describe("Número de la foto, empezando en 1."),
      angle: z.enum(["frontal", "three_quarter", "profile"]).describe("Ángulo de la cara respecto de la cámara."),
      expression: z.enum(["smile", "serious", "surprised", "thinking", "neutral"]),
      framing: z.enum(["close", "medium", "wide"]).describe("close = primer plano de la cara; medium = de la cintura para arriba; wide = cuerpo entero."),
      gaze: z.enum(["camera", "away"]).describe("Si mira a la cámara."),
      quality: z.number().describe("De 0 a 1: qué tan buena es como referencia de la cara (nítida, bien iluminada, cara completa y sin tapar)."),
      notes: z.string().describe("Una frase corta en español sobre la foto (luz, ropa, fondo). Sin datos sensibles."),
    }),
  ),
});

export const PHOTO_TRAITS_RULES = `Te paso fotos de una misma persona: el creador de una cuenta de Instagram. Las vamos a usar como referencia de su cara para generar imágenes. Para cada foto, describe solo cómo está tomada: ángulo de la cara, expresión, encuadre, si mira a cámara y qué tan buena es como referencia. No identifiques a la persona ni describas rasgos sensibles. Responde solo con el JSON del esquema.`;

export function photoTraitsTask(n: number): string {
  return `TAREA: describe estas ${n} fotos, en orden (foto 1, 2…).`;
}

// ─── Variaciones de la descripción ────────────────────────────────────────

export const HOOK_TYPES = ["dato", "pregunta", "problema", "promesa", "curiosidad"] as const;

export const variantsSchema = z.object({
  variants: z
    .array(
      z.object({
        hook: z.enum(HOOK_TYPES).describe("Tipo de gancho de la primera línea."),
        caption: z.string().describe("La descripción completa, sin hashtags."),
        hashtags: z.array(z.string()).describe("Exactamente 5 hashtags, en minúscula y sin tildes, con #. Combinación distinta de las demás variaciones."),
      }),
    )
    .describe("Exactamente 5 variaciones, una por tipo de gancho, en este orden: dato, pregunta, problema, promesa, curiosidad."),
});

export function variantsTask(input: { carousel: string; caption: string; keyword: string | null }): string {
  return `TAREA: escribe 5 variaciones de la descripción de Instagram de este carrusel para probar cuál funciona mejor. Cada una tiene que ser distinta de verdad, no la misma con otras palabras.

CADA VARIACIÓN abre con un gancho de un tipo distinto, en este orden:
1. dato: un dato del carrusel.
2. pregunta: una pregunta al lector.
3. problema: el problema que resuelve.
4. promesa: lo que gana quien lo lee.
5. curiosidad: algo que deja con ganas de abrir el carrusel.
Y cuenta la idea desde ese enfoque, sin repetir el orden de la principal.

LO QUE TODAS MANTIENEN
- Primera línea con las palabras clave del tema, dichas con naturalidad.
- Una frase que lo lleva al ángulo de la marca.
- El llamado a la acción${input.keyword ? ` con la palabra clave ${input.keyword}` : ""}, igual que en la principal.
- "📌 Guárdalo para ..." con un motivo concreto, distinto en cada una.
- 5 hashtags por variación, con una combinación distinta en cada una (pueden repetir alguno general).

REGLAS
- Ninguna cifra que no esté en el carrusel. Nada inventado: ni nombres, ni links, ni promesas que el carrusel no haga.
- Trato de "tú", frases cortas, sin palabras de vendedor ("increíble", "revolucionario", "brutal") y sin listas con guiones.
- Cada una, como mucho 1.500 caracteres. Emojis: solo los del llamado a la acción y el 📌.

CARRUSEL
${input.carousel}

DESCRIPCIÓN PRINCIPAL
${input.caption.trim() || "(todavía no tiene)"}`;
}
