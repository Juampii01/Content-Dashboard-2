import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { attachGeneratedImage, ImageJobError } from "@/lib/carousels/images/service";
import { fail, workerJob } from "@/lib/carousels/worker-api";

/** POST /api/worker/carruseles/imagen — una imagen de un slide ya subida: se pone en el slide y en la salida del trabajo. */
const body = z.object({ slideId: z.string().min(1).max(40), key: z.string().min(10).max(300), provider: z.string().max(20) });

export async function POST(request: NextRequest) {
  const gate = await workerJob(request, ["CAROUSEL_IMAGES"]);
  if (gate instanceof NextResponse) return gate;
  const parsed = body.safeParse(gate.body);
  if (!parsed.success) return fail("Pedido no válido.", 400);
  try {
    return NextResponse.json({ ok: true, ...(await attachGeneratedImage(gate.job, parsed.data.slideId, parsed.data.key, parsed.data.provider)) });
  } catch (error) {
    if (error instanceof ImageJobError) return fail(error.message);
    console.error("[worker/carruseles/imagen]", error instanceof Error ? error.message : error);
    return fail("No pudimos guardar la imagen en el carrusel.", 500, true);
  }
}
