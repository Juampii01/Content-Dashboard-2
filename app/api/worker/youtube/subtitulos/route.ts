import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { fail, workerJob } from "@/lib/carousels/worker-api";
import { saveTranscript } from "@/lib/youtube/retention-service";
import { MAX_SUBTITLE_BYTES, parseSubtitles, sanitizeSegments } from "@/lib/youtube/transcript";

/**
 * POST /api/worker/youtube/subtitulos — los subtítulos públicos (.vtt) de un video, que el worker leyó con yt-dlp.
 * Se leen con el mismo lector que los archivos que sube el cliente y se guardan como transcripción de la pieza.
 */
const body = z.object({ content: z.string().min(10).max(MAX_SUBTITLE_BYTES * 2), language: z.string().max(20).nullable(), kind: z.enum(["manual", "auto"]) });

export async function POST(request: NextRequest) {
  const gate = await workerJob(request, ["YOUTUBE_TRANSCRIPT"]);
  if (gate instanceof NextResponse) return gate;
  const parsed = body.safeParse(gate.body);
  if (!parsed.success) return fail("Los subtítulos llegaron incompletos.", 400);
  const contentItemId = (gate.job.input as { contentItemId?: string }).contentItemId;
  if (!contentItemId) return fail("Falta la pieza.", 400);
  const segments = sanitizeSegments(parseSubtitles(parsed.data.content));
  if (segments.length < 2) return fail("Los subtítulos de YouTube no tienen tiempos que podamos leer. Sube el archivo desde YouTube Studio.");
  try {
    await saveTranscript({ contentItemId, source: "youtube", segments, language: parsed.data.language, userId: gate.job.createdBy });
    return NextResponse.json({ ok: true, segments: segments.length });
  } catch (error) {
    console.error("[worker/youtube/subtitulos]", error instanceof Error ? error.message : error);
    return fail("No pudimos guardar los subtítulos.", 500, true);
  }
}
