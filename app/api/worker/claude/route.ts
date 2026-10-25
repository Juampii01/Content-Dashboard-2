import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ClaudePlanError, saveClaudePlanToken } from "@/lib/ai/claude-plan";
import { fail, workerJob } from "@/lib/carousels/worker-api";

/**
 * POST /api/worker/claude — guarda, cifrado, el token de la suscripción de Claude que obtuvo el worker al terminar
 * `claude setup-token` (trabajo CLAUDE_LOGIN). El worker no lo guarda ni lo loguea.
 */
const body = z.object({ token: z.string().min(20).max(2000) });

export async function POST(request: NextRequest) {
  const gate = await workerJob(request, ["CLAUDE_LOGIN"]);
  if (gate instanceof NextResponse) return gate;
  const parsed = body.safeParse(gate.body);
  if (!parsed.success) return fail("El token de Claude llegó incompleto.", 400);
  try {
    const saved = await saveClaudePlanToken(parsed.data.token, gate.job.createdBy);
    return NextResponse.json({ ok: true, label: saved.label });
  } catch (error) {
    if (error instanceof ClaudePlanError) return fail(error.message);
    console.error("[worker/claude]", error instanceof Error ? error.message : "error");
    return fail("No pudimos guardar la conexión con Claude.", 500, true);
  }
}
