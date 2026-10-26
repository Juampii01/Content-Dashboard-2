import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { IMAGE_PROVIDERS, providersStatus } from "@/lib/carousels/images";
import { CredentialError, saveChatGptAuth } from "@/lib/carousels/images/credentials";
import { readClaudePlanToken } from "@/lib/ai/claude-plan";
import { getDb, schema } from "@/lib/db";
import { workerAuthorized } from "@/lib/jobs";

/**
 * POST /api/worker/projects/<id>/imagenes — imágenes generadas para las animaciones del Editor (lib/video/compos).
 * Solo mientras corre un trabajo del proyecto que las usa (VIDEO_ANALYZE o VIDEO_COMPOS):
 * - { op: "credentials" }: la credencial de imágenes del cliente (ChatGPT o API key de OpenAI), descifrada. Viaja
 *   solo en la respuesta; el worker no la guarda ni la loguea.
 * - { op: "chatgpt", authJson }: guarda la sesión de ChatGPT si Codex refrescó los tokens.
 * - { op: "claude" }: el token de la suscripción de Claude del cliente (lib/ai/claude-plan.ts), para el agente de
 *   animaciones (solo en VIDEO_COMPOS).
 */
const body = z.discriminatedUnion("op", [z.object({ op: z.literal("credentials") }), z.object({ op: z.literal("chatgpt"), authJson: z.string().min(20).max(50_000) }), z.object({ op: z.literal("claude") })]);

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
    if (parsed.data.op === "claude") {
      const token = await readClaudePlanToken();
      if (!token) return NextResponse.json({ error: "La suscripción de Claude ya no se usa: la IA va con la clave de API de Anthropic.", retry: false }, { status: 422 });
      return NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } });
    }
    if (parsed.data.op === "chatgpt") {
      const saved = await saveChatGptAuth(parsed.data.authJson, job.createdBy);
      return NextResponse.json({ ok: true, label: saved.label });
    }
    const status = await providersStatus();
    if (!status.preferred) return NextResponse.json({ error: "Agrega tu clave de API de OpenAI en Ajustes → Claves de servicios para generar imágenes.", retry: false }, { status: 422 });
    const creds = await IMAGE_PROVIDERS[status.preferred].workerCredentials();
    if (!creds) return NextResponse.json({ error: "Vuelve a conectar tu cuenta de imágenes en Ajustes.", retry: false }, { status: 422 });
    return NextResponse.json(creds, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CredentialError) return NextResponse.json({ error: error.message, retry: false }, { status: 422 });
    console.error("[worker/imagenes]", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "No pudimos leer la conexión guardada.", retry: true }, { status: 500 });
  }
}
