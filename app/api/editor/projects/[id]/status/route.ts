import { NextResponse, type NextRequest } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { getProjectStatus } from "@/lib/dal/video";

/** GET /api/editor/projects/<id>/status — estado y progreso real; la pantalla del proyecto lo consulta cada 2 s. */
export async function GET(_request: NextRequest, { params }: RouteContext<"/api/editor/projects/[id]/status">) {
  if (!(await getOptionalUser())) return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar." }, { status: 401 });
  const status = await getProjectStatus((await params).id);
  if (!status) return NextResponse.json({ error: "No encontramos ese proyecto." }, { status: 404 });
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
