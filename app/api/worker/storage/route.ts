import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { workerAuthorized } from "@/lib/jobs";
import { fileDriver, workerTransfer } from "@/lib/storage";
import { loadProject } from "@/lib/video/service";

/**
 * POST /api/worker/storage — solo para el worker (Bearer WORKER_SECRET).
 * Devuelve un acceso de corta duración (método, URL y cabeceras) para bajar o subir un archivo de un proyecto.
 * Así el worker no conoce el proveedor de almacenamiento ni tiene sus claves.
 * Solo se firman archivos del propio proyecto: `editor/<id>/…` o el original guardado en el proyecto.
 */
const body = z.object({
  projectId: z.uuid(),
  key: z.string().min(3).max(1000),
  op: z.enum(["get", "put"]),
  contentType: z.string().max(100).optional(),
});

export async function POST(request: NextRequest) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pedido no válido." }, { status: 400 });
  const { projectId, key, op, contentType } = parsed.data;
  if (!fileDriver()) return NextResponse.json({ error: "Falta configurar el almacenamiento de videos." }, { status: 503 });

  const project = await loadProject(projectId);
  if (!project) return NextResponse.json({ error: "Proyecto inexistente." }, { status: 404 });

  // Archivos propios del proyecto, o (solo lectura) el original que viene de "Videos con clon" (`clon/<id>/…`).
  const cloneOriginal = op === "get" && key === project.sourceKey && key.startsWith("clon/");
  const own = key.startsWith(`editor/${projectId}/`) || cloneOriginal;
  if (!own) return NextResponse.json({ error: "Ese archivo no es de este proyecto." }, { status: 403 });
  if (op === "put" && key === project.sourceKey) return NextResponse.json({ error: "El original no se reemplaza." }, { status: 403 });
  try {
    return NextResponse.json(await workerTransfer(key, op, contentType));
  } catch (error) {
    console.error("[worker/storage]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No se pudo preparar el acceso al archivo." }, { status: 500 });
  }
}
