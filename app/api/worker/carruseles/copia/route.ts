import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AiError } from "@/lib/ai/client";
import { CopyError, finishCopy } from "@/lib/carousels/copy";
import { TemplateError } from "@/lib/carousels/templates";
import { fail, workerJob } from "@/lib/carousels/worker-api";

/**
 * POST /api/worker/carruseles/copia — el worker manda las imágenes reducidas del carrusel que se copia (y sus medidas,
 * si se copia el diseño). La app arma la plantilla y, con Claude (visión), escribe tu versión; borra las referencias.
 * Las imágenes viajan solo en este pedido: no se guardan en ningún lado.
 */
export const maxDuration = 300;

const body = z.object({
  measurements: z.record(z.string(), z.unknown()).nullable(),
  images: z.array(z.string().max(2_000_000).regex(/^[A-Za-z0-9+/=]+$/)).min(2).max(20),
  postText: z.string().max(5000).nullable().optional(),
});

export async function POST(request: NextRequest) {
  const gate = await workerJob(request, ["CAROUSEL_COPY"]);
  if (gate instanceof NextResponse) return gate;
  const parsed = body.safeParse(gate.body);
  if (!parsed.success) return fail("Los slides del carrusel llegaron incompletos.", 400);
  try {
    const { carouselId } = await finishCopy(gate.job, parsed.data.measurements, parsed.data.images, parsed.data.postText ?? null);
    return NextResponse.json({ ok: true, carouselId });
  } catch (error) {
    if (error instanceof CopyError || error instanceof TemplateError) return fail(error.message);
    if (error instanceof AiError) {
      console.error("[worker/carruseles/copia] ia:", error.detail);
      return fail(error.userMessage, 502, true);
    }
    console.error("[worker/carruseles/copia]", error instanceof Error ? error.message : error);
    return fail("No pudimos escribir tu versión del carrusel.", 500, true);
  }
}
