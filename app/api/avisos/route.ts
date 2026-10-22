import { NextResponse } from "next/server";
import { getNotifications, markNotificationsSeen } from "@/lib/dal/notifications";

/** GET /api/avisos — los avisos del usuario (la campana los consulta cada tanto). */
export async function GET() {
  return NextResponse.json(await getNotifications(), { headers: { "cache-control": "no-store" } });
}

/** POST /api/avisos — marca los avisos como vistos (al abrir la campana). */
export async function POST() {
  await markNotificationsSeen();
  return NextResponse.json({ ok: true });
}
