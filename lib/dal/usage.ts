import "server-only";
import { sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { stepLabel } from "@/lib/ai/steps";
import { getDb } from "@/lib/db";

/**
 * Consumo de IA para Ajustes → Consumo (solo el dueño). Lee api_usage: total, por video y por paso, en un periodo.
 * Nunca devuelve claves ni textos de la IA: solo números.
 */
export type UsageTotals = { usd: number; calls: number; failed: number; byModel: { model: string; usd: number; calls: number }[] };
export type VideoUsage = { videoId: string; title: string; durationSec: number | null; usd: number; calls: number; usdPerMinute: number | null; lastAt: Date };
export type StepUsage = { step: string; label: string; usd: number; calls: number; avgUsd: number; share: number };
export type UsageView = { allowed: true; days: number; totals: UsageTotals; videos: VideoUsage[]; steps: StepUsage[] } | { allowed: false };

export const USAGE_PERIODS = [7, 30, 90] as const;

export async function getUsageView(days: number): Promise<UsageView> {
  const me = await getCurrentUser();
  if (me.role !== "OWNER") return { allowed: false };
  const d = (USAGE_PERIODS as readonly number[]).includes(days) ? days : 30;
  const since = sql`now() - make_interval(days => ${d})`;
  const db = getDb();
  const [totals, models, videos, steps] = await Promise.all([
    db.execute<{ usd: number; calls: number; failed: number }>(sql`
      select coalesce(sum(cost_usd), 0)::float as usd, count(*)::int as calls, count(*) filter (where status <> 'ok')::int as failed
      from api_usage where created_at > ${since}`),
    db.execute<{ model: string; usd: number; calls: number }>(sql`
      select model, coalesce(sum(cost_usd), 0)::float as usd, count(*)::int as calls
      from api_usage where created_at > ${since} group by model order by 2 desc`),
    db.execute<{ video_id: string; title: string | null; duration: number | null; usd: number; calls: number; last_at: Date | string }>(sql`
      select u.video_id, p.title, coalesce(max(u.video_duration_sec), nullif(p.media->>'duration', '')::float) as duration,
        sum(u.cost_usd)::float as usd, count(*)::int as calls, max(u.created_at) as last_at
      from api_usage u join video_projects p on p.id = u.video_id
      where u.created_at > ${since}
      group by u.video_id, p.title, p.media
      order by usd desc limit 50`),
    db.execute<{ step: string; usd: number; calls: number }>(sql`
      select step, coalesce(sum(cost_usd), 0)::float as usd, count(*)::int as calls
      from api_usage where created_at > ${since} group by step order by 2 desc`),
  ]);
  const t = totals.rows[0] ?? { usd: 0, calls: 0, failed: 0 };
  const total = Number(t.usd);
  // Varios pasos técnicos comparten etiqueta (por ejemplo, los gráficos): se suman.
  const byLabel = new Map<string, StepUsage>();
  for (const r of steps.rows) {
    const label = stepLabel(r.step);
    const cur = byLabel.get(label) ?? { step: r.step, label, usd: 0, calls: 0, avgUsd: 0, share: 0 };
    cur.usd += Number(r.usd);
    cur.calls += Number(r.calls);
    byLabel.set(label, cur);
  }
  return {
    allowed: true,
    days: d,
    totals: { usd: total, calls: Number(t.calls), failed: Number(t.failed), byModel: models.rows.map((m) => ({ model: m.model, usd: Number(m.usd), calls: Number(m.calls) })) },
    videos: videos.rows.map((v) => {
      const duration = v.duration == null ? null : Number(v.duration);
      return {
        videoId: v.video_id,
        title: v.title?.trim() || "Video sin título",
        durationSec: duration,
        usd: Number(v.usd),
        calls: Number(v.calls),
        usdPerMinute: duration && duration > 0 ? Number(v.usd) / (duration / 60) : null,
        lastAt: new Date(v.last_at),
      };
    }),
    steps: [...byLabel.values()]
      .map((s) => ({ ...s, avgUsd: s.calls ? s.usd / s.calls : 0, share: total > 0 ? s.usd / total : 0 }))
      .sort((a, b) => b.usd - a.usd),
  };
}
