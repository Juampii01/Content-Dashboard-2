import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Cola de trabajos sobre la tabla `jobs` (sin pg-boss ni Redis).
 * La app encola; el worker (worker/, Python) toma trabajos con `FOR UPDATE SKIP LOCKED`, renueva su lease,
 * escribe progreso y etapa, y reintenta con espera creciente hasta `maxAttempts`.
 */
export type JobType = (typeof schema.jobTypeEnum.enumValues)[number];

export async function enqueueJob(input: {
  type: JobType;
  input: Record<string, unknown>;
  videoProjectId?: string | null;
  createdBy?: string | null;
  maxAttempts?: number;
  stage?: string;
}): Promise<string> {
  const [row] = await getDb()
    .insert(schema.jobs)
    .values({
      type: input.type,
      input: input.input,
      videoProjectId: input.videoProjectId ?? null,
      createdBy: input.createdBy ?? null,
      maxAttempts: input.maxAttempts ?? 3,
      stage: input.stage ?? "En cola",
    })
    .returning({ id: schema.jobs.id });
  // Encender el worker no debe demorar la respuesta: va después.
  after(() => wakeWorker());
  return row!.id;
}

/** Cancela los trabajos pendientes o en curso de un proyecto (el worker lo detecta al renovar su lease). */
export async function cancelProjectJobs(videoProjectId: string): Promise<void> {
  await getDb()
    .update(schema.jobs)
    .set({ status: "CANCELED", finishedAt: new Date(), lockedUntil: null })
    .where(and(eq(schema.jobs.videoProjectId, videoProjectId), inArray(schema.jobs.status, ["QUEUED", "RUNNING"])));
}

export async function latestProjectJob(videoProjectId: string) {
  const [job] = await getDb()
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.videoProjectId, videoProjectId))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(1);
  return job ?? null;
}

// ─── Estado del worker ────────────────────────────────────────────────────

/** El worker escribe su latido cada 15 s; un minuto sin latido = apagado. */
const HEARTBEAT_STALE_MS = 60_000;

export type WorkerStatus = {
  online: boolean;
  lastSeen: Date | null;
  /** La app sabe encenderlo sola (Fly Machines configurado). */
  autoStart: boolean;
  /** Trabajos esperando que nadie tomó en más de 3 minutos. */
  stuck: number;
  /** Versión que reportó el worker en su último latido (null = nunca se conectó o no la manda). */
  version: string | null;
};

export function flyConfigured(): boolean {
  return Boolean(env().FLY_API_TOKEN && env().FLY_WORKER_APP);
}

export async function workerStatus(): Promise<WorkerStatus> {
  const db = getDb();
  const [beat] = await db.select({ seenAt: schema.workerHeartbeats.seenAt, version: schema.workerHeartbeats.version }).from(schema.workerHeartbeats).orderBy(desc(schema.workerHeartbeats.seenAt)).limit(1);
  const [stuck] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.jobs)
    .where(and(inArray(schema.jobs.type, ["VIDEO_ANALYZE", "VIDEO_RENDER", "VIDEO_STYLE", "VIDEO_CLIP", "LONG_VIDEO_CLIPS", "REEL_COPY"]), eq(schema.jobs.status, "QUEUED"), sql`${schema.jobs.runAfter} < now() - interval '3 minutes'`));
  const lastSeen = beat?.seenAt ?? null;
  return {
    online: Boolean(lastSeen && Date.now() - lastSeen.getTime() < HEARTBEAT_STALE_MS),
    lastSeen,
    autoStart: flyConfigured(),
    stuck: stuck?.n ?? 0,
    version: beat?.version ?? null,
  };
}

// ─── Fly Machines ─────────────────────────────────────────────────────────

const FLY_API = "https://api.machines.dev/v1";

/**
 * Enciende la Fly Machine del worker (si está configurado). Si ya está encendida, Fly responde con un error
 * que se ignora. Nunca lanza: si falla, el trabajo queda en cola y se toma cuando el worker arranque.
 */
export async function wakeWorker(): Promise<void> {
  const token = env().FLY_API_TOKEN;
  const app = env().FLY_WORKER_APP;
  if (!token || !app) return;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  try {
    let ids = env().FLY_WORKER_MACHINE_ID ? [env().FLY_WORKER_MACHINE_ID!] : [];
    if (!ids.length) {
      const res = await fetch(`${FLY_API}/apps/${encodeURIComponent(app)}/machines`, { headers, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`listar máquinas: ${res.status}`);
      const machines = (await res.json()) as { id: string; state: string }[];
      if (machines.some((m) => m.state === "started" || m.state === "starting")) return;
      ids = machines.filter((m) => m.state === "stopped" || m.state === "suspended").map((m) => m.id).slice(0, 1);
    }
    for (const id of ids) {
      const res = await fetch(`${FLY_API}/apps/${encodeURIComponent(app)}/machines/${encodeURIComponent(id)}/start`, { method: "POST", headers, signal: AbortSignal.timeout(10_000) });
      if (!res.ok && res.status !== 412) console.error("[worker] Fly no encendió la máquina:", res.status);
    }
  } catch (error) {
    console.error("[worker] no se pudo encender el worker:", error instanceof Error ? error.message : "error");
  }
}

// ─── Autenticación del worker ─────────────────────────────────────────────

/**
 * Las rutas `/api/worker/*` solo las llama el worker, con `Authorization: Bearer <WORKER_SECRET>`.
 * La comparación es en tiempo constante (sobre los hash, así no depende del largo).
 */
export function workerAuthorized(request: Request): boolean {
  const secret = env().WORKER_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = createHash("sha256").update(header).digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(given, expected);
}
