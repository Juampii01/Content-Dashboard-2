import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getOptionalUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { HeyGenError } from "@/lib/heygen/client";
import { freshHeyGenFileUrl } from "@/lib/heygen/service";
import { isStoredUrl, openStoredFile } from "@/lib/storage/copy";

/**
 * GET /api/clon/{id}/archivo?tipo=video|srt|miniatura[&descargar=1]
 *
 * Sirve los archivos de un video con clon solo a quien tiene sesión. Si ya están en nuestro almacenamiento
 * (Blob privado), se mandan desde ahí con soporte de `Range`. Si siguen solo en HeyGen (sin Blob configurado
 * o la copia falló), se pide a HeyGen una URL vigente (las firmadas vencen) y se redirige o se transmite.
 */
const kinds = {
  video: { column: "videoUrl", type: "video/mp4", ext: "mp4" },
  srt: { column: "subtitleUrl", type: "application/x-subrip; charset=utf-8", ext: "srt" },
  miniatura: { column: "thumbnailUrl", type: "image/jpeg", ext: "jpg" },
} as const;

function fileName(title: string, ext: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `${base || "video-clon"}.${ext}`;
}

export async function GET(request: NextRequest, { params }: RouteContext<"/api/clon/[id]/archivo">) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar." }, { status: 401 });

  const { id } = await params;
  const kindParam = request.nextUrl.searchParams.get("tipo") ?? "video";
  if (!(kindParam in kinds) || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Archivo no válido." }, { status: 404 });
  const kind = kindParam as keyof typeof kinds;
  const spec = kinds[kind];

  const [row] = await getDb().select().from(schema.cloneVideos).where(eq(schema.cloneVideos.id, id)).limit(1);
  const stored = row?.[spec.column];
  if (!row || !stored) return NextResponse.json({ error: "Ese archivo todavía no existe." }, { status: 404 });

  const download = request.nextUrl.searchParams.get("descargar") === "1";
  const disposition = `${download ? "attachment" : "inline"}; filename="${fileName(row.title, spec.ext)}"`;
  const range = request.headers.get("range");

  let upstream: Response | null = null;
  if (isStoredUrl(stored)) {
    upstream = await openStoredFile(stored, range).catch(() => null);
  } else {
    let url: string | null;
    try {
      url = await freshHeyGenFileUrl(row, kind);
    } catch (error) {
      const message = error instanceof HeyGenError ? error.userMessage : "No pudimos traer el archivo desde HeyGen.";
      return NextResponse.json({ error: message }, { status: 502 });
    }
    if (!url) return NextResponse.json({ error: "HeyGen ya no tiene este archivo." }, { status: 404 });
    // En producción HeyGen sirve por https: se redirige y el navegador baja directo (la CSP admite https).
    if (url.startsWith("https://") && !download) return NextResponse.redirect(url, 302);
    upstream = await fetch(url, { headers: range ? { range } : undefined, cache: "no-store" }).catch(() => null);
  }

  if (!upstream || !upstream.body || (!upstream.ok && upstream.status !== 206)) {
    return NextResponse.json({ error: "No pudimos leer el archivo. Vuelve a intentarlo." }, { status: 502 });
  }

  const headers = new Headers();
  headers.set("Content-Type", kind === "miniatura" ? (upstream.headers.get("content-type") ?? spec.type) : spec.type);
  for (const name of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Content-Disposition", disposition);
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(upstream.body, { status: upstream.status === 206 ? 206 : 200, headers });
}
