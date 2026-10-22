import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { workerAuthorized } from "@/lib/jobs";
import { directorStep, type DirectorBody } from "@/lib/video/director/service";
import { VideoError } from "@/lib/video/service";

/**
 * POST /api/worker/projects/<id>/director — el worker maneja al director de edición paso a paso (ver
 * lib/video/director/service.ts). Cada llamada hace un paso (una llamada de IA como mucho) y responde cuál sigue:
 * entender el video, dirigir, armar la vista previa para la segunda mirada, criticar, corregir o cerrar.
 * Con razonamiento y visión una llamada puede tardar varios minutos: por eso el tope de la función es alto.
 */
export const maxDuration = 800;

const sheet = z.object({ key: z.string().regex(/^editor\/[0-9a-f-]{36}\/director\/[a-z0-9-]+\.jpg$/), width: z.number().int().min(1).max(4000), height: z.number().int().min(1).max(4000) });
const bodySchema = z.discriminatedUnion("step", [
  z.object({ step: z.literal("start") }),
  z.object({ step: z.literal("understand") }),
  z.object({ step: z.literal("direct") }),
  z.object({ step: z.literal("revise") }),
  z.object({ step: z.literal("finalize") }),
  z.object({ step: z.literal("edit") }),
  z.object({ step: z.literal("abort"), error: z.string().max(400).optional() }),
  z.object({ step: z.literal("critique"), round: z.number().int().min(1).max(6), sheets: z.array(sheet).max(8) }),
  z.object({ step: z.literal("final"), sheets: z.array(sheet).max(8), frames: z.array(z.object({ t: z.number().min(0), label: z.string().max(300) })).max(60) }),
]);

export async function POST(request: NextRequest, { params }: RouteContext<"/api/worker/projects/[id]/director">) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pedido no válido.", retry: false }, { status: 400 });
  // Las hojas tienen que ser de este proyecto.
  const body = parsed.data as DirectorBody;
  if ("sheets" in body && body.sheets.some((s) => !s.key.startsWith(`editor/${id}/director/`))) return NextResponse.json({ error: "Hoja de otro proyecto.", retry: false }, { status: 400 });
  try {
    const result = await directorStep(id, body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof VideoError) return NextResponse.json({ error: error.message, retry: false }, { status: 422 });
    console.error("[worker/director]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "El director de edición no respondió.", retry: true }, { status: 500 });
  }
}
