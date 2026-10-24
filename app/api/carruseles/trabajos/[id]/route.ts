import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getOptionalUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";

/**
 * GET /api/carruseles/trabajos/<id> — estado de un trabajo de Carruseles (plantilla, copia, imágenes, video de un slide
 * o conexión de ChatGPT),
 * para que la pantalla muestre el progreso real y se pueda salir y volver. Solo con sesión.
 */
const TYPES = new Set(["CAROUSEL_STYLE", "CAROUSEL_IMAGES", "CODEX_LOGIN", "CAROUSEL_COPY", "CAROUSEL_ANIMATE"]);

export async function GET(_request: NextRequest, { params }: RouteContext<"/api/carruseles/trabajos/[id]">) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar." }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Trabajo no válido." }, { status: 404 });
  const [job] = await getDb().select().from(schema.jobs).where(eq(schema.jobs.id, id)).limit(1);
  if (!job || !TYPES.has(job.type)) return NextResponse.json({ error: "Trabajo no válido." }, { status: 404 });
  const output = (job.output ?? {}) as Record<string, unknown>;
  // Solo lo que la pantalla necesita (nunca credenciales).
  const safe =
    job.type === "CODEX_LOGIN"
      ? { url: output.url ?? null, code: output.code ?? null, label: output.label ?? null }
      : job.type === "CAROUSEL_IMAGES"
        ? { slides: Array.isArray(output.slides) ? output.slides : [], provider: (job.input as { provider?: string }).provider ?? null }
        : job.type === "CAROUSEL_COPY"
          ? { copyId: (job.input as { copyId?: string }).copyId ?? null, carouselId: output.carouselId ?? null }
          : job.type === "CAROUSEL_ANIMATE"
            ? { slideId: (job.input as { slideId?: string }).slideId ?? null, url: output.url ?? null }
            : { templateId: (job.input as { templateId?: string }).templateId ?? null };
  return NextResponse.json(
    {
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      error: job.status === "FAILED" ? job.errorMessage : null,
      retrying: job.status === "QUEUED" && job.attempts > 0 ? job.errorMessage : null,
      output: safe,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
