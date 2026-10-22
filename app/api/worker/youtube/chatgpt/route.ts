import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CredentialError, saveChatGptAuth } from "@/lib/carousels/images/credentials";
import { fail, workerJob } from "@/lib/carousels/worker-api";

/** POST /api/worker/youtube/chatgpt — guarda, cifrado, el auth.json de Codex si se refrescó durante un YT_THUMBNAILS. */
const body = z.object({ authJson: z.string().min(20).max(50_000) });

export async function POST(request: NextRequest) {
  const gate = await workerJob(request, ["YT_THUMBNAILS"]);
  if (gate instanceof NextResponse) return gate;
  if ((gate.job.input as { provider?: string }).provider !== "chatgpt") return fail("Este trabajo no usa ChatGPT.", 403);
  const parsed = body.safeParse(gate.body);
  if (!parsed.success) return fail("La sesión de ChatGPT llegó incompleta.", 400);
  try {
    const saved = await saveChatGptAuth(parsed.data.authJson, gate.job.createdBy);
    return NextResponse.json({ ok: true, label: saved.label });
  } catch (error) {
    if (error instanceof CredentialError) return fail(error.message);
    console.error("[worker/youtube/chatgpt]", error instanceof Error ? error.message : "error");
    return fail("No pudimos guardar la conexión con ChatGPT.", 500, true);
  }
}
