import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { workerAuthorized } from "@/lib/jobs";
import { saveLookData, thinkLook } from "@/lib/video/look";

/**
 * POST /api/worker/projects/<id>/mirar — el worker entrega lo que midió de una referencia de «Mira este video» (o el
 * aviso de que no se pudo bajar). La app contesta enseguida y, después de responder, Claude desarma la referencia y
 * escribe su primera respuesta (puede tardar unos minutos: el Estudio pregunta el estado).
 */
export const maxDuration = 800;

const sheet = z.object({
  key: z.string().regex(/^editor\/[0-9a-f-]{36}\/mirar\/[0-9a-f-]{36}\/hoja-[0-9]{2}\.jpg$/),
  width: z.number().int().min(1).max(4000),
  height: z.number().int().min(1).max(4000),
  frames: z.array(z.number().int().min(1).max(500)).max(140),
});
const bodySchema = z.object({
  lookId: z.uuid(),
  ok: z.boolean(),
  error: z.string().max(400).optional(),
  metrics: z.unknown().optional(),
  moments: z
    .array(z.object({ t: z.number().min(0).max(3600), frame: z.number().int().min(0).max(500), cut: z.boolean(), face: z.boolean(), text: z.string().max(160), said: z.string().max(200) }))
    .max(140)
    .optional(),
  transcript: z.string().max(6000).optional(),
  sheets: z.array(sheet).max(6).optional(),
});

export async function POST(request: NextRequest, { params }: RouteContext<"/api/worker/projects/[id]/mirar">) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Proyecto no válido.", retry: false }, { status: 400 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos.", retry: false }, { status: 400 });
  const ok = await saveLookData(id, parsed.data.lookId, parsed.data);
  if (ok) after(() => thinkLook(id, parsed.data.lookId));
  return NextResponse.json({ ok: true });
}
