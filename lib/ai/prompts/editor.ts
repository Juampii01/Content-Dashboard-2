import { z } from "zod";
import type { Candidate } from "@/lib/video/candidates";
import { endsSentence } from "@/lib/video/text";
import type { Word } from "@/lib/video/types";

/**
 * Prompt del plan de edición (feature "video.plan").
 * Claude ve la transcripción palabra por palabra con sus ids y los candidatos que encontró el detector,
 * y responde decisiones sobre ids: nunca escribe segundos. El plan final lo arma y valida lib/video/plan.ts.
 */
export const EDITOR_RULES = `Eres el editor de video personal de este creador. Editas videos donde la persona habla a cámara (talking head) para Reels, TikTok y Shorts.

QUÉ HACES
1. Decides cuáles de los CANDIDATOS a cortar se cortan de verdad (tomas repetidas, arranques en falso, muletillas).
2. Si ves otras tomas fallidas o frases que se cortaron a la mitad y se repiten bien después, las agregas como cortes extra.
3. Propones 3 ganchos: tramos de 3 a 8 segundos que se entiendan solos, sin contexto previo, y den ganas de seguir mirando.
4. Marcas hasta 8 palabras clave para resaltar en los subtítulos (números, resultados, la idea central).

REGLAS
- Nunca cortes contenido bueno: si una frase se dice dos veces y las dos están completas, se corta solo la primera.
- En una toma repetida gana la última toma completa.
- Una muletilla se corta solo si sacarla no cambia el sentido.
- No cortes palabras sueltas en medio de una frase fluida: se nota el salto.
- Lo que no está en el guion se marca, pero no se corta solo por eso.
- Los ganchos deben empezar y terminar en un límite de frase. Si el video ya abre con un buen gancho, ese va primero.
- Si el guion ya trae un gancho al principio, respétalo como primer candidato.
- Usa solo ids que existan en la transcripción. Los tramos van de from_word a to_word, inclusive.
- La duración ideal del video final para Reels y TikTok es de 30 a 90 segundos; no inventes cortes para llegar.
- "why", "note", "summary" y "warning" son para el creador: cortos, concretos y en el idioma de la marca (ver IDIOMA más abajo; por defecto, español neutro con trato de "tú", sin voseo ni español de España).`;

export const planAiSchema = z.object({
  decisions: z
    .array(
      z.object({
        candidate: z.string().describe("Id del candidato, por ejemplo C3."),
        cut: z.boolean(),
        confidence: z.number().describe("De 0 a 1."),
      }),
    )
    .describe("Una decisión por cada candidato que no sea de tipo silencio."),
  extra_removals: z
    .array(
      z.object({
        from_word: z.number().int(),
        to_word: z.number().int(),
        reason: z.enum(["retake", "false_start", "filler", "off_topic"]),
        confidence: z.number(),
        note: z.string().describe("Por qué, en una frase corta."),
      }),
    )
    .describe("Cortes que el detector no encontró. Vacío si no hay."),
  hook_candidates: z
    .array(
      z.object({
        from_word: z.number().int(),
        to_word: z.number().int(),
        score: z.number().describe("De 0 a 1: qué tan fuerte es como apertura."),
        why: z.string().describe("Por qué funciona como gancho, en una frase."),
      }),
    )
    .describe("Exactamente 3 ganchos de 3 a 8 segundos, el mejor primero."),
  emphasis_words: z.array(z.number().int()).describe("Ids de hasta 8 palabras para resaltar."),
  summary: z.string().describe("Qué se cortó y por qué, en una o dos frases."),
  warning: z.string().describe("Algo que la persona debería revisar (audio malo, video muy largo), o vacío."),
});
export type PlanAiOutput = z.infer<typeof planAiSchema>;

export type Sentence = { index: number; from: number; to: number; start: number; end: number; text: string };

/** Frases a partir de la puntuación y de las pausas largas. */
export function sentences(words: Word[]): Sentence[] {
  const out: Sentence[] = [];
  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const next = words[i + 1];
    // Una frase termina en un punto, signo de cierre o una pausa clara (al hablar, la pausa marca la frase).
    if (!next || endsSentence(w.text) || next.start - w.end > 0.4) {
      out.push({
        index: out.length + 1,
        from: words[from]!.id,
        to: w.id,
        start: words[from]!.start,
        end: w.end,
        text: words.slice(from, i + 1).map((x) => x.text).join(" "),
      });
      from = i + 1;
    }
  }
  return out;
}

const s = (n: number) => n.toFixed(1);

const KIND_LABEL: Record<Candidate["kind"], string> = {
  retake: "toma repetida",
  false_start: "arranque en falso",
  filler: "muletilla",
  silence: "silencio",
};

export function planTask(input: {
  words: Word[];
  candidates: Candidate[];
  duration: number;
  format: string;
  script: string | null;
  scriptCoverage: number | null;
  /** Estilo de un video de referencia que la persona quiere copiar (solo el ritmo, nunca el contenido). */
  style?: { cutsPerMinute: number; hookSeconds: number; longPause: number; aggressiveness: string } | null;
}): string {
  const { words, candidates } = input;
  const transcript = words
    .map((w, i) => {
      const prev = words[i - 1];
      const pause = prev && w.start - prev.end >= 0.6 ? `(pausa ${s(w.start - prev.end)} s) ` : "";
      return `${pause}${w.id}:${w.text}`;
    })
    .join(" ");
  const frases = sentences(words)
    .map((f) => `F${f.index} [${f.from}–${f.to}] ${s(f.end - f.start)} s (${s(f.start)}–${s(f.end)}): ${f.text}`)
    .join("\n");
  const cands = candidates.length
    ? candidates
        .map((c) => `${c.id} ${KIND_LABEL[c.kind]} [${c.from_word}–${c.to_word}] conf ${c.confidence.toFixed(2)}: ${c.note}`)
        .join("\n")
    : "(ninguno)";

  return `Arma el plan de edición de este video.

DATOS
- Duración del original: ${s(input.duration)} s
- Formato de salida: ${input.format}
- Palabras: ${words.length}
${input.script ? `- Hay guion (coincide con el ${Math.round((input.scriptCoverage ?? 0) * 100)} % de lo dicho).` : "- No hay guion."}
${
  input.style
    ? `
ESTILO A COPIAR (de un video de referencia; copia el ritmo, no el contenido)
- Ritmo de edición: ${input.style.aggressiveness} (${s(input.style.cutsPerMinute)} cortes por minuto en la referencia). Con ritmo alto, corta también muletillas y arranques dudosos.
- Pausas: no quedan pausas de más de ${s(input.style.longPause)} s (eso se recorta solo).
- Gancho: la referencia abre con una frase de unos ${s(input.style.hookSeconds)} s; prefiere ganchos de ese largo.
`
    : ""
}
FRASES (id de la frase, rango de palabras, duración y tiempos)
${frases}

CANDIDATOS A CORTAR (del detector automático)
${cands}

${input.script ? `GUION ORIGINAL\n<guion>\n${input.script.slice(0, 12000)}\n</guion>\n` : ""}
TRANSCRIPCIÓN PALABRA POR PALABRA (id:palabra)
<transcripcion>
${transcript}
</transcripcion>`;
}

// ─── B-roll (feature "video.broll") ────────────────────────────────────────

/**
 * Claude elige dónde va cada b-roll (rangos de palabras) y de qué tipo: una toma de video (consulta corta en inglés
 * para el stock y palabras clave en español para la biblioteca del cliente) o un gráfico animado con la marca
 * (plantilla y textos cortos). Nunca tapa el gancho ni el llamado a la acción.
 */
export const BROLL_RULES = `Eres el editor de b-roll de este creador. El b-roll tapa por unos segundos al creador mientras su voz sigue. Hay dos tipos:
- "stock": una toma de video real (por ejemplo, alguien atendiendo un teléfono mientras dice "contestan el teléfono").
- "graphic": un gráfico animado con los colores de la marca (textos con movimiento, números que cuentan, listas, frases grandes, flechas). Sirve para lo conceptual, que no se puede filmar.

CUÁNDO USAR CADA UNO
- graphic, plantilla "number": cuando dice una cifra o un resultado ("duplicamos las ventas", "40 % más", "10 mil seguidores").
- graphic, "list": cuando enumera 2 a 4 cosas ("tres errores", "primero..., segundo...").
- graphic, "compare": cuando contrasta dos cosas (antes y después, mito y realidad, "no es X, es Y").
- graphic, "flow": cuando describe un proceso o sistema de 3 pasos (anuncio → llamada → cliente).
- graphic, "quote": una frase fuerte o la idea central dicha con fuerza.
- graphic, "keyword": un concepto clave de 1 a 3 palabras.
- stock: cuando la frase describe algo concreto que se puede mostrar (un objeto, un lugar, una acción).
- En contenido conceptual (ventas, anuncios, sistemas, negocios) prefiere los gráficos; deja el stock para lo que se ve.
- Nunca en frases emocionales o personales donde importa ver la cara (ahí, si hace falta, un "quote" o "keyword" en modo "overlay").

MODO DEL GRÁFICO
- "full": pantalla completa con el fondo de la marca (números, listas, comparaciones y flujos).
- "overlay": sobre el video del creador, con un velo; deja ver la cara. Ideal para "quote" y "keyword". position "top" (arriba, lo normal) o "bottom" (a la altura del pecho).

TEXTOS DEL GRÁFICO (en el idioma de la marca; por defecto español neutro)
- Cortos y legibles en 2 segundos: headline hasta 28 caracteres en "keyword", 100 en "quote" y 10 en "number"; cada ítem hasta 40 (en "flow", 24).
- Nunca inventes cifras: todo número del gráfico tiene que estar en lo que dice el creador en ese tramo (con cifras o con palabras). Si no dice un número, no uses "number".
- number: headline es la cifra tal como se diría en pantalla ("x2", "+40%", "10K", "3/10"); label explica la cifra en pocas palabras.
- list: items con 2 a 4 puntos; label es un título opcional (o vacío).
- quote: headline es la frase (puede ser algo más corta que lo dicho, sin cambiar el sentido); highlight es la palabra o frase de 1 a 3 palabras a resaltar, tomada de headline.
- keyword: headline es la palabra o frase clave; label es un rótulo corto opcional encima (o vacío).
- compare: items con 2 textos (primero el "malo": antes o mito; después el "bueno"); item_labels con 2 rótulos de 1 o 2 palabras ("Antes", "Después" o "Mito", "Realidad").
- flow: items con exactamente 3 pasos de 1 a 3 palabras; label es un título opcional.
- Respeta las palabras prohibidas de la marca. Sin emojis.

REGLAS GENERALES
- Nunca dentro del gancho (los primeros segundos) ni del llamado a la acción del final: ahí se ve al creador.
- Cada tramo dura entre DURACIÓN mínima y máxima (los gráficos, entre GRÁFICOS mínima y máxima), empieza y termina en palabras de la misma frase, y no se superpone con otro.
- Separa los b-roll de forma pareja a lo largo del video, más o menos con la cadencia pedida.
- query_en (siempre, también en los gráficos, por si el creador prefiere una toma): 2 a 5 palabras en inglés, concretas y visuales, como se busca en un banco de videos (por ejemplo "receptionist answering phone"). Sin marcas ni personas famosas.
- keywords: 2 a 4 palabras en español, en minúsculas, para buscar en los clips propios del creador (por ejemplo "teléfono", "recepción").
- En los tramos "stock", graphic va en null.
- Usa solo ids que existan. "why" va en una frase corta para el creador, en español neutro con trato de "tú".`;

export const brollGraphicAiSchema = z.object({
  template: z.enum(["number", "list", "quote", "keyword", "compare", "flow"]),
  mode: z.enum(["full", "overlay"]),
  position: z.enum(["top", "bottom"]),
  headline: z.string().describe("Cifra (number), frase (quote) o palabra clave (keyword). Vacío en list, compare y flow."),
  label: z.string().describe("Explicación de la cifra (number), rótulo (keyword) o título (list, flow). Puede ir vacío."),
  highlight: z.string().describe("Solo en quote: 1 a 3 palabras de headline a resaltar. Vacío en las demás."),
  items: z.array(z.string()).describe("list: 2 a 4 puntos; compare: 2 textos; flow: 3 pasos. Vacío en las demás."),
  item_labels: z.array(z.string()).describe("Solo en compare: 2 rótulos cortos. Vacío en las demás."),
});

export const brollAiSchema = z.object({
  broll: z
    .array(
      z.object({
        from_word: z.number().int(),
        to_word: z.number().int(),
        kind: z.enum(["stock", "graphic"]),
        query_en: z.string().describe("Consulta en inglés para bancos de videos de stock, 2 a 5 palabras."),
        keywords: z.array(z.string()).describe("2 a 4 palabras clave en español para la biblioteca."),
        graphic: brollGraphicAiSchema.nullable().describe("El gráfico si kind es graphic; null si es stock."),
        why: z.string().describe("Por qué ahí, en una frase."),
      }),
    )
    .describe("Tramos de b-roll en orden, sin superponerse."),
});
export type BrollAiOutput = z.infer<typeof brollAiSchema>;

export function brollTask(input: {
  words: Word[];
  count: number;
  minSeconds: number;
  maxSeconds: number;
  /** Rangos donde no puede ir b-roll (gancho, llamado a la acción). */
  forbidden: { from: number; to: number; label: string }[];
  format: string;
  libraryTags: string[];
  /** Duración de los gráficos (null: sin gráficos, solo stock y biblioteca). */
  graphics?: { minSeconds: number; maxSeconds: number } | null;
  /** Si hay videos de stock o clips propios para elegir. */
  stock?: boolean;
}): string {
  const frases = sentences(input.words)
    .map((f) => `F${f.index} [${f.from}–${f.to}] ${s(f.end - f.start)} s (${s(f.start)}–${s(f.end)}): ${f.text}`)
    .join("\n");
  const transcript = input.words.map((w) => `${w.id}:${w.text}`).join(" ");
  const graphics = input.graphics ?? null;
  return `Elige dónde va el b-roll de este video.

DATOS
- Formato: ${input.format}
- CANTIDAD: ${input.count} tramos como máximo (menos si no hay frases que lo pidan)
- DURACIÓN: ${s(input.minSeconds)}–${s(input.maxSeconds)} s por tramo
${graphics ? `- GRÁFICOS: ${s(graphics.minSeconds)}–${s(graphics.maxSeconds)} s por tramo` : "- GRÁFICOS: no disponibles (usa solo stock)"}
${input.stock === false ? "- STOCK: no hay videos de stock ni clips propios; usa gráficos siempre que puedas." : ""}
${input.forbidden.map((f) => `- PROHIBIDO [${f.from}–${f.to}]: ${f.label}`).join("\n")}
- Clips propios del creador (etiquetas): ${input.libraryTags.length ? input.libraryTags.slice(0, 60).join(", ") : "(no tiene)"}

FRASES (id, rango de palabras, duración y tiempos)
${frases}

TRANSCRIPCIÓN (id:palabra)
<transcripcion>
${transcript}
</transcripcion>`;
}
