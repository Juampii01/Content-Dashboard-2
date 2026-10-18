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

export function fakeResponse(feature: string): unknown {
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
    default:
      throw new Error(`Sin respuesta simulada para ${feature}`);
  }
}
