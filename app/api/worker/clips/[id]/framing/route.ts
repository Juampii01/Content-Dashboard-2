import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ClipsError, saveFraming } from "@/lib/clips/service";
import { workerAuthorized } from "@/lib/jobs";

/**
 * POST /api/worker/clips/<id>/framing — el worker entrega el reencuadre (camino de la cámara virtual) y la vista
 * previa vertical de cada clip. El video queda listo para elegir clips.
 */
const keyframes = z.array(z.tuple([z.number(), z.number().min(0).max(1)])).max(2000);
const framing = z
  .object({
    version: z.literal(1),
    mode: z.enum(["face", "center"]),
    crop: z.object({ w: z.number().positive().max(1), h: z.number().positive().max(1) }),
    keyframes,
    faceRatio: z.number().min(0).max(1),
    maxFaces: z.number().int().min(0),
    speakerSwitches: z.number().int().min(0),
    shotCuts: z.number().int().min(0),
    start: z.number(),
    end: z.number(),
  })
  .loose();
const body = z.object({
  posterKey: z.string().max(300).nullable(),
  clips: z.array(z.object({ id: z.uuid(), framing, previewKey: z.string().max(300).nullable(), posterKey: z.string().max(300).nullable() })).max(20),
});

export async function POST(request: NextRequest, { params }: RouteContext<"/api/worker/clips/[id]/framing">) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Video no válido.", retry: false }, { status: 400 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "El reencuadre llegó incompleto.", retry: false }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await saveFraming(id, parsed.data)) });
  } catch (error) {
    if (error instanceof ClipsError) return NextResponse.json({ error: error.message, retry: false }, { status: 422 });
    console.error("[worker/clips]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No pudimos guardar el reencuadre.", retry: true }, { status: 500 });
  }
}
