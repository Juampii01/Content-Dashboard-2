import { NextResponse, type NextRequest } from "next/server";
import { ClipsError, findMoments } from "@/lib/clips/service";
import { workerAuthorized } from "@/lib/jobs";

/**
 * POST /api/worker/clips/<id>/moments — lo llama el worker cuando termina de transcribir un video largo.
 * La app arma los candidatos con reglas, Claude elige y explica los momentos y se guardan los clips con su puntaje.
 * Responde el tramo de cada clip y su ventana (el clip con margen) para que el worker siga las caras ahí.
 * Idempotente: si los clips ya existen, los devuelve sin volver a llamar a la IA.
 */
export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: RouteContext<"/api/worker/clips/[id]/moments">) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Video no válido.", retry: false }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await findMoments(id)) });
  } catch (error) {
    if (error instanceof ClipsError) return NextResponse.json({ error: error.message, retry: false }, { status: 422 });
    console.error("[worker/clips]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No pudimos elegir los momentos del video.", retry: true }, { status: 500 });
  }
}
