import "server-only";
/**
 * Carruseles de ejemplo para la demo de venta. Llevan `demo = true`: se borran con clearCarouselDemo()
 * sin tocar los carruseles reales del cliente. No usan cifras presentadas como reales: los números
 * están en su propio texto de origen y se presentan como ejemplo.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { CarouselSlide } from "@/lib/db/schema";

type DemoCarousel = Omit<typeof schema.carousels.$inferInsert, "id" | "demo">;

const s = (id: string, slide: Omit<CarouselSlide, "id" | "template">): CarouselSlide => ({ id, template: null, ...slide });

const demos: DemoCarousel[] = [
  {
    title: "5 errores que te hacen perder clientes en la primera llamada",
    topic: "Los errores más comunes en la primera llamada de venta y qué decir en cambio",
    status: "READY",
    template: "editorial",
    theme: { palette: "marca" },
    ctaKeyword: "GUION",
    sourceText: "Ejemplo: de 3 de cada 10 llamadas agendadas a 6 de cada 10 cambiando solo el orden de la conversación.",
    slides: [
      s("demo1-01", { type: "cover", kicker: "Ventas por teléfono", headline: "5 errores que espantan clientes en la primera llamada", highlight: "espantan clientes", body: "", cta: "" }),
      s("demo1-02", { type: "item", kicker: "Error #1", headline: "Hablar del precio antes de entender el problema", highlight: "precio", body: "Si lo primero que escucha es un número, te compara con el más barato y cuelga.", cta: "" }),
      s("demo1-03", { type: "item", kicker: "Error #2", headline: "Hacer preguntas que se responden con sí o no", highlight: "sí o no", body: "Cambia “¿Te interesa?” por “¿Qué te hizo buscar ayuda justo ahora?”.", cta: "" }),
      s("demo1-04", { type: "item", kicker: "Error #3", headline: "Llenar los silencios por nervios", highlight: "silencios", body: "Después de una pregunta importante, cállate. El que habla primero, cede.", cta: "" }),
      s("demo1-05", { type: "item", kicker: "Error #4", headline: "Explicar todo tu servicio en la primera llamada", highlight: "todo", body: "Cuenta solo la parte que resuelve lo que te dijo. El resto, después.", cta: "" }),
      s("demo1-06", { type: "item", kicker: "Error #5", headline: "Cortar sin una próxima fecha agendada", highlight: "próxima fecha", body: "Toda llamada termina con un día y una hora en el calendario de los dos.", cta: "" }),
      s("demo1-07", { type: "data", kicker: "Ejemplo", headline: "De 3 de cada 10 a 6 de cada 10 citas agendadas", highlight: "6 de cada 10", body: "Solo cambiando el orden: primero escuchar, después explicar.", cta: "" }),
      s("demo1-08", { type: "cta", kicker: "Guion gratis", headline: "¿Quieres el guion exacto de mi primera llamada?", highlight: "guion exacto", body: "Te lo mando por mensaje directo, sin costo.", cta: "Comenta GUION" }),
    ],
    caption:
      "La primera llamada no se gana explicando. Se gana escuchando 👇\n\nEstos son los 5 errores que más clientes cuestan, y lo que conviene decir en cambio.\n\nGuárdalo para tu próxima llamada y comenta GUION si quieres el guion completo.",
    hashtags: ["#ventas", "#emprendedores", "#marcapersonal", "#llamadasdeventa", "#negocios"],
  },
  {
    title: "Cómo planear un mes de contenido en 2 horas",
    topic: "Método para planear un mes de contenido en una sola sesión de 2 horas",
    status: "DRAFT",
    template: "lista",
    theme: { palette: "carbon", font: "montserrat" },
    ctaKeyword: null,
    sourceText: "Método de 2 horas: 30 minutos para juntar 20 ideas, 30 para ganchos, 45 para guiones y 15 para el calendario. 12 piezas al mes.",
    slides: [
      s("demo2-01", { type: "cover", kicker: "Método", headline: "Planea un mes de contenido en solo 2 horas", highlight: "2 horas", body: "", cta: "" }),
      s("demo2-02", { type: "step", kicker: "30 minutos", headline: "Junta 20 ideas sin filtrarlas", highlight: "20 ideas", body: "Preguntas de tus clientes, errores que ves todos los días y opiniones que nadie dice.", cta: "" }),
      s("demo2-03", { type: "step", kicker: "30 minutos", headline: "Escribe un gancho para cada idea", highlight: "gancho", body: "Si no se te ocurre un gancho en un minuto, esa idea todavía no está lista.", cta: "" }),
      s("demo2-04", { type: "step", kicker: "45 minutos", headline: "Elige las 12 mejores y arma el guion", highlight: "12 mejores", body: "Gancho, tres puntos y un cierre. No más de cinco líneas por pieza.", cta: "" }),
      s("demo2-05", { type: "step", kicker: "15 minutos", headline: "Ponlas en el calendario por pilar", highlight: "por pilar", body: "Alterna temas para que tu audiencia no vea lo mismo dos días seguidos.", cta: "" }),
      s("demo2-06", { type: "quote", kicker: "La regla", headline: "Planear es decidir antes de tener que improvisar", highlight: "improvisar", body: "", cta: "" }),
      s("demo2-07", { type: "cta", kicker: "Antes de irte", headline: "Guarda este carrusel para tu próxima sesión", highlight: "Guarda", body: "Y compártelo con quien siempre publica a último momento.", cta: "Guárdalo y compártelo" }),
    ],
    caption:
      "Dos horas. Un mes de contenido. Sin improvisar cada mañana.\n\n30 minutos de ideas, 30 de ganchos, 45 de guiones y 15 para el calendario.\n\nGuárdalo para tu próxima sesión de planeación.",
    hashtags: ["#contenido", "#marcapersonal", "#creadoresdecontenido", "#productividad", "#instagramtips"],
  },
];

export async function loadCarouselDemo(): Promise<{ created: number }> {
  const db = getDb();
  await clearCarouselDemo();
  await db.insert(schema.carousels).values(demos.map((d) => ({ ...d, demo: true })));
  return { created: demos.length };
}

export async function clearCarouselDemo(): Promise<{ deleted: number }> {
  const rows = await getDb().delete(schema.carousels).where(eq(schema.carousels.demo, true)).returning({ id: schema.carousels.id });
  return { deleted: rows.length };
}
