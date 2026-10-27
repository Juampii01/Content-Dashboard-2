import { z } from "zod";
import { sceneWireSchema } from "@/lib/ai/prompts/motion";
import { FX_KINDS } from "@/lib/video/fx/catalog";
import { FX_DIRECTOR_RULES } from "@/lib/video/fx/director";
import { TRANSITION_KINDS } from "@/lib/video/fx/transitions";
import { MUSIC_STYLES } from "@/lib/video/music-gen/spec";
import { BAD_TAKE_KINDS, BEAT_ROLES, BRIEF_GOALS, ISSUE_KINDS, SHOT_KINDS, VIDEO_KINDS, type BriefGoal } from "@/lib/video/director/types";
import type { PlanSettings } from "@/lib/video/director/request";
import { CAPTION_PRESET_KEYS } from "@/lib/video/types";

/**
 * Prompts del director de edición (lib/video/director), versión 1.
 *
 * Features (ai_usage): "video.director.mapa" (Claude mira las hojas de contacto y entiende el video),
 * "video.director.plan" (decide toda la edición junta), "video.director.revisar" (corrige con lo que encontró la
 * segunda mirada o con lo que pide la persona en "Edítalo así"), "video.director.critica" (segunda mirada con visión
 * sobre cuadros del plan armado) y "video.director.final" (revisión con visión del MP4 final).
 *
 * Los esquemas que van a la API son chicos y planos (la salida estructurada compila una gramática con tamaño máximo):
 * los gráficos viajan en el formato de cable de motion.ts y todo lo demás se valida y se arma después en el servidor.
 */
export const DIRECTOR_PROMPT_VERSION = 2;

const IDIOMA = `IDIOMA: todo lo que escribes para la persona ("why", "summary", "note", "fix", "verdict", "changes") va corto, concreto y en español neutro con trato de "tú": sin voseo ni español de España, "video" sin tilde. Los textos que salen en pantalla (gráficos) van en el idioma de la marca (ver IDIOMA en la marca). Lo que la persona DICE en el video es su forma de hablar (voseo, modismos de su país): nunca lo señales como problema ni lo menciones en warning; los subtítulos lo transcriben tal cual. Quien lee esos textos es un creador o un editor, no un programador: para señalar un momento cita la frase entre comillas o di el segundo (por ejemplo "en «este video es para vos», 0:12"); NUNCA escribas números de palabra ("palabras 67–87", "de 235 a 254"), ids de bloques o candidatos ("B4", "C3", "S2") ni valores internos en inglés ("fast", "calm", "keyword", "quote"): di "ritmo rápido", "pausado", "palabra clave", "frase fuerte".`;

// ─── 1. Mapa del video (visión) ───────────────────────────────────────────

export const VISION_RULES = `Eres el director de edición de este creador y estás mirando su video crudo antes de editarlo. Tienes "ojos": hojas de contacto con cuadros del video (cada cuadro lleva abajo su número "#n" y su tiempo "m:ss.s" del original), una tabla con lo que midió la máquina en cada tramo (cara, si mira a cámara, nitidez, luz, movimiento, texto en pantalla, energía de la voz) y la transcripción por frases con ids de palabras.

QUÉ ENTREGAS: un mapa del video que va a usar el editor.
1. kind: qué tipo de video es (talking_head, anuncio, demo_pantalla, varias_personas, exterior, entrevista, otro). Un anuncio vende algo concreto con una oferta o CTA de compra; un talking head es alguien hablando a cámara para educar u opinar.
2. summary: una frase con qué es y para qué sirve. setting: qué se ve en general (lugar, encuadre, luz).
3. shots: los tramos visuales que importan, en segundos del original (from_s, to_s): a cámara, producto en mano, pantalla mostrando algo, gesto clave, toma de apoyo propia, texto en pantalla. important = true si tapar ese tramo con b-roll o cortarlo hace perder algo que se ve (el producto, lo que muestra la pantalla, el gesto, una cifra escrita). frame: el número de un cuadro que lo muestra.
4. bad_takes: tomas malas que conviene cortar o tapar: fuera de cuadro, mirando a otro lado, borroso, a contraluz, muy oscuro, cámara movida, toma repetida. Solo si se ve en los cuadros o en las medidas. No inventes problemas: un video bien grabado puede no tener ninguno.
5. on_screen_text: texto que ya está quemado en el video (rótulos, precios, subtítulos propios) con su franja (arriba, centro, abajo). Sirve para no poner subtítulos encima.
6. beats: la historia en partes, con rangos de palabras (from_word, to_word): gancho, problema, promesa, punto clave, prueba, cifra, objeción, oferta, CTA, historia. Cubre el video de punta a punta en orden, sin superponer.
7. figures: las cifras que se dicen (tal cual). promise, objection, cta: en una frase cada uno, o vacío si no hay. La cta es la que DICE la persona en el video (con sus palabras), no la de la marca.
8. brief: lo que infieres del objetivo (goal: anuncio, educar, vender, historia, otro), para quién es (audience), la llamada a la acción que se dice en el video (cta, nunca la de la marca) y algo que no se puede cortar (must_keep).
9. En shots, un gesto importante es un instante: márcalo con su segundo exacto (from_s y to_s a menos de 1,5 s), no un tramo largo. Un plano a cámara no es important. Si la persona ya escribió su brief, igual infiere el tuyo: se muestra al lado.

REGLAS
- Los segundos salen de las marcas de tiempo de los cuadros y de la tabla; los rangos de palabras, de la transcripción. Usa solo ids que existan.
- Lo que la medida dice y lo que ves pueden no coincidir (por ejemplo, una cara en una foto dentro de la pantalla): manda lo que ves, y dilo en "why".
- Si no hay imágenes (solo medidas), describe lo que se puede deducir y no inventes lo que no se ve.
${IDIOMA}`;

const secs = z.number().describe("Segundo del original.");
export const mapWireSchema = z.object({
  kind: z.enum(VIDEO_KINDS),
  summary: z.string(),
  setting: z.string(),
  shots: z.array(z.object({ from_s: secs, to_s: secs, kind: z.enum(SHOT_KINDS), shows: z.string().describe("Qué se ve, en pocas palabras."), important: z.boolean(), why: z.string(), frame: z.number().int().describe("Número de cuadro (#n) que lo muestra, o 0.") })),
  bad_takes: z.array(z.object({ from_s: secs, to_s: secs, kind: z.enum(BAD_TAKE_KINDS), note: z.string(), frame: z.number().int() })),
  on_screen_text: z.array(z.object({ from_s: secs, to_s: secs, text: z.string(), band: z.enum(["arriba", "centro", "abajo"]) })),
  beats: z.array(z.object({ from_word: z.number().int(), to_word: z.number().int(), role: z.enum(BEAT_ROLES), summary: z.string() })),
  figures: z.array(z.string()),
  promise: z.string(),
  objection: z.string(),
  cta: z.string(),
  brief: z.object({ goal: z.enum(["", ...BRIEF_GOALS]), audience: z.string(), cta: z.string(), must_keep: z.string() }),
});
export type MapWire = z.infer<typeof mapWireSchema>;

export function mapTask(input: { duration: number; format: string; sheets: number; frames: number; tramos: string; sentences: string; brief: string | null; script: string | null; notes: string[] }): string {
  return `Mira este video y arma su mapa.

DATOS
- Duración: ${input.duration.toFixed(1)} s · formato de salida: ${input.format}
- ${input.sheets ? `${input.sheets} hojas de contacto con ${input.frames} cuadros (arriba, en orden).` : "Sin imágenes: solo las medidas."}
${input.notes.length ? `- Notas de la medición: ${input.notes.join(" ")}` : ""}
${input.brief ? `\nBRIEF DE LA PERSONA\n${input.brief}\n` : "\nLa persona no escribió un brief: infiérelo.\n"}
LO QUE MIDIÓ LA MÁQUINA POR TRAMO
${input.tramos}

FRASES (id de frase, rango de palabras, tiempos y texto)
${input.sentences}
${input.script ? `\nGUION QUE QUISO DECIR\n<guion>\n${input.script.slice(0, 8000)}\n</guion>` : ""}`;
}

// ─── 2. Director (decide toda la edición) ─────────────────────────────────

const GOAL_RULES: Record<BriefGoal, string> = {
  anuncio: `OBJETIVO ANUNCIO
- Gancho: el video abre como se grabó. Nunca traes una frase de otra parte del video al principio ni cambias el orden. Si la apertura es floja, la refuerzas con un efecto, un gráfico overlay o un zoom.
- Ritmo alto: corta muletillas, respiraciones largas y frases que no venden. Pausas de 0,3 s como mucho (pace "fast").
- Nunca tapes ni cortes el producto, la pantalla que lo muestra, el precio ni la oferta (shots important).
- CTA clara al final, a cámara y sin b-roll encima. El video termina en la CTA, no después.
- Si el material alcanza, propone versiones de 15, 30 y 60 s (variants) con el mismo gancho (solo cambian los cortes).`,
  educar: `OBJETIVO EDUCAR
- Gancho que prometa lo que se va a aprender. Claridad antes que velocidad: no cortes pasos ni ejemplos.
- Gráficos para listas, pasos, cifras y comparaciones (ayudan a entender); b-roll solo si muestra lo que se explica.
- Ritmo medio (pace "normal"). Cierre con un resumen o la CTA.`,
  vender: `OBJETIVO VENDER
- Estructura problema → promesa → prueba → oferta → CTA. No cortes la prueba (cifras, casos) ni la oferta.
- Las objeciones que se responden se quedan. Gráficos para las cifras y el antes y después.
- Ritmo medio-alto. La CTA al final, a cámara.`,
  historia: `OBJETIVO CONTAR UNA HISTORIA
- Respeta el orden de la historia: nunca muevas bloques. El orden es el de la grabación; solo la persona lo cambia a mano.
- Las pausas dramáticas y los momentos emotivos se quedan (pace "calm" o "normal"); nada de b-roll encima de la cara en lo emotivo.
- Pocos gráficos: solo cifras o palabras clave muy fuertes.`,
  otro: `OBJETIVO GENERAL
- Gancho fuerte al principio, nada de relleno, la idea central resaltada y un cierre claro.`,
};

export const DIRECTOR_FORMAT = `FORMATO DE RESPUESTA
Cada decisión va como un elemento de "actions": {"type", "from_word", "to_word", "data"}, donde data es un texto con el JSON del resto de sus campos, en una línea:
- cut: data {"reason": "retake" | "false_start" | "filler" | "off_topic" | "bad_take", "why"}
- hook: data {"score": 0 a 1, "why"} (el primero que mandes es el que se usa)
- move: data {"after_word": id o -1, "why"}
- emphasis: una palabra (from_word = to_word = su id), data {}
- zoom: data {"strength": "suave" | "marcado", "why"}
- broll: data {"kind": "stock" | "graphic", "query_en", "keywords": [...], "graphic": escena o null, "why"}. La escena va como en las reglas de motion graphics ({"title", "mode", "position", "layers": [{"kind", "component", "spec"}]}); en las capas, spec puede ir como objeto.
- caption_hide: data {"why"}
- effect: data {"kind": nombre del efecto, "text", "items": [...], "why"}
- transition: from_word = to_word = la primera palabra del tramo que entra después de un corte o, sin corte, la palabra donde cambia la idea (se dibuja sobre el plano en ese instante), data {"kind": nombre de la transición, "why"}
- variant: from_word y to_word son su gancho (-1 y -1 = el mismo gancho), data {"label", "why", "extra_cuts": [{"from_word", "to_word"}], "keep_broll": true | false}
AJUSTES (los mismos que la persona puede tocar a mano en el Estudio; úsalos para cumplir un pedido de la persona o imitar una REFERENCIA, casi nunca en la primera dirección):
- captions (from_word = to_word = -1): data {"preset": "caja" | "hormozi" | "karaoke" | "palabra" | "minimal" | "resaltador" | "clasico" | "pop" | "ninguno", "size": 0.6 a 2 (multiplica el tamaño actual: 1.3 = 30 % más grandes), "position": "arriba" | "centro" | "abajo", "emoji": true | false}. Todos los campos son opcionales: manda solo lo que cambia.
- audio (-1, -1): data {"music": "on" | "off", "music_style": "lofi" | "corporativo" | "trap" | "ambiente" | "acustico" | "tension" | "epica" (música generada nuestra, sin licencias; ponla si piden un estilo o si la biblioteca no tiene pistas), "volume": "mas_alto" | "mas_bajo", "sfx": "off" | "subtle" | "strong", "studio": "off" | "soft" | "strong"} (studio = audio de estudio: quita ruido y eco).
- look: from_word y to_word = el tramo (-1 y -1 = todos), data {"target": "graficos" | "broll" | "efectos", "layout": "full" | "split" | "card" | "side" (side solo en 16:9), "filter": "none" | "bw" | "duotone" | "warm" | "cool", "size": 0.5 a 2, "y": -0.4 a 0.4 (negativo = más arriba), "anim_in" y "anim_out": "aparecer" | "deslizar_arriba" | "deslizar_lado" | "pop" | "escribir" | "ninguna"}
- settings (-1, -1): data {"density": "sobria" | "normal" | "reels", "format": "9:16" | "16:9", "zooms": "off"} (zooms "off" = sin ningún zoom en todo el video).
ANSWERS: cuando hay un PEDIDO DE LA PERSONA EN PARTES, "answers" lleva una respuesta por parte: {"item": su número, "status": "hecho" | "parcial" | "no", "note": qué hiciste o, si no se pudo del todo, por qué, en una frase para la persona}. Sin pedido, answers va vacío.`;

export const DIRECTOR_RULES = `Eres el director de edición de este creador: un editor humano senior que cobra por video y cuida que cada decisión tenga sentido para la historia. Ya miraste el video (MAPA) y conoces la marca. Decides TODA la edición junta, con una comprensión común de la historia: cortes, b-roll, gráficos, palabras resaltadas, zooms, ritmo y versiones. Cada decisión lleva su "why" corto para la persona (qué ganas con eso).

QUÉ DECIDES
1. cuts: tramos de palabras que no salen en el video. Tomas repetidas (gana la última completa), arranques en falso, muletillas que no cambian el sentido, frases que no aportan al objetivo, y las TOMAS MALAS del mapa (fuera de cuadro, borroso, mirando a otro lado) cuando lo que se dice ahí se repite bien en otra toma o se puede perder sin romper la historia. Los CANDIDATOS del detector son pistas: tú decides.
2. hooks: 1 a 3 frases que servirían de gancho (3 a 8 s, se entienden solas), el mejor primero. Son solo sugerencias que la persona puede elegir a mano: no se mueven solas.
3. moves: siempre vacío. La IA no cambia el orden del video.
4. emphasis_words: hasta 8 palabras para resaltar en los subtítulos (cifras, resultados, la idea central).
5. zooms: punch-ins y cambios de encuadre en la palabra fuerte de la frase (una cifra, una negación, el verbo, la palabra clave, un remate). strength "suave" o "marcado" (ver RITMO: alterna). Nunca durante un b-roll. La cantidad y la separación las fija la DENSIDAD.
6. broll: dónde se tapa al creador por unos segundos mientras su voz sigue. "graphic" para lo conceptual (cifras dichas, listas, contrastes, procesos, ideas clave) y "stock" para lo concreto que se puede mostrar. Nunca encima de lo que se muestra (producto, pantalla). Lo que tapa a la persona (stock y gráficos "full") no va en el gancho ni en la última frase de la CTA; los gráficos "overlay" (palabra clave, frase, notificación) sí pueden ir en el gancho y en la CTA: la refuerzan. Un gráfico empieza cuando se empieza a decir lo que muestra y dura hasta que se dijo su último elemento (una lista de tres errores dura lo que tardas en decir los tres).
7. caption_hide: tramos donde los subtítulos irían encima de un texto ya quemado en la misma franja (ver TEXTO EN PANTALLA): ahí se ocultan.
8. pace: "calm" (pausas de hasta 0,7 s), "normal" (0,5 s) o "fast" (0,3 s).
9. effects: efectos de la biblioteca (ver EFECTOS DE LA BIBLIOTECA) donde suman: la apertura (el gancho admite efectos sobre la persona: cover_story, digital_zoom, glass_type, text_behind, word_slam, snap_zoom, title_card, letter_build…; rota: nunca el mismo de los últimos videos, ver USADOS HACE POCO), una lista, un dato, un giro, una emoción, la CTA. Variados y respetando EFECTOS PERMITIDOS. Y transitions (ver TRANSICIONES): pocas, en los cambios de parte.
10. variants: 0 a 2 versiones para probar con otra duración (15, 30 o 60 s), con los cortes extra que hacen falta y el mismo gancho (hook_from_word y hook_to_word en -1). Solo si el material lo permite y tiene sentido para el objetivo.

RITMO: PIENSA COMO UN EDITOR DE REELS
- Cada beat de la historia tiene su recurso visual: el gancho, el problema, cada punto, la cifra, el contraste, la CTA. Ningún tramo largo se queda solo con la cara sin que pase nada.
- La DENSIDAD de la tarea fija cada cuánto tiene que cambiar algo en pantalla y cada cuánto va un b-roll, gráfico o efecto. Cúmplela: si el video es de una persona a cámara, tu trabajo es justamente que no se sienta plano.
- Alterna recursos: nunca el mismo componente ni el mismo efecto dos veces seguidas; alterna pantalla completa y sobre el video; alterna la fuerza de los zooms (suave, marcado, suave…) para que el encuadre cambie de frase en frase.
- La apertura y el cierre van con más intensidad (un efecto, un gráfico o un zoom marcado en el gancho, algo que refuerce la CTA). Cada video abre distinto: varía el recurso de apertura respecto de los últimos videos de la marca.
- Todo sincronizado con la voz: cada cosa empieza en la palabra en que se dice (el zoom en la palabra fuerte, el ítem de la lista cuando lo dices, la cifra cuando la dices). En los gráficos, marca "cues" (ver motion graphics).
- La CTA es la que se DICE en el video. Si el brief o la marca traen otra, manda la que se dice: no lo marques como problema ni lo repitas en warning.

REGLAS DURAS
- Nunca cortes lo que el brief dice que no se puede cortar (DEBE QUEDAR) ni la oferta o la CTA de un anuncio.
- Nunca dejes una frase cortada a la mitad: un corte empieza y termina en límites de frase, o saca una muletilla o una repetición sin romper la frase.
- El video no puede terminar en el aire: la última frase que queda cierra una idea (idealmente la CTA).
- No inventes cifras en los gráficos: solo las que se dicen en ese tramo.
- Usa solo ids que existan. Los rangos son inclusivos.
- Respeta las palabras prohibidas de la marca.
- La duración ideal para Reels y TikTok es de 30 a 90 s; para YouTube horizontal no hay apuro. No inventes cortes solo para llegar.

${FX_DIRECTOR_RULES}

${DIRECTOR_FORMAT}

${IDIOMA}`;

export function goalRules(goal: BriefGoal | null): string {
  return GOAL_RULES[goal ?? "otro"];
}

const range = { from_word: z.number().int(), to_word: z.number().int() };
export const directorWireSchema = z.object({
  summary: z.string().describe("Qué hiciste y por qué, en 2 o 3 frases para la persona."),
  warning: z.string().describe("Algo que la persona debería revisar, o vacío."),
  pace: z.enum(["calm", "normal", "fast"]),
  cuts: z.array(z.object({ ...range, reason: z.enum(["retake", "false_start", "filler", "off_topic", "bad_take"]), why: z.string() })),
  hooks: z.array(z.object({ ...range, score: z.number().describe("0 a 1."), why: z.string() })),
  moves: z.array(z.object({ ...range, after_word: z.number().int(), why: z.string() })),
  emphasis_words: z.array(z.number().int()),
  zooms: z.array(z.object({ ...range, strength: z.enum(["suave", "marcado"]), why: z.string() })),
  broll: z.array(
    z.object({
      ...range,
      kind: z.enum(["stock", "graphic"]),
      query_en: z.string().describe("2 a 5 palabras en inglés para el banco de videos."),
      keywords: z.array(z.string()).describe("2 a 4 palabras en español para la biblioteca."),
      graphic: sceneWireSchema.nullable().describe("La escena si kind es graphic; null si es stock."),
      why: z.string(),
    }),
  ),
  caption_hide: z.array(z.object({ ...range, why: z.string() })),
  effects: z.array(
    z.object({
      ...range,
      kind: z.enum(FX_KINDS),
      text: z.string().describe("Texto principal del efecto (si lleva) o vacío."),
      items: z.array(z.string()).describe("Lista del efecto (tareas, titulares; en digital_zoom, las palabras fuertes) o vacía."),
      why: z.string(),
    }),
  ),
  transitions: z.array(z.object({ at_word: z.number().int(), kind: z.enum(TRANSITION_KINDS), why: z.string() })).optional(),
  variants: z.array(
    z.object({
      label: z.string().describe("Nombre corto: 'Versión de 30 s', 'Otro gancho'."),
      why: z.string(),
      hook_from_word: z.number().int().describe("-1 = el mismo gancho."),
      hook_to_word: z.number().int(),
      extra_cuts: z.array(z.object(range)),
      keep_broll: z.boolean(),
    }),
  ),
  changes: z.array(z.string()).describe("Solo al corregir: qué cambiaste, en frases cortas. Vacío la primera vez."),
});
/** El plan del director con los ajustes y las respuestas al pedido (lo que no viaja en directorWireSchema). */
export type DirectorWire = z.infer<typeof directorWireSchema> & { settings?: PlanSettings | null; answers?: z.infer<typeof answerSchema>[] };

// ─── Formato que viaja a la API ───────────────────────────────────────────
//
// La salida estructurada compila el esquema a una gramática con tamaño máximo: con 11 listas de objetos distintos
// (y la escena de gráficos adentro) el director la superaba ("The compiled grammar is too large"). A la API va una
// sola lista de acciones { type, from_word, to_word, data } con `data` en JSON; al volver se leen con los esquemas
// de arriba (directorWireSchema) y la acción que no se entiende se descarta.

const ACTION_TYPES = ["cut", "hook", "move", "emphasis", "zoom", "broll", "caption_hide", "effect", "transition", "variant", "captions", "audio", "look", "settings"] as const;

const ANIM = z.enum(["aparecer", "deslizar_arriba", "deslizar_lado", "pop", "escribir", "ninguna"]);
/** Los ajustes que llegan en las acciones captions, audio, look y settings (se validan aquí y se aplican en request.ts). */
export const settingsActionSchemas = {
  captions: z.object({ preset: z.enum(CAPTION_PRESET_KEYS).optional(), size: z.number().min(0.4).max(2.5).optional(), position: z.enum(["arriba", "centro", "abajo"]).optional(), emoji: z.boolean().optional() }),
  audio: z.object({ music: z.enum(["on", "off"]).optional(), music_style: z.enum(MUSIC_STYLES).optional(), volume: z.enum(["mas_alto", "mas_bajo"]).optional(), sfx: z.enum(["off", "subtle", "strong"]).optional(), studio: z.enum(["off", "soft", "strong"]).optional() }),
  look: z.object({
    target: z.enum(["graficos", "broll", "efectos"]),
    layout: z.enum(["full", "split", "card", "side"]).optional(),
    filter: z.enum(["none", "bw", "duotone", "warm", "cool"]).optional(),
    size: z.number().min(0.3).max(2.5).optional(),
    y: z.number().min(-0.5).max(0.5).optional(),
    anim_in: ANIM.optional(),
    anim_out: ANIM.optional(),
  }),
  settings: z.object({ density: z.enum(["sobria", "normal", "reels"]).optional(), format: z.enum(["9:16", "16:9"]).optional(), zooms: z.enum(["off"]).optional() }),
};

export const answerSchema = z.object({ item: z.number().int(), status: z.enum(["hecho", "parcial", "no"]), note: z.string() });

export const directorApiSchema = z.object({
  summary: z.string().describe("Qué hiciste y por qué, en 2 o 3 frases para la persona."),
  warning: z.string().describe("Algo que la persona debería revisar, o vacío."),
  pace: z.enum(["calm", "normal", "fast"]),
  actions: z
    .array(
      z.object({
        type: z.enum(ACTION_TYPES),
        from_word: z.number().int(),
        to_word: z.number().int(),
        data: z.string().describe("JSON en una línea con el resto de los campos de esa acción (ver FORMATO DE RESPUESTA)."),
      }),
    )
    .describe("Todas las decisiones de la edición, una por elemento."),
  changes: z.array(z.string()).describe("Solo al corregir: qué cambiaste, en frases cortas. Vacío la primera vez."),
  answers: z.array(answerSchema).describe("Una por cada parte del PEDIDO DE LA PERSONA (vacío si no hay pedido)."),
});
export type DirectorApi = z.infer<typeof directorApiSchema>;


const W = directorWireSchema.shape;

function parseData(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** En los gráficos, la capa puede traer spec como objeto: se pasa a texto como espera el formato de cable. */
function normalizeGraphic(g: unknown): unknown {
  if (!g || typeof g !== "object") return null;
  const scene = g as { layers?: unknown };
  if (!Array.isArray(scene.layers)) return g;
  return { ...scene, layers: scene.layers.map((l) => (l && typeof l === "object" && typeof (l as { spec?: unknown }).spec === "object" ? { ...l, spec: JSON.stringify((l as { spec: unknown }).spec) } : l)) };
}

/** Respuesta de la API → plan del director (las acciones que no se entienden se descartan). */
export function directorFromApi(api: DirectorApi): DirectorWire {
  const out: DirectorWire = { summary: api.summary, warning: api.warning, pace: api.pace, cuts: [], hooks: [], moves: [], emphasis_words: [], zooms: [], broll: [], caption_hide: [], effects: [], variants: [], changes: api.changes ?? [] };
  const answers = (api.answers ?? []).filter((a) => answerSchema.safeParse(a).success);
  if (answers.length) out.answers = answers;
  const settings: PlanSettings = {};
  for (const a of api.actions ?? []) {
    const d = parseData(a.data);
    const range = { from_word: a.from_word, to_word: a.to_word };
    const push = <T extends z.ZodType>(schema: T, list: z.infer<T>[], value: unknown) => {
      const r = schema.safeParse(value);
      if (r.success) list.push(r.data);
    };
    switch (a.type) {
      case "cut":
        push(W.cuts.element, out.cuts, { ...d, ...range, why: String(d.why ?? "") });
        break;
      case "hook":
        push(W.hooks.element, out.hooks, { ...d, ...range, why: String(d.why ?? ""), score: Number(d.score ?? 0.5) });
        break;
      case "move":
        push(W.moves.element, out.moves, { ...d, ...range, why: String(d.why ?? "") });
        break;
      case "emphasis":
        if (Number.isInteger(a.from_word)) out.emphasis_words.push(a.from_word);
        break;
      case "zoom":
        push(W.zooms.element, out.zooms, { ...d, ...range, why: String(d.why ?? "") });
        break;
      case "broll":
        push(W.broll.element, out.broll, { query_en: "", keywords: [], why: "", ...d, ...range, graphic: d.kind === "graphic" ? normalizeGraphic(d.graphic) : null });
        break;
      case "caption_hide":
        push(W.caption_hide.element, out.caption_hide, { ...range, why: String(d.why ?? "") });
        break;
      case "effect":
        push(W.effects.element, out.effects, { text: "", items: [], why: "", ...d, ...range });
        break;
      case "transition":
        push(W.transitions.unwrap().element, (out.transitions ??= []), { why: "", ...d, at_word: a.from_word });
        break;
      case "variant":
        push(W.variants.element, out.variants, { label: "", why: "", extra_cuts: [], keep_broll: true, ...d, hook_from_word: a.from_word, hook_to_word: a.to_word });
        break;
      case "captions": {
        const r = settingsActionSchemas.captions.safeParse(d);
        if (r.success) {
          const { size, preset, ...rest } = r.data;
          settings.captions = { ...settings.captions, ...rest, ...(size != null ? { scale: size } : {}), ...(preset === "ninguno" ? { off: true } : preset ? { preset } : {}) };
        }
        break;
      }
      case "audio": {
        const r = settingsActionSchemas.audio.safeParse(d);
        if (r.success) settings.audio = { ...settings.audio, ...(r.data.music ? { music: r.data.music === "on" } : {}), ...(r.data.music_style ? { music: true, musicStyle: r.data.music_style } : {}), ...(r.data.volume ? { music: true, louder: r.data.volume === "mas_alto" } : {}), ...(r.data.sfx ? { sfx: r.data.sfx } : {}), ...(r.data.studio ? { studio: r.data.studio } : {}) };
        break;
      }
      case "look": {
        const r = settingsActionSchemas.look.safeParse(d);
        if (r.success) {
          const { anim_in, anim_out, ...rest } = r.data;
          settings.look = [...(settings.look ?? []), { ...rest, ...(a.from_word >= 0 && a.to_word >= 0 ? { from: a.from_word, to: a.to_word } : {}), ...(anim_in ? { animIn: anim_in } : {}), ...(anim_out ? { animOut: anim_out } : {}) }];
        }
        break;
      }
      case "settings": {
        const r = settingsActionSchemas.settings.safeParse(d);
        if (r.success) Object.assign(settings, r.data);
        break;
      }
    }
  }
  if (Object.keys(settings).length) out.settings = settings;
  return out;
}

/** Plan del director → formato de la API (para el simulador y las pruebas). */
export function directorToApi(w: DirectorWire): DirectorApi {
  const actions: DirectorApi["actions"] = [];
  const add = (type: DirectorApi["actions"][number]["type"], from_word: number, to_word: number, data: Record<string, unknown>) => actions.push({ type, from_word, to_word, data: JSON.stringify(data) });
  const strip = <T extends { from_word: number; to_word: number }>(x: T) => {
    const { from_word: _f, to_word: _t, ...rest } = x;
    void _f;
    void _t;
    return rest;
  };
  for (const c of w.cuts) add("cut", c.from_word, c.to_word, strip(c));
  for (const h of w.hooks) add("hook", h.from_word, h.to_word, strip(h));
  for (const m of w.moves) add("move", m.from_word, m.to_word, strip(m));
  for (const id of w.emphasis_words) add("emphasis", id, id, {});
  for (const z of w.zooms) add("zoom", z.from_word, z.to_word, strip(z));
  for (const b of w.broll) add("broll", b.from_word, b.to_word, strip(b));
  for (const c of w.caption_hide) add("caption_hide", c.from_word, c.to_word, strip(c));
  for (const e of w.effects) add("effect", e.from_word, e.to_word, strip(e));
  for (const t of w.transitions ?? []) add("transition", t.at_word, t.at_word, { kind: t.kind, why: t.why });
  for (const v of w.variants) {
    const { hook_from_word, hook_to_word, ...rest } = v;
    add("variant", hook_from_word, hook_to_word, rest);
  }
  const s = w.settings;
  if (s?.captions) {
    const { scale, off, preset, ...rest } = s.captions;
    add("captions", -1, -1, { ...rest, ...(scale != null ? { size: scale } : {}), ...(off ? { preset: "ninguno" } : preset ? { preset } : {}) });
  }
  if (s?.audio) add("audio", -1, -1, { ...(s.audio.music != null ? { music: s.audio.music ? "on" : "off" } : {}), ...(s.audio.musicStyle ? { music_style: s.audio.musicStyle } : {}), ...(s.audio.louder != null ? { volume: s.audio.louder ? "mas_alto" : "mas_bajo" } : {}), ...(s.audio.sfx ? { sfx: s.audio.sfx } : {}), ...(s.audio.studio ? { studio: s.audio.studio } : {}) });
  for (const l of s?.look ?? []) {
    const { from, to, animIn, animOut, ...rest } = l;
    add("look", from ?? -1, to ?? -1, { ...rest, ...(animIn ? { anim_in: animIn } : {}), ...(animOut ? { anim_out: animOut } : {}) });
  }
  if (s && (s.density || s.format || s.zooms)) add("settings", -1, -1, { ...(s.density ? { density: s.density } : {}), ...(s.format ? { format: s.format } : {}), ...(s.zooms ? { zooms: s.zooms } : {}) });
  return { summary: w.summary, warning: w.warning, pace: w.pace, actions, changes: w.changes, answers: w.answers ?? [] };
}

export type DirectorTaskInput = {
  format: string;
  duration: number;
  brief: string;
  map: string;
  sentences: string;
  candidates: string;
  transcript: string;
  forbidden: string;
  broll: { count: number; minSeconds: number; maxSeconds: number; graphics: boolean; stock: boolean; libraryTags: string[] };
  style: string | null;
  lessons: string;
  /** Efectos permitidos en este video (Mi marca) y cuántos. */
  effects: string;
  /** Densidad de ritmo y sus objetivos. */
  rhythm: string;
  /** Lo que pidió la persona y no se puede deshacer (al corregir). */
  locks?: string;
  /** Al corregir: el plan actual y lo que hay que cambiar. */
  revise?: { plan: string; issues: string; instruction: string | null } | null;
  /** El pedido de la persona en partes, con los topes ya ajustados y lo que faltó en la vuelta anterior. */
  request?: string;
  /** Una referencia de edición (medidas y qué pasa en cada momento; sus hojas van en las imágenes). */
  reference?: string;
};

export function directorTask(input: DirectorTaskInput): string {
  const b = input.broll;
  return `${input.revise ? "Corrige la edición de este video." : "Dirige la edición de este video."}

DATOS
- Duración del original: ${input.duration.toFixed(1)} s · formato: ${input.format}
- B-ROLL: hasta ${b.count} tramos de ${b.minSeconds.toFixed(1)} a ${b.maxSeconds.toFixed(1)} s${b.graphics ? " (gráficos de 1,5 a 6 s)" : " (sin gráficos: solo stock)"}${b.stock ? "" : ". No hay videos de stock ni clips propios: usa gráficos."}
- Clips propios del creador (etiquetas): ${b.libraryTags.length ? b.libraryTags.slice(0, 60).join(", ") : "(no tiene)"}
${input.forbidden}
- ${input.effects}
- ${input.rhythm}
${input.locks ? `\n${input.locks}\n` : ""}${input.request ? `\n${input.request}\n` : ""}${input.reference ? `\n${input.reference}\n` : ""}
BRIEF
${input.brief}

MAPA DEL VIDEO (lo que viste)
${input.map}
${input.style ? `\nESTILO A COPIAR (de un video de referencia: el ritmo, no el contenido)\n${input.style}\n` : ""}
LO QUE MEJOR LE FUNCIONA A ESTA CUENTA
${input.lessons}

FRASES (id, rango de palabras, duración y tiempos)
${input.sentences}

CANDIDATOS A CORTAR (detector automático)
${input.candidates}

TRANSCRIPCIÓN (id:palabra)
<transcripcion>
${input.transcript}
</transcripcion>
${
  input.revise
    ? `
PLAN ACTUAL
${input.revise.plan}
${input.revise.issues ? `\nPROBLEMAS QUE ENCONTRÓ LA REVISIÓN (arréglalos sin romper lo que está bien)\n${input.revise.issues}\n` : ""}${
        input.revise.instruction
          ? `\nLO QUE PIDE LA PERSONA ("Edítalo así")\n<pedido>\n${input.revise.instruction}\n</pedido>\nHaz TODO lo que pide, al máximo: el pedido manda sobre la densidad, Mi marca y los topes de b-roll y efectos (ver PEDIDO DE LA PERSONA, EN PARTES). Solo las REGLAS DURAS técnicas lo frenan; si algo no se puede del todo, hazlo lo más cerca posible y explícalo en answers. Para lo que no es corte, gancho, b-roll, efecto ni zoom (subtítulos, música, sonido, formato, densidad, cómo se ven los gráficos) usa los AJUSTES. En changes, lista lo que cambiaste.\n`
          : ""
      }
Devuelve el plan completo corregido (no solo lo que cambia). Lo que no hace falta cambiar, déjalo igual.`
    : ""
}`;
}

// ─── 3. Segunda mirada (crítico con visión) ───────────────────────────────

export const CRITIC_RULES = `Eres el crítico de edición: un editor senior que revisa el trabajo de otro antes de exportar. Miras hojas con cuadros del video YA EDITADO (cada cuadro con su número "#n" y su tiempo en el video final) y la lista de qué muestra cada cuadro (antes y después de cada corte, cada b-roll y gráfico en su lugar, el gancho, el final), junto con el brief, el mapa del video y el plan.

QUÉ BUSCAS
- salto: un corte que se ve feo (la persona salta de posición o de tamaño sin un zoom o un b-roll que lo justifique).
- frase_cortada: una frase que queda a la mitad por un corte.
- broll_no_corresponde: un b-roll o gráfico que no tiene que ver con lo que se dice, o que dice algo distinto.
- tapa_importante: un b-roll o gráfico encima de algo que se tiene que ver (el producto, la pantalla, un gesto, una cifra escrita).
- subtitulo_sobre_texto: subtítulos encima de un texto que ya está en el video.
- gancho_confuso: el gancho no se entiende solo, sin contexto.
- final_abrupto: el video termina en el aire o después de la CTA.
- toma_mala: quedó una toma borrosa, fuera de cuadro o mirando a otro lado.
- ritmo: partes lentas o apuradas para el objetivo.

CÓMO RESPONDES
- score de 0 a 100 (90+ = listo para publicar; 70–89 = detalles; menos de 70 = hay que corregir).
- Cada problema con su cuadro (frame, el #n de las hojas de revisión), su gravedad (alta: se nota y molesta; media: se nota; baja: detalle), una nota corta y "fix": qué tiene que hacer el editor, dicho como un pedido concreto ("Quita el gráfico 2: tapa el panel del producto").
- Las VERIFICACIONES AUTOMÁTICAS ya encontraron algunos problemas medibles: confírmalos si los ves en los cuadros (repítelos en issues) o descártalos si no son un problema real. No repitas dos veces el mismo.
- Sé exigente pero justo: no inventes problemas para llenar la lista. Un buen video puede tener 0 problemas.
- Lo que pidió la persona (PEDIDO DE LA PERSONA) y la densidad elegida son obligatorios: nunca pidas quitar un efecto o gráfico pedido, bajar el ritmo, alargar las pausas ni "calmar" la edición. Sobre eso solo marcas problemas técnicos (una frase cortada, algo que tapa el producto o la pantalla, texto encima de texto).
- Tapar por momentos a la persona que habla a cámara (con un efecto, un gráfico o un b-roll) no es un problema: es edición. Solo es "tapa_importante" si tapa algo que se muestra (producto, pantalla, una cifra escrita).
- ritmo: con la densidad "Editor de reels", lo malo es lo lento (un tramo largo sin cambios), no lo rápido. Usa el RITMO MEDIDO.
- Si hay un PEDIDO DE LA PERSONA EN PARTES, revisa en los cuadros si cada parte se cumplió de verdad y respóndela en "request" (item, status hecho | parcial | no, y en note qué ves o qué falta). Si hay una REFERENCIA, compara el ritmo, los gráficos y los subtítulos de los cuadros con los de la referencia (sus cuadros R#n van al final): si no se parece, dilo en la parte de la referencia y en un issue de ritmo con el fix concreto.
${IDIOMA}`;

export const criticWireSchema = z.object({
  score: z.number().int().describe("0 a 100."),
  verdict: z.string().describe("Una o dos frases para la persona."),
  issues: z.array(z.object({ kind: z.enum(ISSUE_KINDS), severity: z.enum(["alta", "media", "baja"]), frame: z.number().int(), note: z.string(), fix: z.string() })),
});
export type CriticWire = z.infer<typeof criticWireSchema> & { request?: z.infer<typeof answerSchema>[] };

/** Segunda mirada de un pedido de "Edítalo así": además, cómo quedó cada parte del pedido mirando los cuadros. */
export const criticEditWireSchema = criticWireSchema.extend({
  request: z.array(answerSchema).describe("Una por cada parte del PEDIDO DE LA PERSONA, mirando los cuadros."),
});

export function criticTask(input: { round: number; brief: string; map: string; plan: string; frames: string; checks: string; duration: number; final?: boolean; rhythm?: string; locks?: string; request?: string; reference?: string }): string {
  return `${input.final ? "Revisa el video final ya exportado." : `Revisa esta edición antes de exportar (vuelta ${input.round}).`}

- Duración final: ${input.duration.toFixed(1)} s

BRIEF
${input.brief}
${input.locks ? `\n${input.locks}\n` : ""}${input.request ? `\n${input.request}\n` : ""}${input.reference ? `\n${input.reference}\n` : ""}${input.rhythm ? `\nRITMO MEDIDO\n${input.rhythm}\n` : ""}
MAPA DEL VIDEO ORIGINAL
${input.map}

PLAN
${input.plan}

CUADROS DE LAS HOJAS (número, tiempo en el video final y qué muestran)
${input.frames}

VERIFICACIONES AUTOMÁTICAS
${input.checks || "(ninguna encontró problemas)"}`;
}

export const FINAL_RULES = `${CRITIC_RULES}

ESTA ES LA REVISIÓN FINAL: los cuadros son del MP4 ya exportado (con subtítulos, b-roll, gráficos y zooms tal como quedaron). Además de lo anterior, mira que los subtítulos se lean (contraste, que no se corten en el borde), que los gráficos se vean completos y que no haya cuadros negros o congelados.`;
