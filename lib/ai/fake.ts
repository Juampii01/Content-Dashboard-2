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
    default:
      throw new Error(`Sin respuesta simulada para ${feature}`);
  }
}
