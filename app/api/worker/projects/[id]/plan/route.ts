import { NextResponse, type NextRequest } from "next/server";
import { workerAuthorized } from "@/lib/jobs";
import { generatePlan, VideoError } from "@/lib/video/service";

/**
 * POST /api/worker/projects/<id>/plan — lo llama el worker cuando termina de transcribir.
 * La IA vive en la app (TypeScript): aquí se calculan los candidatos, Claude arma el plan v2, se valida con Zod
 * y el proyecto queda en revisión. Es idempotente: si ya hay plan, responde sin volver a llamar a la IA.
 * Si esta llamada falla o se corta, el trabajo del worker se reintenta con espera creciente.
 */
export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: RouteContext<"/api/worker/projects/[id]/plan">) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.json({ ok: true, ...(await generatePlan(id)) });
  } catch (error) {
    if (error instanceof VideoError) return NextResponse.json({ error: error.message, retry: false }, { status: 422 });
    console.error("[worker/plan]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No pudimos armar el plan de edición.", retry: true }, { status: 500 });
  }
}
