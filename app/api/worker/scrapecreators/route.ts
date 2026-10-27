import { NextResponse } from "next/server";
import { fail, workerJob } from "@/lib/carousels/worker-api";
import { readScrapeCreatorsKey } from "@/lib/scrapecreators/key";

/**
 * POST /api/worker/scrapecreators — la clave de ScrapeCreators del cliente, descifrada, para el plan B de
 * `download_link` (worker/video/style_job.py) cuando Instagram o TikTok bloquean la descarga desde el servidor.
 * Solo para un trabajo en curso de los que bajan links: { jobId } → { apiKey: string | null }. Sin clave responde
 * null (el worker muestra qué hacer). Viaja solo en la respuesta; el worker no la guarda ni la loguea.
 */
const LINK_JOBS = ["VIDEO_STYLE", "REEL_COPY", "AUDIO_SPLIT", "LONG_VIDEO_CLIPS", "VIDEO_LOOK", "VIDEO_ANALYZE"] as const;

export async function POST(request: Request) {
  const gate = await workerJob(request, [...LINK_JOBS]);
  if (gate instanceof NextResponse) return gate;
  try {
    const apiKey = await readScrapeCreatorsKey();
    return NextResponse.json({ apiKey }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[worker/scrapecreators]", error instanceof Error ? error.message : "error");
    return fail("No pudimos leer tu clave de ScrapeCreators. Vuelve a guardarla en Ajustes → Claves de servicios.");
  }
}
