import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { IMAGE_PROVIDERS, providersStatus } from "@/lib/carousels/images";
import { CredentialError } from "@/lib/carousels/images/credentials";
import { getDb, schema } from "@/lib/db";
import { workerAuthorized } from "@/lib/jobs";

/**
 * POST /api/worker/projects/<id>/imagenes — imágenes generadas para las animaciones del Editor (lib/video/compos).
 * Solo mientras corre un trabajo del proyecto que las usa (VIDEO_ANALYZE o VIDEO_COMPOS):
 * - { op: "credentials" }: la API key de OpenAI del cliente, descifrada. Viaja solo en la respuesta; el worker no la
 *   guarda ni la loguea.
 */
const body = z.object({ op: z.literal("credentials") });

export async function POST(request: NextRequest, { params }: RouteContext<"/api/worker/projects/[id]/imagenes">) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Pedido no válido." }, { status: 400 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pedido no válido." }, { status: 400 });
  const [job] = await getDb()
    .select({ id: schema.jobs.id, createdBy: schema.jobs.createdBy })
    .from(schema.jobs)
    .where(and(inArray(schema.jobs.type, ["VIDEO_ANALYZE", "VIDEO_COMPOS"]), eq(schema.jobs.status, "RUNNING"), sql`${schema.jobs.input}->>'projectId' = ${id}`))
    .limit(1);
  if (!job) return NextResponse.json({ error: "No hay un trabajo en curso para este video.", retry: false }, { status: 409 });
  try {
    const status = await providersStatus();
    if (!status.preferred) return NextResponse.json({ error: "Agrega tu clave de API de OpenAI en Ajustes → Claves de servicios para generar imágenes.", retry: false }, { status: 422 });
    const creds = await IMAGE_PROVIDERS[status.preferred].workerCredentials();
    if (!creds) return NextResponse.json({ error: "Revisa tu API key de OpenAI en Ajustes → Claves de servicios.", retry: false }, { status: 422 });
    return NextResponse.json(creds, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CredentialError) return NextResponse.json({ error: error.message, retry: false }, { status: 422 });
    console.error("[worker/imagenes]", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "No pudimos leer la conexión guardada.", retry: true }, { status: 500 });
  }
}
