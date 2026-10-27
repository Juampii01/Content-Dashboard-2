import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { StrategistCitation, StrategistIdea, StrategistToolCall } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { conversationTitle, strategistRules, STRATEGIST_PROMPT_VERSION } from "@/lib/ai/prompts/estratega";
import { todayIn } from "@/lib/metrics/params";
import { platformLabel, type Platform } from "@/lib/social/types";

/**
 * Escrituras del estratega (conversaciones, mensajes y consumo de IA) y el contexto del sistema.
 * Solo lo llama la ruta /api/estratega después de comprobar la sesión y el permiso de edición.
 */
export async function createConversation(userId: string, question: string): Promise<{ id: string; title: string }> {
  const title = conversationTitle(question);
  const [row] = await getDb().insert(schema.strategistConversations).values({ userId, title }).returning({ id: schema.strategistConversations.id });
  return { id: row!.id, title };
}

export async function saveUserMessage(conversationId: string, userId: string, question: string): Promise<void> {
  await getDb().insert(schema.strategistMessages).values({ conversationId, userId, role: "user", content: question });
}

export async function saveAssistantMessage(
  conversationId: string,
  data: { content: string; citations: StrategistCitation[]; ideas: StrategistIdea[]; toolCalls: StrategistToolCall[]; model: string | null; usage: { input: number; output: number } | null; error: string | null },
): Promise<{ id: string; createdAt: Date }> {
  const db = getDb();
  const [row] = await db
    .insert(schema.strategistMessages)
    .values({
      conversationId,
      role: "assistant",
      content: data.content,
      citations: data.citations,
      ideas: data.ideas,
      toolCalls: data.toolCalls,
      model: data.model,
      inputTokens: data.usage?.input ?? null,
      outputTokens: data.usage?.output ?? null,
      error: data.error,
    })
    .returning({ id: schema.strategistMessages.id, createdAt: schema.strategistMessages.createdAt });
  await db.update(schema.strategistConversations).set({ updatedAt: new Date() }).where(eq(schema.strategistConversations.id, conversationId));
  return row!;
}

/** Marca una idea como agregada al calendario (para no duplicarla y mostrar el enlace). */
export async function markIdeaScheduled(messageId: string, ideaId: string, entryId: string): Promise<void> {
  await getDb().execute(sql`
    update strategist_messages
    set ideas = (
      select coalesce(jsonb_agg(case when i->>'id' = ${ideaId} then i || jsonb_build_object('calendarEntryId', ${entryId}::text) else i end), '[]'::jsonb)
      from jsonb_array_elements(ideas) i
    )
    where id = ${messageId}::uuid
  `);
}

/** Contexto del sistema: reglas del estratega + marca (en caché de Claude, igual entre preguntas del mismo día). */
export async function systemContext(): Promise<{ system: string; today: string; version: string }> {
  const tz = env().APP_TIMEZONE;
  const today = todayIn(tz);
  const weekday = new Intl.DateTimeFormat("es-419", { weekday: "long", timeZone: tz }).format(new Date());
  const [brand, accounts] = await Promise.all([getBrand(), getDb().execute<{ platform: Platform; handle: string }>(sql`select platform, handle from social_accounts where current order by platform`)]);
  const accountText = accounts.rows.length ? accounts.rows.map((a) => `${platformLabel[a.platform]} (@${a.handle.replace(/^@/, "")})`).join(", ") : "ninguna todavía";
  const rules = strategistRules({ today, weekday, timezone: tz, language: brand?.language ?? "es-neutro", accounts: accountText });
  return { system: `${rules}\n\n${await brandContext(brand)}`, today, version: STRATEGIST_PROMPT_VERSION };
}
