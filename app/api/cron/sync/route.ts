import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { dueKinds, syncAccount, type SyncOutcome } from "@/lib/social/sync/runner";
import { classifyPendingHooks } from "@/lib/metrics/hooks";
import { ensureWeeklyReport } from "@/lib/home/weekly-report";
import { sweepCloneVideos } from "@/lib/heygen/service";
import { sweepJobNotifications } from "@/lib/notifications";

export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env().CRON_SECRET}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * GET /api/cron/sync: lo llama Vercel Cron cada hora (vercel.json).
 * Decide qué le toca a cada cuenta (histórico, recientes, diario, semanal) y lo hace dentro del presupuesto.
 * También limpia estados de OAuth vencidos, contadores de intentos viejos y registros de más de 90 días.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const started = Date.now();
  const deadline = started + 270_000;
  const db = getDb();

  const accounts = await db
    .select({ id: schema.socialAccounts.id, platform: schema.socialAccounts.platform, backfillCompletedAt: schema.socialAccounts.backfillCompletedAt })
    .from(schema.socialAccounts)
    .where(and(eq(schema.socialAccounts.current, true), inArray(schema.socialAccounts.status, ["ACTIVE", "MISSING_SCOPES", "ERROR"])));

  const results: { platform: string; kind: string; outcome: SyncOutcome }[] = [];
  for (const [index, account] of accounts.entries()) {
    for (const kind of await dueKinds(account)) {
      const remaining = deadline - Date.now();
      // Reparte el tiempo que queda entre las cuentas que faltan.
      const budget = Math.floor(remaining / Math.max(1, accounts.length - index));
      if (budget < 30_000) break;
      results.push({ platform: account.platform, kind, outcome: await syncAccount(account.id, kind, budget) });
    }
  }

  // Ganchos de las piezas nuevas (con el modelo rápido, cuesta centavos). Si falla, se reintenta en la próxima hora.
  if (deadline - Date.now() > 40_000) {
    await classifyPendingHooks(80).catch((error: unknown) => console.error("[cron] ganchos", error instanceof Error ? error.message : error));
  }
  // Resumen de la semana pasada (una vez por semana, desde el lunes a las 9:00 hora de la marca).
  if (deadline - Date.now() > 40_000) {
    await ensureWeeklyReport().catch((error: unknown) => console.error("[cron] resumen semanal", error instanceof Error ? error.message : error));
  }

  await db.delete(schema.oauthStates).where(lt(schema.oauthStates.expiresAt, new Date()));
  await db.delete(schema.rateLimits).where(lt(schema.rateLimits.windowStartedAt, new Date(Date.now() - 86_400_000)));
  await db.delete(schema.syncRuns).where(lt(schema.syncRuns.startedAt, new Date(Date.now() - 90 * 86_400_000)));
  // Una sincronización que murió sin cerrar (por ejemplo, se cortó la función) se da por fallida.
  await db
    .update(schema.syncRuns)
    .set({ status: "FAILED", errorMessage: "La sincronización se interrumpió.", finishedAt: new Date() })
    .where(and(eq(schema.syncRuns.status, "RUNNING"), lt(schema.syncRuns.leaseUntil, sql`now()`)));

  // Videos con clon: respaldo del webhook para los que quedaron en curso sin que nadie mire la pantalla.
  const clone = await sweepCloneVideos().catch((error: unknown) => {
    console.error("[cron] clon:", error instanceof Error ? error.message : "error");
    return null;
  });

  // Avisos de trabajos terminados que el worker no llegó a reportar.
  const notified = await sweepJobNotifications().catch((error: unknown) => {
    console.error("[cron] avisos:", error instanceof Error ? error.message : "error");
    return 0;
  });

  return NextResponse.json({ ok: true, ms: Date.now() - started, results, clone, notified });
}
