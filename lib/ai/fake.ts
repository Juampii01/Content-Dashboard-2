import "server-only";

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
          { type: "cover", kicker: "Clínicas dentales", headline: "Así pierdes pacientes en la primera llamada", highlight: "primera llamada", body: "", cta: "" },
          { type: "item", kicker: "Error #1", headline: "Dar el precio antes de escuchar", highlight: "precio", body: "Si lo primero que oye es un número, el paciente compara precios y cuelga.", cta: "" },
          { type: "item", kicker: "Error #2", headline: "Responder sin preguntar qué le pasa", highlight: "preguntar", body: "Pregunta qué le duele, desde cuándo y qué probó. Así sabe que lo escuchas.", cta: "" },
          { type: "step", kicker: "Lo que sí funciona", headline: "Repite lo que dijo con sus palabras", highlight: "sus palabras", body: "“Entonces te duele al masticar desde hace una semana.” Recién ahí hablas de la solución.", cta: "" },
          { type: "data", kicker: "Caso real", headline: "De 3 de cada 10 a 6 de cada 10 citas", highlight: "6 de cada 10", body: "Una clínica cambió solo el orden de la llamada y duplicó las citas agendadas en un mes.", cta: "" },
          { type: "quote", kicker: "Recuerda", headline: "La primera llamada se gana escuchando, no explicando", highlight: "escuchando", body: "", cta: "" },
          { type: "cta", kicker: "Guion de llamadas", headline: "¿Quieres el guion exacto para tu recepción?", highlight: "guion exacto", body: "Te lo mando gratis por mensaje directo.", cta: "Comenta AGENDA" },
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
    default:
      throw new Error(`Sin respuesta simulada para ${feature}`);
  }
}

/**
 * B-roll del Editor: elige frases "mostrables" repartidas en el video (ni la primera ni la última),
 * un tramo del largo pedido dentro de cada una, y arma la búsqueda con un diccionario chico.
 */
function fakeBrollPlan(task: string) {
  const count = Number(task.match(/CANTIDAD: (\d+)/)?.[1] ?? 2);
  const [minS, maxS] = (task.match(/DURACIÓN: ([\d.]+)–([\d.]+) s/)?.slice(1) ?? ["1.5", "3"]).map(Number) as [number, number];
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
  return {
    broll: picked.map((f) => {
      const words = f.to - f.from + 1;
      const take = Math.max(2, Math.min(words, Math.round((words * Math.min(f.dur, maxS)) / f.dur)));
      const hit = dictionary.find(([re]) => re.test(f.text));
      return {
        from_word: f.from,
        to_word: f.from + take - 1,
        query_en: hit?.[1] ?? "business office teamwork",
        keywords: [hit?.[2] ?? "oficina", ...f.text.toLowerCase().split(/[^a-záéíóúñ]+/).filter((w) => w.length > 5).slice(0, 2)],
        why: "La frase describe algo que se puede mostrar.",
      };
    }),
  };
}
