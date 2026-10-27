import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { workerAuthorized } from "@/lib/jobs";
import { generateFicha, saveClipSheets } from "@/lib/video/library";

/**
 * POST /api/worker/biblioteca/<id>/ficha — el worker entrega las hojas de cuadros de un clip de la biblioteca (o el aviso
 * de que no se pudieron armar). La app contesta enseguida y, después de responder, Claude escribe la ficha. El clip ya
 * está listo para usarse: la ficha es aparte y, si falla, se reintenta desde la Biblioteca.
 */
export const maxDuration = 300;

const bodySchema = z.object({
  ok: z.boolean(),
  error: z.string().max(400).optional(),
  sheets: z.array(z.unknown()).max(3).optional(),
});

export async function POST(request: NextRequest, { params }: RouteContext<"/api/worker/biblioteca/[id]/ficha">) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Clip no válido.", retry: false }, { status: 400 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos.", retry: false }, { status: 400 });
  const ok = await saveClipSheets(id, parsed.data);
  if (ok) after(() => generateFicha(id));
  return NextResponse.json({ ok: true });
}
