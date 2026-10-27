import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import type { StrategistCitation, StrategistIdea } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { suggestedQuestions } from "@/lib/ai/prompts/estratega";
import { totalsUnchecked } from "@/lib/dal/metrics";
import { addDays, todayIn, type MetricsFilters } from "@/lib/metrics/params";
import type { Platform } from "@/lib/social/types";
import { TOOL_IMPLEMENTATIONS, type ToolContext, type ToolOutput } from "@/lib/strategist/queries";
import type { ToolInput, ToolName } from "@/lib/strategist/tools";

/** Preguntas por persona y por día (en APP_TIMEZONE). Protege el costo de la clave del servidor. */
export const DAILY_QUESTION_LIMIT = 40;

export type ConversationSummary = { id: string; title: string; updatedAt: Date; messages: number };

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: StrategistCitation[];
  ideas: StrategistIdea[];
  error: string | null;
  createdAt: Date;
};

/** Conversaciones de quien está mirando (cada persona ve las suyas), de la más reciente a la más vieja. */
export async function listConversations(limit = 40): Promise<ConversationSummary[]> {
  const user = await getCurrentUser();
  const rows = await getDb()
    .select({
      id: schema.strategistConversations.id,
      title: schema.strategistConversations.title,
      updatedAt: schema.strategistConversations.updatedAt,
      messages: sql<number>`(select count(*)::int from strategist_messages m where m.conversation_id = ${schema.strategistConversations.id})`,
    })
    .from(schema.strategistConversations)
    .where(eq(schema.strategistConversations.userId, user.id))
    .orderBy(desc(schema.strategistConversations.updatedAt))
    .limit(limit);
  return rows;
}

export async function getConversation(id: string): Promise<{ id: string; title: string; messages: StoredMessage[] } | null> {
  const user = await getCurrentUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return conversationFor(user, id);
}

/** Lo mismo que getConversation para quien ya tiene el usuario (la ruta del chat). */
export async function conversationFor(user: CurrentUser, id: string): Promise<{ id: string; title: string; messages: StoredMessage[] } | null> {
  const db = getDb();
  const [conv] = await db
    .select({ id: schema.strategistConversations.id, title: schema.strategistConversations.title })
    .from(schema.strategistConversations)
    .where(and(eq(schema.strategistConversations.id, id), eq(schema.strategistConversations.userId, user.id)))
    .limit(1);
  if (!conv) return null;
  const messages = await db
    .select({
      id: schema.strategistMessages.id,
      role: schema.strategistMessages.role,
      content: schema.strategistMessages.content,
      citations: schema.strategistMessages.citations,
      ideas: schema.strategistMessages.ideas,
      error: schema.strategistMessages.error,
      createdAt: schema.strategistMessages.createdAt,
    })
    .from(schema.strategistMessages)
    .where(eq(schema.strategistMessages.conversationId, id))
    .orderBy(asc(schema.strategistMessages.createdAt))
    .limit(200);
  return { ...conv, messages };
}

/** Preguntas que hizo hoy (día local de la marca). */
export async function questionsToday(userId: string): Promise<number> {
  const tz = env().APP_TIMEZONE;
  const today = todayIn(tz);
  const [row] = (
    await getDb().execute<{ n: number }>(sql`
      select count(*)::int as n from strategist_messages
      where user_id = ${userId} and role = 'user' and created_at >= (${today}::date::timestamp at time zone ${tz})
    `)
  ).rows;
  return row?.n ?? 0;
}

export async function getUsageToday(): Promise<{ used: number; limit: number }> {
  const user = await getCurrentUser();
  return { used: await questionsToday(user.id), limit: DAILY_QUESTION_LIMIT };
}

/** Preguntas sugeridas para empezar, armadas con sus datos. */
export async function getSuggestions(): Promise<string[]> {
  await getCurrentUser();
  const db = getDb();
  const tz = env().APP_TIMEZONE;
  const today = todayIn(tz);
  const accounts = await db.execute<{ platform: Platform }>(sql`select distinct platform from social_accounts where current order by platform`);
  const platforms = accounts.rows.map((r) => r.platform);
  const f = (p: Platform, from: string, to: string): MetricsFilters => ({ preset: "custom", from, to, platforms: [p], types: [], q: "", minViews: null, maxViews: null, sort: "fecha", dir: "desc", view: "tabla", page: 1 });
  const drops = await Promise.all(
    platforms.map(async (p) => {
      const [cur, prev] = await Promise.all([totalsUnchecked(f(p, addDays(today, -27), today), addDays(today, -27), today), totalsUnchecked(f(p, addDays(today, -55), addDays(today, -28)), addDays(today, -55), addDays(today, -28))]);
      return { p, change: cur.views != null && prev.views ? (cur.views - prev.views) / prev.views : null };
    }),
  );
  const dropping = drops.filter((d) => d.change != null && d.change < -0.1).sort((a, b) => a.change! - b.change!)[0]?.p ?? null;
  const [hooks, goal, report] = await Promise.all([
    db.execute<{ platform: Platform; n: number }>(sql`select platform, count(*)::int as n from content_items where hook_type is not null and hook_type <> 'otro' and perf_score is not null group by 1 order by 2 desc limit 1`),
    db.select({ goals: schema.brandProfile.goals }).from(schema.brandProfile).limit(1),
    db.execute<{ n: number }>(sql`select count(*)::int as n from monthly_reports`),
  ]);
  return suggestedQuestions({
    platforms,
    dropping,
    hookPlatform: (hooks.rows[0]?.n ?? 0) >= 6 ? hooks.rows[0]!.platform : null,
    hasGoal: Boolean(goal[0]?.goals),
    hasReport: (report.rows[0]?.n ?? 0) > 0,
  });
}

/**
 * Ejecutor de las herramientas del estratega. Comprueba la sesión al crearlo (antes de abrir el streaming)
 * y después solo corre lecturas acotadas de lib/strategist/queries.ts.
 */
export async function createToolRunner(): Promise<{ user: CurrentUser; run: <N extends ToolName>(name: N, input: ToolInput<N>, ctx: ToolContext) => Promise<ToolOutput> }> {
  const user = await getCurrentUser();
  return { user, run: (name, input, ctx) => TOOL_IMPLEMENTATIONS[name](input, ctx) };
}
