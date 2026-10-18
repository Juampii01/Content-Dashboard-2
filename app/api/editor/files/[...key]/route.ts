import { NextResponse, type NextRequest } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { fileDriver } from "@/lib/storage";
import { assertKey, serveLocal, writeLocal } from "@/lib/storage/files";
import { loadProject } from "@/lib/video/service";

/**
 * /api/editor/files/<clave> — archivos del Editor con el almacenamiento local de desarrollo.
 * GET: reproducir o descargar (con Range). PUT: subir el original desde el navegador.
 * Protegida por sesión aquí mismo; está fuera del `matcher` de proxy.ts para que un video de varios GB
 * no se copie en memoria. Con Vercel Blob responde 404: el navegador usa URLs firmadas.
 */
function resolveKey(parts: string[]): string | null {
  try {
    const key = assertKey(parts.join("/"));
    return key.startsWith("editor/") ? key : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, { params }: RouteContext<"/api/editor/files/[...key]">) {
  if (fileDriver() !== "local") return new NextResponse(null, { status: 404 });
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar." }, { status: 401 });
  const key = resolveKey((await params).key);
  if (!key) return NextResponse.json({ error: "Archivo no válido." }, { status: 400 });
  return serveLocal(key, request, { download: request.nextUrl.searchParams.get("download") });
}

export async function PUT(request: NextRequest, { params }: RouteContext<"/api/editor/files/[...key]">) {
  if (fileDriver() !== "local") return new NextResponse(null, { status: 404 });
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar." }, { status: 401 });
  if (user.role === "VIEWER") return NextResponse.json({ error: "Tu usuario es de solo lectura." }, { status: 403 });
  const key = resolveKey((await params).key);
  const projectId = key?.split("/")[1];
  const project = projectId ? await loadProject(projectId) : null;
  if (!key || !project || project.status !== "UPLOADING" || project.sourceKey !== key) {
    return NextResponse.json({ error: "Esta subida ya no es válida. Vuelve a empezar." }, { status: 400 });
  }
  if (!request.body) return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });
  try {
    const bytes = await writeLocal(key, request.body, project.sourceBytes ?? 0);
    return NextResponse.json({ ok: true, bytes });
  } catch {
    return NextResponse.json({ error: "La subida se cortó. Vuelve a intentarlo." }, { status: 400 });
  }
}
