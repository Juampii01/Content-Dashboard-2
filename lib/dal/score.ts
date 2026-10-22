import "server-only";
import { sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { firstLine } from "@/lib/metrics/hooks";
import type { HistoryPiece, HookKind } from "@/lib/scripts/score";

const HOOK_KINDS = new Set<string>(["contraste", "curiosidad", "dolor", "resultado", "historia", "pregunta", "lista", "otro"]);

/**
 * Historial para el puntaje antes de publicar: piezas de video del último año que ya tienen
 * "× tu mediana". Los cálculos se hacen en el navegador (lib/scripts/score.ts), así el puntaje
 * se mueve al escribir sin volver a consultar la base.
 */
export async function getScoreHistory(): Promise<HistoryPiece[]> {
  await getCurrentUser();
  const result = await getDb().execute<{
    id: string;
    platform: HistoryPiece["platform"];
    type: HistoryPiece["type"];
    hook_type: string | null;
    title: string | null;
    caption: string | null;
    duration_sec: number | null;
    perf_score: number;
    views: number | null;
  }>(sql`
    select id, platform, type, hook_type, title, caption, duration_sec, perf_score, views
    from content_items
    where available and perf_score is not null and type in ('REEL', 'VIDEO', 'SHORT')
      and published_at > now() - interval '365 days'
    order by published_at desc
    limit 800
  `);
  return result.rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    type: r.type,
    hookType: r.hook_type && HOOK_KINDS.has(r.hook_type) ? (r.hook_type as HookKind) : null,
    text: firstLine(r.title, r.caption).slice(0, 160),
    durationSec: r.duration_sec == null ? null : Number(r.duration_sec),
    perf: Number(r.perf_score),
    views: r.views == null ? null : Number(r.views),
  }));
}
