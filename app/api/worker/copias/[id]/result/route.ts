import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { workerAuthorized } from "@/lib/jobs";
import { ReelCopyError, saveCopyResult } from "@/lib/scripts/reel-copy-service";

/**
 * POST /api/worker/copias/<id>/result — lo llama el worker al terminar de bajar, transcribir y medir un reel
 * ("Copia este reel"). La app analiza la estructura con Claude, escribe la versión propia de la persona, deja listo
 * el estilo de edición y borra el archivo subido. La transcripción llega aquí una sola vez y no se guarda.
 * Idempotente: si la copia ya está lista, responde sin volver a llamar a la IA.
 */
export const maxDuration = 300;

const body = z.object({
  metrics: z.record(z.string(), z.unknown()),
  words: z.array(z.unknown()).max(4000),
  jobId: z.uuid().nullable().optional(),
});

export async function POST(request: NextRequest, { params }: RouteContext<"/api/worker/copias/[id]/result">) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Copia no válida.", retry: false }, { status: 400 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "El análisis llegó incompleto.", retry: false }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await saveCopyResult(id, parsed.data, parsed.data.jobId ?? null)) });
  } catch (error) {
    if (error instanceof ReelCopyError) return NextResponse.json({ error: error.message, retry: false }, { status: 422 });
    console.error("[worker/copias]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No pudimos escribir tu versión.", retry: true }, { status: 500 });
  }
}
