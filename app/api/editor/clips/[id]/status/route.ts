import { NextResponse, type NextRequest } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { getLongVideoStatus } from "@/lib/dal/clips";

/** GET /api/editor/clips/<id>/status — estado y progreso real de un video largo; la pantalla lo consulta cada 2 s. */
export async function GET(_request: NextRequest, { params }: RouteContext<"/api/editor/clips/[id]/status">) {
  if (!(await getOptionalUser())) return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar." }, { status: 401 });
  const status = await getLongVideoStatus((await params).id);
  if (!status) return NextResponse.json({ error: "No encontramos ese video." }, { status: 404 });
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
