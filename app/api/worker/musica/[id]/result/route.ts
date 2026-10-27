import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { workerAuthorized } from "@/lib/jobs";
import { MusicError } from "@/lib/video/music";
import { saveSplitResult } from "@/lib/video/music-split";

/**
 * POST /api/worker/musica/<id>/result — lo llama el worker al terminar de separar la música de un reel (AUDIO_SPLIT),
 * con la pista ya subida. La app la deja lista y borra el archivo subido. Idempotente.
 */
const body = z.object({ duration: z.number().nonnegative().max(24 * 3600), bytes: z.number().int().nonnegative() });

export async function POST(request: NextRequest, { params }: RouteContext<"/api/worker/musica/[id]/result">) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Pista no válida.", retry: false }, { status: 400 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "El resultado llegó incompleto.", retry: false }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await saveSplitResult(id, parsed.data)) });
  } catch (error) {
    if (error instanceof MusicError) return NextResponse.json({ error: error.message, retry: false }, { status: 422 });
    console.error("[worker/musica]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No pudimos guardar la pista.", retry: true }, { status: 500 });
  }
}
