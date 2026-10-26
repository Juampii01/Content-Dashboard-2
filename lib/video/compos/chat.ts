import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { RefImage } from "./schema";

/**
 * Memoria de la charla con el taller (tabla compos_chats): una conversación por animación de cada video. Se guardan
 * los mensajes (hasta 120), lo acordado que falta mandar y una marca «applied» cada vez que se mandó un cambio, así la
 * IA sabe qué se pidió y qué ya se hizo aunque se recargue el Estudio.
 */
export type ChatMessage = { role: "user" | "assistant" | "applied"; text: string; at: string; refs?: RefImage[] };
export type ChatThread = { messages: ChatMessage[]; agreed: { instruction: string; scope: "scene" | "all" } | null };

const MAX_MESSAGES = 120;

export async function loadChat(projectId: string, compId: string): Promise<ChatThread> {
  const [row] = await getDb()
    .select({ messages: schema.composChats.messages, agreed: schema.composChats.agreed })
    .from(schema.composChats)
    .where(and(eq(schema.composChats.projectId, projectId), eq(schema.composChats.compId, compId)))
    .limit(1);
  return { messages: row?.messages ?? [], agreed: row?.agreed ?? null };
}

export async function saveChat(projectId: string, compId: string, thread: ChatThread): Promise<void> {
  const messages = thread.messages.slice(-MAX_MESSAGES);
  await getDb()
    .insert(schema.composChats)
    .values({ projectId, compId, messages, agreed: thread.agreed })
    .onConflictDoUpdate({ target: [schema.composChats.projectId, schema.composChats.compId], set: { messages, agreed: thread.agreed, updatedAt: new Date() } });
}

export async function clearChat(projectId: string, compId: string): Promise<void> {
  await getDb().delete(schema.composChats).where(and(eq(schema.composChats.projectId, projectId), eq(schema.composChats.compId, compId)));
}
