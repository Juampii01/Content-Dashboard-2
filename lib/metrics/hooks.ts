import "server-only";
import { inArray, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { aiConfigured, generateStructured } from "@/lib/ai/client";
import { HOOK_CATEGORIES, HOOK_RULES, hookClassificationSchema, type HookCategory } from "@/lib/ai/prompts/metricas";

export const hookLabel: Record<HookCategory, string> = {
  contraste: "Contraste",
  curiosidad: "Curiosidad",
  dolor: "Dolor",
  resultado: "Resultado",
  historia: "Historia",
  pregunta: "Pregunta",
  lista: "Lista",
  otro: "Sin gancho claro",
};

/** Primera frase útil del texto de una pieza: el título si lo hay, si no la primera línea con letras. */
export function firstLine(title: string | null, caption: string | null): string {
  const source = (title?.trim() || caption || "").split("\n").map((l) => l.trim()).find((l) => /\p{L}{3}/u.test(l)) ?? "";
  return source.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "").replace(/\s+/g, " ").trim().slice(0, 220);
}

/**
 * Clasifica el gancho de las piezas que todavía no lo tienen (de a lotes, con el modelo rápido).
 * Lo llama el cron después de sincronizar y el botón de Métricas. Devuelve cuántas clasificó.
 */
export async function classifyPendingHooks(maxPieces = 120): Promise<number> {
  if (!aiConfigured()) return 0;
  const db = getDb();
  const pending = await db.execute<{ id: string; title: string | null; caption: string | null }>(sql`
    select id, title, caption from content_items
    where hook_classified_at is null and coalesce(title, caption, '') <> ''
    order by published_at desc limit ${maxPieces}
  `);
  let done = 0;
  for (let i = 0; i < pending.rows.length; i += 40) {
    const batch = pending.rows.slice(i, i + 40).map((r) => ({ id: r.id, text: firstLine(r.title, r.caption) }));
    const withText = batch.filter((b) => b.text);
    const now = new Date();
    if (withText.length > 0) {
      const result = await generateStructured({
        feature: "metricas.ganchos",
        model: "fast",
        context: HOOK_RULES,
        task: withText.map((b, n) => `#${n + 1} ${b.text.replace(/\s+/g, " ")}`).join("\n"),
        schema: hookClassificationSchema,
        maxTokens: 4000,
      });
      const byN = new Map(result.items.map((it) => [it.n, it.type]));
      for (const [n, b] of withText.entries()) {
        // Si el modelo omitió una pieza, queda como "otro" para no reenviarla en cada corrida.
        const type = byN.get(n + 1) ?? "otro";
        await db.execute(sql`update content_items set hook_type = ${type}, hook_classified_at = ${now} where id = ${b.id}`);
        done++;
      }
    }
    // Las piezas sin texto se marcan para no volver a intentarlas.
    const empty = batch.filter((b) => !b.text).map((b) => b.id);
    if (empty.length) await db.update(schema.contentItems).set({ hookType: "otro", hookClassifiedAt: now }).where(inArray(schema.contentItems.id, empty));
  }
  return done;
}

export type HookStat = { type: HookCategory; label: string; count: number; medianScore: number; medianViews: number | null; example: { id: string; text: string; score: number } | null };

/** Rendimiento por tipo de gancho (últimos 180 días): mediana de "× tu mediana" por tipo, con al menos 3 piezas. */
export async function hookRanking(platform: string | null = null): Promise<{ stats: HookStat[]; pending: number; classified: number }> {
  await getCurrentUser();
  return hookRankingUnchecked(platform);
}

/** Igual que hookRanking pero sin sesión: solo para el contexto de los prompts (lib/ai). */
export async function hookRankingUnchecked(platform: string | null = null): Promise<{ stats: HookStat[]; pending: number; classified: number }> {
  const db = getDb();
  const rows = await db.execute<{ hook_type: string; n: number; med: number; views: number | null; best_id: string; best_title: string | null; best_caption: string | null; best_score: number }>(sql`
    with base as (
      select id, hook_type, perf_score, views, title, caption from content_items
      where hook_type is not null and hook_type <> 'otro' and perf_score is not null and available
        and published_at > now() - interval '180 days'
        ${platform ? sql`and platform = ${platform}` : sql``}
    ), ranked as (
      select *, row_number() over (partition by hook_type order by perf_score desc) as rk from base
    )
    select b.hook_type, count(*)::int as n,
      percentile_cont(0.5) within group (order by b.perf_score) as med,
      percentile_cont(0.5) within group (order by b.views) as views,
      max(r.id::text) as best_id, max(r.title) as best_title, max(r.caption) as best_caption, max(r.perf_score) as best_score
    from base b left join ranked r on r.hook_type = b.hook_type and r.rk = 1 and r.id = b.id
    group by b.hook_type having count(*) >= 3
    order by med desc
  `);
  const counts = await db.execute<{ pending: number; classified: number }>(sql`
    select count(*) filter (where hook_classified_at is null and coalesce(title, caption, '') <> '')::int as pending,
           count(*) filter (where hook_classified_at is not null)::int as classified
    from content_items
  `);
  const stats = rows.rows
    .filter((r) => (HOOK_CATEGORIES as readonly string[]).includes(r.hook_type))
    .map((r) => {
      const type = r.hook_type as HookCategory;
      return {
        type,
        label: hookLabel[type],
        count: Number(r.n),
        medianScore: Number(r.med),
        medianViews: r.views == null ? null : Number(r.views),
        example: r.best_id ? { id: r.best_id, text: firstLine(r.best_title, r.best_caption), score: Number(r.best_score) } : null,
      };
    });
  return { stats, pending: Number(counts.rows[0]?.pending ?? 0), classified: Number(counts.rows[0]?.classified ?? 0) };
}
