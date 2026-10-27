import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { carouselFilesReady, IMAGE_TYPES, MAX_IMAGE_BYTES, putFile, sniffImage } from "@/lib/carousels/files";
import { allowAttempt } from "@/lib/rate-limit";
import { addBrandPhoto, PackageError } from "@/lib/youtube/packages";
import { thumbFileUrl } from "@/lib/youtube/files";

/**
 * POST /api/miniaturas/fotos — sube una foto del personaje a Mi marca (la usan las miniaturas de YouTube) y pide su
 * recorte al worker. El cuerpo es la imagen (JPG, PNG o WebP, hasta 8 MB; el navegador la reduce antes a 2000 px).
 * El tipo se comprueba por sus primeros bytes.
 */
export async function POST(request: NextRequest) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar." }, { status: 401 });
  if (user.role === "VIEWER") return NextResponse.json({ error: "Tu usuario es de solo lectura." }, { status: 403 });
  if (!carouselFilesReady()) return NextResponse.json({ error: "Falta configurar el almacenamiento de archivos. Avísale a soporte." }, { status: 503 });
  if (!(await allowAttempt(`miniaturas-fotos:${user.id}`, 40, 3600))) return NextResponse.json({ error: "Subiste demasiadas fotos seguidas. Espera unos minutos." }, { status: 429 });
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES) return NextResponse.json({ error: "La foto pesa más de 8 MB." }, { status: 413 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return NextResponse.json({ error: "Falta la foto." }, { status: 400 });
  if (bytes.length > MAX_IMAGE_BYTES) return NextResponse.json({ error: "La foto pesa más de 8 MB." }, { status: 413 });
  const type = sniffImage(bytes);
  if (!type) return NextResponse.json({ error: "Ese archivo no es una foto JPG, PNG o WebP." }, { status: 415 });
  const key = `marca/fotos/${randomBytes(8).toString("hex")}.${IMAGE_TYPES[type]}`;
  try {
    await putFile(key, bytes, type);
    await addBrandPhoto(key, user.id);
  } catch (error) {
    if (error instanceof PackageError) return NextResponse.json({ error: error.message }, { status: 422 });
    console.error("[miniaturas/fotos]", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "No pudimos guardar la foto. Prueba de nuevo." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, key, url: thumbFileUrl(key) });
}
