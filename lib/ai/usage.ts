import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { costOf } from "./pricing";

/**
 * Registro único del consumo de IA (tabla api_usage). Toda llamada a un proveedor pasa por `recordUsage`: el cliente
 * de Claude (lib/ai/client.ts) y el Estratega. Nunca lanza: si no se puede guardar, lo avisa en el log y sigue.
 *
 * A quién se carga cada llamada, en este orden: lo que pasa quien llama, el ámbito (`withUsageScope`) y, si hay video,
 * quien lo creó. Sin ninguno, queda sin usuario (se cuenta en el total de la instalación).
 */
export type UsageScope = { videoProjectId?: string | null; userId?: string | null; requestId?: string | null };

const scope = new AsyncLocalStorage<UsageScope>();

/** Todo lo que se llame a la IA dentro de `fn` se carga a este video, usuario y pedido (lo que no venga, se hereda). */
export function withUsageScope<T>(next: UsageScope, fn: () => Promise<T>): Promise<T> {
  const prev = scope.getStore() ?? {};
  const merged: UsageScope = {
    videoProjectId: next.videoProjectId !== undefined ? next.videoProjectId : prev.videoProjectId,
    userId: next.userId !== undefined ? next.userId : prev.userId,
    requestId: next.requestId !== undefined ? next.requestId : prev.requestId,
  };
  return scope.run(merged, fn);
}

export function currentUsageScope(): UsageScope {
  return scope.getStore() ?? {};
}

export type TokenUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export type UsageStatus = "ok" | "truncada" | "error_lectura" | "rechazada" | "cancelada";

export type UsageRow = {
  step: string;
  model: string;
  provider?: string;
  usage: TokenUsage;
  status?: UsageStatus;
  userId?: string | null;
  videoProjectId?: string | null;
  jobId?: string | null;
  requestId?: string | null;
  /** Costo ya calculado (por ejemplo, el simulado); si no, sale de los tokens con lib/ai/pricing.ts. */
  costUsd?: number;
};

const videoInfo = new Map<string, { duration: number | null; createdBy: string | null; at: number }>();

async function videoFacts(id: string): Promise<{ duration: number | null; createdBy: string | null }> {
  const hit = videoInfo.get(id);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit;
  const [row] = await getDb()
    .select({ media: schema.videoProjects.media, createdBy: schema.videoProjects.createdBy })
    .from(schema.videoProjects)
    .where(eq(schema.videoProjects.id, id))
    .limit(1);
  const d = Number((row?.media as { duration?: unknown } | null)?.duration);
  const out = { duration: Number.isFinite(d) && d > 0 ? d : null, createdBy: row?.createdBy ?? null, at: Date.now() };
  videoInfo.set(id, out);
  return out;
}

/** A quién se carga una llamada (el mismo orden que el registro): quien llama, el ámbito o quien creó el video. */
export async function resolveUsageUser(userId: string | null | undefined, videoProjectId: string | null | undefined): Promise<string | null> {
  const s = currentUsageScope();
  if (userId ?? s.userId) return (userId ?? s.userId) as string;
  const video = videoProjectId ?? s.videoProjectId;
  return video ? ((await videoFacts(video).catch(() => null))?.createdBy ?? null) : null;
}

/** Guarda el consumo de UNA llamada. También las que fallan después de generar: igual se cobran. */
export async function recordUsage(row: UsageRow): Promise<void> {
  try {
    const s = currentUsageScope();
    const videoId = row.videoProjectId ?? s.videoProjectId ?? null;
    const facts = videoId ? await videoFacts(videoId).catch(() => null) : null;
    const userId = row.userId ?? s.userId ?? facts?.createdBy ?? null;
    const u = {
      input: Math.max(0, Math.round(row.usage.input_tokens ?? 0)),
      output: Math.max(0, Math.round(row.usage.output_tokens ?? 0)),
      cacheRead: Math.max(0, Math.round(row.usage.cache_read_input_tokens ?? 0)),
      cacheWrite: Math.max(0, Math.round(row.usage.cache_creation_input_tokens ?? 0)),
    };
    await getDb()
      .insert(schema.apiUsage)
      .values({
        step: row.step,
        provider: row.provider ?? "anthropic",
        model: row.model,
        userId,
        videoId,
        videoDurationSec: facts?.duration ?? null,
        jobId: row.jobId ?? null,
        requestId: row.requestId ?? s.requestId ?? null,
        status: row.status ?? "ok",
        inputTokens: u.input,
        outputTokens: u.output,
        cacheReadTokens: u.cacheRead,
        cacheWriteTokens: u.cacheWrite,
        costUsd: row.costUsd ?? costOf(row.model, u),
      });
  } catch (error) {
    console.error("[ia] no se pudo guardar el consumo:", error instanceof Error ? error.message : "error");
  }
}
