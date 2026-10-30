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
import { sfxCatalogText, SFX_NAMES, type SfxName } from "@/lib/video/sfx-library";

// ─── Receta de la referencia ─────────────────────────────────────────────

export const MOMENT_KINDS = ["transicion", "texto", "tarjeta", "camara", "look", "broll", "recorte", "subtitulos", "sonido", "grafico", "imagen"] as const;
export const MOMENT_FUNCTIONS = ["gancho", "enumeracion", "cifra", "promesa", "cta", "enfasis", "historia", "prueba", "pregunta", "cambio", "otro"] as const;

export const recipeWireSchema = z.object({
  summary: z.string().describe("En 2 frases: qué tipo de edición es y qué la hace reconocible."),
  global: z.object({
    pace: z.string().describe("Ritmo: cada cuánto cambia algo, cortes, pausas."),
    captions: z.string().describe("Subtítulos: estilo, tamaño, lugar, colores, animación por palabra."),
    typography: z.string().describe("Tipografías que se ven (gruesa condensada, serif, mano…), pesos, mayúsculas."),
    palette: z.array(z.string()).describe("Colores dominantes de los gráficos y textos, en #hex."),
    look: z.string().describe("Look de la imagen: grano, color, viñeta, contraste, desenfoques."),
    music: z.string().describe("Música y sonidos: estilo, golpes, whooshes."),
    density: z.enum(["sobria", "normal", "reels"]),
  }),
  kit: z
    .object({
      background: z.string().describe("El fondo que se repite (escenario, degradé, grilla, velas…): qué es, colores #hex y cómo se mueve. Vacío si se ve a la persona."),
      character: z.string().describe("Personaje o mascota que se repite (forma, tamaño en % del cuadro, dónde se para, cómo se mueve, estilo: pixel art, 3D, trazo…). Vacío si no hay."),
      components: z.array(z.string()).describe("Piezas que se repiten entre escenas, cada una como ficha: panel/tarjeta (tamaño, borde, fondo, título), títulos chicos arriba, caja de subtítulos, aros de impacto, destellos, contador, cursor, sello…"),
      layout: z.string().describe("Dónde va cada cosa en el cuadro (% del alto): título, panel principal, personaje, subtítulos, firma o usuario."),
      transitions: z.string().describe("Cómo se pasa de una escena a la otra (fundido, sube desde abajo, barrido, corte seco) y cuánto dura."),
    })
    .describe("El KIT: lo que se repite en todo el video y lo hace verse como una sola pieza. Con esto otro motion designer arma la base sin ver la referencia."),
  moments: z
    .array(
      z.object({
        t0: z.number().describe("Segundo de la referencia donde empieza."),
        t1: z.number(),
        kind: z.enum(MOMENT_KINDS),
        function: z.enum(MOMENT_FUNCTIONS).describe("Para qué sirve en la historia (lo que se adapta al guion nuevo)."),
        visual: z.string().describe("Descripción visual PRECISA: composición, posición, tamaños relativos, colores (#hex), tipografía, qué se ve detrás/delante de la persona."),
        motion: z.string().describe("Movimiento: qué entra, cómo (escala, giro, desplazamiento, letras, máscara), curva (rebote, ease out fuerte…) y duración en segundos."),
        relation: z.string().describe("Relación con lo que se dice: qué palabra o idea lo dispara y cuándo."),
        frames: z.array(z.number().int()).describe("Números R#n de los cuadros donde se ve."),
        catalog: z.string().describe(`Si coincide DE VERDAD con un efecto o transición de la biblioteca, su clave (${[...FX_KINDS.slice(0, 6), "…", ...TRANSITION_KINDS.slice(0, 3)].join(", ")}…); si no, vacío.`),
        importance: z.number().int().min(1).max(3).describe("3 = lo que hace única a la edición; 1 = detalle."),
      }),
    )
    .describe("Todos los momentos de edición, en orden. No te saltees nada visible."),
});
export type RecipeWire = z.infer<typeof recipeWireSchema>;

export const COPY_RULES = `Eres un editor de video senior (reels y TikTok de marcas personales) que cobra USD 50 por video y un motion designer.
Tu trabajo: mirar un video de referencia cuadro a cuadro y desarmar su EDICIÓN en una receta que otro editor pueda reproducir sin verlo. Nunca copias el contenido (frases, cifras, nombres): copias cómo está editado.

Cómo mirar:
- Los cuadros vienen en hojas, marcados R#n con su segundo. Alrededor de cada corte y de cada cambio visual hay varios cuadros seguidos (4 a 8 por segundo): úsalos para entender el MOVIMIENTO (de dónde viene cada cosa, cuánto tarda, si rebota, si se desenfoca).
- Un momento es cualquier cosa que el editor agregó: una transición, un texto animado, una tarjeta, un zoom o golpe de cámara, un cambio de look, un b-roll, un recorte de la persona (texto detrás, fondo cambiado), un estilo de subtítulos, un sonido marcado, un gráfico, una imagen.
- Sé preciso como una ficha técnica: "palabra en Anton blanca de 22 % del ancho, centrada en el 38 % del alto, entra con escala 1,6→1 en 0,25 s con rebote, glitch RGB de 3 cuadros al llegar, sale con desenfoque". Nada de "un texto que aparece".
- Colores en #hex aproximado. Posiciones en % del cuadro. Tiempos en segundos.
- Si algo no se distingue, dilo en la descripción ("no se ve bien si…").
- Separa el KIT (lo que se repite: fondo, personaje, paneles, títulos, caja de subtítulos, aros, transiciones) de los MOMENTOS (lo que cambia en cada idea). El kit hace que el video se vea como una sola pieza: descríbelo con el mismo detalle que un momento.`;

export function recipeTask(input: { duration: number; aspect: string; metrics: string; moments: string; transcript: string; sheets: number; frames: number }): string {
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
      plan: z.enum(["compose", "catalog", "skip"]).describe("compose: se programa una animación a medida; catalog: lo cubre un efecto/transición de la biblioteca o los subtítulos/ritmo; skip: no se puede o no tiene dónde ir."),
      from_word: z.number().int().describe("Primera palabra (id) del tramo del video nuevo donde va."),
      to_word: z.number().int(),
      brief: z.string().describe("Qué se programa aquí, adaptado: la misma edición del momento con el contenido de ESTE video (textos cortos, en el idioma de la marca)."),
      texts: z.array(z.string()).describe("Textos que se verán en pantalla (sacados de lo que dice la persona en ese tramo; nunca cifras inventadas)."),
      reason: z.string().describe("Por qué ahí (qué función cumple) o por qué no se puede."),
    }),
  ),
});
export type AdaptWire = z.infer<typeof adaptWireSchema>;

export function adaptTask(input: { recipe: string; sentences: string; duration: number; maxCompose: number; taken: string }): string {
  return `RECETA DE LA REFERENCIA:
${input.recipe}

VIDEO NUEVO (${input.duration.toFixed(1)} s). Frases con los ids de sus palabras:
${input.sentences}

${input.taken ? `YA OCUPADO POR LA EDICIÓN BASE (si un momento de la receta va justo ahí, la animación va encima: conviven en capas):\n${input.taken}\n` : ""}
Lleva cada momento de la receta al video nuevo POR FUNCIÓN, no por segundo: el gancho al gancho, una enumeración a la enumeración, una cifra a donde se dice una cifra, la promesa a la promesa, la CTA a la CTA. Respeta el orden y la densidad de la referencia (si la referencia tiene un momento cada 3 s, este también).
${input.maxCompose >= 20 ? `- Copia TODO: cada momento de la receta que se pueda dibujar (textos, tarjetas, gráficos, imágenes, transiciones con forma, recortes de la persona, looks) va con plan "compose", aunque sea de importancia 1. Solo van como "catalog" los que son nada más ritmo, zooms simples o el estilo de los subtítulos.` : `- Hasta ${input.maxCompose} momentos con plan "compose" (los de importancia 3 y 2 primero). Los que son solo ritmo, zooms simples o subtítulos van como "catalog".`}
- Cada tramo: de 0,8 a ${COMPOS_LIMITS.maxSeconds} s, sin pisarse entre sí.
- Si un momento no tiene dónde ir (no hay una cifra que mostrar, por ejemplo), "skip" con la razón. Nunca inventes datos.`;
}

// ─── Copia exacta de todo el video: escenas atadas a palabras ───────────

export const copyScenesWireSchema = z.object({
  scenes: z
    .array(
      z.object({
        from_word: z.number().int().describe("Primera palabra (id) del video nuevo donde arranca la escena."),
        to_word: z.number().int().describe("Última palabra (id) de la escena."),
        title: z.string().describe("Nombre corto (2 a 5 palabras)."),
        moments: z.array(z.string()).describe("Ids de los momentos de la receta que copia (m1, m2…)."),
        frames: z.array(z.number().int()).describe("Cuadros R#n de la referencia que hay que mirar para esta escena (los más claros, hasta 8)."),
        draw: z.string().describe("Qué se dibuja, como ficha técnica y con el contenido de ESTE video: el panel o lo que vaya, sus textos exactos entre «», colores #hex, tamaños y posiciones en % del cuadro, usando las piezas del kit."),
        beats: z
          .array(z.object({ word: z.number().int().describe("Id de la palabra que lo dispara."), what: z.string().describe("Qué pasa justo ahí (entra un elemento, cuenta un número, cae un sello, se tacha…).") }))
          .describe("Los golpes de la escena, cada uno atado a la palabra exacta que lo dispara."),
      }),
    )
    .describe("Todas las escenas, en orden, cubriendo el video nuevo de principio a fin sin huecos ni pisarse."),
});
export type CopyScenesWire = z.infer<typeof copyScenesWireSchema>;

export function copyScenesTask(input: { recipe: string; sentences: string; duration: number; maxScenes: number; notes: string | null }): string {
  return `RECETA DE LA REFERENCIA (lo que hay que copiar tal cual):
${input.recipe}

VIDEO NUEVO (${input.duration.toFixed(1)} s). Frases con los ids de sus palabras ([desde–hasta] segundos):
${input.sentences}
${input.notes ? `\nLO QUE PIDIÓ LA PERSONA: ${input.notes}\n` : ""}
Arma las escenas del video nuevo para copiar la edición de la referencia TAL CUAL, con el contenido de este video:
- Misma estructura y misma densidad que la referencia: si la referencia cambia de escena cada 2–3 s, este también. Entre ${Math.max(3, Math.round(input.maxScenes * 0.6))} y ${input.maxScenes} escenas.
- Cada escena copia uno o más momentos de la receta POR FUNCIÓN (el gancho al gancho, la enumeración a la enumeración, la cifra a la cifra, la CTA a la CTA) y usa las piezas del KIT. Si el video nuevo habla de algo que la referencia no tiene, inventa una escena en el MISMO estilo (mismo kit, misma composición).
- Las escenas cubren el video entero en orden: la primera empieza en la primera palabra, cada una termina justo antes de la siguiente y la última llega al final.
- Cada golpe (beats) va atado a la palabra exacta que lo dispara: el número aparece cuando se dice el número, el sello cuando se dice «gratis», el tachón cuando se dice «no».
- Textos en pantalla: cortos y sacados de lo que dice la persona. Nunca inventes cifras ni datos.`;
}

// ─── Pedido libre (Studio y "Edítalo así") ───────────────────────────────

export const requestPlanWireSchema = z.object({
  tasks: z
    .array(
      z.object({
        from_word: z.number().int(),
        to_word: z.number().int(),
        brief: z.string().describe("La animación pedida, precisa y completa (qué se ve, cómo se mueve, cuándo)."),
      }),
    )
    .describe("Una o más animaciones que cumplen el pedido."),
  cannot: z.string().describe("Lo que del pedido no se puede hacer y por qué (vacío si todo se puede)."),
});

export function requestPlanTask(input: { instruction: string; sentences: string; span: string | null }): string {
  return `PEDIDO DE LA PERSONA: «${input.instruction}»
${input.span ? `TRAMO ELEGIDO EN EL ESTUDIO: ${input.span} (la animación va ahí salvo que el pedido diga otra cosa).` : "Elige tú dónde va según el pedido y lo que se dice."}

FRASES DEL VIDEO con los ids de sus palabras:
${input.sentences}

Arma la lista de animaciones que cumplen el pedido. El límite es lo que se puede dibujar: intenta TODO lo pedido; solo lo que de verdad no se pueda (por ejemplo, video real de un lugar), dilo en cannot.`;
}

// ─── Plan de una animación: ¿necesita imágenes? ─────────────────────────

/**
 * Cómo pedir fotos que no se noten hechas con IA. Lo que más delata a la IA: gente posando en grupo y simétrica,
 * sonrisas de banco de imágenes, piel y trajes de plástico, luz perfecta de todos lados y todo nítido.
 */
export const PHOTO_REALISM = `SI LA IMAGEN ES UNA FOTO (fotorrealista), que no se note la IA:
- Escribe el prompt como foto documental o fotograma de película: "candid documentary photograph" o "35mm film still", con cámara y lente concretos (por ejemplo "shot on a full-frame camera, 35mm lens, f/2"), una sola fuente de luz con motivo (ventana, lámpara, luz de la calle) y sombras profundas.
- Prefiere lugares y objetos (una bóveda, un escritorio, papeles, una ciudad) antes que personas. Si hay gente: de espaldas, de perfil, lejos, parcialmente fuera de cuadro o desenfocada, haciendo algo (caminando, escribiendo), nunca posando ni mirando a cámara, nunca en grupo simétrico ni dándose la mano para la foto.
- Pide imperfecciones reales: grano de película, leve desenfoque de movimiento, profundidad de campo corta, polvo, reflejos, ropa con arrugas, piel con textura, encuadre algo torcido.
- Evita en el prompt: "perfect", "beautiful", "stunning", "luxury", "ultra detailed", "8k", "hyperrealistic", "glossy", "symmetrical".`;

export const composPlanWireSchema = z.object({
  approach: z.string().describe("Cómo la vas a construir: capas, qué se dibuja con código, qué movimiento y en qué momentos."),
  images: z
    .array(
      z.object({
        purpose: z.string().describe("Para qué es en la animación."),
        prompt: z.string().describe("Prompt para el generador de imágenes, en inglés, detallado. SIN TEXTO NI LETRAS en la imagen (el texto lo dibuja la animación)."),
        aspect: z.enum(["vertical", "horizontal", "square"]),
      }),
    )
    .max(6)
    .describe("Imágenes que hay que generar con IA (hasta 2; hasta 6 en una pieza única) (mapas, objetos, lugares, ilustraciones). Vacío si todo se dibuja con código o con el video."),
  reuse: z.string().describe('Id de un efecto de MIS EFECTOS que hace JUSTO lo que se pide (se usa tal cual, sin escribir código nuevo). Vacío "" si ninguno encaja de verdad.'),
  reuse_params: z.array(z.object({ key: z.string(), value: z.string() })).describe("Si reusas: sus textos editables con lo que dice la persona en este tramo (mismas claves). Vacío si no reusas."),
});

export function composPlanTask(input: { brief: string; said: string; duration: number; format: string; hasImages: boolean; library?: string | null; copy?: boolean; maxImages?: number }): string {
  return `ANIMACIÓN A CONSTRUIR (${input.duration.toFixed(1)} s, ${input.format}): ${input.brief}
LO QUE DICE LA PERSONA EN ESE TRAMO: «${input.said}»
${input.hasImages ? `Hay un generador de imágenes disponible (cuenta del cliente): pide imágenes SOLO si la animación muestra algo que no se puede dibujar bien con formas y texto (un mapa real, un objeto, un lugar, una ilustración). Hasta ${input.maxImages ?? 2}.
${PHOTO_REALISM}` : "No hay generador de imágenes conectado: todo se dibuja con código y el video."}
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

export function effectParamsTask(input: { name: string; description: string; params: { key: string; label: string; value: string }[]; said: string }): string {
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
      focus: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).describe("La zona que importa para la animación, en fracciones de la imagen (0 a 1, desde arriba a la izquierda). Ajustada al objeto, no aproximada."),
      label: z.string().describe("Qué es esa zona."),
      notes: z.string().describe("Lo que hay que saber para animarla: dónde está cada cosa importante (en fracciones), colores dominantes (#hex), zonas vacías para poner texto."),
      usable: z.boolean().describe("false si la imagen no sirve (no muestra lo pedido o tiene texto)."),
    }),
  ),
});

export function imageLookTask(input: { brief: string; images: { purpose: string; width: number; height: number }[] }): string {
  return `ANIMACIÓN: ${input.brief}
Te paso ${input.images.length} imagen(es) generada(s) para esta animación:
${input.images.map((im, i) => `${i + 1}. ${im.purpose} (${im.width}×${im.height})`).join("\n")}
Mira cada una con cuidado y dime dónde está exactamente lo importante (fracciones 0…1 de la imagen). Esas coordenadas van directo al código: si te equivocas, el zoom y la flecha apuntan a otro lado.`;
}

// ─── Código ──────────────────────────────────────────────────────────────

const sfxName = z.enum(SFX_NAMES as [SfxName, ...SfxName[]]);

export const composCodeWireSchema = z.object({
  name: z.string().describe("Nombre corto para la línea de tiempo (3 a 6 palabras)."),
  why: z.string().describe("Por qué esta animación aquí, en una frase para la persona."),
  code: z.string().describe("El módulo completo: export default { … }."),
  params: z.array(z.object({ key: z.string(), label: z.string(), value: z.string() })).describe("Los textos editables (las mismas claves que params del módulo)."),
  sounds: z.array(z.object({ at: z.number(), name: sfxName, gain: z.number() })).describe("Sonidos de la biblioteca en segundos de la animación (whoosh al entrar, golpe en el impacto…). Ganancia de -14 a -4 dB."),
  hide_captions: z.boolean().describe("true si la animación ya muestra en pantalla lo que se dice (informativo: los subtítulos se ven igual)."),
  tags: z.array(z.string()).describe("2 o 3 familias visuales en minúsculas con guiones (texto-letra-a-letra, tarjeta-3d, mapa-con-foco…)."),
});
export type ComposCodeWire = z.infer<typeof composCodeWireSchema>;

/** Ejemplos de calidad que van en el contexto (en caché). */
function samplesText(): string {
  return COMPOS_SAMPLES.map((s) => `### EJEMPLO «${s.name}» — ${s.use}\nparams: ${JSON.stringify(Object.fromEntries(s.params.map((p) => [p.key, p.value])))} · sonidos: ${s.sounds.map((x) => `${x.name}@${x.at}s`).join(", ") || "ninguno"} · oculta subtítulos: ${s.hide_captions ? "sí" : "no"}\n\`\`\`js\n${s.code.trim()}\n\`\`\``).join("\n\n");
}

export const COMPOS_RULES = `Eres un motion designer y programador que anima reels a mano, al nivel de un editor que cobra USD 20–50 por video. Programas cada animación como un módulo de JavaScript que dibuja cuadro a cuadro con Canvas 2D (no eliges de una lista: la escribes tú).

CALIDAD QUE SE ESPERA
- Movimiento con intención: entradas con resortes o ease out fuertes (nunca lineales), anticipación y rebote donde suma, salida propia en los últimos 0,3 s. Nada aparece de golpe salvo que sea un golpe a propósito.
- Sincronía con la voz: cada elemento entra cuando se dice (env.timeOf / env.words). El golpe cae en la palabra fuerte.
- Jerarquía tipográfica clara: una cosa grande y una chica. Tamaños de video (titulares de 90 a 300 px en 1080 de ancho, textos de apoyo 36–56 px). Siempre legible: velo, sombra, caja o contorno sobre fondos movidos.
- Color: la paleta de la marca (env.brand) salvo que la receta de la referencia pida otros colores; acentos con brillo (shadowBlur) con moderación.
- Profundidad: capas (detrás/delante de la persona con ctx.drawPerson(), desenfoques, sombras, 3D simple) cuando la referencia o el pedido lo piden.
- Composición: respeta env.face/env.safe (nunca tapes la cara salvo que la idea sea ir detrás de la persona), deja libre la franja de subtítulos (env.captions): los subtítulos se ven siempre encima de la animación, para quien mira sin sonido. No pongas texto ni elementos importantes en esa franja.
- Textos cortos, en el idioma de la marca, editables en params (nada de textos fijos dentro del código que la persona quiera cambiar).
- Si dibujas una fuente propia (pixel, a mano), tiene que tener TODAS las letras del español: Ñ, Á, É, Í, Ó, Ú, Ü, ¿ y ¡. «AÑO» nunca puede salir «ANO». Si no vas a dibujarlas todas, usa las fuentes de env.fonts.
- Nunca inventes cifras ni datos: solo lo que se dice.

${COMPOS_API_DOC}

SONIDOS DE LA BIBLIOTECA (en "sounds": nombre exacto, segundo de la animación y ganancia; pocos y justos, en los golpes visuales; las voces de anunciador para momentos épicos o de juego):
${sfxCatalogText()}

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
  /** Pieza única de todo el video, con sus escenas (segundos de la pieza). */
  long?: { scenes: { title: string; start: number; end: number; brief: string }[] } | null;
  /** Franja fija de la persona: dónde puede dibujar la animación (env.stage) y dónde va la persona (env.panel). */
  stage?: string | null;
  /** Cambio en una sola escena de la pieza. */
  scene?: { index: number; title: string; start: number; end: number } | null;
  /** Copia exacta de todo el video: el kit y el estilo de la referencia (las hojas son de toda la referencia). */
  copyKit?: string | null;
}): string {
  const parts = [
    `ANIMACIÓN: ${input.brief}`,
    `DURACIÓN: ${input.duration.toFixed(2)} s · FORMATO ${input.format} (${input.width}×${input.height}).`,
    `LO QUE DICE LA PERSONA (palabras con su segundo dentro de la animación): ${input.words}`,
    `CARA (px): ${input.face}`,
  ];
  if (input.long) {
    parts.push(`PIEZA ÚNICA DE TODO EL VIDEO: una sola animación de principio a fin, que se ve como una pieza (no como clips sueltos). Empieza con una entrada pensada para el inicio del video y termina con un cierre pensado para el final.
- Arma el código por escenas: const SCENES = [{ t0, t1, draw(ctx, lt, env, k) }, …] con una función por escena (lt = segundos dentro de la escena, k = progreso 0…1), en el mismo orden y con los mismos tiempos que la lista de abajo. render() dibuja primero lo que se comparte (fondo, grilla, partículas, marco, logo) y después la escena del momento.
- Continuidad: lo que se repite entre escenas (fondo, paleta, tipografía, elementos que pasan de una a otra) vive fuera de las escenas. Cada escena entra desde cómo terminó la anterior: transiciones dibujadas de 0,3 a 0,6 s en el borde entre escenas, nunca un corte seco ni un cuadro vacío.
- Movimiento siempre: ninguna escena se queda quieta. Sincroniza los golpes con las palabras de env.words.
- Sonidos en "sounds" con segundos de la pieza: uno en CADA acción que se ve (choque de espadas, golpe, tajo, cartel que cae, monedas, tic de contador, whoosh de entrada), normalmente de 3 a 6 por escena, con al menos 0,25 s entre uno y otro. Ganancia de -12 a -4 dB (los golpes e impactos fuertes, -6 a -2): tienen que escucharse claro; el mezclador los baja un poco mientras hablas. Una pieza sin sonidos o con muy pocos se siente vacía.
- Escala: lo principal (personajes, objetos, carteles) grande y cerca de la cámara. Un personaje ocupa al menos un tercio del ancho del cuadro; nada importante chiquito a lo lejos. Si hay escenario, es el fondo: no achiques a los protagonistas para mostrarlo entero.
ESCENAS (segundos de la pieza):
${input.long.scenes.map((sc, i) => `${i + 1}. «${sc.title}» ${sc.start.toFixed(2)}–${sc.end.toFixed(2)} s: ${sc.brief}`).join("\n")}`);
  }
  if (input.copyKit) parts.push(`COPIA EXACTA DE UNA REFERENCIA (manda sobre lo anterior): este video tiene que verse IGUAL a la referencia, como si lo hubiera editado la misma persona, con el contenido de este video.
- Primero el KIT, una sola vez y fuera de las escenas: const KIT = { fondo, personaje, panel, título, subtítulo, aros, … } con una función por pieza, fieles a la ficha de abajo (mismos colores #hex, tamaños en % del cuadro, tipografía, estilo de dibujo: si es pixel art, todo en pixel art con rectángulos y sin suavizar). Cada escena se arma con esas piezas: así toda la pieza se ve como una sola.
- render(): fondo del kit → escena del momento (con su entrada de la transición del kit) → personaje del kit → título de la escena → subtítulos del kit → aros y destellos. Lo que la referencia tiene siempre (personaje, velas, firma), aquí también está siempre.
- Subtítulos: los dibujas tú con el estilo de la referencia (caja, tipografía, mayúsculas, cuántas palabras a la vez) leyendo env.words, y pones hide_captions en true.
- Cada golpe de la lista de escenas ya trae su segundo de la pieza (el de la palabra que lo dispara): ponlo exactamente ahí, con su sonido.
- Las hojas adjuntas son TODA la referencia, cuadro por cuadro (R#n con su segundo). Antes de escribir cada escena, mira sus cuadros R#n: copia la composición, los tamaños, los colores y el movimiento. Nada genérico: si en la referencia el panel ocupa el 55 % del ancho con grilla de 11 casilleros, aquí también.
KIT Y ESTILO DE LA REFERENCIA:
${input.copyKit}`);
  if (input.stage) parts.push(input.stage);
  if (input.scene) parts.push(`CAMBIO SOLO EN LA ESCENA ${input.scene.index + 1} «${input.scene.title}» (${input.scene.start.toFixed(2)}–${input.scene.end.toFixed(2)} s de la pieza). Cambia únicamente esa escena (y, si hace falta, la transición de entrada y de salida de esa escena). Todo lo demás del código tiene que quedar exactamente igual, carácter por carácter.`);
  if (input.momentDetail) parts.push(`EL MOMENTO DE LA REFERENCIA QUE COPIAS (reprodúcelo lo más fiel posible: composición, tipografía, colores, movimiento, curvas y tiempos; solo cambia el contenido):\n${input.momentDetail}`);
  if (input.recipeGlobal) parts.push(`ESTILO GLOBAL DE LA REFERENCIA:\n${input.recipeGlobal}`);
  if (input.refFrames && !input.copyKit) parts.push(`Te paso ${input.refFrames === 1 ? "una hoja" : `${input.refFrames} hojas`} con los cuadros de la referencia en ese momento (R#n). Míralos y copia lo que se ve.`);
  if (input.images) parts.push(`IMÁGENES GENERADAS PARA ESTA ANIMACIÓN (están en env.assets con kind "image", en este orden):\n${input.images}`);
  if (input.avoid) parts.push(`VARIEDAD: ya se usaron hace poco en esta marca (evita repetir la misma familia visual salvo que el pedido lo exija): ${input.avoid}`);
  if (input.base) parts.push(`ANIMACIÓN ACTUAL (la cambias según el pedido; conserva lo que no se pide cambiar):\nPedido: «${input.base.request}»\nparams actuales: ${input.base.params}\n\`\`\`js\n${input.base.code}\n\`\`\``);
  if (input.previousError) parts.push(`TU VERSIÓN ANTERIOR FALLÓ LA VALIDACIÓN: ${input.previousError}\nCorrígela (el resto de la idea se mantiene).`);
  parts.push("Escribe el módulo completo.");
  return parts.join("\n\n");
}

// ─── Mirar el resultado ──────────────────────────────────────────────────

export const composLookWireSchema = z.object({
  score: z.number().min(0).max(100).describe("Parecido con la referencia (o cumplimiento del pedido) y calidad: 100 = indistinguible de un editor profesional."),
  ok: z.boolean().describe("true si ya está bien (no hace falta otra vuelta)."),
  issues: z.array(z.string()).describe("Lo que está mal o distinto, concreto (posición, tamaño, color, tiempo, legibilidad, tapa la cara…)."),
  fixed: z.string().describe("Si no está bien: el módulo completo corregido. Si está bien: vacío."),
  note: z.string().describe("Para la persona, en una frase: qué tan parecido quedó y qué no se pudo."),
});
export type ComposLookWire = z.infer<typeof composLookWireSchema>;

export function composLookTask(input: { brief: string; momentDetail?: string | null; code: string; times: number[]; refFrames: number; round: number; copy?: boolean }): string {
  return `ANIMACIÓN: ${input.brief}
${input.momentDetail ? `MOMENTO DE LA REFERENCIA QUE COPIA:\n${input.momentDetail}\n` : ""}
La PRIMERA imagen es una hoja con tu animación dibujada sobre el video real en ${input.times.map((t) => `${t.toFixed(2)} s`).join(", ")}.${input.refFrames ? (input.copy ? ` Las siguientes son las hojas de TODA la referencia que hay que copiar tal cual (R#n): busca en cada escena qué no se parece (fondo, personaje, paneles, tamaños, colores, subtítulos) y corrígelo.` : ` Las siguientes son los cuadros de la referencia en ese momento (R#n).`) : ""}
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
        brief: z.string().describe("Animación a medida para este momento (idea visual original, no un efecto de catálogo)."),
        family: z.string().describe("Familia visual en minúsculas con guiones."),
      }),
    )
    .max(4),
});

export function keyMomentsTask(input: { sentences: string; map: string; count: number; avoid: string; taken: string }): string {
  return `VIDEO (frases con los ids de sus palabras):
${input.sentences}

LO QUE ENTENDIÓ EL DIRECTOR:
${input.map}

YA OCUPADO POR LA EDICIÓN:
${input.taken || "nada"}

Elige ${input.count} momentos clave (el gancho, una cifra, una enumeración, un giro, la CTA…) que merecen una animación a medida, original y distinta entre sí. Ideas visuales con carácter (no "texto que aparece").
EVITA estas familias que la marca usó hace poco: ${input.avoid || "ninguna"}.`;
}

// ─── Animar todo el video ────────────────────────────────────────────────

export type WholeMode = "face" | "over" | "split" | "top" | "full";

/** Cómo se reparte la pantalla en cada modo (va en cada pedido, para el motion designer). */
export const WHOLE_LAYOUT: Record<WholeMode, string> = {
  face: "",
  over: "SOBRE TU CARA: se ve el video de la persona a pantalla completa todo el tiempo y la animación va encima, alrededor de la cara (textos, tarjetas, gráficos, objetos), sin taparla nunca (usa env.face y env.freeY).",
  split: "MITAD Y MITAD: la pantalla se divide en dos. Arriba (la mitad superior) va la animación con su propio fondo; abajo va la persona: dibuja el video con ctx.drawVideo recortado y encuadrado en la cara (env.face) para que la cara quede centrada en la mitad de abajo. Una línea o borde fino separa las dos mitades.",
  top: "FONDO BLANCO ARRIBA: la persona va recortada en la parte de abajo (dibuja el video con ctx.drawVideo en el 45 % inferior, encuadrado en la cara) y arriba hay un panel blanco liso (#ffffff) de donde nacen y se mueven todas las animaciones (textos en tinta oscura y el acento de la marca, objetos, fotos). El panel blanco está siempre, igual en todas.",
  full: "PANTALLA COMPLETA: la animación ocupa todo el cuadro con un fondo propio opaco; no se ve el video de abajo ni a la persona.",
};

export const WHOLE_RULES = `Eres el director de arte y motion designer de un reel de una marca personal. Te pasan la transcripción completa con los ids de sus palabras y armas el plan para animar TODO el video: un estilo común y un pedido por momento, que otro motion designer ejecuta sin ver nada más que ese pedido y el estilo.

Cada pedido:
- Va en español neutro, escrito como para un motion designer: qué se ve, cómo se mueve y en qué palabra pasa cada cosa (cita las palabras exactas entre comillas: «En "plata": …»).
- Se entiende solo (no dice "como la anterior").
- Cuenta UNA idea visual fuerte de lo que se dice en ese tramo, sin inventar cifras, nombres ni datos que la persona no dice. Si dice un número, se puede mostrar ese número.
- Tiene movimiento continuo (sin momentos quietos) y, si sirve, un sonido marcado ("whoosh al entrar", "golpe grave en…").
- Puede pedir hasta dos imágenes creadas con IA. Si son fotos, que parezcan fotos reales: foto documental o fotograma de 35 mm, una luz con motivo, grano; mejor lugares y objetos que gente; si hay gente, de espaldas, lejos o desenfocada, nunca posando.
- Nada de emojis ni íconos de caricatura salvo que el estilo lo pida.
- Entre 300 y 1000 caracteres.

El estilo común (máximo 400 caracteres): look, paleta en #hex (usa los colores de la marca), tipografía, tipo de movimiento y de sonido. Se repite al principio de cada pedido para que todo el video se vea como una sola pieza.`;

export function wholeVideoTask(input: { mode: WholeMode; duration: number; format: string; sentences: string; map: string; notes: string; count: { min: number; max: number } }): string {
  const continuous = `Las animaciones cubren el video entero, una detrás de otra, sin huecos: la primera empieza en la primera palabra y cada una termina justo antes de la siguiente; la última termina en la última palabra. Cada una dura entre 3 y 9 s. Entre ${input.count.min} y ${input.count.max} animaciones. Que se encadenen: cada una sale como la siguiente necesita entrar.`;
  const mode =
    input.mode === "full"
      ? `MODO PANTALLA COMPLETA (solo la voz): la persona NO se ve nunca. ${continuous} Cada pedido dice que la animación ocupa toda la pantalla con un fondo propio opaco (no se ve el video de abajo).`
      : input.mode !== "face"
        ? `MODO ${WHOLE_LAYOUT[input.mode].split(":")[0]}: ${WHOLE_LAYOUT[input.mode].split(":").slice(1).join(":").trim()} Esta disposición es igual en todas las animaciones (no hace falta repetirla en cada pedido: se agrega sola). ${continuous}`
        : `MODO CON TU CARA: la persona habla a cámara y se la ve entre animación y animación. Anima los momentos que más ganan con algo en pantalla (el gancho, cifras, comparaciones, listas, el cierre), de 2 a 6 s cada uno, con al menos 2 s de cara entre una y otra. Alterna: algunas a pantalla completa, otras sobre el video (textos, tarjetas, gráficos al costado) y alguna que se achica a una tarjeta con esquinas redondeadas para dejar ver la cara. La primera va en el gancho. Entre ${input.count.min} y ${input.count.max} animaciones.`;
  return `VIDEO: ${input.duration.toFixed(1)} s, ${input.format}.
${mode}
${input.notes ? `\nLO QUE PIDE LA PERSONA PARA ESTE VIDEO: ${input.notes}\n` : ""}
${input.map ? `MAPA DEL VIDEO (historia y partes):\n${input.map}\n` : ""}
FRASES CON LOS IDS DE SUS PALABRAS ([desde–hasta] segundos: texto):
${input.sentences}

Arma el estilo y la lista de momentos en orden, con from_word y to_word de las frases de arriba.`;
}

export const wholeVideoWireSchema = z.object({
  style: z.string().describe("Estilo común de todas las animaciones (máximo 400 caracteres)."),
  moments: z
    .array(
      z.object({
        from_word: z.number().int(),
        to_word: z.number().int(),
        title: z.string().describe("Nombre corto de la animación (3 a 6 palabras)."),
        prompt: z.string().describe("El pedido para el motion designer (300 a 1000 caracteres)."),
      }),
    )
    .max(30),
});
