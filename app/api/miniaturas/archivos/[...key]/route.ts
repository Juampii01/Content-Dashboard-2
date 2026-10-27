import { NextResponse, type NextRequest } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { carouselFilesReady, serveFile } from "@/lib/carousels/files";
import { servableKey } from "@/lib/youtube/files";

/**
 * GET /api/miniaturas/archivos/<clave> — fotos del personaje, recortes y fondos de las miniaturas, solo con sesión.
 * Se sirven desde el mismo origen para que la vista previa y la exportación a JPG puedan dibujarlas.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/miniaturas/archivos/[...key]">) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar." }, { status: 401 });
  const key = (await params).key.join("/");
  if (!servableKey(key)) return NextResponse.json({ error: "Archivo no válido." }, { status: 404 });
  if (!carouselFilesReady()) return NextResponse.json({ error: "Falta configurar el almacenamiento de archivos." }, { status: 503 });
  return serveFile(key, request);
}
