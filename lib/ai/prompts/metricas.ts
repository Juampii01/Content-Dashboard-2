import { z } from "zod";

/** "¿Por qué funcionó?": diagnóstico de una pieza con sus números contra los de sus pares. */
export const pieceAnalysisSchema = z.object({
  verdict: z.string().describe("Una frase directa con el diagnóstico (ej. 'Funcionó por el gancho de contraste y porque se guardó el doble que tus otros reels')."),
  drivers: z
    .array(
      z.object({
        factor: z.string().describe("Qué influyó, en 2 a 5 palabras (ej. 'Gancho de contraste', 'Retención en los primeros 3 s')."),
        evidence: z.string().describe("El dato que lo prueba, con números de los que te pasaron. Si es una hipótesis sin dato, dilo."),
        effect: z.enum(["positivo", "negativo"]),
      }),
    )
    .describe("2 a 4 factores, el más importante primero."),
  hook: z.string().describe("Análisis del gancho o la primera línea: qué tipo es y por qué atrapa o no. Una o dos frases."),
  lessons: z.array(z.string()).describe("3 aprendizajes accionables para las próximas piezas, en imperativo y concretos."),
  ideas: z
    .array(z.object({ title: z.string(), hook: z.string().describe("El gancho dicho tal cual, listo para grabar."), angle: z.string().describe("Qué cambia respecto de esta pieza, en una frase.") }))
    .describe("3 ideas nuevas que aprovechan lo que funcionó (o corrigen lo que falló), sin repetir el mismo tema."),
});
export type PieceAnalysisDraft = z.infer<typeof pieceAnalysisSchema>;

export const ANALYSIS_RULES = `Eres el analista de contenido de este creador. Explicas con datos por qué una pieza rindió como rindió y qué hacer distinto.

REGLAS
- Usa SOLO los números que te pasan. Nunca inventes cifras, porcentajes ni comparaciones. Si un dato no está, no lo supongas.
- Compara siempre contra la mediana de sus piezas del mismo tipo y red: eso dice si algo fue bueno o malo para ESTA cuenta.
- Separa lo que muestran los datos de lo que es hipótesis (por ejemplo, sobre el gancho sin haber visto el video: di "por el texto, parece…").
- Cero frases de manual ("aporta valor", "conecta con tu audiencia", "sé constante"). Cada aprendizaje tiene que poder aplicarse en el próximo guion.
- Si la pieza rindió por debajo, el diagnóstico es honesto y útil, sin suavizarlo.
- Español neutro (trato de "tú", sin voseo, "video" sin tilde), salvo que la marca indique otro idioma.
- Responde solo con el JSON del esquema.`;

type Metric = { label: string; value: number | null; median: number | null; unit?: "%" | "s" };

export function pieceAnalysisTask(input: {
  platform: string;
  type: string;
  publishedAt: string;
  durationSec: number | null;
  title: string;
  caption: string | null;
  ratio: number | null;
  peerCount: number;
  metrics: Metric[];
  retention: string | null;
  growth: string | null;
}): string {
  const fmt = (v: number | null, unit?: string) => (v == null ? "sin dato" : unit === "%" ? `${(v * 100).toFixed(1)} %` : unit === "s" ? `${v.toFixed(1)} s` : Math.round(v).toLocaleString("es-MX"));
  return `PIEZA A ANALIZAR
Red y tipo: ${input.platform} · ${input.type}
Publicada: ${input.publishedAt}${input.durationSec ? ` · duración ${Math.round(input.durationSec)} s` : ""}
Título o primera línea: ${input.title}
Texto completo:
<caption>
${(input.caption ?? "(sin texto)").slice(0, 2200)}
</caption>

RENDIMIENTO (contra la mediana de sus ${input.peerCount} ${input.type} de ${input.platform} de los últimos 180 días)
Visualizaciones a los 7 días: ${input.ratio == null ? "todavía no hay comparación" : `×${input.ratio.toFixed(2)} la mediana`}
${input.metrics.map((m) => `- ${m.label}: ${fmt(m.value, m.unit)} (mediana ${fmt(m.median, m.unit)})`).join("\n")}
${input.retention ? `\nRETENCIÓN (porcentaje de la audiencia que sigue mirando en cada punto del video)\n${input.retention}` : ""}
${input.growth ? `\nCRECIMIENTO DE VISUALIZACIONES\n${input.growth}` : ""}

TAREA
Explica por qué esta pieza rindió así y qué conviene repetir o cambiar. Después propone 3 ideas nuevas con su gancho.`;
}

/** Clasificación del tipo de gancho de cada pieza, a partir de su primera línea. */
export const HOOK_CATEGORIES = ["contraste", "curiosidad", "dolor", "resultado", "historia", "pregunta", "lista", "otro"] as const;
export type HookCategory = (typeof HOOK_CATEGORIES)[number];

export const hookClassificationSchema = z.object({
  items: z.array(
    z.object({
      n: z.number().int().describe("El número de la pieza (#n)."),
      type: z.enum(HOOK_CATEGORIES),
      hook: z.string().describe("El gancho tal cual aparece (la primera frase), máximo 120 caracteres."),
    }),
  ),
});

export const HOOK_RULES = `Clasificas el gancho (la primera frase) de piezas de redes sociales de un creador.

TIPOS
- contraste: contradice una creencia o una práctica común ("Deja de…", "Nadie te dice que…", "El error de…").
- curiosidad: abre una intriga sin resolverla ("Esto cambió todo…", "Lo que descubrí…").
- dolor: nombra un problema o frustración de la audiencia.
- resultado: promete o muestra un resultado concreto, con cifra o transformación.
- historia: arranca contando algo que pasó ("Mi primer cliente…", "Ayer…").
- pregunta: empieza con una pregunta directa a la audiencia.
- lista: anuncia una cantidad de ítems o pasos ("3 errores…", "5 herramientas…").
- otro: no tiene gancho claro (solo hashtags, saludo, texto genérico) o no se puede saber.

REGLAS
- Si encaja en varios, elige el que más pesa en la primera frase.
- Responde un ítem por cada pieza recibida, con su mismo número. Solo el JSON del esquema.`;
