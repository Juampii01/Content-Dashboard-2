import { NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { instagramAvatarSource } from "@/lib/dal/carousels";

/**
 * GET /api/carruseles/avatar
 * Foto de perfil de la cuenta de Instagram conectada, servida desde el mismo origen.
 * Hace falta para la plantilla Tweet: la exportación a imagen en el navegador no puede leer imágenes
 * de otro dominio (el CDN de Instagram no manda CORS). Solo para usuarios con sesión.
 */
export async function GET() {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Inicia sesión." }, { status: 401 });
  const source = await instagramAvatarSource();
  if (!source) return new NextResponse(null, { status: 404 });
  // Solo dominios de imágenes de Meta: la URL viene de la API, pero no se usa para pedir cualquier cosa.
  const host = new URL(source).hostname;
  if (!/(^|\.)(cdninstagram\.com|fbcdn\.net|instagram\.com)$/.test(host)) return new NextResponse(null, { status: 404 });
  try {
    const res = await fetch(source, { signal: AbortSignal.timeout(8_000), redirect: "follow" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/^image\/(jpeg|png|webp|gif)/.test(type)) return new NextResponse(null, { status: 404 });
    const body = await res.arrayBuffer();
    if (body.byteLength > 2_000_000) return new NextResponse(null, { status: 404 });
    return new NextResponse(body, { headers: { "content-type": type, "cache-control": "private, max-age=3600" } });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
