import { NextResponse, type NextRequest } from "next/server";
import { workerAuthorized } from "@/lib/jobs";
import { fileDriver } from "@/lib/storage";
import { assertKey, serveLocal, writeLocal } from "@/lib/storage/files";

/**
 * /api/worker/files/<clave> — solo con el almacenamiento local de desarrollo (con Vercel Blob, el worker
 * usa URLs firmadas y esta ruta responde 404). Autenticada con WORKER_SECRET.
 * Está fuera del `matcher` de proxy.ts para que el cuerpo (videos grandes) no se copie en memoria.
 */
const MAX_WORKER_UPLOAD = 20 * 1024 ** 3;

function resolveKey(parts: string[]): string | null {
  try {
    return assertKey(parts.join("/"));
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, { params }: RouteContext<"/api/worker/files/[...key]">) {
  if (fileDriver() !== "local") return new NextResponse(null, { status: 404 });
  if (!workerAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const key = resolveKey((await params).key);
  if (!key) return NextResponse.json({ error: "Clave no válida." }, { status: 400 });
  return serveLocal(key, request);
}

export async function PUT(request: NextRequest, { params }: RouteContext<"/api/worker/files/[...key]">) {
  if (fileDriver() !== "local") return new NextResponse(null, { status: 404 });
  if (!workerAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const key = resolveKey((await params).key);
  // editor/… (videos) o carruseles/… (imágenes de slides, hasta 8 MB). La clave la firmó antes la app para un trabajo.
  if (!key || !(key.startsWith("editor/") || key.startsWith("carruseles/"))) return NextResponse.json({ error: "Clave no válida." }, { status: 400 });
  if (!request.body) return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });
  const bytes = await writeLocal(key, request.body, key.startsWith("carruseles/") ? 8 * 1024 * 1024 : MAX_WORKER_UPLOAD);
  return NextResponse.json({ ok: true, bytes });
}
