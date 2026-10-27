import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { finishStyle, TemplateError } from "@/lib/carousels/templates";
import { fail, workerJob } from "@/lib/carousels/worker-api";

/**
 * POST /api/worker/carruseles/estilo — el worker manda las medidas (Tesseract + colores) y las imágenes reducidas
 * de la referencia. La app arma la plantilla con Claude (visión) y borra las referencias guardadas.
 * Las imágenes viajan solo en este pedido: no se guardan en ningún lado.
 */
export const maxDuration = 300;

const body = z.object({
  measurements: z.record(z.string(), z.unknown()),
  images: z.array(z.string().max(1_500_000).regex(/^[A-Za-z0-9+/=]+$/)).min(1).max(12),
});

export async function POST(request: NextRequest) {
  const gate = await workerJob(request, ["CAROUSEL_STYLE"]);
  if (gate instanceof NextResponse) return gate;
  const parsed = body.safeParse(gate.body);
  if (!parsed.success) return fail("Las medidas del carrusel llegaron incompletas.", 400);
  try {
    const { usedAi } = await finishStyle(gate.job, parsed.data.measurements, parsed.data.images);
    return NextResponse.json({ ok: true, usedAi });
  } catch (error) {
    if (error instanceof TemplateError) return fail(error.message);
    console.error("[worker/carruseles/estilo]", error instanceof Error ? error.message : error);
    return fail("No pudimos armar la plantilla.", 500, true);
  }
}
