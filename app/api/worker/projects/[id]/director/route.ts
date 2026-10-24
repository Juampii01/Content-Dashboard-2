import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { workerAuthorized } from "@/lib/jobs";
import { referencePayloadSchema } from "@/lib/video/director/reference";
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
const referenceSheet = z.object({
  key: z.string().regex(/^editor\/[0-9a-f-]{36}\/referencia\/[a-z0-9-]+\.jpg$/),
  width: z.number().int().min(1).max(4000),
  height: z.number().int().min(1).max(4000),
  frames: z.array(z.number().int().min(1).max(500)).max(140),
});
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
  // La referencia de edición ya medida (o el aviso de que no se pudo bajar). Sus hojas van en editor/<id>/referencia/.
  referencePayloadSchema.extend({ step: z.literal("reference"), sheets: z.array(referenceSheet).max(6).optional() }),
  // Composiciones (lib/video/compos): receta, adaptación, taller, imágenes generadas y cuadros para la revisión.
  z.object({ step: z.literal("recipe") }),
  z.object({ step: z.literal("adapt") }),
  // `workId`: un pedido del Estudio (compos_requests); sin él, el taller del director.
  z.object({ step: z.literal("compos"), workId: z.string().regex(/^w[0-9a-z]{1,30}$/).optional() }),
  z.object({
    step: z.literal("compos-images-done"),
    results: z
      .array(
        z.object({
          taskId: z.string().max(40),
          imageId: z.string().max(40),
          key: z.string().regex(/^editor\/[0-9a-f-]{36}\/compos\/[a-z0-9-]+\.(png|jpg|webp)$/).optional(),
          width: z.number().int().min(16).max(4096).optional(),
          height: z.number().int().min(16).max(4096).optional(),
          error: z.string().max(400).optional(),
        }),
      )
      .max(20),
    workId: z.string().regex(/^w[0-9a-z]{1,30}$/).optional(),
  }),
  z.object({ step: z.literal("compos-look"), sheets: z.array(sheet.extend({ taskId: z.string().max(40), times: z.array(z.number().min(0).max(60)).max(12).optional() })).max(30), workId: z.string().regex(/^w[0-9a-z]{1,30}$/).optional() }),
]);

export async function POST(request: NextRequest, { params }: RouteContext<"/api/worker/projects/[id]/director">) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pedido no válido.", retry: false }, { status: 400 });
  // Las hojas tienen que ser de este proyecto.
  const body = parsed.data as DirectorBody;
  const prefix = body.step === "reference" ? `editor/${id}/referencia/` : `editor/${id}/director/`;
  if ("sheets" in body && body.sheets?.some((s) => !s.key.startsWith(prefix))) return NextResponse.json({ error: "Hoja de otro proyecto.", retry: false }, { status: 400 });
  if (body.step === "compos-images-done" && (body.results as { key?: string }[]).some((r) => r.key && !r.key.startsWith(`editor/${id}/compos/`))) return NextResponse.json({ error: "Imagen de otro proyecto.", retry: false }, { status: 400 });
  try {
    const result = await directorStep(id, body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof VideoError) return NextResponse.json({ error: error.message, retry: false }, { status: 422 });
    console.error("[worker/director]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "El director de edición no respondió.", retry: true }, { status: 500 });
  }
}
