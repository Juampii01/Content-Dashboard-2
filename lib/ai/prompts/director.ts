import { z } from "zod";
import { sceneWireSchema } from "@/lib/ai/prompts/motion";
import { BAD_TAKE_KINDS, BEAT_ROLES, BRIEF_GOALS, ISSUE_KINDS, SHOT_KINDS, VIDEO_KINDS, type BriefGoal } from "@/lib/video/director/types";

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
export const DIRECTOR_PROMPT_VERSION = 1;

const IDIOMA = `IDIOMA: todo lo que escribes para la persona ("why", "summary", "note", "fix", "verdict", "changes") va corto, concreto y en español neutro con trato de "tú": sin voseo ni español de España, "video" sin tilde. Los textos que salen en pantalla (gráficos) van en el idioma de la marca (ver IDIOMA en la marca).`;

// ─── 1. Mapa del video (visión) ───────────────────────────────────────────

export const VISION_RULES = `Eres el director de edición de este creador y estás mirando su video crudo antes de editarlo. Tienes "ojos": hojas de contacto con cuadros del video (cada cuadro lleva abajo su número "#n" y su tiempo "m:ss.s" del original), una tabla con lo que midió la máquina en cada tramo (cara, si mira a cámara, nitidez, luz, movimiento, texto en pantalla, energía de la voz) y la transcripción por frases con ids de palabras.

QUÉ ENTREGAS: un mapa del video que va a usar el editor.
1. kind: qué tipo de video es (talking_head, anuncio, demo_pantalla, varias_personas, exterior, entrevista, otro). Un anuncio vende algo concreto con una oferta o CTA de compra; un talking head es alguien hablando a cámara para educar u opinar.
2. summary: una frase con qué es y para qué sirve. setting: qué se ve en general (lugar, encuadre, luz).
3. shots: los tramos visuales que importan, en segundos del original (from_s, to_s): a cámara, producto en mano, pantalla mostrando algo, gesto clave, toma de apoyo propia, texto en pantalla. important = true si tapar ese tramo con b-roll o cortarlo hace perder algo que se ve (el producto, lo que muestra la pantalla, el gesto, una cifra escrita). frame: el número de un cuadro que lo muestra.
4. bad_takes: tomas malas que conviene cortar o tapar: fuera de cuadro, mirando a otro lado, borroso, a contraluz, muy oscuro, cámara movida, toma repetida. Solo si se ve en los cuadros o en las medidas. No inventes problemas: un video bien grabado puede no tener ninguno.
5. on_screen_text: texto que ya está quemado en el video (rótulos, precios, subtítulos propios) con su franja (arriba, centro, abajo). Sirve para no poner subtítulos encima.
6. beats: la historia en partes, con rangos de palabras (from_word, to_word): gancho, problema, promesa, punto clave, prueba, cifra, objeción, oferta, CTA, historia. Cubre el video de punta a punta en orden, sin superponer.
7. figures: las cifras que se dicen (tal cual). promise, objection, cta: en una frase cada uno, o vacío si no hay.
8. brief: lo que infieres del objetivo (goal: anuncio, educar, vender, historia, otro), para quién es (audience), la llamada a la acción (cta) y algo que no se puede cortar (must_keep). Si la persona ya escribió su brief, igual infiere el tuyo: se muestra al lado.

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
- Gancho en los primeros 2 segundos: la primera frase tiene que parar el scroll (dolor, resultado o pregunta). Si el mejor gancho está más adelante, va al principio.
- Ritmo alto: corta muletillas, respiraciones largas y frases que no venden. Pausas de 0,3 s como mucho (pace "fast").
- Nunca tapes ni cortes el producto, la pantalla que lo muestra, el precio ni la oferta (shots important).
- CTA clara al final, a cámara y sin b-roll encima. El video termina en la CTA, no después.
- Si el material alcanza, propone versiones de 15, 30 y 60 s (variants) con el mismo gancho o con otro.`,
  educar: `OBJETIVO EDUCAR
- Gancho que prometa lo que se va a aprender. Claridad antes que velocidad: no cortes pasos ni ejemplos.
- Gráficos para listas, pasos, cifras y comparaciones (ayudan a entender); b-roll solo si muestra lo que se explica.
- Ritmo medio (pace "normal"). Cierre con un resumen o la CTA.`,
  vender: `OBJETIVO VENDER
- Estructura problema → promesa → prueba → oferta → CTA. No cortes la prueba (cifras, casos) ni la oferta.
- Las objeciones que se responden se quedan. Gráficos para las cifras y el antes y después.
- Ritmo medio-alto. La CTA al final, a cámara.`,
  historia: `OBJETIVO CONTAR UNA HISTORIA
- Respeta el orden de la historia: no muevas bloques salvo que el gancho sea un momento de tensión que se adelanta.
- Las pausas dramáticas y los momentos emotivos se quedan (pace "calm" o "normal"); nada de b-roll encima de la cara en lo emotivo.
- Pocos gráficos: solo cifras o palabras clave muy fuertes.`,
  otro: `OBJETIVO GENERAL
- Gancho fuerte al principio, nada de relleno, la idea central resaltada y un cierre claro.`,
};

export const DIRECTOR_RULES = `Eres el director de edición de este creador: un editor humano senior que cobra por video y cuida que cada decisión tenga sentido para la historia. Ya miraste el video (MAPA) y conoces la marca. Decides TODA la edición junta, con una comprensión común de la historia: cortes, orden, gancho, b-roll, gráficos, palabras resaltadas, zooms, ritmo y versiones. Cada decisión lleva su "why" corto para la persona (qué ganas con eso).

QUÉ DECIDES
1. cuts: tramos de palabras que no salen en el video. Tomas repetidas (gana la última completa), arranques en falso, muletillas que no cambian el sentido, frases que no aportan al objetivo, y las TOMAS MALAS del mapa (fuera de cuadro, borroso, mirando a otro lado) cuando lo que se dice ahí se repite bien en otra toma o se puede perder sin romper la historia. Los CANDIDATOS del detector son pistas: tú decides.
2. hooks: 1 a 3 ganchos (3 a 8 s, frases completas que se entienden solas, sin contexto previo), el mejor primero. El primero se usa. Si el video ya abre bien, ese va primero.
3. moves: solo si mejora la retención sin cambiar el sentido (por ejemplo, la prueba fuerte antes de la explicación). Bloques de frases completas; after_word es la última palabra después de la que va el bloque (-1 = al principio, después del gancho). Máximo 2. Casi siempre vacío.
4. emphasis_words: hasta 8 palabras para resaltar en los subtítulos (cifras, resultados, la idea central).
5. zooms: énfasis de cámara en momentos clave (una cifra, la frase central, un remate). strength "suave" o "marcado". Nunca durante un b-roll. Uno cada 5 a 10 s como mucho.
6. broll: dónde se tapa al creador por unos segundos mientras su voz sigue. "graphic" para lo conceptual (cifras dichas, listas, contrastes, procesos, ideas clave) y "stock" para lo concreto que se puede mostrar. Donde sume al sentido, NUNCA encima de un shot important del mapa (producto, pantalla, gesto), del gancho ni de la CTA. Cada tramo empieza y termina en palabras de la misma frase y dura lo pedido.
7. caption_hide: tramos donde los subtítulos irían encima de un texto ya quemado en la misma franja (ver TEXTO EN PANTALLA): ahí se ocultan.
8. pace: "calm" (pausas de hasta 0,7 s), "normal" (0,5 s) o "fast" (0,3 s).
9. variants: 0 a 2 versiones para probar (otro gancho u otra duración: 15, 30 o 60 s), con los cortes extra que hacen falta. Solo si el material lo permite y tiene sentido para el objetivo.

REGLAS DURAS
- Nunca cortes lo que el brief dice que no se puede cortar (DEBE QUEDAR) ni la oferta o la CTA de un anuncio.
- Nunca dejes una frase cortada a la mitad: un corte empieza y termina en límites de frase, o saca una muletilla o una repetición sin romper la frase.
- El video no puede terminar en el aire: la última frase que queda cierra una idea (idealmente la CTA).
- No inventes cifras en los gráficos: solo las que se dicen en ese tramo.
- Usa solo ids que existan. Los rangos son inclusivos.
- Respeta las palabras prohibidas de la marca.
- La duración ideal para Reels y TikTok es de 30 a 90 s; para YouTube horizontal no hay apuro. No inventes cortes solo para llegar.

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
export type DirectorWire = z.infer<typeof directorWireSchema>;

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
  /** Al corregir: el plan actual y lo que hay que cambiar. */
  revise?: { plan: string; issues: string; instruction: string | null } | null;
};

export function directorTask(input: DirectorTaskInput): string {
  const b = input.broll;
  return `${input.revise ? "Corrige la edición de este video." : "Dirige la edición de este video."}

DATOS
- Duración del original: ${input.duration.toFixed(1)} s · formato: ${input.format}
- B-ROLL: hasta ${b.count} tramos de ${b.minSeconds.toFixed(1)} a ${b.maxSeconds.toFixed(1)} s${b.graphics ? " (gráficos de 1,5 a 6 s)" : " (sin gráficos: solo stock)"}${b.stock ? "" : ". No hay videos de stock ni clips propios: usa gráficos."}
- Clips propios del creador (etiquetas): ${b.libraryTags.length ? b.libraryTags.slice(0, 60).join(", ") : "(no tiene)"}
${input.forbidden}

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
          ? `\nLO QUE PIDE LA PERSONA ("Edítalo así")\n<pedido>\n${input.revise.instruction}\n</pedido>\nHaz lo que pide mientras no rompa las REGLAS DURAS; si algo no se puede, dilo en warning. En changes, lista lo que cambiaste.\n`
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
${IDIOMA}`;

export const criticWireSchema = z.object({
  score: z.number().int().describe("0 a 100."),
  verdict: z.string().describe("Una o dos frases para la persona."),
  issues: z.array(z.object({ kind: z.enum(ISSUE_KINDS), severity: z.enum(["alta", "media", "baja"]), frame: z.number().int(), note: z.string(), fix: z.string() })),
});
export type CriticWire = z.infer<typeof criticWireSchema>;

export function criticTask(input: { round: number; brief: string; map: string; plan: string; frames: string; checks: string; duration: number; final?: boolean }): string {
  return `${input.final ? "Revisa el video final ya exportado." : `Revisa esta edición antes de exportar (vuelta ${input.round}).`}

- Duración final: ${input.duration.toFixed(1)} s

BRIEF
${input.brief}

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
