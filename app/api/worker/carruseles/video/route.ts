import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AnimationError, attachSlideVideo } from "@/lib/carousels/animate";
import { fail, workerJob } from "@/lib/carousels/worker-api";

/** POST /api/worker/carruseles/video — el video de un slide animado ya subido: se pone en el slide. */
const body = z.object({ key: z.string().min(10).max(300) });

export async function POST(request: NextRequest) {
  const gate = await workerJob(request, ["CAROUSEL_ANIMATE"]);
  if (gate instanceof NextResponse) return gate;
  const parsed = body.safeParse(gate.body);
  if (!parsed.success) return fail("Pedido no válido.", 400);
  try {
    return NextResponse.json({ ok: true, ...(await attachSlideVideo(gate.job, parsed.data.key)) });
  } catch (error) {
    if (error instanceof AnimationError) return fail(error.message);
    console.error("[worker/carruseles/video]", error instanceof Error ? error.message : error);
    return fail("No pudimos guardar el video en el carrusel.", 500, true);
  }
}
