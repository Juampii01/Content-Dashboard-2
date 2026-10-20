import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getOptionalUser } from "@/lib/auth";
import { carouselFilesReady, fileUrl, IMAGE_TYPES, MAX_IMAGE_BYTES, putFile, sniffImage } from "@/lib/carousels/files";
import { getDb, schema } from "@/lib/db";
import { allowAttempt } from "@/lib/rate-limit";

/**
 * POST /api/carruseles/subir?tipo=foto&carrusel=<id>&slide=<id>         → foto propia para un slide
 * POST /api/carruseles/subir?tipo=referencia&plantilla=<id>&n=<1..20>  → una imagen del carrusel de referencia
 *
 * El cuerpo es la imagen (JPG, PNG o WebP, hasta 8 MB; el navegador la reduce antes a 2000 px). El tipo se comprueba
 * por sus primeros bytes. Las referencias se borran apenas termina el análisis.
 */
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(request: NextRequest) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar." }, { status: 401 });
  if (user.role === "VIEWER") return NextResponse.json({ error: "Tu usuario es de solo lectura." }, { status: 403 });
  if (!carouselFilesReady()) return NextResponse.json({ error: "Falta configurar el almacenamiento de archivos. Avísale a soporte." }, { status: 503 });
  if (!(await allowAttempt(`carruseles-subir:${user.id}`, 300, 3600))) return NextResponse.json({ error: "Subiste demasiadas imágenes seguidas. Espera unos minutos." }, { status: 429 });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES) return NextResponse.json({ error: "La imagen pesa más de 8 MB." }, { status: 413 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return NextResponse.json({ error: "Falta la imagen." }, { status: 400 });
  if (bytes.length > MAX_IMAGE_BYTES) return NextResponse.json({ error: "La imagen pesa más de 8 MB." }, { status: 413 });
  const type = sniffImage(bytes);
  if (!type) return NextResponse.json({ error: "Ese archivo no es una imagen JPG, PNG o WebP." }, { status: 415 });
  const ext = IMAGE_TYPES[type]!;

  const q = request.nextUrl.searchParams;
  let key: string;
  if (q.get("tipo") === "foto") {
    const carouselId = q.get("carrusel") ?? "";
    const slideId = q.get("slide") ?? "";
    if (!UUID.test(carouselId) || !/^[a-z0-9]{1,40}$/i.test(slideId)) return NextResponse.json({ error: "Slide no válido." }, { status: 400 });
    const [row] = await getDb().select({ id: schema.carousels.id }).from(schema.carousels).where(eq(schema.carousels.id, carouselId)).limit(1);
    if (!row) return NextResponse.json({ error: "No encontramos ese carrusel." }, { status: 404 });
    key = `carruseles/${carouselId}/${slideId.toLowerCase()}-${randomBytes(4).toString("hex")}.${ext}`;
  } else if (q.get("tipo") === "referencia") {
    const templateId = q.get("plantilla") ?? "";
    const n = Number(q.get("n"));
    if (!UUID.test(templateId) || !Number.isInteger(n) || n < 1 || n > 20) return NextResponse.json({ error: "Pedido no válido." }, { status: 400 });
    const [row] = await getDb().select({ status: schema.carouselTemplates.status, source: schema.carouselTemplates.source }).from(schema.carouselTemplates).where(eq(schema.carouselTemplates.id, templateId)).limit(1);
    if (!row || row.source !== "upload" || row.status !== "ANALYZING") return NextResponse.json({ error: "Esta plantilla ya no recibe imágenes. Empieza de nuevo." }, { status: 409 });
    key = `carruseles-ref/${templateId}/${String(n).padStart(2, "0")}.${ext}`;
  } else {
    return NextResponse.json({ error: "Pedido no válido." }, { status: 400 });
  }

  try {
    await putFile(key, bytes, type);
  } catch (error) {
    console.error("[carruseles/subir]", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "No pudimos guardar la imagen. Prueba de nuevo." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, key, url: key.startsWith("carruseles/") ? fileUrl(key) : null });
}
