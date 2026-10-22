import { NextResponse, type NextRequest } from "next/server";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { getOptionalUser } from "@/lib/auth";
import { fileDriver } from "@/lib/storage";
import { uploadDelegation } from "@/lib/storage/files";

/**
 * POST /api/clon/subir — firma la subida directa del navegador a Vercel Blob (store privado) de un video para
 * traducir (Videos con clon → Traducir → Subir un video). El archivo no pasa por esta función.
 * Solo admite la ruta que reserva `prepareTranslationUploadAction` (`clon/subidas/<uuid>/original.mp4|webm`),
 * MP4 o WebM y hasta 200 MB (lo que acepta la subida directa de HeyGen).
 */
const KEY_RE = /^clon\/subidas\/[0-9a-f-]{36}\/original\.(mp4|webm)$/;

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
      getSignedToken: async (pathname) => {
        if (!KEY_RE.test(pathname)) throw new Error("Esta subida ya no es válida. Vuelve a empezar.");
        return {
          token: await uploadDelegation(pathname, "video"),
          urlOptions: {
            allowedContentTypes: ["video/mp4", "video/webm"],
            maximumSizeInBytes: 209_715_200,
            allowOverwrite: false,
            addRandomSuffix: false,
            validUntil: Date.now() + 3 * 3600_000,
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
