import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { workerAuthorized } from "@/lib/jobs";
import { saveStyleResult, StyleError } from "@/lib/video/styles";

/**
 * POST /api/worker/styles/<id>/result — lo llama el worker al terminar de analizar un video de referencia.
 * La app valida lo medido (Zod), arma el preset, deja el estilo listo y borra la referencia subida.
 * Idempotente: si el estilo ya está listo, responde sin cambiar nada.
 */
const body = z.object({ metrics: z.record(z.string(), z.unknown()), thumbKey: z.string().max(300).nullable() });

export async function POST(request: NextRequest, { params }: RouteContext<"/api/worker/styles/[id]/result">) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Estilo no válido.", retry: false }, { status: 400 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "El análisis llegó incompleto.", retry: false }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await saveStyleResult(id, parsed.data)) });
  } catch (error) {
    if (error instanceof StyleError) return NextResponse.json({ error: error.message, retry: false }, { status: 422 });
    console.error("[worker/estilos]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No pudimos guardar el estilo.", retry: true }, { status: 500 });
  }
}
