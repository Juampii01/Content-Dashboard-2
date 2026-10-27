import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AiError, anthropicApiKey, anthropicBaseUrl } from "@/lib/ai/client";
import { getDb, schema } from "@/lib/db";
import { workerAuthorized } from "@/lib/jobs";
import { RemoteCallError, remoteCallBody } from "@/lib/video/compos/work";

/**
 * POST /api/worker/projects/<id>/ia — una llamada larga a Claude que hace el worker: el código de una pieza larga
 * («Animar todo», hasta 180 s) o de una animación que se cortó en la app, y su revisión. Con hasta 128 mil tokens de
 * salida tarda más que los 13 minutos de una función, así que la hace el worker (lib/video/compos/work.ts, routeRemote).
 *
 * Solo mientras corre un trabajo del proyecto que avanza el taller (VIDEO_ANALYZE o VIDEO_COMPOS) y solo para la
 * llamada que el taller está esperando: { taskId, call, workId? } → { apiKey, baseUrl, body, expected, timeoutS }.
 * Antes revisa los créditos del mes. La clave de API viaja solo en la respuesta; el worker no la guarda ni la loguea, y
 * el consumo vuelve a la app con el resultado (paso "compos-ai-done" del director), que lo registra en api_usage.
 * Nunca la suscripción de Claude: solo la clave de API del cliente o la del servidor.
 */
export const maxDuration = 60;

const bodySchema = z.object({
  taskId: z.string().max(40),
  call: z.string().regex(/^k[0-9a-z]{4,30}$/),
  workId: z.string().regex(/^w[0-9a-z]{1,30}$/).optional(),
});

export async function POST(request: NextRequest, { params }: RouteContext<"/api/worker/projects/[id]/ia">) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Pedido no válido.", retry: false }, { status: 400 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pedido no válido.", retry: false }, { status: 400 });
  const [job] = await getDb()
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(and(inArray(schema.jobs.type, ["VIDEO_ANALYZE", "VIDEO_COMPOS"]), eq(schema.jobs.status, "RUNNING"), sql`${schema.jobs.input}->>'projectId' = ${id}`))
    .limit(1);
  if (!job) return NextResponse.json({ error: "No hay un trabajo en curso para este video.", retry: false }, { status: 422 });
  try {
    const apiKey = await anthropicApiKey();
    if (!apiKey) return NextResponse.json({ error: "Agrega tu clave de API de Anthropic en Ajustes → Claves de servicios para usar la IA.", retry: false }, { status: 422 });
    const call = await remoteCallBody(id, parsed.data);
    return NextResponse.json({ apiKey, baseUrl: anthropicBaseUrl(), ...call }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RemoteCallError) return NextResponse.json({ error: error.message, retry: false }, { status: 422 });
    if (error instanceof AiError) return NextResponse.json({ error: error.userMessage, retry: false }, { status: 422 });
    console.error("[worker/ia]", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "No pudimos preparar la llamada a la IA.", retry: true }, { status: 500 });
  }
}
