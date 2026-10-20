import { NextResponse, type NextRequest } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { carouselFilesReady, serveFile, SLIDE_KEY_RE } from "@/lib/carousels/files";

/**
 * GET /api/carruseles/archivos/carruseles/<carrusel>/<archivo> — imágenes de los slides, solo con sesión.
 * Se sirven desde el mismo origen para que la vista previa y la exportación a JPG puedan dibujarlas.
 * Las imágenes de referencia (`carruseles-ref/…`) no se sirven nunca.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/carruseles/archivos/[...key]">) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar." }, { status: 401 });
  const key = (await params).key.join("/");
  if (!SLIDE_KEY_RE.test(key)) return NextResponse.json({ error: "Archivo no válido." }, { status: 404 });
  if (!carouselFilesReady()) return NextResponse.json({ error: "Falta configurar el almacenamiento de archivos." }, { status: 503 });
  return serveFile(key, request);
}
