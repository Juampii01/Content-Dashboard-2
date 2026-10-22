import { NextResponse, type NextRequest } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { fileDriver } from "@/lib/storage";
import { assertKey, fileInfo, writeLocal } from "@/lib/storage/files";

/**
 * PUT /api/clon/archivos/<clave> — solo con el almacenamiento local de desarrollo: el navegador sube aquí el video para
 * traducir (con Vercel Blob usa /api/clon/subir y URLs firmadas, y esta ruta responde 404).
 * Solo la ruta reservada `clon/subidas/<uuid>/original.mp4|webm`, una sola vez y hasta 200 MB.
 * Está fuera del `matcher` de proxy.ts (como /api/editor/files) para que el cuerpo no se copie en memoria;
 * la sesión se comprueba aquí mismo.
 */
const KEY_RE = /^clon\/subidas\/[0-9a-f-]{36}\/original\.(mp4|webm)$/;

export async function PUT(request: NextRequest, { params }: RouteContext<"/api/clon/archivos/[...key]">) {
  if (fileDriver() !== "local") return new NextResponse(null, { status: 404 });
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar." }, { status: 401 });
  if (user.role === "VIEWER") return NextResponse.json({ error: "Tu usuario es de solo lectura." }, { status: 403 });
  let key: string;
  try {
    key = assertKey((await params).key.join("/"));
  } catch {
    return NextResponse.json({ error: "Archivo no válido." }, { status: 400 });
  }
  if (!KEY_RE.test(key) || (await fileInfo(key))) return NextResponse.json({ error: "Esta subida ya no es válida. Vuelve a empezar." }, { status: 400 });
  if (!request.body) return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });
  try {
    const bytes = await writeLocal(key, request.body, 209_715_200);
    return NextResponse.json({ ok: true, bytes });
  } catch {
    return NextResponse.json({ error: "La subida se cortó o el video supera los 200 MB. Vuelve a intentarlo." }, { status: 400 });
  }
}
