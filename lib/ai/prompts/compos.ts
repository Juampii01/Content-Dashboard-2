/**
 * Prompts de las composiciones (animaciones que escribe Claude) y de "Copiar edición":
 * - receta: desarmar la referencia en momentos (con muchos cuadros a su alrededor) y el estilo global,
 * - adaptación: llevar cada momento a lo que dice la persona (por función, no por segundo),
 * - plan de una animación (si necesita imágenes generadas y cuáles),
 * - mirada de imágenes generadas (dónde está cada cosa, para animarla),
 * - código (la composición, con la API fija),
 * - revisión con cuadros (parecido a la referencia o al pedido, y corrección).
 *
 * Las reglas grandes (la API y los ejemplos) van en el contexto, que se guarda en caché una hora: en un video se
 * escriben una vez y se leen en cada composición.
 */
import { z } from "zod";
import { COMPOS_API_DOC, COMPOS_LIMITS } from "@/lib/video/compos/contract";
import { COMPOS_SAMPLES } from "@/lib/video/compos/samples";
import { FX_KINDS } from "@/lib/video/fx/catalog";
import { TRANSITION_KINDS } from "@/lib/video/fx/transitions";
import { SFX_NAMES, type SfxName } from "@/lib/video/sfx-library";

// ─── Receta de la referencia ─────────────────────────────────────────────

export const MOMENT_KINDS = [
  "transicion",
  "texto",
  "tarjeta",
  "camara",
  "look",
  "broll",
  "recorte",
  "subtitulos",
  "sonido",
  "grafico",
  "imagen",
] as const;
export const MOMENT_FUNCTIONS = [
  "gancho",
  "enumeracion",
  "cifra",
  "promesa",
  "cta",
  "enfasis",
  "historia",
  "prueba",
  "pregunta",
  "cambio",
  "otro",
] as const;

export const recipeWireSchema = z.object({
  summary: z
    .string()
    .describe("En 2 frases: qué tipo de edición es y qué la hace reconocible."),
  global: z.object({
    pace: z
      .string()
      .describe("Ritmo: cada cuánto cambia algo, cortes, pausas."),
    captions: z
      .string()
      .describe(
        "Subtítulos: estilo, tamaño, lugar, colores, animación por palabra.",
      ),
    typography: z
      .string()
      .describe(
        "Tipografías que se ven (gruesa condensada, serif, mano…), pesos, mayúsculas.",
      ),
    palette: z
      .array(z.string())
      .describe("Colores dominantes de los gráficos y textos, en #hex."),
    look: z
      .string()
      .describe(
        "Look de la imagen: grano, color, viñeta, contraste, desenfoques.",
      ),
    music: z.string().describe("Música y sonidos: estilo, golpes, whooshes."),
    density: z.enum(["sobria", "normal", "reels"]),
  }),
  moments: z
    .array(
      z.object({
        t0: z.number().describe("Segundo de la referencia donde empieza."),
        t1: z.number(),
        kind: z.enum(MOMENT_KINDS),
        function: z
          .enum(MOMENT_FUNCTIONS)
          .describe(
            "Para qué sirve en la historia (lo que se adapta al guion nuevo).",
          ),
        visual: z
          .string()
          .describe(
            "Descripción visual PRECISA: composición, posición, tamaños relativos, colores (#hex), tipografía, qué se ve detrás/delante de la persona.",
          ),
        motion: z
          .string()
          .describe(
            "Movimiento: qué entra, cómo (escala, giro, desplazamiento, letras, máscara), curva (rebote, ease out fuerte…) y duración en segundos.",
          ),
        relation: z
          .string()
          .describe(
            "Relación con lo que se dice: qué palabra o idea lo dispara y cuándo.",
          ),
        frames: z
          .array(z.number().int())
          .describe("Números R#n de los cuadros donde se ve."),
        catalog: z
          .string()
          .describe(
            `Si coincide DE VERDAD con un efecto o transición de la biblioteca, su clave (${[...FX_KINDS.slice(0, 6), "…", ...TRANSITION_KINDS.slice(0, 3)].join(", ")}…); si no, vacío.`,
          ),
        importance: z
          .number()
          .int()
          .min(1)
          .max(3)
          .describe("3 = lo que hace única a la edición; 1 = detalle."),
      }),
    )
    .describe(
      "Todos los momentos de edición, en orden. No te saltees nada visible.",
    ),
});
export type RecipeWire = z.infer<typeof recipeWireSchema>;

export const COPY_RULES = `Eres un editor de video senior (reels y TikTok de marcas personales) que cobra USD 50 por video y un motion designer.
Tu trabajo: mirar un video de referencia cuadro a cuadro y desarmar su EDICIÓN en una receta que otro editor pueda reproducir sin verlo. Nunca copias el contenido (frases, cifras, nombres): copias cómo está editado.

Cómo mirar:
- Los cuadros vienen en hojas, marcados R#n con su segundo. Alrededor de cada corte y de cada cambio visual hay varios cuadros seguidos (4 a 8 por segundo): úsalos para entender el MOVIMIENTO (de dónde viene cada cosa, cuánto tarda, si rebota, si se desenfoca).
- Un momento es cualquier cosa que el editor agregó: una transición, un texto animado, una tarjeta, un zoom o golpe de cámara, un cambio de look, un b-roll, un recorte de la persona (texto detrás, fondo cambiado), un estilo de subtítulos, un sonido marcado, un gráfico, una imagen.
- Sé preciso como una ficha técnica: "palabra en Anton blanca de 22 % del ancho, centrada en el 38 % del alto, entra con escala 1,6→1 en 0,25 s con rebote, glitch RGB de 3 cuadros al llegar, sale con desenfoque". Nada de "un texto que aparece".
- Colores en #hex aproximado. Posiciones en % del cuadro. Tiempos en segundos.
- Si algo no se distingue, dilo en la descripción ("no se ve bien si…").`;

export function recipeTask(input: {
  duration: number;
  aspect: string;
  metrics: string;
  moments: string;
  transcript: string;
  sheets: number;
  frames: number;
}): string {
  return `REFERENCIA: ${input.duration.toFixed(1)} s, ${input.aspect}. Te paso ${input.sheets} hojas con ${input.frames} cuadros (R#n con su segundo).

MEDIDAS AUTOMÁTICAS (cortes, zooms, subtítulos, habla):
${input.metrics}

CUADROS (lo que se midió en cada uno):
${input.moments}

LO QUE SE DICE (solo para entender la estructura; no lo copies):
«${input.transcript.slice(0, 2500)}»

Escribe la receta completa: el estilo global y TODOS los momentos de edición en orden.`;
}

// ─── Adaptación al guion nuevo ───────────────────────────────────────────

export const adaptWireSchema = z.object({
  moments: z.array(
    z.object({
      moment: z.string().describe("Id del momento de la receta (m1, m2…)."),
      plan: z
        .enum(["compose", "catalog", "skip"])
        .describe(
          "compose: se programa una animación a medida; catalog: lo cubre un efecto/transición de la biblioteca o los subtítulos/ritmo; skip: no se puede o no tiene dónde ir.",
        ),
      from_word: z
        .number()
        .int()
        .describe("Primera palabra (id) del tramo del video nuevo donde va."),
      to_word: z.number().int(),
      brief: z
        .string()
        .describe(
          "Qué se programa aquí, adaptado: la misma edición del momento con el contenido de ESTE video (textos cortos, en el idioma de la marca).",
        ),
      texts: z
        .array(z.string())
        .describe(
          "Textos que se verán en pantalla (sacados de lo que dice la persona en ese tramo; nunca cifras inventadas).",
        ),
      reason: z
        .string()
        .describe("Por qué ahí (qué función cumple) o por qué no se puede."),
    }),
  ),
});
export type AdaptWire = z.infer<typeof adaptWireSchema>;

export function adaptTask(input: {
  recipe: string;
  sentences: string;
  duration: number;
  maxCompose: number;
  taken: string;
}): string {
  return `RECETA DE LA REFERENCIA:
${input.recipe}

VIDEO NUEVO (${input.duration.toFixed(1)} s). Frases con los ids de sus palabras:
${input.sentences}

${input.taken ? `YA OCUPADO POR LA EDICIÓN BASE (si un momento de la receta va justo ahí, la animación va encima: conviven en capas):\n${input.taken}\n` : ""}
Lleva cada momento de la receta al video nuevo POR FUNCIÓN, no por segundo: el gancho al gancho, una enumeración a la enumeración, una cifra a donde se dice una cifra, la promesa a la promesa, la CTA a la CTA. Respeta el orden y la densidad de la referencia (si la referencia tiene un momento cada 3 s, este también).
- Hasta ${input.maxCompose} momentos con plan "compose" (los de importancia 3 y 2 primero). Los que son solo ritmo, zooms simples o subtítulos van como "catalog".
- Cada tramo: de 0,8 a ${COMPOS_LIMITS.maxSeconds} s, sin pisarse entre sí.
- Si un momento no tiene dónde ir (no hay una cifra que mostrar, por ejemplo), "skip" con la razón. Nunca inventes datos.`;
}

// ─── Pedido libre (Studio y "Edítalo así") ───────────────────────────────

export const requestPlanWireSchema = z.object({
  tasks: z
    .array(
      z.object({
        from_word: z.number().int(),
        to_word: z.number().int(),
        brief: z
          .string()
          .describe(
            "La animación pedida, precisa y completa (qué se ve, cómo se mueve, cuándo).",
          ),
      }),
    )
    .describe("Una o más animaciones que cumplen el pedido."),
  cannot: z
    .string()
    .describe(
      "Lo que del pedido no se puede hacer y por qué (vacío si todo se puede).",
    ),
});

export function requestPlanTask(input: {
  instruction: string;
  sentences: string;
  span: string | null;
}): string {
  return `PEDIDO DE LA PERSONA: «${input.instruction}»
${input.span ? `TRAMO ELEGIDO EN EL ESTUDIO: ${input.span} (la animación va ahí salvo que el pedido diga otra cosa).` : "Elige tú dónde va según el pedido y lo que se dice."}

FRASES DEL VIDEO con los ids de sus palabras:
${input.sentences}

Arma la lista de animaciones que cumplen el pedido. El límite es lo que se puede dibujar: intenta TODO lo pedido; solo lo que de verdad no se pueda (por ejemplo, video real de un lugar), dilo en cannot.`;
}

// ─── Plan de una animación: ¿necesita imágenes? ─────────────────────────

export const composPlanWireSchema = z.object({
  approach: z
    .string()
    .describe(
      "Cómo la vas a construir: capas, qué se dibuja con código, qué movimiento y en qué momentos.",
    ),
  images: z
    .array(
      z.object({
        purpose: z.string().describe("Para qué es en la animación."),
        prompt: z
          .string()
          .describe(
            "Prompt para el generador de imágenes, en inglés, detallado. SIN TEXTO NI LETRAS en la imagen (el texto lo dibuja la animación).",
          ),
        aspect: z.enum(["vertical", "horizontal", "square"]),
      }),
    )
    .max(2)
    .describe(
      "Imágenes que hay que generar con IA (mapas, objetos, lugares, ilustraciones). Vacío si todo se dibuja con código o con el video.",
    ),
  reuse: z
    .string()
    .describe(
      'Id de un efecto de MIS EFECTOS que hace JUSTO lo que se pide (se usa tal cual, sin escribir código nuevo). Vacío "" si ninguno encaja de verdad.',
    ),
  reuse_params: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .describe(
      "Si reusas: sus textos editables con lo que dice la persona en este tramo (mismas claves). Vacío si no reusas.",
    ),
});

export function composPlanTask(input: {
  brief: string;
  said: string;
  duration: number;
  format: string;
  hasImages: boolean;
  library?: string | null;
  copy?: boolean;
}): string {
  return `ANIMACIÓN A CONSTRUIR (${input.duration.toFixed(1)} s, ${input.format}): ${input.brief}
LO QUE DICE LA PERSONA EN ESE TRAMO: «${input.said}»
${input.hasImages ? "Hay un generador de imágenes disponible (cuenta del cliente): pide imágenes SOLO si la animación muestra algo que no se puede dibujar bien con formas y texto (un mapa real, un objeto, un lugar, una ilustración)." : "No hay generador de imágenes conectado: todo se dibuja con código y el video."}
${
  input.library
    ? `MIS EFECTOS (animaciones que la marca ya creó y guardó; reusar una cuesta mucho menos que escribir otra):
${input.library}
Reúsala SOLO si hace lo que se pide${input.copy ? " y se parece de verdad al momento de la referencia (si la referencia hace otra cosa, escribe una nueva)" : ""}: mismo tipo de movimiento y de composición. No la fuerces. Si reusas, pon su id en "reuse", sus textos adaptados en "reuse_params" y deja "images" vacío.`
    : 'No hay efectos guardados que encajen: deja "reuse" vacío.'
}
Decide el enfoque y si necesitas imágenes.`;
}

// ─── Textos de un efecto guardado en otro tramo ──────────────────────────

export const EFFECT_PARAMS_RULES = `Adaptas los textos de una animación ya hecha a lo que dice una persona en un video corto (reels de una marca personal).
Reglas:
- Cada texto conserva su función y su largo aproximado: una palabra sigue siendo una palabra, una cifra sigue siendo una cifra, un título sigue siendo un título corto.
- Usa las palabras de la persona; no inventes cifras ni datos: si no dice ninguna cifra, deja la cifra original.
- Español neutro (trato de tú, sin voseo ni España). Mismas mayúsculas que el original.
- Devuelve todas las claves, en el mismo orden.`;

export const effectParamsWireSchema = z.object({
  params: z.array(z.object({ key: z.string(), value: z.string() })),
});

export function effectParamsTask(input: {
  name: string;
  description: string;
  params: { key: string; label: string; value: string }[];
  said: string;
}): string {
  return `ANIMACIÓN: «${input.name}». ${input.description}
TEXTOS ACTUALES:
${input.params.map((p) => `- ${p.key} (${p.label}): «${p.value}»`).join("\n")}
LO QUE DICE LA PERSONA EN ESE TRAMO: «${input.said.slice(0, 600)}»
Escribe los textos nuevos.`;
}

// ─── Mirar las imágenes generadas ────────────────────────────────────────

export const imageLookWireSchema = z.object({
  images: z.array(
    z.object({
      index: z.number().int().describe("Número de la imagen (1, 2…)."),
      focus: z
        .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
        .describe(
          "La zona que importa para la animación, en fracciones de la imagen (0 a 1, desde arriba a la izquierda). Ajustada al objeto, no aproximada.",
        ),
      label: z.string().describe("Qué es esa zona."),
      notes: z
        .string()
        .describe(
          "Lo que hay que saber para animarla: dónde está cada cosa importante (en fracciones), colores dominantes (#hex), zonas vacías para poner texto.",
        ),
      usable: z
        .boolean()
        .describe(
          "false si la imagen no sirve (no muestra lo pedido o tiene texto).",
        ),
    }),
  ),
});

export function imageLookTask(input: {
  brief: string;
  images: { purpose: string; width: number; height: number }[];
}): string {
  return `ANIMACIÓN: ${input.brief}
Te paso ${input.images.length} imagen(es) generada(s) para esta animación:
${input.images.map((im, i) => `${i + 1}. ${im.purpose} (${im.width}×${im.height})`).join("\n")}
Mira cada una con cuidado y dime dónde está exactamente lo importante (fracciones 0…1 de la imagen). Esas coordenadas van directo al código: si te equivocas, el zoom y la flecha apuntan a otro lado.`;
}

// ─── Código ──────────────────────────────────────────────────────────────

const sfxName = z.enum(SFX_NAMES as [SfxName, ...SfxName[]]);

export const composCodeWireSchema = z.object({
  name: z
    .string()
    .describe("Nombre corto para la línea de tiempo (3 a 6 palabras)."),
  why: z
    .string()
    .describe("Por qué esta animación aquí, en una frase para la persona."),
  code: z.string().describe("El módulo completo: export default { … }."),
  params: z
    .array(z.object({ key: z.string(), label: z.string(), value: z.string() }))
    .describe(
      "Los textos editables (las mismas claves que params del módulo).",
    ),
  sounds: z
    .array(z.object({ at: z.number(), name: sfxName, gain: z.number() }))
    .describe(
      "Sonidos de la biblioteca en segundos de la animación (whoosh al entrar, golpe en el impacto…). Ganancia de -24 a -8 dB.",
    ),
  hide_captions: z
    .boolean()
    .describe(
      "true si la animación ya muestra el texto o tapa la franja de subtítulos.",
    ),
  tags: z
    .array(z.string())
    .describe(
      "2 o 3 familias visuales en minúsculas con guiones (texto-letra-a-letra, tarjeta-3d, mapa-con-foco…).",
    ),
});
export type ComposCodeWire = z.infer<typeof composCodeWireSchema>;

/** Ejemplos de calidad que van en el contexto (en caché). */
function samplesText(): string {
  return COMPOS_SAMPLES.map(
    (s) =>
      `### EJEMPLO «${s.name}» — ${s.use}\nparams: ${JSON.stringify(Object.fromEntries(s.params.map((p) => [p.key, p.value])))} · sonidos: ${s.sounds.map((x) => `${x.name}@${x.at}s`).join(", ") || "ninguno"} · oculta subtítulos: ${s.hide_captions ? "sí" : "no"}\n\`\`\`js\n${s.code.trim()}\n\`\`\``,
  ).join("\n\n");
}

export const COMPOS_RULES = `Eres un motion designer y programador que anima reels a mano, al nivel de un editor que cobra USD 20–50 por video. Programas cada animación como un módulo de JavaScript que dibuja cuadro a cuadro con Canvas 2D (no eliges de una lista: la escribes tú).

CALIDAD QUE SE ESPERA
- Movimiento con intención: entradas con resortes o ease out fuertes (nunca lineales), anticipación y rebote donde suma, salida propia en los últimos 0,3 s. Nada aparece de golpe salvo que sea un golpe a propósito.
- Sincronía con la voz: cada elemento entra cuando se dice (env.timeOf / env.words). El golpe cae en la palabra fuerte.
- Jerarquía tipográfica clara: una cosa grande y una chica. Tamaños de video (titulares de 90 a 300 px en 1080 de ancho, textos de apoyo 36–56 px). Siempre legible: velo, sombra, caja o contorno sobre fondos movidos.
- Color: la paleta de la marca (env.brand) salvo que la receta de la referencia pida otros colores; acentos con brillo (shadowBlur) con moderación.
- Profundidad: capas (detrás/delante de la persona con ctx.drawPerson(), desenfoques, sombras, 3D simple) cuando la referencia o el pedido lo piden.
- Composición: respeta env.face/env.safe (nunca tapes la cara salvo que la idea sea ir detrás de la persona), deja libre la franja de subtítulos si se ven (env.captions) o pon hide_captions: true.
- Textos cortos, en el idioma de la marca, editables en params (nada de textos fijos dentro del código que la persona quiera cambiar).
- Nunca inventes cifras ni datos: solo lo que se dice.

${COMPOS_API_DOC}

EJEMPLOS (mismo nivel de calidad, distintos estilos: no los copies tal cual, úsalos para ver cómo se usa la API):

${samplesText()}`;

export function composCodeTask(input: {
  brief: string;
  said: string;
  words: string;
  duration: number;
  format: string;
  width: number;
  height: number;
  face: string;
  recipeGlobal?: string | null;
  momentDetail?: string | null;
  images?: string | null;
  avoid?: string | null;
  base?: { code: string; params: string; request: string } | null;
  previousError?: string | null;
  refFrames?: number;
}): string {
  const parts = [
    `ANIMACIÓN: ${input.brief}`,
    `DURACIÓN: ${input.duration.toFixed(2)} s · FORMATO ${input.format} (${input.width}×${input.height}).`,
    `LO QUE DICE LA PERSONA (palabras con su segundo dentro de la animación): ${input.words}`,
    `CARA (px): ${input.face}`,
  ];
  if (input.momentDetail)
    parts.push(
      `EL MOMENTO DE LA REFERENCIA QUE COPIAS (reprodúcelo lo más fiel posible: composición, tipografía, colores, movimiento, curvas y tiempos; solo cambia el contenido):\n${input.momentDetail}`,
    );
  if (input.recipeGlobal)
    parts.push(`ESTILO GLOBAL DE LA REFERENCIA:\n${input.recipeGlobal}`);
  if (input.refFrames)
    parts.push(
      `Te paso ${input.refFrames === 1 ? "una hoja" : `${input.refFrames} hojas`} con los cuadros de la referencia en ese momento (R#n). Míralos y copia lo que se ve.`,
    );
  if (input.images)
    parts.push(
      `IMÁGENES GENERADAS PARA ESTA ANIMACIÓN (están en env.assets con kind "image", en este orden):\n${input.images}`,
    );
  if (input.avoid)
    parts.push(
      `VARIEDAD: ya se usaron hace poco en esta marca (evita repetir la misma familia visual salvo que el pedido lo exija): ${input.avoid}`,
    );
  if (input.base)
    parts.push(
      `ANIMACIÓN ACTUAL (la cambias según el pedido; conserva lo que no se pide cambiar):\nPedido: «${input.base.request}»\nparams actuales: ${input.base.params}\n\`\`\`js\n${input.base.code}\n\`\`\``,
    );
  if (input.previousError)
    parts.push(
      `TU VERSIÓN ANTERIOR FALLÓ LA VALIDACIÓN: ${input.previousError}\nCorrígela (el resto de la idea se mantiene).`,
    );
  parts.push("Escribe el módulo completo.");
  return parts.join("\n\n");
}

// ─── Mirar el resultado ──────────────────────────────────────────────────

export const composLookWireSchema = z.object({
  score: z
    .number()
    .min(0)
    .max(100)
    .describe(
      "Parecido con la referencia (o cumplimiento del pedido) y calidad: 100 = indistinguible de un editor profesional.",
    ),
  ok: z.boolean().describe("true si ya está bien (no hace falta otra vuelta)."),
  issues: z
    .array(z.string())
    .describe(
      "Lo que está mal o distinto, concreto (posición, tamaño, color, tiempo, legibilidad, tapa la cara…).",
    ),
  fixed: z
    .string()
    .describe(
      "Si no está bien: el módulo completo corregido. Si está bien: vacío.",
    ),
  note: z
    .string()
    .describe(
      "Para la persona, en una frase: qué tan parecido quedó y qué no se pudo.",
    ),
});
export type ComposLookWire = z.infer<typeof composLookWireSchema>;

export function composLookTask(input: {
  brief: string;
  momentDetail?: string | null;
  code: string;
  times: number[];
  refFrames: number;
  round: number;
}): string {
  return `ANIMACIÓN: ${input.brief}
${input.momentDetail ? `MOMENTO DE LA REFERENCIA QUE COPIA:\n${input.momentDetail}\n` : ""}
La PRIMERA imagen es una hoja con tu animación dibujada sobre el video real en ${input.times.map((t) => `${t.toFixed(2)} s`).join(", ")}.${input.refFrames ? ` Las siguientes son los cuadros de la referencia en ese momento (R#n).` : ""}
Vuelta ${input.round}. Compara como un director exigente: legibilidad, tamaños, lugar, colores, que no tape la cara, que el movimiento se lea en los cuadros${input.refFrames ? " y que se parezca a la referencia" : ""}. Si hay algo para mejorar, devuelve el módulo completo corregido en fixed.

CÓDIGO ACTUAL:
\`\`\`js
${input.code}
\`\`\``;
}

// ─── Momentos clave sin referencia (variedad) ────────────────────────────

export const keyMomentsWireSchema = z.object({
  moments: z
    .array(
      z.object({
        from_word: z.number().int(),
        to_word: z.number().int(),
        brief: z
          .string()
          .describe(
            "Animación a medida para este momento (idea visual original, no un efecto de catálogo).",
          ),
        family: z
          .string()
          .describe("Familia visual en minúsculas con guiones."),
      }),
    )
    .max(4),
});

export function keyMomentsTask(input: {
  sentences: string;
  map: string;
  count: number;
  avoid: string;
  taken: string;
}): string {
  return `VIDEO (frases con los ids de sus palabras):
${input.sentences}

LO QUE ENTENDIÓ EL DIRECTOR:
${input.map}

YA OCUPADO POR LA EDICIÓN:
${input.taken || "nada"}

Elige ${input.count} momentos clave (el gancho, una cifra, una enumeración, un giro, la CTA…) que merecen una animación a medida, original y distinta entre sí. Ideas visuales con carácter (no "texto que aparece").
EVITA estas familias que la marca usó hace poco: ${input.avoid || "ninguna"}.`;
}

// ─── Agente con la suscripción de Claude ─────────────────────────────────

/**
 * Cómo trabaja el agente de animaciones (worker/video/compos_agent.py) con la suscripción de Claude del cliente: en
 * lugar de escribir el módulo de una sola vez, lo prueba en el sandbox, lo mira sobre el video real y lo corrige antes
 * de entregarlo. Va al final del sistema (después de COMPOS_RULES y la marca).
 */
export const COMPOS_AGENT_GUIDE = `CÓMO TRABAJAS AHORA (agente con herramientas)
No respondas con el módulo en un mensaje: trabajas con las herramientas del taller y entregas al final.
- probar({ code }): corre tu módulo en el mismo sandbox del render (18 instantes). Devuelve "ok" con estadísticas o el error con su línea.
- mirar({ code, times? }): dibuja tu animación sobre el video real en 5 instantes (o los que pidas, en segundos de la animación) y te devuelve la hoja de cuadros. Mírala como un director exigente.
- ver_referencia(): solo cuando copias una referencia: las hojas con sus cuadros (R#n).
- entregar({ name, why, code, params, sounds, hide_captions, tags }): la versión final. Se valida otra vez; si falla, te dice por qué y la corriges.

PROCESO
1. Escribe la primera versión completa, con todo lo que pide el pedido.
2. probar hasta que pase.
3. mirar y anota lo que se ve mal: legibilidad, tamaños, que tape la cara, tiempos contra la voz, que se lea el movimiento, que cumpla el pedido (o se parezca a la referencia).
4. Corrige y vuelve a probar y mirar. Hasta 3 vueltas de mirar; para antes si ya está al nivel de un editor profesional.
5. entregar una sola vez, con los textos editables en params y los sonidos que sumen.
No hay límite de largo para el código salvo el del sandbox; prioriza que se vea profesional y que cumpla cada momento del pedido. Si algo del pedido no se puede (por ejemplo un video que no tienes), resuélvelo con lo más parecido y dilo en why.`;

/** El pedido para el agente: lo mismo que composCodeTask, pero cerrando con el proceso de herramientas. */
export function composAgentTask(
  input: Parameters<typeof composCodeTask>[0],
): string {
  return composCodeTask(input).replace(
    /\n\nEscribe el módulo completo\.$/,
    "\n\nTrabaja con las herramientas del taller (probar, mirar, entregar) hasta entregar la mejor versión.",
  );
}
