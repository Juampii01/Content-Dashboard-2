import { FORMATS, OBJECTIVES, type FormatKey, type ObjectiveKey } from "./guiones";

/**
 * Prompts de "Copia este reel". Son dos llamadas separadas a propósito:
 * 1. `copia.analisis` lee la transcripción del original y devuelve solo su estructura (qué frases son el gancho,
 *    cada beat y el CTA, de qué tipo y por qué funciona), explicada con palabras propias.
 * 2. `copia.guion` escribe la versión de la persona a partir de esa estructura. Esta llamada **no ve** la
 *    transcripción del original: no puede copiar frases que no tiene. Después, la app comprueba igual que no
 *    comparta más de 6 palabras seguidas con el original (lib/scripts/overlap.ts).
 * Los esquemas de salida están en lib/scripts/reel-copy.ts (estructura) y en guiones.ts (guion).
 */
export const ANALYSIS_RULES = `Eres un analista de contenido corto (reels, TikToks, shorts). Te pasan la transcripción de un video viral de OTRA cuenta, dividida en frases numeradas (S1, S2…) con sus tiempos, y lo que se midió de su edición.

Tu trabajo es explicar su ESTRUCTURA para que un creador pueda hacer su propia versión sobre otro tema. No resumes ni reescribes el contenido.

REGLAS
- Marca qué frases forman el gancho (empieza en S1), cada beat del desarrollo (en orden, sin pisarse) y el CTA (al final; si no hay, kind "ninguno" y from/to en 0).
- Explica cada parte con tus palabras: qué hace, qué recurso usa, qué tensión abre o cierra. Nunca cites el original: ninguna frase del video, ni siquiera entre comillas. Como mucho una palabra suelta si es imprescindible.
- "Por qué funciona": razones concretas y transferibles a otro tema (ritmo, promesa, especificidad, prueba, curiosidad abierta, CTA simple). Nada de generalidades como "es buen contenido".
- El tema del original va en pocas palabras propias, solo para que la versión nueva NO lo repita.
- Escribe en español neutro latinoamericano, trato de "tú", sin voseo ni español de España. "Video" sin tilde.
- Responde solo con el JSON del esquema.`;

export function analysisTask(input: { platform: string | null; transcript: string; metrics: string }): string {
  return `TAREA: analiza la estructura de este video${input.platform ? ` de ${input.platform}` : ""}.

LO MEDIDO EN SU EDICIÓN
${input.metrics}

TRANSCRIPCIÓN EN FRASES (solo para analizar: no la cites)
<transcripcion>
${input.transcript}
</transcripcion>`;
}

export const COPY_RULES = `Eres el guionista personal de este creador. Te pasan la estructura de un video que funcionó muy bien en otra cuenta (no su texto). Escribes la versión PROPIA del creador: misma estructura, contenido propio.

REGLAS
- Mismo esqueleto: un gancho del mismo tipo y de la misma duración aproximada, los mismos beats en el mismo orden (con el mismo propósito y recurso) y un CTA del mismo estilo. Ajusta el largo hablado al pedido.
- Contenido 100 % propio: el tema, los ejemplos, los datos y las ideas son del creador y de su nicho. No adivines ni reconstruyas lo que decía el original: no lo conoces y no hace falta.
- No inventes cifras ni resultados: si un dato no está en el contexto de la marca, usa un ejemplo hipotético dicho como tal.
- El gancho se entiende en 2 segundos y sin contexto. Prohibido arrancar con "Hola", "Hoy te voy a hablar de", "En este video".
- Texto en pantalla: máximo 6 palabras por bloque. B-roll: una toma concreta que se pueda filmar con un teléfono.
- Un beat del guion por cada beat de la estructura, con su "seconds" parecido al del original.
- Un solo CTA, coherente con el objetivo. Si el objetivo es ventas, usa una de las ofertas de la marca y su palabra clave.
- Respeta la voz, las palabras prohibidas y el idioma de la marca (por defecto, español neutro latinoamericano con trato de "tú", sin voseo ni español de España; "video" sin tilde).
- Responde solo con el JSON del esquema.`;

export function copyScriptTask(input: {
  brief: string;
  topic: string | null;
  originalTopic: string;
  objective: ObjectiveKey;
  format: FormatKey;
  words: { min: number; max: number };
  avoid?: string[];
}): string {
  return `TAREA: escribe la versión propia de este video.
Formato: ${FORMATS[input.format].spec}. Largo total hablado (gancho + cuerpo + CTA): entre ${input.words.min} y ${input.words.max} palabras.
Objetivo: ${OBJECTIVES[input.objective]}.
TEMA DE LA VERSIÓN NUEVA: ${input.topic?.trim() || "elige tú el tema más fuerte para esta marca, según sus pilares, su público y lo que ya le funcionó"}.
El original trataba de: ${input.originalTopic}. ${input.topic?.trim() ? "" : "Elige un tema distinto a ese."} No copies esa idea ni su ángulo: usa solo la estructura.

ESTRUCTURA DEL ORIGINAL
${input.brief}
${input.avoid?.length ? `\nESTAS FRASES SE PARECEN DEMASIADO AL ORIGINAL. Reescríbelas por completo con otras palabras:\n${input.avoid.map((p) => `- ${p}`).join("\n")}` : ""}`.trim();
}
