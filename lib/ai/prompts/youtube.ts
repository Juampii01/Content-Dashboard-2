import { z } from "zod";
import type { RetentionDrop, TitleBasis } from "@/lib/youtube/types";
import { TITLE_ANGLES } from "@/lib/youtube/types";

// ─── "Dónde se fue la gente" ─────────────────────────────────────────────

export const retentionExplanationSchema = z.object({
  summary: z.string().describe("Una o dos frases con lo más importante de la curva, con los números que te pasaron."),
  drops: z
    .array(
      z.object({
        n: z.number().int().describe("El número de la caída (#n) tal como te la pasaron."),
        why: z.string().describe("Por qué se fue la gente en ese momento, según lo que se decía. Si no hay texto, dilo y limita la explicación al momento del video."),
        change: z.string().describe("Qué cambiar en ese tramo para la próxima, en imperativo y concreto (una frase)."),
      }),
    )
    .describe("Una entrada por cada caída recibida, en el mismo orden."),
  keep: z.string().describe("Qué conviene repetir de este video según la curva (por ejemplo, el tramo que mejor retuvo). Una frase."),
});

export const RETENTION_RULES = `Eres el analista de retención de YouTube de este creador. Lees su curva de retención y lo que decía en cada caída, y explicas por qué se fue la gente y qué cambiar.

REGLAS
- Usa SOLO los datos que te pasan: la curva, las caídas con su porcentaje y la frase que se decía. Nunca inventes cifras, segundos ni frases del video.
- Si una caída no tiene texto, no supongas lo que se dijo: explica solo por el momento del video (arranque, mitad, cierre) y dilo.
- Causas típicas que puedes nombrar cuando el texto las muestra: la promesa del título tarda en cumplirse, una introducción larga, una autopromoción o pedido de suscripción temprano, un tramo repetido, una explicación técnica sin ejemplo, un cambio de tema, anunciar el final ("para terminar").
- El cambio es concreto y aplicable al próximo guion: qué frase mover, cortar o reescribir y cómo.
- Cero frases de manual ("aporta valor", "engancha a tu audiencia").
- Español neutro (trato de "tú", sin voseo, "video" sin tilde), salvo que la marca indique otro idioma.
- Responde solo con el JSON del esquema.`;

const pct = (n: number) => `${n.toFixed(1)} %`;
const sec = (n: number | null) => (n == null ? "?" : `${Math.round(n)} s`);

export function retentionTask(input: {
  title: string;
  type: string;
  durationSec: number | null;
  avgViewPercentage: number | null;
  introAt: number;
  introRetention: number | null;
  curve: string;
  drops: { n: number; drop: RetentionDrop; quote: string | null }[];
  hasTranscript: boolean;
}): string {
  return `VIDEO
Título: ${input.title}
Tipo: ${input.type}${input.durationSec ? ` · duración ${Math.round(input.durationSec)} s` : ""}
Porcentaje medio visto: ${input.avgViewPercentage == null ? "sin dato" : pct(input.avgViewPercentage)}
Siguen mirando al terminar el arranque (${Math.round(input.introAt * 100)} % del video): ${input.introRetention == null ? "sin dato" : pct(input.introRetention)}

CURVA (parte del video → porcentaje del público que sigue mirando)
${input.curve}

CAÍDAS FUERTES
${input.drops
  .map(({ n, drop, quote }) => `#${n} ${drop.intro ? "(arranque) " : ""}de ${sec(drop.startSec)} a ${sec(drop.endSec)}: se fue el ${pct(drop.lostPct)} del público, ${drop.steepness.toFixed(1)} veces más rápido que el ritmo normal del video.\n   Se decía: ${quote ? `«${quote}»` : "(sin transcripción en ese tramo)"}`)
  .join("\n")}
${input.hasTranscript ? "" : "\nNo hay transcripción de este video: explica solo por el momento de cada caída y aclara que con la transcripción el análisis sería más preciso."}

TAREA
Explica cada caída (por qué se fueron y qué cambiar), un resumen y qué repetir.`;
}

// ─── Títulos ─────────────────────────────────────────────────────────────

export const titlesSchema = z.object({
  groups: z
    .array(
      z.object({
        angle: z.enum(TITLE_ANGLES),
        options: z.array(z.object({ text: z.string().describe("El título tal cual, de 60 caracteres o menos."), why: z.string().describe("Por qué funciona, en una frase corta.") })),
      }),
    )
    .describe("3 a 5 ángulos distintos con 2 o 3 títulos cada uno: 8 a 10 títulos en total."),
});

export const TITLE_RULES = `Escribes títulos de YouTube para este creador. Un buen título promete algo concreto que la persona quiere y deja una pregunta abierta que solo el video responde.

REGLAS
- 8 a 10 títulos en total, agrupados por ángulo: curiosidad, resultado, contraste, pregunta, lista, historia o error (usa 3 a 5 ángulos distintos).
- Cada título tiene 60 caracteres o menos (contando espacios): es lo que se ve en el teléfono sin cortarse. Lo importante va al principio.
- Usa el estilo de los títulos que mejor le rindieron (te los paso con cuánto superaron su mediana), sin copiarlos.
- Nada de clickbait que el video no cumple ni cifras que no estén en el contenido. Si el contenido no tiene un número, no lo inventes.
- Sin comillas, sin punto final, sin hashtags, sin emojis (salvo que la marca los use). Mayúsculas normales (no todo en mayúsculas).
- Respeta las palabras prohibidas de la marca.
- Español neutro (trato de "tú", sin voseo, "video" sin tilde), salvo que la marca indique otro idioma.
- Responde solo con el JSON del esquema.`;

export function titlesTask(input: { format: "VIDEO" | "SHORT"; sourceLabel: string; title: string; text: string; basis: TitleBasis; feedback?: string }): string {
  return `CONTENIDO DEL VIDEO (${input.sourceLabel})
Tema o título de trabajo: ${input.title}
<contenido>
${input.text.slice(0, 6000)}
</contenido>
Formato: ${input.format === "SHORT" ? "Short (vertical, menos de 3 minutos)" : "video largo"}

TÍTULOS QUE MEJOR LE RINDIERON (${input.basis.note})
${input.basis.examples.length ? input.basis.examples.map((e) => `- ×${e.ratio.toFixed(1)} · ${e.title}`).join("\n") : "(todavía no hay suficientes videos para comparar: guíate por la marca)"}
${input.feedback ? `\nCORRIGE ESTO DEL INTENTO ANTERIOR\n${input.feedback}\n` : ""}
TAREA
Escribe 8 a 10 títulos para este video, agrupados por ángulo.`;
}

// ─── Miniaturas ──────────────────────────────────────────────────────────

export const conceptsSchema = z.object({
  concepts: z
    .array(
      z.object({
        name: z.string().describe("Nombre corto del concepto (2 a 4 palabras), ej. 'Antes y después'."),
        idea: z.string().describe("Qué ve la persona en la miniatura, en una frase."),
        text: z.string().describe("Texto grande de 2 a 4 palabras, sin repetir el título: lo complementa."),
        highlight: z.string().describe("La palabra (o palabras seguidas) del texto que va en color de acento."),
        scene: z.string().describe("Descripción del fondo para generar la imagen: lugar, objetos, luz y colores. SIN texto, letras, logos ni personas."),
        layout: z.enum(["texto-izquierda", "texto-derecha", "texto-centro"]).describe("Dónde va el texto. Con la foto del creador, el texto va del lado opuesto; texto-centro es sin foto."),
        withPhoto: z.boolean().describe("true si conviene que salga la foto del creador."),
      }),
    )
    .describe("Exactamente 3 conceptos bien distintos entre sí."),
});

export const CONCEPT_RULES = `Diseñas miniaturas de YouTube para este creador. Una miniatura se entiende en menos de un segundo en tamaño chico: una sola idea, un texto de 2 a 4 palabras y una imagen de fondo fuerte. El texto lo dibuja una plantilla encima: tú solo propones qué dice y cómo es el fondo.

REGLAS
- Exactamente 3 conceptos distintos (por ejemplo: emoción del creador con el resultado, contraste antes/después, un objeto o escena que genera curiosidad).
- El texto tiene de 2 a 4 palabras, no repite el título: lo completa o lo provoca. Sin cifras que no estén en el contenido.
- El fondo nunca lleva texto, letras, números, logos ni personas (la foto del creador se agrega después, recortada).
- Si el concepto lleva la foto del creador, deja libre ese lado del fondo.
- Respeta las palabras prohibidas de la marca.
- Español neutro (trato de "tú", sin voseo, "video" sin tilde), salvo que la marca indique otro idioma. La descripción del fondo puede ir en español.
- Responde solo con el JSON del esquema.`;

export function conceptsTask(input: { title: string; text: string; titles: string[]; hasPhotos: boolean }): string {
  return `VIDEO
Tema o título de trabajo: ${input.title}
<contenido>
${input.text.slice(0, 4000)}
</contenido>
Títulos propuestos: ${input.titles.slice(0, 5).join(" · ") || "(ninguno todavía)"}
Fotos del creador disponibles: ${input.hasPhotos ? "sí" : "no (todavía no subió fotos: igual puedes proponer conceptos con foto, se agregará después)"}

TAREA
Propón 3 conceptos de miniatura.`;
}
