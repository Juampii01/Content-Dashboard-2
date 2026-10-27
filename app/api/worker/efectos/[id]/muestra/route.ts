import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { workerAuthorized } from "@/lib/jobs";
import { loadEffect, setSample } from "@/lib/video/compos/library-service";

/**
 * POST /api/worker/efectos/<id>/muestra — solo para el worker (Bearer WORKER_SECRET). Avisa que guardó el cuadro y
 * la muestra en bucle de un efecto de Mis efectos (siempre en las claves fijas del efecto).
 */
const body = z.object({ posterKey: z.string().max(200), sampleKey: z.string().max(200) });

export async function POST(request: NextRequest, { params }: RouteContext<"/api/worker/efectos/[id]/muestra">) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Efecto no válido." }, { status: 400 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pedido no válido." }, { status: 400 });
  const effect = await loadEffect(id);
  if (!effect) return NextResponse.json({ error: "Ese efecto ya no existe." }, { status: 404 });
  const posterKey = `editor/efectos/${id}/poster.jpg`;
  const sampleKey = `editor/efectos/${id}/muestra.webm`;
  if (parsed.data.posterKey !== posterKey || parsed.data.sampleKey !== sampleKey) return NextResponse.json({ error: "Claves no válidas." }, { status: 403 });
  await setSample(id, { posterKey, sampleKey });
  return NextResponse.json({ ok: true });
}
