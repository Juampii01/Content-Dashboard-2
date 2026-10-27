import "server-only";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { workerAuthorized, type JobType } from "@/lib/jobs";

/**
 * Puerta de las rutas `/api/worker/carruseles/*`: solo el worker (Bearer WORKER_SECRET) y solo para un trabajo
 * que existe, está en curso y es del tipo esperado. Así una ruta no sirve para tocar otro carrusel ni otra plantilla.
 */
export type RunningJob = typeof schema.jobs.$inferSelect;

export function fail(message: string, status = 422, retry = false) {
  return NextResponse.json({ error: message, retry }, { status });
}

export async function workerJob(request: Request, types: JobType[]): Promise<{ job: RunningJob; body: Record<string, unknown> } | NextResponse> {
  if (!workerAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const jobId = typeof body?.jobId === "string" && /^[0-9a-f-]{36}$/i.test(body.jobId) ? body.jobId : null;
  if (!body || !jobId) return fail("Pedido no válido.", 400);
  const [job] = await getDb().select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1);
  if (!job || !types.includes(job.type)) return fail("Trabajo inexistente.", 404);
  if (job.status !== "RUNNING") return fail("El trabajo ya no está en curso.", 409);
  return { job, body };
}
