import { after, NextResponse, type NextRequest } from "next/server";
import { workerAuthorized } from "@/lib/jobs";
import { sweepJobNotifications } from "@/lib/notifications";

/** POST /api/worker/avisos — el worker avisa que terminó un trabajo: se arman los avisos (y correos) pendientes. */
export async function POST(request: NextRequest) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  after(() => sweepJobNotifications().catch((error: unknown) => console.error("[avisos] barrido:", error instanceof Error ? error.message : error)));
  return NextResponse.json({ ok: true });
}
