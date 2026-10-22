import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { workerAuthorized } from "@/lib/jobs";
import { fileDriver, workerTransfer } from "@/lib/storage";
import { loadLongVideo } from "@/lib/clips/service";
import { loadClip } from "@/lib/video/library";
import { loadProject } from "@/lib/video/service";
import { loadStyle } from "@/lib/video/styles";

/**
 * POST /api/worker/storage — solo para el worker (Bearer WORKER_SECRET).
 * Devuelve un acceso de corta duración (método, URL y cabeceras) para bajar o subir un archivo.
 * Así el worker no conoce el proveedor de almacenamiento ni tiene sus claves.
 * Solo se firman archivos del dueño que se indica (uno y solo uno):
 * - projectId: `editor/<id>/…` o (solo lectura) el original guardado en el proyecto.
 * - styleId: `editor/estilos/<id>/…` (la referencia subida, solo lectura, y la miniatura).
 * - clipId: `editor/biblioteca/<id>/…` (el clip, solo lectura, y su miniatura).
 * - longVideoId: `editor/largos/<id>/…` (el video largo: se lee, y si vino de un link el worker lo guarda una vez;
 *   las vistas previas y pósters de sus clips).
 */
const body = z
  .object({
    projectId: z.uuid().optional(),
    styleId: z.uuid().optional(),
    clipId: z.uuid().optional(),
    longVideoId: z.uuid().optional(),
    key: z.string().min(3).max(1000),
    op: z.enum(["get", "put"]),
    contentType: z.string().max(100).optional(),
  })
  .refine((b) => [b.projectId, b.styleId, b.clipId, b.longVideoId].filter(Boolean).length === 1);

const denied = () => NextResponse.json({ error: "Ese archivo no es de este trabajo." }, { status: 403 });

export async function POST(request: NextRequest) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pedido no válido." }, { status: 400 });
  const { projectId, styleId, clipId, longVideoId, key, op, contentType } = parsed.data;
  if (!fileDriver()) return NextResponse.json({ error: "Falta configurar el almacenamiento de videos." }, { status: 503 });

  if (projectId) {
    const project = await loadProject(projectId);
    if (!project) return NextResponse.json({ error: "Proyecto inexistente." }, { status: 404 });
    // Archivos propios del proyecto, o (solo lectura) el original que viene de "Videos con clon" (`clon/<id>/…`).
    const cloneOriginal = op === "get" && key === project.sourceKey && key.startsWith("clon/");
    const own = key.startsWith(`editor/${projectId}/`) || cloneOriginal;
    if (!own) return denied();
    // El original de un proyecto creado desde un clip lo genera el worker (corte y reencuadre del video largo).
    const fromClip = Boolean((project.media as { clip?: unknown } | null)?.clip) && key === `editor/${projectId}/original.mp4`;
    if (op === "put" && key === project.sourceKey && !fromClip) return NextResponse.json({ error: "El original no se reemplaza." }, { status: 403 });
  } else if (styleId) {
    const style = await loadStyle(styleId);
    if (!style) return NextResponse.json({ error: "Ese estilo ya no existe." }, { status: 404 });
    if (!key.startsWith(`editor/estilos/${styleId}/`)) return denied();
    if (op === "put" && key !== `editor/estilos/${styleId}/miniatura.jpg`) return denied();
  } else if (longVideoId) {
    const video = await loadLongVideo(longVideoId);
    if (!video) return NextResponse.json({ error: "Ese video ya no existe." }, { status: 404 });
    if (!key.startsWith(`editor/largos/${longVideoId}/`)) return denied();
    const original = key === video.sourceKey;
    // El original subido no se reemplaza; el bajado de un link se guarda una sola vez (el worker lo sube al terminar de bajarlo).
    if (op === "put" && original && video.sourceKind !== "link") return NextResponse.json({ error: "El original no se reemplaza." }, { status: 403 });
    if (op === "put" && !original && !key.startsWith(`editor/largos/${longVideoId}/clips/`) && key !== `editor/largos/${longVideoId}/poster.jpg`) return denied();
  } else if (clipId) {
    const clip = await loadClip(clipId);
    if (!clip) return NextResponse.json({ error: "Ese clip ya no existe." }, { status: 404 });
    if (!key.startsWith(`editor/biblioteca/${clipId}/`)) return denied();
    if (op === "put" && key !== `editor/biblioteca/${clipId}/miniatura.jpg`) return denied();
  }
  try {
    return NextResponse.json(await workerTransfer(key, op, contentType));
  } catch (error) {
    console.error("[worker/storage]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No se pudo preparar el acceso al archivo." }, { status: 500 });
  }
}
