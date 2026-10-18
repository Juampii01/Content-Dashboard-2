import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { PieceAnalysis } from "@/lib/db/schema";
import { generateStructured } from "@/lib/ai/client";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { ANALYSIS_RULES, pieceAnalysisSchema, pieceAnalysisTask } from "@/lib/ai/prompts/metricas";
import { typeLabel } from "@/lib/metrics/labels";
import { platformLabel } from "@/lib/social/types";
import { formatDate } from "@/lib/format";

type Medians = { n: number; views7d: number | null; reach: number | null; er: number | null; saves: number | null; shares: number | null; comments: number | null; avp: number | null; skip: number | null; avgWatch: number | null; follows: number | null };

/**
 * Analiza una pieza con IA y guarda el resultado en la propia pieza (se muestra sin volver a pagar).
 * Compara cada métrica contra la mediana de sus pares (misma red y tipo, últimos 180 días).
 */
export async function analyzePiece(id: string, userId: string): Promise<PieceAnalysis> {
  const db = getDb();
  const [item] = await db.select().from(schema.contentItems).where(eq(schema.contentItems.id, id)).limit(1);
  if (!item) throw new Error("pieza no encontrada");

  const peers = await db.execute<Record<keyof Medians, number | null>>(sql`
    select count(*)::int as n,
      percentile_cont(0.5) within group (order by coalesce(views_7d, views)) as "views7d",
      percentile_cont(0.5) within group (order by reach) as reach,
      percentile_cont(0.5) within group (order by (coalesce(likes,0) + coalesce(comments,0) + coalesce(shares,0) + coalesce(saves,0))::float / nullif(views, 0)) as er,
      percentile_cont(0.5) within group (order by saves::float / nullif(views, 0)) as saves,
      percentile_cont(0.5) within group (order by shares::float / nullif(views, 0)) as shares,
      percentile_cont(0.5) within group (order by comments::float / nullif(views, 0)) as comments,
      percentile_cont(0.5) within group (order by avg_view_percentage) as avp,
      percentile_cont(0.5) within group (order by skip_rate) as skip,
      percentile_cont(0.5) within group (order by avg_watch_sec) as "avgWatch",
      percentile_cont(0.5) within group (order by coalesce(follows, subscribers_gained)) as follows
    from content_items
    where platform = ${item.platform} and type = ${item.type} and available and id <> ${id}
      and published_at > now() - interval '180 days' and published_at < now() - interval '7 days'
  `);
  const m = peers.rows[0] as unknown as Medians;
  const num = (v: unknown) => (v == null ? null : Number(v));
  const per = (v: number | null) => (v != null && item.views ? v / item.views : null);
  const interactions = (item.likes ?? 0) + (item.comments ?? 0) + (item.shares ?? 0) + (item.saves ?? 0);
  const compare = item.views7d ?? (Date.now() - item.publishedAt.getTime() > 7 * 86_400_000 ? item.views : null);
  const median7d = num(m.views7d);
  const ratio = compare != null && median7d ? compare / median7d : null;

  const metrics = [
    { label: "Visualizaciones", value: item.views, median: median7d },
    { label: "Alcance", value: item.reach, median: num(m.reach) },
    { label: "Tasa de interacción", value: item.views ? interactions / item.views : null, median: num(m.er), unit: "%" as const },
    { label: "Guardados por visualización", value: per(item.saves), median: num(m.saves), unit: "%" as const },
    { label: "Compartidos por visualización", value: per(item.shares), median: num(m.shares), unit: "%" as const },
    { label: "Comentarios por visualización", value: per(item.comments), median: num(m.comments), unit: "%" as const },
    { label: "Porcentaje visto", value: item.avgViewPercentage, median: num(m.avp), unit: "%" as const },
    { label: "Saltan en los primeros 3 s", value: item.skipRate, median: num(m.skip), unit: "%" as const },
    { label: "Tiempo medio visto", value: item.avgWatchSec, median: num(m.avgWatch), unit: "s" as const },
    { label: "Seguidores ganados", value: item.follows ?? item.subscribersGained, median: num(m.follows) },
  ].filter((x) => x.value != null);

  const [retention] = await db.select().from(schema.retentionCurves).where(eq(schema.retentionCurves.contentItemId, id)).limit(1);
  const retentionText = retention?.points.length
    ? retention.points
        .filter((_, i, all) => i % Math.max(1, Math.floor(all.length / 10)) === 0)
        .map((p) => `${Math.round(p.at * 100)} % del video: ${(p.ratio * 100).toFixed(0)} %`)
        .join(" · ")
    : null;
  const growthText = [item.views24h != null ? `24 h: ${item.views24h}` : null, item.views72h != null ? `72 h: ${item.views72h}` : null, item.views7d != null ? `7 días: ${item.views7d}` : null]
    .filter(Boolean)
    .join(" · ");

  const brand = await getBrand();
  const draft = await generateStructured({
    feature: "metricas.analisis",
    model: "main",
    context: `${ANALYSIS_RULES}\n\n${await brandContext(brand)}`,
    task: pieceAnalysisTask({
      platform: platformLabel[item.platform],
      type: typeLabel[item.type].toLowerCase(),
      publishedAt: formatDate(item.publishedAt),
      durationSec: item.durationSec,
      title: item.title ?? item.caption?.split("\n")[0] ?? "(sin título)",
      caption: item.caption,
      ratio,
      peerCount: Number(m.n ?? 0),
      metrics,
      retention: retentionText,
      growth: growthText || null,
    }),
    schema: pieceAnalysisSchema,
    maxTokens: 3000,
    userId,
  });

  const analysis: PieceAnalysis = { ...draft, ratio };
  await db.update(schema.contentItems).set({ aiAnalysis: analysis, aiAnalyzedAt: new Date() }).where(eq(schema.contentItems.id, id));
  return analysis;
}
