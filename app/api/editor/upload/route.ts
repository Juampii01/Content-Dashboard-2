import { NextResponse, type NextRequest } from "next/server";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { getOptionalUser } from "@/lib/auth";
import { fileDriver, VIDEO_TYPES } from "@/lib/storage";
import { uploadDelegation } from "@/lib/storage/files";
import { loadProject } from "@/lib/video/service";

/**
 * POST /api/editor/upload — firma la subida directa del navegador a Vercel Blob (store privado).
 * El archivo nunca pasa por esta función: el navegador recibe URLs firmadas (PUT simple o multipart)
 * válidas solo para la ruta reservada del proyecto (`editor/<id>/original.<ext>`).
 * No se usa el aviso de "subida completa" de Blob: al terminar, el navegador llama a una acción
 * que verifica el archivo con `head` y encola el análisis (funciona igual en local y en producción).
 */
export async function POST(request: NextRequest) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar." }, { status: 401 });
  if (user.role === "VIEWER") return NextResponse.json({ error: "Tu usuario es de solo lectura." }, { status: 403 });
  if (fileDriver() !== "blob") return NextResponse.json({ error: "La subida a Blob no está configurada." }, { status: 400 });

  const body = (await request.json().catch(() => null)) as HandleUploadPresignedBody | null;
  if (!body) return NextResponse.json({ error: "Pedido no válido." }, { status: 400 });
  try {
    const result = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname, clientPayload) => {
        const project = clientPayload ? await loadProject(clientPayload) : null;
        if (!project || project.status !== "UPLOADING" || project.sourceKey !== pathname) throw new Error("Esta subida ya no es válida. Vuelve a empezar.");
        return {
          token: await uploadDelegation(pathname),
          urlOptions: {
            allowedContentTypes: Object.keys(VIDEO_TYPES),
            maximumSizeInBytes: project.sourceBytes ?? undefined,
            allowOverwrite: true,
            addRandomSuffix: false,
            validUntil: Date.now() + 6 * 3600_000,
          },
        };
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error && /subida/.test(error.message) ? error.message : "No pudimos preparar la subida. Prueba de nuevo.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
