import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { fail, workerJob } from "@/lib/carousels/worker-api";
import { attachCutout, PackageError } from "@/lib/youtube/packages";

/** POST /api/worker/youtube/recorte — la foto del personaje sin fondo (o por qué no se pudo). */
const body = z.object({ photoKey: z.string().min(3).max(300), key: z.string().max(300).nullable(), method: z.string().min(1).max(40), error: z.string().max(500).nullable().optional() });

export async function POST(request: NextRequest) {
  const gate = await workerJob(request, ["YT_THUMBNAILS"]);
  if (gate instanceof NextResponse) return gate;
  const parsed = body.safeParse(gate.body);
  if (!parsed.success) return fail("Pedido no válido.", 400);
  try {
    await attachCutout(gate.job, parsed.data.photoKey, parsed.data.key, parsed.data.method, parsed.data.error ?? null);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PackageError) return fail(error.message);
    console.error("[worker/youtube/recorte]", error instanceof Error ? error.message : error);
    return fail("No pudimos guardar el recorte.", 500, true);
  }
}
