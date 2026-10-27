import { after, NextResponse, type NextRequest } from "next/server";
import { workerAuthorized } from "@/lib/jobs";
import { sweepJobNotifications } from "@/lib/notifications";
import { sweepSystemAlerts } from "@/lib/system/alerts";

/** POST /api/worker/avisos — el worker avisa que terminó un trabajo: se arman los avisos (y correos) pendientes. */
export async function POST(request: NextRequest) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  after(async () => {
    await sweepJobNotifications().catch((error: unknown) => console.error("[avisos] barrido:", error instanceof Error ? error.message : error));
    // Si el worker viene fallando trabajo tras trabajo, el dueño se entera (una vez por racha).
    await sweepSystemAlerts();
  });
  return NextResponse.json({ ok: true });
}
