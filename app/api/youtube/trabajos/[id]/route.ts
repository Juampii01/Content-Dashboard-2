import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getOptionalUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";

/**
 * GET /api/youtube/trabajos/<id> — estado de un trabajo de YouTube (fondos de miniaturas y recortes, o subtítulos de
 * un video), para mostrar el progreso real y poder salir y volver. Solo con sesión; nunca devuelve credenciales.
 */
const TYPES = new Set(["YT_THUMBNAILS", "YOUTUBE_TRANSCRIPT"]);

export async function GET(_request: NextRequest, { params }: RouteContext<"/api/youtube/trabajos/[id]">) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar." }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Trabajo no válido." }, { status: 404 });
  const [job] = await getDb().select().from(schema.jobs).where(eq(schema.jobs.id, id)).limit(1);
  if (!job || !TYPES.has(job.type)) return NextResponse.json({ error: "Trabajo no válido." }, { status: 404 });
  const output = (job.output ?? {}) as Record<string, unknown>;
  return NextResponse.json(
    {
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      error: job.status === "FAILED" ? job.errorMessage : null,
      retrying: job.status === "QUEUED" && job.attempts > 0 ? job.errorMessage : null,
      output: job.type === "YT_THUMBNAILS" ? { done: Array.isArray(output.done) ? output.done : [] } : { segments: typeof output.segments === "number" ? output.segments : null },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
