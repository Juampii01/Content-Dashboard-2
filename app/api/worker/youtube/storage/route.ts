import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { fail, workerJob } from "@/lib/carousels/worker-api";
import { fileDriver, workerTransfer } from "@/lib/storage";
import { CUTOUT_KEY_RE, BACKGROUND_KEY_RE } from "@/lib/youtube/files";

/**
 * POST /api/worker/youtube/storage — acceso de corta duración a un archivo para un YT_THUMBNAILS en curso:
 * leer las fotos del personaje del trabajo, subir sus recortes (`miniaturas/recortes/…`) y los fondos de sus conceptos
 * (`miniaturas/<paquete>/<concepto>-<azar>.jpg`). Nada más.
 */
const body = z.object({ key: z.string().min(3).max(300), op: z.enum(["get", "put"]), contentType: z.enum(["image/jpeg", "image/png"]).optional() });

export async function POST(request: NextRequest) {
  const gate = await workerJob(request, ["YT_THUMBNAILS"]);
  if (gate instanceof NextResponse) return gate;
  const parsed = body.safeParse(gate.body);
  if (!parsed.success) return fail("Pedido no válido.", 400);
  const { key, op, contentType } = parsed.data;
  if (!fileDriver()) return fail("Falta configurar el almacenamiento de archivos.", 503, true);
  const input = gate.job.input as { packageId?: string | null; concepts?: { conceptId: string }[]; photos?: string[] };
  let allowed = false;
  if (op === "get") allowed = Boolean(input.photos?.includes(key));
  else if (CUTOUT_KEY_RE.test(key)) allowed = Boolean(input.photos?.length) && contentType === "image/png";
  else if (BACKGROUND_KEY_RE.test(key) && input.packageId) {
    const conceptId = key.split("/")[2]?.replace(/-[0-9a-f]{8}\.jpg$/, "");
    allowed = key.startsWith(`miniaturas/${input.packageId}/`) && Boolean(input.concepts?.some((c) => c.conceptId === conceptId)) && contentType === "image/jpeg";
  }
  if (!allowed) return fail("Ese archivo no es de este trabajo.", 403);
  try {
    return NextResponse.json(await workerTransfer(key, op, contentType));
  } catch (error) {
    console.error("[worker/youtube/storage]", error instanceof Error ? error.message : error);
    return fail("No se pudo preparar el acceso al archivo.", 500, true);
  }
}
