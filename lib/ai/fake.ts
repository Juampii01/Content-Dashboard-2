import "server-only";
import { spokenNumbers } from "@/lib/video/graphics";
import { ICON_TAGS } from "@/lib/video/motion/icons";
import { sceneToWire, type MotionSceneAi } from "@/lib/ai/prompts/motion";

/**
 * Respuestas simuladas para probar la interfaz sin clave de IA. Solo en desarrollo con AI_FAKE=1;
 * en producción nunca se usan (ver lib/ai/client.ts).
 */
const beats = [
  { purpose: "Mostrar el error", spoken: "La mayoría contesta la primera llamada explicando el precio. Error. En ese momento el paciente todavía no sabe si confía en ti.", onScreenText: "El error #1", broll: "Recepcionista contestando el teléfono", seconds: 9 },
  { purpose: "Dar la alternativa", spoken: "Lo que funciona es preguntar primero qué le pasa y desde cuándo. Escuchas, repites lo que dijo con sus palabras, y recién ahí hablas de la solución.", onScreenText: "Primero pregunta", broll: "Primer plano tomando notas", seconds: 12 },
  { purpose: "Prueba", spoken: "Una clínica en Houston cambió solo eso y pasó de agendar 3 de cada 10 llamadas a 6 de cada 10 en un mes.", onScreenText: "3/10 → 6/10", broll: "Pantalla de agenda llenándose", seconds: 8 },
];

/**
 * Editor de video: un "editor" determinista que lee la tarea (candidatos y frases con sus tiempos)
 * y responde como lo haría Claude: corta los candidatos seguros y propone 3 frases de 3 a 8 s como gancho.
 */
function fakeVideoPlan(task: string) {
  const decisions = [...task.matchAll(/^(C\d+) (toma repetida|arranque en falso|muletilla) \[(\d+)–(\d+)\] conf ([\d.]+)/gm)].map((m) => ({
    candidate: m[1]!,
    cut: Number(m[5]) >= 0.6,
    confidence: Number(m[5]),
  }));
  const frases = [...task.matchAll(/^F(\d+) \[(\d+)–(\d+)\] ([\d.]+) s \([\d.]+–[\d.]+\): (.*)$/gm)].map((m) => ({
    index: Number(m[1]),
    from: Number(m[2]),
    to: Number(m[3]),
    dur: Number(m[4]),
    text: m[5]!,
  }));
  const cut = new Set<number>();
  for (const m of task.matchAll(/^C\d+ (?:toma repetida|arranque en falso|muletilla) \[(\d+)–(\d+)\] conf ([\d.]+)/gm)) {
    if (Number(m[3]) >= 0.6) for (let id = Number(m[1]); id <= Number(m[2]); id++) cut.add(id);
  }
  const hooks = frases
    .map((f) => {
      let from = f.from;
      let to = f.to;
      while (from < to && cut.has(from)) from++;
      while (to > from && cut.has(to)) to--;
      return { ...f, from, to };
    })
    .filter((f) => f.dur >= 3 && f.dur <= 8.5 && ![...Array(f.to - f.from + 1).keys()].some((k) => cut.has(f.from + k)))
    .map((f) => ({ ...f, score: (/[?¿]/.test(f.text) ? 0.2 : 0) + (/\d/.test(f.text) ? 0.2 : 0) + 0.5 - f.index * 0.01 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((f) => ({ from_word: f.from, to_word: f.to, score: Math.min(0.95, f.score), why: /\d/.test(f.text) ? "Abre con un dato concreto que genera curiosidad." : "Plantea el problema de entrada y se entiende sin contexto." }));
  const numbers = [...task.matchAll(/(\d+):[^\s]*\d[^\s]*/g)].map((m) => Number(m[1])).slice(0, 4);
  return {
    decisions,
    extra_removals: [],
    hook_candidates: hooks,
    emphasis_words: numbers,
    summary: `Se cortaron ${decisions.filter((d) => d.cut).length} tramos: tomas repetidas, arranques en falso y muletillas. Las pausas largas se acortan solas.`,
    warning: "",
  };
}

export function fakeResponse(feature: string, task = ""): unknown {
  const hooks = [
    { text: "Si contestas el teléfono así, estás perdiendo pacientes.", type: "contraste", score: 9, why: "Ataca algo que hacen todos los días." },
    { text: "Tres de cada diez llamadas. Esa es la cifra que te está costando miles.", type: "resultado", score: 8, why: "Un número concreto genera curiosidad." },
    { text: "¿Por qué tus pacientes llaman, preguntan el precio y nunca vuelven?", type: "pregunta", score: 8, why: "Nombra el dolor exacto." },
    { text: "Mi primer cliente perdía la mitad de sus llamadas. El problema eran 5 palabras.", type: "historia", score: 7, why: "Historia con intriga." },
    { text: "Deja de dar el precio en la primera llamada.", type: "dolor", score: 7, why: "Orden directa y polémica." },
  ];
  switch (feature) {
    case "guiones.generar":
    case "guiones.adaptar":
      return {
        title: "El error de la primera llamada",
        angle: "La primera llamada se gana escuchando, no explicando precios.",
        hooks,
        beats,
        cta: { spoken: "Si quieres el guion exacto que usan, comenta LLAMADA y te lo mando.", onScreenText: "Comenta LLAMADA", offer: "Guion de llamadas" },
        caption: "El error que comete casi toda clínica en la primera llamada 👇\n\nNo es el precio. Es el orden.\n\nComenta LLAMADA y te mando el guion.",
      };
    case "guiones.ganchos":
      return { hooks: [...hooks].reverse().map((h, i) => ({ ...h, text: `${h.text} (variante ${i + 1})` })) };
    case "guiones.acortar":
    case "guiones.directo":
      return { beats: beats.slice(0, 2).map((b) => ({ ...b, spoken: b.spoken.split(".")[0] + ".", seconds: Math.max(3, b.seconds - 4) })) };
    case "guiones.bloque":
      return { beat: { ...beats[1]!, spoken: "Pregunta primero: qué le pasa, desde cuándo, qué probó. Repite lo que dijo. Después hablas de la solución." } };
    case "guiones.cta":
      return { cta: { spoken: "Guarda este video para tu próxima llamada.", onScreenText: "Guárdalo", offer: "" }, caption: "Guárdalo para tu próxima llamada." };
    case "marca.borrador":
      return {
        niche: "Marketing de pacientes para clínicas dentales latinas en Estados Unidos",
        whatYouSell: "Programa de 8 semanas para llenar la agenda con pacientes nuevos (USD 2,500)",
        differentiator: "Trabajo el teléfono y la recepción, no solo los anuncios.",
        audience: "Dueños de clínicas dentales latinas en Estados Unidos, con 2 a 6 sillas, que gastan en anuncios pero no llenan la agenda.",
        audiencePains: ["Pago anuncios y la gente no agenda", "Mi recepcionista no sabe vender", "Los pacientes preguntan el precio y desaparecen"],
        audienceDesires: ["Agenda llena dos semanas por adelantado", "Un equipo que cierre sin mí"],
        objections: ["Ya probé con una agencia y no funcionó", "No tengo tiempo para entrenar a nadie"],
        beliefs: ["Los anuncios no son el problema, el teléfono sí", "No hay que bajar precios para llenar la agenda"],
        tone: "Directo, con ejemplos de clínicas reales y un poco de humor seco.",
        signaturePhrases: ["Esto no es magia, es proceso"],
        bannedWords: ["gurú", "secreto", "hackear"],
        emojiPolicy: "pocos",
        pillars: [
          { name: "Teléfono y recepción", description: "Cómo convertir llamadas en citas", share: 40 },
          { name: "Anuncios que traen pacientes", description: "Qué funciona y qué no", share: 30 },
          { name: "Casos de clientes", description: "Antes y después", share: 30 },
        ],
        offers: [{ name: "Programa Agenda Llena", promise: "Llena tu agenda en 8 semanas", cta: "Comenta AGENDA y te explico cómo funciona", keyword: "AGENDA" }],
      };
    case "metricas.ganchos": {
      const types = ["contraste", "curiosidad", "dolor", "resultado", "historia", "pregunta", "lista", "otro"];
      const lines = [...task.matchAll(/^#(\d+) (.*)$/gm)];
      return {
        items: lines.map(([, n, text]) => {
          const t = text!.toLowerCase();
          const type = t.includes("?") ? "pregunta" : /\d/.test(t) ? "lista" : t.includes("error") || t.includes("deja") ? "contraste" : types[(text!.length * 7) % types.length];
          return { n: Number(n), type, hook: text!.slice(0, 120) };
        }),
      };
    }
    case "marca.prueba":
      return {
        topic: "La primera llamada",
        hook: "Tu recepcionista está perdiendo pacientes antes de decir hola.",
        body: [
          "Mira, el 80 % de las clínicas contesta la primera llamada dando el precio. Y ahí se cae todo.",
          "Porque el paciente todavía no sabe si confía en ti. Le das un número y lo compara con el de enfrente.",
          "Lo que funciona es al revés: preguntas qué le pasa, desde cuándo, qué probó. Y recién ahí hablas de la solución.",
        ],
        cta: "Si quieres el guion exacto de esa llamada, comenta AGENDA y te lo mando.",
      };
    case "inicio.resumen":
      return {
        headline: "Semana sólida: +873 seguidores, casi la mitad por un solo reel de historia.",
        wins: [
          "El reel de la primera llamada rindió ×3.1 tu mediana y trajo 410 seguidores.",
          "Publicaste 14 piezas, 4 más que la semana anterior.",
          "Los guardados por cada 1,000 vistas subieron de 9 a 14.",
        ],
        watch: ["Las visualizaciones totales bajaron 18 %: tres de tus piezas de TikTok quedaron por debajo de ×0.5."],
        nextWeek: [
          { title: "La llamada que perdió al paciente", hook: "Esta recepcionista perdió a un paciente en 20 segundos. Escucha por qué.", why: "Tus ganchos de historia rinden ×1.3 y esta semana lo confirmaste." },
          { title: "3 preguntas antes del precio", hook: "Antes de decir el precio, haz estas 3 preguntas.", why: "Formato lista: el que más guardados te da." },
          { title: "El mito del descuento", hook: "Bajar el precio no llena tu agenda. Esto sí.", why: "Contraste con una creencia de tu audiencia." },
        ],
      };
    case "informes.resumen":
      return {
        wins: [
          "Tu mejor reel del mes rindió ×3.4 tu mediana y fue el que más seguidores trajo.",
          "Publicaste 36 piezas: cumpliste tu meta semanal en 3 de 4 semanas.",
          "La tasa de interacción subió de 4.1 % a 4.9 % en Instagram.",
        ],
        watch: [
          "YouTube bajó 12 % en visualizaciones: los videos largos salieron sin un gancho claro en los primeros 10 segundos.",
          "La última semana publicaste 5 piezas, por debajo de tu meta de 8: deja dos piezas listas antes del lunes.",
        ],
        ideas: [
          { title: "El error de la primera llamada", hook: "Esta recepcionista perdió a un paciente en 20 segundos. Escucha por qué.", why: "Tus ganchos de historia fueron los que más rindieron este mes." },
          { title: "3 preguntas antes del precio", hook: "Antes de decir el precio, haz estas 3 preguntas.", why: "El formato lista te dio el doble de guardados." },
          { title: "El mito del descuento", hook: "Bajar el precio no llena tu agenda. Esto sí.", why: "Los contrastes con una creencia de tu audiencia llevaron más comentarios." },
        ],
        worstLesson: "El gancho tardó 6 segundos en llegar al punto y la mitad se fue antes. La próxima vez abre con el resultado y deja el contexto para después.",
      };
    case "metricas.analisis":
      return {
        verdict: "Funcionó por un gancho de contraste muy claro y porque se guardó casi el triple que tus otros reels: la gente lo tomó como referencia.",
        drivers: [
          { factor: "Guardados", evidence: "2,4 % de guardados por visualización contra 0,9 % de tu mediana.", effect: "positivo" },
          { factor: "Gancho de contraste", evidence: "Por el texto, la primera línea contradice algo que tu audiencia hace todos los días (hipótesis: no vimos el video).", effect: "positivo" },
          { factor: "Pocos comentarios", evidence: "0,2 % de comentarios contra 0,4 % de tu mediana: el CTA no invitaba a responder.", effect: "negativo" },
        ],
        hook: "Es un gancho de contraste: nombra un error concreto en la primera frase. Se entiende sin contexto y obliga a seguir mirando para saber la alternativa.",
        lessons: [
          "Abre con el error concreto que comete tu audiencia, no con el tema.",
          "Cuando el contenido sea una referencia (pasos, guion, lista), pide guardar en el CTA.",
          "Si quieres comentarios, termina con una pregunta de una palabra.",
        ],
        ideas: [
          { title: "El segundo error de la primera llamada", hook: "Si ya no das el precio en la primera llamada, este es el siguiente error que te está costando pacientes.", angle: "Continuación directa: misma audiencia, siguiente paso." },
          { title: "Guion de 3 preguntas", hook: "Estas 3 preguntas agendan más pacientes que cualquier descuento.", angle: "Formato lista para empujar guardados." },
          { title: "La llamada real, comentada", hook: "Escucha cómo una recepcionista perdió a este paciente en 20 segundos.", angle: "Caso real con antes y después, para comentarios." },
        ],
      };
    case "carruseles.ficha":
      return {
        title: "La primera llamada que llena tu agenda",
        slides: [
          { type: "cover", kicker: "Clínicas dentales", headline: "Así pierdes pacientes en la primera llamada", highlight: "primera llamada", body: "", cta: "", scenePrompt: "Teléfono de recepción sonando sobre un mostrador blanco de clínica, luz de mañana, plano cercano" },
          { type: "item", kicker: "Error #1", headline: "Dar el precio antes de escuchar", highlight: "precio", body: "Si lo primero que oye es un número, el paciente compara precios y cuelga.", cta: "", scenePrompt: "Calculadora y factura sobre un escritorio, luz cálida lateral, fondo desenfocado" },
          { type: "item", kicker: "Error #2", headline: "Responder sin preguntar qué le pasa", highlight: "preguntar", body: "Pregunta qué le duele, desde cuándo y qué probó. Así sabe que lo escuchas.", cta: "", scenePrompt: "Libreta abierta con un bolígrafo junto a una taza de café, vista cenital" },
          { type: "step", kicker: "Lo que sí funciona", headline: "Repite lo que dijo con sus palabras", highlight: "sus palabras", body: "“Entonces te duele al masticar desde hace una semana.” Recién ahí hablas de la solución.", cta: "", scenePrompt: "Dos sillas frente a frente en una sala de espera luminosa, plano general" },
          { type: "data", kicker: "Caso real", headline: "De 3 de cada 10 a 6 de cada 10 citas", highlight: "6 de cada 10", body: "Una clínica cambió solo el orden de la llamada y duplicó las citas agendadas en un mes.", cta: "", scenePrompt: "Calendario de pared lleno de marcas de colores, plano medio, luz suave" },
          { type: "quote", kicker: "Recuerda", headline: "La primera llamada se gana escuchando, no explicando", highlight: "escuchando", body: "", cta: "", scenePrompt: "Ventana con luz natural entrando en una sala vacía y tranquila" },
          { type: "cta", kicker: "Guion de llamadas", headline: "¿Quieres el guion exacto para tu recepción?", highlight: "guion exacto", body: "Te lo mando gratis por mensaje directo.", cta: "Comenta AGENDA", scenePrompt: "Auriculares de recepción sobre un escritorio ordenado, tono azul" },
        ],
        caption: "El error que comete casi toda clínica en la primera llamada 👇\n\nNo es el precio. Es el orden: primero escuchas, después explicas.\n\nComenta AGENDA y te mando el guion que usa mi equipo.",
        hashtags: ["#clinicadental", "#dentistas", "#marketingdental", "#recepcion", "#pacientesnuevos"],
      };
    case "carruseles.slide":
      return { slide: { type: "item", kicker: "Error #1", headline: "Hablar del precio antes de escuchar (reescrito)", highlight: "precio", body: "Primero pregunta qué le pasa. El precio llega cuando ya confía en ti.", cta: "" } };
    case "carruseles.portada":
      return {
        covers: [
          { kicker: "Clínicas dentales", headline: "Tu recepción está espantando pacientes sin darse cuenta", highlight: "espantando pacientes", body: "" },
          { kicker: "Antes de contestar", headline: "Lo que tu recepcionista dice en los primeros segundos", highlight: "primeros segundos", body: "" },
          { kicker: "Pregunta incómoda", headline: "¿Por qué llaman, preguntan el precio y no vuelven?", highlight: "no vuelven", body: "" },
        ],
      };
    case "carruseles.caption":
      return {
        caption: "Tu agenda no se llena con más anuncios. Se llena en el teléfono.\n\nGuarda este carrusel y compártelo con tu recepción.\n\nComenta AGENDA y te mando el guion completo.",
        hashtags: ["#odontologia", "#clinicadental", "#recepcionista", "#agendallena", "#dentistaslatinos"],
      };
    case "carruseles.escenas": {
      const indexes = (task.match(/slides: ([\d, ]+)\./)?.[1] ?? "1").split(/,\s*/).map(Number).filter(Boolean);
      const ideas = ["Escritorio ordenado con una planta y luz de ventana, vista cenital", "Taza de café humeante junto a una libreta abierta, luz cálida", "Ciudad al amanecer vista desde una terraza, tonos suaves", "Manos sosteniendo una brújula sobre un mapa, plano cercano"];
      return { scenes: indexes.map((index, i) => ({ index, scenePrompt: ideas[i % ideas.length]! })) };
    }
    case "carruseles.estilo": {
      // Sin IA: devuelve el borrador medido tal cual (así la prueba de fidelidad mide el motor de medidas).
      const draft = task.match(/<borrador>([\s\S]*?)<\/borrador>/)?.[1];
      return draft ? JSON.parse(draft) : {};
    }
    case "calendario.plan":
      return {
        ideas: [
          { title: "El error de la primera llamada", hook: "Si contestas el teléfono así, estás perdiendo pacientes.", pillar: "Teléfono y recepción", format: "REEL", platforms: ["INSTAGRAM", "TIKTOK"], day: 1, why: "Tu pilar más atrasado y el tipo de gancho de contraste que mejor te rinde." },
          { title: "3 anuncios que sí traen pacientes", hook: "Gastaste en anuncios y nadie agendó. Estos 3 sí funcionan.", pillar: "Anuncios que traen pacientes", format: "CAROUSEL", platforms: ["INSTAGRAM"], day: 2, why: "Los carruseles de lista son los que más guardan." },
          { title: "De 3 a 6 citas de cada 10 llamadas", hook: "Una clínica en Houston duplicó sus citas sin gastar un dólar más.", pillar: "Casos de clientes", format: "SHORT", platforms: ["YOUTUBE"], day: 3, why: "Un caso con números concretos, como tus piezas que más rindieron." },
          { title: "La pregunta que cierra la cita", hook: "Esta pregunta hace que el paciente agende antes de preguntar el precio.", pillar: "Teléfono y recepción", format: "REEL", platforms: ["INSTAGRAM", "TIKTOK"], day: 4, why: "Conecta con tu oferta Agenda Llena (palabra clave AGENDA)." },
        ],
      };
    case "video.plan":
      return fakeVideoPlan(task);
    case "video.broll":
      return fakeBrollPlan(task);
    // Los gráficos viajan en el formato de cable de lib/ai/prompts/motion.ts (capas con spec en JSON).
    case "video.broll.motion": {
      const plan = fakeBrollMotionPlan(task);
      return { broll: plan.broll.map((b) => ({ ...b, graphic: b.graphic ? toWire(b.graphic) : null })) };
    }
    case "video.motion.pedido":
      return toWireRequest(fakeMotionRequest(task));
    case "video.motion.ajuste":
      return toWireRequest(fakeMotionAdjust(task));
    case "video.motion.retry":
      return { graphics: fakeMotionRetry(task).graphics.map(toWire) };
    case "clips.momentos":
      return fakeClipMoments(task);
    case "guiones.puntaje": {
      // Explica con lo que trae la tarea (las cifras ya calculadas), igual que lo haría Claude.
      const best = /Su mejor tipo de gancho: (\p{L}+) \((×[\d.]+)/u.exec(task);
      const own = /Ganchos de ese tipo: (×[\d.]+) su mediana/.exec(task);
      const type = /Tipo de gancho: (.+)/.exec(task)?.[1] ?? "sin clasificar";
      const few = task.includes("pocos datos");
      const sameType = best && best[1]!.toLowerCase() === type.toLowerCase();
      return {
        summary: `${few ? "Con los pocos datos que hay, tu" : "Tu"} gancho es de ${type.toLowerCase()}${own ? `, un tipo que te rinde ${own[1]} tu mediana` : ""}.${best && !sameType ? ` Tu mejor tipo es ${best[1]!.toLowerCase()} (${best[2]}).` : " Es el tipo que mejor te funciona."}`,
        tips: [
          best && !sameType ? `Reescribe la primera frase como un gancho de ${best[1]!.toLowerCase()}.` : "Mantén el gancho y cuida que se diga en menos de 3 segundos.",
          ...(/Sugerencias calculadas: .*Recorta/.test(task) ? ["Recorta el cuerpo hasta la duración de tus mejores piezas."] : []),
        ],
        hookRewrite: best && !sameType ? "Así pasé de 3 a 9 pacientes por día cambiando una sola frase." : null,
      };
    }
    default:
      throw new Error(`Sin respuesta simulada para ${feature}`);
  }
}

/**
 * B-roll del Editor: elige frases "mostrables" repartidas en el video (ni la primera ni la última), un tramo del
 * largo pedido dentro de cada una, y decide como lo haría Claude: un gráfico de "número" si se dice una cifra,
 * "comparación" si hay un contraste, una toma de stock si la frase describe algo que se ve (diccionario chico) y,
 * si no, una frase fuerte o una palabra clave sobre el video.
 */
function fakeBrollPlan(task: string) {
  const count = Number(task.match(/CANTIDAD: (\d+)/)?.[1] ?? 2);
  const [minS, maxS] = (task.match(/DURACIÓN: ([\d.]+)–([\d.]+) s/)?.slice(1) ?? ["1.5", "3"]).map(Number) as [number, number];
  const graphicsRange = task.match(/GRÁFICOS: ([\d.]+)–([\d.]+) s/)?.slice(1).map(Number) ?? null;
  const forbidden = [...task.matchAll(/PROHIBIDO \[(\d+)–(\d+)\]/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  const frases = [...task.matchAll(/^F(\d+) \[(\d+)–(\d+)\] ([\d.]+) s \(([\d.]+)–([\d.]+)\): (.*)$/gm)].map((m) => ({
    from: Number(m[2]),
    to: Number(m[3]),
    dur: Number(m[4]),
    text: m[7]!,
  }));
  const dictionary: [RegExp, string, string][] = [
    [/tel[eé]fono|llamada|contestan/i, "receptionist answering phone", "teléfono"],
    [/cl[ií]nica|pacientes?|m[eé]dic/i, "modern medical clinic", "clínica"],
    [/precio|dinero|pag/i, "price tag money", "dinero"],
    [/citas?|agenda|calendario/i, "calendar appointment booking", "agenda"],
    [/pregunt|escuch/i, "doctor listening to patient", "consulta"],
    [/houston|ciudad/i, "city skyline aerial", "ciudad"],
  ];
  const usable = frases.filter((f, i) => i > 0 && i < frases.length - 1 && f.dur >= minS && !forbidden.some(([a, b]) => f.from <= b && a <= f.to));
  const step = Math.max(1, Math.floor(usable.length / Math.max(1, count)));
  const picked = usable.filter((_, i) => i % step === 0).slice(0, count);
  const clean = (text: string) => text.replace(/^(eh|em|este)\s+/i, "").replace(/[.?!…]+$/, "").trim();
  const short = (text: string, max: number) => (text.length <= max ? text : text.slice(0, text.lastIndexOf(" ", max)).trim());
  return {
    broll: picked.map((f, n) => {
      const words = f.to - f.from + 1;
      const hit = dictionary.find(([re]) => re.test(f.text));
      const nums = spokenNumbers(f.text);
      const text = clean(f.text);
      let graphic: Record<string, unknown> | null = null;
      if (graphicsRange && nums.length) {
        const ratio = /\bcada\b/i.test(f.text) && nums.length >= 2 ? `${nums[nums.length - 2]}/${nums[nums.length - 1]}` : String(nums[0]);
        graphic = { template: "number", mode: "full", position: "top", headline: ratio, label: short(text, 48), highlight: "", items: [], item_labels: [] };
      } else if (graphicsRange && /\b(no es|pero|sino|en vez de)\b/i.test(f.text)) {
        const [a, b] = f.text.split(/\b(?:pero|sino|en vez de)\b/i);
        graphic = { template: "compare", mode: "full", position: "top", headline: "", label: "", highlight: "", items: [short(clean(a ?? ""), 56), short(clean(b ?? ""), 56)], item_labels: ["Antes", "Después"] };
      } else if (graphicsRange && (!hit || n % 2 === 1)) {
        const longest = [...text.split(" ")].sort((x, y) => y.length - x.length)[0] ?? "";
        graphic =
          n % 2 === 0
            ? { template: "quote", mode: "overlay", position: "top", headline: short(text, 100), label: "", highlight: longest.replace(/[^\p{L}\p{N}]/gu, ""), items: [], item_labels: [] }
            : { template: "keyword", mode: "overlay", position: "top", headline: short(longest.replace(/[^\p{L}\p{N}]/gu, ""), 28), label: "", highlight: "", items: [], item_labels: [] };
      }
      const max = graphic && graphicsRange ? graphicsRange[1]! : maxS;
      const take = Math.max(2, Math.min(words, Math.round((words * Math.min(f.dur, max)) / f.dur)));
      return {
        from_word: f.from,
        to_word: f.from + take - 1,
        kind: graphic ? "graphic" : "stock",
        query_en: hit?.[1] ?? "business office teamwork",
        keywords: [hit?.[2] ?? "oficina", ...f.text.toLowerCase().split(/[^a-záéíóúñ]+/).filter((w) => w.length > 5).slice(0, 2)],
        graphic,
        why: graphic ? "Una idea que se entiende mejor en pantalla." : "La frase describe algo que se puede mostrar.",
      };
    }),
  };
}

// ─── Motion graphics (escenas v2 con el motor) ───────────────────────────
//
// Un "director" determinista que responde como Claude con la forma de lib/ai/prompts/motion.ts: mapea palabras del
// pedido a componentes (embudo, notificación, barras, checklist, tachado…), rechaza lo que entra en los límites
// (personas, fotos realistas, logos de terceros) y aplica ajustes simples (más grande, arriba, pantalla completa).

type FakeLayer = Record<string, unknown>;
type FakeScene = { title: string; mode: "full" | "overlay"; position: "top" | "bottom"; layers: FakeLayer[] };

const fakeComp = (component: string, props: Record<string, unknown>, extra: Partial<{ at: number; scale: number; place: string }> = {}): FakeLayer => ({ kind: "component", component, at: 0, scale: 1, place: "auto", props, ...extra });
const anim = (type: string, at: number) => ({ type, at, dur: 0, dir: "none" });
const fakeText = (text: string, y: number, o: Partial<{ size: number; color: string; style: string; at: number }> = {}): FakeLayer => ({
  kind: "text",
  text,
  x: 0.5,
  y,
  w: 0.84,
  size: o.size ?? 150,
  weight: 900,
  font: "display",
  color: o.color ?? "text",
  align: "center",
  uppercase: true,
  emphasis_words: o.style && o.style !== "none" ? text : "",
  emphasis_style: o.style ?? "none",
  animate: [anim(o.style === "strike" ? "fadeUp" : "pop", o.at ?? 0), ...(o.style === "strike" ? [anim("strike", (o.at ?? 0) + 0.5)] : [])],
});

const between = (task: string, tag: string) => task.match(new RegExp(`<${tag}>\\n?([\\s\\S]*?)\\n?</${tag}>`))?.[1]?.trim() ?? "";
const spokenOf = (task: string) => task.match(/Lo que dice la persona(?: en el tramo)?: "([^"]*)"/)?.[1] ?? "";
const quoted = (text: string) => text.match(/[“"'‘]([^"”'’]{2,90})["”'’]/)?.[1]?.trim() ?? null;
const cap = (t: string) => (t ? t[0]!.toUpperCase() + t.slice(1) : t);
const firstWords = (t: string, n: number) => t.replace(/[.?!…]+$/, "").split(/\s+/).filter(Boolean).slice(0, n).join(" ");
const listAfterColon = (request: string) => {
  const part = request.includes(":") ? request.slice(request.indexOf(":") + 1) : request;
  return part
    .split(/,|\by\b|→|->|>/)
    .map((x) => x.replace(/[.]+$/, "").trim())
    .filter(Boolean)
    .slice(0, 5);
};
const fakeFmt = (n: number) => (n >= 1e6 ? `${Math.round(n / 1e5) / 10}M` : n >= 10000 ? `${Math.round(n / 100) / 10}K` : String(n));

function fakeIcon(text: string): string {
  const t = text.toLowerCase();
  for (const [name, tags] of Object.entries(ICON_TAGS)) if (tags?.split(/,\s*/).some((tag) => tag.length > 3 && t.includes(tag.toLowerCase()))) return name;
  return "sparkles";
}

function fakeRefusal(request: string): { refusal: string; alternative: string } | null {
  if (/\b(logo|logotipo|nike|apple|instagram|whatsapp|tiktok|youtube|coca[- ]?cola|google)\b/i.test(request))
    return { refusal: "No podemos poner logos ni marcas de otras empresas en tus gráficos.", alternative: "Un ícono de mensaje que aparece con la frase 'Escríbeme'" };
  if (/\b(personas?|caras?|rostros?|gente|mujer|hombre|cuerpo|avatar|personaje)\b/i.test(request))
    return { refusal: "Los gráficos no incluyen personas ni caras: se arman con textos, íconos, cifras y formas de tu marca.", alternative: "Un ícono de usuarios que aparece con la frase 'Tu comunidad'" };
  if (/\b(foto|fotos|fotograf\w*|realista|video real|filmad\w*|imagen real)\b/i.test(request))
    return { refusal: "No generamos fotos ni videos realistas. Para eso usa una toma de stock o de tu biblioteca.", alternative: "Una palabra clave grande con la idea de este tramo" };
  return null;
}

function fakeSceneFor(request: string, spoken: string): FakeScene {
  const r = request.toLowerCase();
  const position: "top" | "bottom" = /\babajo\b/.test(r) ? "bottom" : "top";
  const nums = spokenNumbers(request);
  const said = spokenNumbers(spoken);
  if (/embudo/.test(r)) {
    const levels = request
      .split(/→|->|>|,/)
      .map((x, i, all) => x.replace(i === 0 ? /^.*embudo\s*(de\s*)?/i : /$^/, "").replace(i === all.length - 1 ? /\s+que\s.*$/i : /$^/, "").trim())
      .filter(Boolean)
      .slice(0, 5);
    return { title: "Embudo", mode: "full", position, layers: [fakeComp("funnel", { title: "", levels: (levels.length >= 2 ? levels : ["Seguidores", "Conversaciones", "Clientes"]).map((label) => ({ label: cap(label), value: "" })) })] };
  }
  if (/\b(dm|notificaci|mensaje directo|mensaje)\b/.test(r)) {
    return { title: "Mensaje directo", mode: "overlay", position, layers: [fakeComp("dmNotification", { name: "Nuevo cliente", message: quoted(request) ?? firstWords(spoken, 10), app: "Mensajes", time: "ahora", typing: true, stack: 1 })] };
  }
  if (/barras?/.test(r)) {
    const values = nums.length >= 2 ? nums.slice(0, 6) : said.slice(0, 6);
    const title = request.match(/\d+\s+([a-záéíóúñ ]{4,40})$/i)?.[1]?.trim() ?? "";
    const bars = values.length === 2 ? [{ label: "Antes", value: values[0] }, { label: "Ahora", value: values[1] }] : values.map((v, i) => ({ label: `#${i + 1}`, value: v }));
    if (bars.length >= 2) return { title: "Barras que suben", mode: "full", position, layers: [fakeComp("barChart", { title: cap(title), bars, prefix: "", suffix: "", highlight: -1 })] };
  }
  if (/check|tild|palom/.test(r)) return { title: "Checklist", mode: "full", position, layers: [fakeComp("checklist", { title: "", items: listAfterColon(request).map(cap) })] };
  if (/tachad/.test(r)) {
    const caps = request.match(/\b[A-ZÁÉÍÓÚÑ]{3,}\b/g) ?? [];
    const [off, on] = [caps[0] ?? "ANTES", caps[1] ?? "AHORA"];
    return { title: `${cap(off.toLowerCase())} tachado`, mode: "full", position, layers: [fakeText(off, 0.38, { color: "muted", style: "strike" }), fakeText(on, 0.54, { color: "accent", size: 170, at: 0.95 })] };
  }
  if (/\bde\s+\S+\s+a\s+\S+/.test(r) && nums.length >= 2) {
    return { title: "Antes y después", mode: "full", position, layers: [fakeComp("beforeAfter", { from: fakeFmt(nums[0]!), to: fakeFmt(nums[1]!), fromLabel: "Antes", toLabel: "Ahora", label: firstWords(request.replace(/^.*?\d+\s+a\s+\d+\s*/i, ""), 5) })] };
  }
  if (/porcentaje|progreso|anillo/.test(r)) {
    const v = (nums.length ? nums : said).find((n) => n > 0 && n <= 100);
    if (v != null) return { title: "Progreso", mode: "full", position, layers: [fakeComp("progress", { value: v, style: /barra/.test(r) ? "bar" : "ring", label: firstWords(spoken, 7), eyebrow: "" })] };
  }
  if (/n[uú]mero|cifra|contador/.test(r)) {
    const v = said[0] ?? nums[0];
    if (v != null) return { title: "Cifra", mode: "full", position, layers: [fakeComp("statCard", { value: fakeFmt(v), label: firstWords(spoken, 6), eyebrow: "", icon: "" })] };
  }
  if (/lista|puntos/.test(r)) return { title: "Lista", mode: "full", position, layers: [fakeComp("list", { title: "", items: listAfterColon(request).map(cap), marker: "number", icons: [] })] };
  if (/pasos|flujo|proceso|sistema/.test(r)) {
    const steps = listAfterColon(request).map(cap).slice(0, 4);
    return { title: "Pasos", mode: "full", position, layers: [fakeComp("steps", { title: "", steps: steps.length >= 2 ? steps : ["Contenido", "Conversación", "Cierre"], icons: [] })] };
  }
  if (/compar|mito|versus|\bvs\b/.test(r)) return { title: "Comparación", mode: "full", position, layers: [fakeComp("comparison", { left: { label: "Antes", text: "Lo que hacías" }, right: { label: "Ahora", text: firstWords(spoken, 6) } })] };
  if (/l[ií]nea de tiempo|hitos/.test(r)) return { title: "Línea de tiempo", mode: "full", position, layers: [fakeComp("timeline", { title: "", items: listAfterColon(request).map((label) => ({ label: cap(label), caption: "" })) })] };
  if (/[ií]cono/.test(r)) return { title: "Ícono", mode: "overlay", position, layers: [fakeComp("iconBurst", { icon: fakeIcon(request), title: cap(quoted(request) ?? firstWords(spoken, 4)), caption: "" })] };
  if (/frase|cita/.test(r)) return { title: "Frase", mode: "overlay", position, layers: [fakeComp("quote", { text: cap(quoted(request) ?? firstWords(spoken, 10)), highlight: "", author: "" })] };
  const word = quoted(request) ?? [...spoken.replace(/[^\p{L}\p{N} ]/gu, "").split(" ")].sort((a, b) => b.length - a.length)[0] ?? "Idea";
  return { title: "Palabra clave", mode: "overlay", position, layers: [fakeComp("keyword", { text: cap(word.slice(0, 28)), label: "", emphasis: "marker" })] };
}

const toWire = (scene: unknown) => sceneToWire(scene as MotionSceneAi);
const toWireRequest = (r: { refusal: string; alternative: string; note: string }) => ({ ...toWire(r), refusal: r.refusal, alternative: r.alternative, note: r.note });

function fakeMotionRequest(task: string) {
  const request = between(task, "pedido");
  const refusal = fakeRefusal(request);
  if (refusal) return { title: "", mode: "full", position: "top", layers: [], note: "", ...refusal };
  return { ...fakeSceneFor(request, spokenOf(task)), refusal: "", alternative: "", note: "" };
}

function fakeMotionAdjust(task: string) {
  const request = between(task, "pedido");
  const refusal = fakeRefusal(request);
  let scene: FakeScene;
  try {
    scene = JSON.parse(between(task, "escena")) as FakeScene;
  } catch {
    return { ...fakeSceneFor(request, spokenOf(task)), refusal: "", alternative: "", note: "" };
  }
  if (refusal) return { ...scene, layers: [], note: "", ...refusal };
  const r = request.toLowerCase();
  const notes: string[] = [];
  const comps = scene.layers.filter((l) => l.kind === "component");
  const resize = (f: number) =>
    scene.layers.forEach((l) => {
      if (l.kind === "component") l.scale = Math.round(Math.min(1.4, Math.max(0.7, Number(l.scale ?? 1) * f)) * 100) / 100;
      else if (typeof l.size === "number") l.size = Math.round(l.size * f);
    });
  if (/m[aá]s grande|agranda|grande/.test(r)) resize(1.22);
  if (/m[aá]s (chico|peque)|achica/.test(r)) resize(0.85);
  if (/arriba/.test(r)) {
    scene.position = "top";
    comps.forEach((l) => (l.place = "top"));
  }
  if (/abajo/.test(r)) {
    scene.position = "bottom";
    comps.forEach((l) => (l.place = "bottom"));
  }
  if (/pantalla completa/.test(r)) scene.mode = "full";
  if (/sobre (el|mi) video|encima/.test(r)) scene.mode = "overlay";
  if (/flecha.*sub|que suba/.test(r)) {
    const ba = comps.find((l) => l.component === "beforeAfter");
    if (ba) {
      const p = ba.props as { from: string; to: string; fromLabel: string; toLabel: string; label: string };
      const num = (v: string) => Number(v.replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
      Object.assign(ba, { component: "barChart", props: { title: cap(p.label), bars: [{ label: p.fromLabel || "Antes", value: num(p.from) }, { label: p.toLabel || "Ahora", value: num(p.to) }], prefix: "", suffix: "", highlight: -1 } });
      notes.push("La flecha de ese gráfico siempre va hacia la derecha: lo cambié por barras que suben.");
    } else notes.push("Este gráfico no tiene una flecha que se pueda girar; dejé el resto igual.");
  }
  const text = quoted(request);
  if (text && /dig|texto|cambi|pon/.test(r)) {
    const main = comps[0]?.props as Record<string, unknown> | undefined;
    const key = main ? (["message", "text", "title", "label", "value"].find((k) => typeof main[k] === "string") ?? null) : null;
    if (main && key) main[key] = text;
    else {
      const t = scene.layers.find((l) => l.kind === "text");
      if (t) t.text = text;
    }
  }
  if (/m[aá]s r[aá]pido/.test(r)) scene.layers.forEach((l) => (l.at = 0));
  if (/m[aá]s lento|despu[eé]s|tarde/.test(r)) comps.forEach((l) => (l.at = Math.min(1.2, Number(l.at ?? 0) + 0.4)));
  return { ...scene, refusal: "", alternative: "", note: notes.join(" ") };
}

function fakeMotionRetry(task: string) {
  const scenes = [...task.matchAll(/- Escena:\n(\{.*\})\n/g)].map((m) => {
    try {
      return JSON.parse(m[1]!) as FakeScene;
    } catch {
      return null;
    }
  });
  const shrinkText = (v: unknown): unknown => {
    if (typeof v === "string") return v.length > 18 ? firstWords(v, Math.max(2, Math.ceil(v.split(" ").length * 0.6))) : v;
    if (Array.isArray(v)) return v.slice(0, 4).map(shrinkText);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shrinkText(x)]));
    return v;
  };
  return {
    graphics: scenes.map((s) =>
      s
        ? {
            ...s,
            mode: "full",
            layers: s.layers.slice(0, 3).map((l) => (l.kind === "component" ? { ...l, scale: 0.9, props: shrinkText(l.props) } : { ...l, text: typeof l.text === "string" ? shrinkText(l.text) : l.text, size: typeof l.size === "number" ? l.size * 0.85 : l.size })),
          }
        : { title: "", mode: "overlay", position: "top", layers: [fakeComp("keyword", { text: "Idea clave", label: "", emphasis: "marker" })] },
    ),
  };
}

/** Plan del b-roll con escenas v2: como fakeBrollPlan, pero los gráficos ya son escenas del motor. */
function fakeBrollMotionPlan(task: string) {
  const plan = fakeBrollPlan(task);
  const frases = [...task.matchAll(/^F\d+ \[(\d+)–(\d+)\] [\d.]+ s \([\d.]+–[\d.]+\): (.*)$/gm)].map((m) => ({ from: Number(m[1]), to: Number(m[2]), text: m[3]! }));
  return {
    broll: plan.broll.map((b, n) => {
      if (b.kind !== "graphic" || !b.graphic) return { ...b, graphic: null };
      const text = frases.find((f) => f.from <= b.from_word && b.from_word <= f.to)?.text ?? "";
      const nums = spokenNumbers(text);
      const clean = text.replace(/^(eh|em|este)\s+/i, "").replace(/[.?!…]+$/, "").trim();
      const g = b.graphic as { template: string; items?: string[]; item_labels?: string[]; headline?: string };
      let scene: FakeScene;
      if (g.template === "number" && /\bde\s+\S+\s+a\s+\S+/i.test(text) && nums.length >= 2) {
        const rest = clean.replace(/^.*?\ba\s+\S+\s*/i, "");
        scene = { title: "Antes y después", mode: "full", position: "top", layers: [fakeComp("beforeAfter", { from: fakeFmt(nums[0]!), to: fakeFmt(nums[1]!), fromLabel: "Antes", toLabel: "Ahora", label: firstWords(rest, 6) })] };
      } else if (g.template === "number") {
        scene = { title: "Cifra", mode: "full", position: "top", layers: [fakeComp("statCard", { value: g.headline ?? fakeFmt(nums[0] ?? 2), label: firstWords(clean, 6), eyebrow: "", icon: fakeIcon(clean) === "sparkles" ? "" : fakeIcon(clean) })] };
      } else if (g.template === "compare") {
        scene = { title: "Comparación", mode: "full", position: "top", layers: [fakeComp("comparison", { left: { label: g.item_labels?.[0] ?? "Antes", text: g.items?.[0] ?? "" }, right: { label: g.item_labels?.[1] ?? "Ahora", text: g.items?.[1] ?? "" } })] };
      } else if (/\b(precio|pregunt)/i.test(clean) && n % 2 === 0) {
        scene = { title: "Pasos", mode: "full", position: "top", layers: [fakeComp("steps", { title: "", steps: ["Pregunta", "Escucha", "Propón"], icons: ["search", "mic", "handshake"] })] };
      } else if (n % 2 === 0) {
        scene = { title: "Frase", mode: "overlay", position: "top", layers: [fakeComp("quote", { text: firstWords(cap(clean), 11), highlight: g.headline ? "" : "", author: "" })] };
      } else {
        const word = [...clean.split(" ")].sort((a, x) => x.length - a.length)[0]?.replace(/[^\p{L}\p{N}]/gu, "") ?? "Idea";
        scene = { title: "Palabra clave", mode: "overlay", position: "top", layers: [fakeComp("keyword", { text: cap(word), label: "", emphasis: "marker" })] };
      }
      return { ...b, graphic: scene };
    }),
  };
}

/**
 * Clips desde un video largo: elige los candidatos con mejor puntaje de reglas (la cantidad pedida), arranca en la
 * primera palabra que no es conector y arma título, gancho y explicación con lo que se dice en el tramo.
 */
function fakeClipMoments(task: string) {
  const count = Number(task.match(/idealmente (\d+)/)?.[1] ?? 5);
  const cands = [...task.matchAll(/^### (C\d+) \[(\d+)–(\d+)\] [^\n]*?reglas (\d+)\/100 · (\d+) preguntas · (\d+) cifras[^\n]*\nANTES: [^\n]*\nCLIP: ([^\n]*)/gm)].map((m) => ({
    id: m[1]!,
    from: Number(m[2]),
    to: Number(m[3]),
    rule: Number(m[4]),
    questions: Number(m[5]),
    numbers: Number(m[6]),
    words: m[7]!.split(" ").map((t) => ({ id: Number(t.split(":")[0]), text: t.slice(t.indexOf(":") + 1) })),
  }));
  const picked = [...cands].sort((a, b) => b.rule - a.rule).slice(0, Math.min(10, Math.max(count, 0)));
  const connector = /^(y|pero|entonces|eh|em|bueno|este)$/i;
  return {
    clips: picked.map((c, i) => {
      let k = 0;
      while (k < c.words.length - 1 && k < 6 && connector.test(c.words[k]!.text.replace(/[^\p{L}]/gu, ""))) k++;
      const text = c.words.slice(k).map((w) => w.text);
      const firstSentence = text.slice(0, Math.max(4, text.findIndex((t) => /[.?!]$/.test(t)) + 1)).join(" ");
      const short = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, t.lastIndexOf(" ", max - 1))}…`);
      return {
        candidate: c.id,
        from_word: c.words[k]!.id,
        to_word: c.to,
        title: short(firstSentence.replace(/[¿?¡!.,]/g, ""), 58),
        hook_text: short(firstSentence, 68),
        reason:
          c.questions > 0
            ? "Abre con una pregunta que tu audiencia se hace y la responde completa antes de cerrar."
            : c.numbers > 0
              ? "Da un dato concreto con cifras y lo explica sin depender de lo que se dijo antes."
              : "Plantea una idea completa con un cierre claro: se entiende sin contexto.",
        hook_type: /[¿?]/.test(firstSentence) ? "pregunta" : /\d|mil/.test(firstSentence) ? "resultado" : "contraste",
        ai_score: Math.max(40, 92 - i * 6),
      };
    }),
    note: "",
  };
}
