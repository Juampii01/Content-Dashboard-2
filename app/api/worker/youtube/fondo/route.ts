import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { fail, workerJob } from "@/lib/carousels/worker-api";
import { attachBackground, PackageError } from "@/lib/youtube/packages";

/** POST /api/worker/youtube/fondo — el fondo de un concepto ya subido (o el motivo por el que falló). */
const body = z.object({ conceptId: z.string().min(1).max(20), key: z.string().max(300).nullable(), provider: z.string().max(20).nullable(), error: z.string().max(500).nullable().optional() });

export async function POST(request: NextRequest) {
  const gate = await workerJob(request, ["YT_THUMBNAILS"]);
  if (gate instanceof NextResponse) return gate;
  const parsed = body.safeParse(gate.body);
  if (!parsed.success) return fail("Pedido no válido.", 400);
  try {
    await attachBackground(gate.job, parsed.data.conceptId, parsed.data.key, parsed.data.provider, parsed.data.error ?? null);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PackageError) return fail(error.message);
    console.error("[worker/youtube/fondo]", error instanceof Error ? error.message : error);
    return fail("No pudimos guardar el fondo.", 500, true);
  }
}
