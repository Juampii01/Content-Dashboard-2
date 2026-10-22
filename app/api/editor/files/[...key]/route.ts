import { NextResponse, type NextRequest } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { fileDriver } from "@/lib/storage";
import { assertKey, serveLocal, writeLocal } from "@/lib/storage/files";
import { loadLongVideo } from "@/lib/clips/service";
import { loadClip } from "@/lib/video/library";
import { loadProject } from "@/lib/video/service";
import { loadStyle } from "@/lib/video/styles";

/**
 * /api/editor/files/<clave> — archivos del Editor con el almacenamiento local de desarrollo.
 * GET: reproducir o descargar (con Range). PUT: subir desde el navegador el original de un proyecto,
 * la referencia de un estilo (`editor/estilos/<id>/…`) o un clip de la biblioteca (`editor/biblioteca/<id>/…`),
 * solo a la ruta reservada y mientras está en estado UPLOADING.
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

/** Cuánto puede pesar la subida a esta clave, o null si no hay una subida pendiente para ella. */
async function pendingUpload(key: string): Promise<number | null> {
  const [, scope, id] = key.split("/");
  if (scope === "estilos" && id) {
    const style = await loadStyle(id);
    return style?.status === "UPLOADING" && style.sourceKey === key ? (style.sourceBytes ?? 0) : null;
  }
  if (scope === "largos" && id) {
    const video = await loadLongVideo(id);
    return video?.status === "UPLOADING" && video.sourceKey === key ? (video.sourceBytes ?? 0) : null;
  }
  if (scope === "biblioteca" && id) {
    const clip = await loadClip(id);
    return clip?.status === "UPLOADING" && clip.fileKey === key ? (clip.fileBytes ?? 0) : null;
  }
  const project = scope ? await loadProject(scope) : null;
  return project?.status === "UPLOADING" && project.sourceKey === key ? (project.sourceBytes ?? 0) : null;
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
  const maxBytes = key ? await pendingUpload(key) : null;
  if (!key || maxBytes == null) return NextResponse.json({ error: "Esta subida ya no es válida. Vuelve a empezar." }, { status: 400 });
  if (!request.body) return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });
  try {
    const bytes = await writeLocal(key, request.body, maxBytes);
    return NextResponse.json({ ok: true, bytes });
  } catch {
    return NextResponse.json({ error: "La subida se cortó. Vuelve a intentarlo." }, { status: 400 });
  }
}
