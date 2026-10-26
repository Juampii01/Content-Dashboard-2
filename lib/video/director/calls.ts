import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Pasos del director en segundo plano (tabla director_calls): el worker pide un paso, la app guarda la llamada como
 * «running», contesta con su id y hace el paso después de responder; el worker pregunta hasta que esté. Una llamada que
 * quedó «running» más de 15 minutos (la función se cortó) cuenta como fallida, con reintento.
 */
export const CALL_STALE_MS = 15 * 60_000;

export type CallState = { status: "running" } | { status: "done"; result: Record<string, unknown> } | { status: "failed"; error: string; retry: boolean };

export function newCallId(): string {
  return `c${Date.now().toString(36)}${randomBytes(6).toString("hex")}`;
}

export async function openCall(projectId: string, id: string): Promise<void> {
  // De paso, se borran las llamadas viejas de este proyecto (ya se leyeron o nadie las va a leer).
  await getDb().delete(schema.directorCalls).where(and(eq(schema.directorCalls.projectId, projectId), lt(schema.directorCalls.createdAt, sql`now() - interval '1 day'`)));
  await getDb().insert(schema.directorCalls).values({ id, projectId, status: "running" });
}

export async function finishCall(id: string, result: Record<string, unknown>): Promise<void> {
  await getDb().update(schema.directorCalls).set({ status: "done", result, updatedAt: new Date() }).where(eq(schema.directorCalls.id, id));
}

export async function failCall(id: string, error: string, retry: boolean): Promise<void> {
  await getDb().update(schema.directorCalls).set({ status: "failed", error: error.slice(0, 600), retry, updatedAt: new Date() }).where(eq(schema.directorCalls.id, id));
}

export async function readCall(projectId: string, id: string): Promise<CallState | null> {
  const [row] = await getDb()
    .select()
    .from(schema.directorCalls)
    .where(and(eq(schema.directorCalls.id, id), eq(schema.directorCalls.projectId, projectId)))
    .limit(1);
  if (!row) return null;
  if (row.status === "done") return { status: "done", result: row.result ?? {} };
  if (row.status === "failed") return { status: "failed", error: row.error ?? "El director de edición no respondió.", retry: row.retry };
  if (Date.now() - row.createdAt.getTime() > CALL_STALE_MS) return { status: "failed", error: "El director de edición tardó demasiado.", retry: true };
  return { status: "running" };
}
