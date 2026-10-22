"use server";

import { refresh } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { isDenied, requireEditor } from "@/lib/auth";
import { CalendarError, createEntry } from "@/lib/calendar/service";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { todayIn } from "@/lib/metrics/params";
import { markIdeaScheduled } from "@/lib/strategist/service";

/** Acciones del estratega. Cada una comprueba el permiso de edición y que la conversación sea de quien la usa. */
export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const uuid = z.string().uuid();

/** Busca un mensaje de una conversación de este usuario. */
async function ownMessage(userId: string, messageId: string) {
  const [row] = await getDb()
    .select({ id: schema.strategistMessages.id, ideas: schema.strategistMessages.ideas })
    .from(schema.strategistMessages)
    .innerJoin(schema.strategistConversations, eq(schema.strategistConversations.id, schema.strategistMessages.conversationId))
    .where(and(eq(schema.strategistMessages.id, messageId), eq(schema.strategistConversations.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** "Agregar al calendario": crea la idea como pieza en estado Idea (con su fecha si es de hoy en adelante). */
export async function addIdeaToCalendarAction(messageId: string, ideaId: string): Promise<ActionResult<{ entryId: string; date: string | null }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!uuid.safeParse(messageId).success || !uuid.safeParse(ideaId).success) return { ok: false, error: "No encontramos esa idea." };
  try {
    const message = await ownMessage(user.id, messageId);
    const idea = message?.ideas.find((i) => i.id === ideaId);
    if (!message || !idea) return { ok: false, error: "No encontramos esa idea. Puede que la conversación se haya borrado." };
    const today = todayIn(env().APP_TIMEZONE);
    const date = idea.date && idea.date >= today ? idea.date : null;
    if (idea.calendarEntryId) return { ok: true, data: { entryId: idea.calendarEntryId, date } };
    const entryId = await createEntry(
      {
        title: idea.title.slice(0, 160),
        notes: [idea.idea, idea.why ? `Por qué: ${idea.why.replace(/\s?\[[PCE]\d+\]/g, "")}` : null].filter(Boolean).join("\n\n").slice(0, 4000),
        hook: idea.hook?.slice(0, 600) ?? null,
        pillar: null,
        format: idea.format,
        status: "IDEA",
        platforms: idea.platforms.length ? idea.platforms : ["INSTAGRAM"],
        scheduledDate: date,
        scheduledTime: null,
        scriptId: null,
        source: "estratega",
      },
      user.id,
    );
    await markIdeaScheduled(messageId, ideaId, entryId);
    return { ok: true, data: { entryId, date } };
  } catch (error) {
    if (error instanceof CalendarError) return { ok: false, error: error.message };
    console.error("[estratega]", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos agregarla al calendario. Prueba de nuevo." };
  }
}

export async function deleteConversationAction(id: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!uuid.safeParse(id).success) return { ok: false, error: "No encontramos esa conversación." };
  try {
    await getDb()
      .delete(schema.strategistConversations)
      .where(and(eq(schema.strategistConversations.id, id), eq(schema.strategistConversations.userId, user.id)));
    refresh();
    return { ok: true };
  } catch (error) {
    console.error("[estratega]", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos borrar la conversación. Prueba de nuevo." };
  }
}
