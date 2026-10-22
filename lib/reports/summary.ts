import "server-only";
import { aiConfigured, generateStructured } from "@/lib/ai/client";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { MONTHLY_RULES, monthlySummarySchema } from "@/lib/ai/prompts/informes";
import { formatDate } from "@/lib/format";
import { typeLabel } from "@/lib/metrics/labels";
import { platformLabel } from "@/lib/social/types";
import { addMonths, monthLabel } from "./month";
import type { MonthlyReportData, Pair, ReportPiece, ReportSummary } from "./types";

const fmt = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? "sin dato" : v.toLocaleString("es-MX", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const pair = (p: Pair, digits = 0, unit = "") => `${fmt(p.current, digits)}${p.current != null ? unit : ""} / ${fmt(p.previous, digits)}${p.previous != null ? unit : ""}`;
const piece = (p: ReportPiece) =>
  `[${platformLabel[p.platform]} ${typeLabel[p.type]}, ${formatDate(p.publishedAt, { withYear: false })}] ${p.title.slice(0, 140)} · ${fmt(p.views)} vistas · ${fmt(p.interactions)} interacciones${p.perfScore != null ? ` · ×${p.perfScore.toFixed(1)} su mediana` : ""}${p.why ? ` · análisis previo: ${p.why.slice(0, 200)}` : ""}`;

/** Tarea para la IA con las cifras del informe (exportada para la prueba: nada de números inventados). */
export function summaryTask(data: Omit<MonthlyReportData, "summary">): string {
  const label = monthLabel(data.month);
  const prev = monthLabel(addMonths(data.month, -1));
  const c = data.consistency;
  return `INFORME DE ${label.toUpperCase()}${data.partial ? ` (mes en curso, datos hasta el ${formatDate(data.to)})` : ""}
Comparación: ${label} / ${prev}${data.partial ? " (mismos días)" : ""}

TOTALES DE TODAS LAS REDES
- Seguidores al cierre: ${fmt(data.totals.followers)}
- Seguidores ganados: ${pair(data.totals.followersGained)}
- Publicaciones: ${pair(data.totals.pieces)}
- Visualizaciones de lo publicado: ${pair(data.totals.views)}
- Interacciones: ${pair(data.totals.interactions)}
- Tasa de interacción: ${pair(data.totals.engagementRate, 1, " %")}

POR RED
${data.platforms
  .map(
    (p) => `${platformLabel[p.platform]} (${p.handle})
- Seguidores al cierre: ${fmt(p.followers)} · ganados: ${pair(p.followersGained)}
- Publicaciones: ${pair(p.pieces)} · visualizaciones: ${pair(p.views)} · interacciones: ${pair(p.interactions)} · tasa: ${pair(p.engagementRate, 1, " %")}${p.notes.length ? `\n- Notas: ${p.notes.join(" ")}` : ""}`,
  )
  .join("\n")}

MEJORES PIEZAS DEL MES
${data.top.length ? data.top.map((p, i) => `${i + 1}. ${piece(p)}`).join("\n") : "(no hubo publicaciones)"}

PIEZA QUE MENOS FUNCIONÓ
${data.worst ? piece(data.worst) : "(no hay)"}

CONSTANCIA
- Piezas planeadas en el calendario: ${c.planned} · publicadas de esas: ${c.plannedPublished} · publicadas en total: ${c.published}
- Meta semanal: ${c.weeklyTarget} piezas · semanas: ${c.weeks.map((w) => `${formatDate(w.weekStart, { withYear: false })}: ${w.pieces}/${w.target}${w.partial ? " (semana incompleta)" : ""}`).join(", ")}
${c.goal ? `- Meta de seguidores: ${fmt(c.goal.followers)} (${c.goal.platform === "TOTAL" ? "todas las redes" : platformLabel[c.goal.platform]}) · hoy: ${fmt(c.goal.current)} · ritmo: ${fmt(c.goal.perDay, 1)} por día${c.goal.eta ? ` · llegada estimada: ${formatDate(c.goal.eta)}` : ""}` : "- Sin meta de seguidores definida"}

PRODUCCIÓN EN LA APP
- Guiones: ${data.production.scripts} · videos editados: ${data.production.videosEdited} · carruseles: ${data.production.carouselsCreated} · videos con clon: ${data.production.cloneVideos}

TAREA
Escribe el resumen del mes: 3 logros, 2 cosas a vigilar, 3 ideas para ${monthLabel(addMonths(data.month, 1), { lower: true, withYear: false })} y la lección de la pieza que menos funcionó.`;
}

/** Resumen con IA. null si la IA no está configurada o el mes no tiene datos para resumir. */
export async function writeSummary(data: Omit<MonthlyReportData, "summary">, userId: string | null): Promise<ReportSummary | null> {
  if (!aiConfigured()) return null;
  if (!data.totals.pieces.current && data.platforms.every((p) => p.followersGained.current == null)) return null;
  const brand = await getBrand();
  const draft = await generateStructured({
    feature: "informes.resumen",
    model: "main",
    context: `${MONTHLY_RULES}\n\n${await brandContext(brand)}`,
    task: summaryTask(data),
    schema: monthlySummarySchema,
    maxTokens: 3000,
    userId,
  });
  return {
    headline: draft.headline.trim(),
    wins: draft.wins.slice(0, 3),
    watch: draft.watch.slice(0, 2),
    ideas: draft.ideas.slice(0, 3),
    worstLesson: data.worst && draft.worstLesson.trim() ? draft.worstLesson.trim() : null,
  };
}
