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
    .filter((f) => f.dur >= 3 && f.dur <= 8 && ![...Array(f.to - f.from + 1).keys()].some((k) => cut.has(f.from + k)))
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
    case "video.plan":
      return fakeVideoPlan(task);
    default:
      throw new Error(`Sin respuesta simulada para ${feature}`);
  }
}
