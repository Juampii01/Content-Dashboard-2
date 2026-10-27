import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { platformLabel } from "@/lib/social/types";
import { readConnections, readFailStreak } from "./queries";
import { connectionAlertKey, failStreakKey } from "./status";

/**
 * Avisos al dueño cuando algo del sistema se rompe: una conexión con una red o el worker fallando 3 trabajos seguidos.
 * Lo llaman el cron de cada hora y el worker al terminar un trabajo. Cada problema avisa una sola vez (clave única
 * en `notifications`); si se arregla y vuelve a romperse, es un problema nuevo. Nunca tira error.
 */
export async function sweepSystemAlerts(): Promise<number> {
  try {
    const owners = await getDb().execute<{ id: string }>(sql`
      select u.id from users u join team_members tm on tm.user_id = u.id where tm.active and tm.role = 'OWNER'
    `);
    if (owners.rows.length === 0) return 0;
    const alerts: { key: string; title: string; body: string; href: string }[] = [];

    for (const c of await readConnections()) {
      const key = connectionAlertKey(c);
      if (!key) continue;
      const name = platformLabel[c.platform];
      alerts.push({
        key,
        title: `Se cortó la conexión con ${name}`,
        body: `${c.statusMessage?.trim() || `No pudimos leer @${c.handle.replace(/^@/, "")}.`} Mientras no la vuelvas a conectar, no llegan métricas nuevas de ${name}. Tu histórico queda guardado.`,
        href: "/ajustes#estado",
      });
    }

    const streak = await readFailStreak();
    const streakKey = failStreakKey(streak);
    if (streakKey) {
      alerts.push({
        key: streakKey,
        title: "El procesamiento de videos está fallando",
        body: `Fallaron ${streak.count} trabajos seguidos (videos, clips o imágenes). Revisa el estado del sistema para ver qué pasó y reintentarlos.`,
        href: "/ajustes#estado",
      });
    }

    for (const alert of alerts) {
      for (const owner of owners.rows) {
        await notify({ ...alert, key: `${alert.key}:${owner.id}`, userId: owner.id, tone: "error", email: true, footnote: "Te avisamos una sola vez por cada problema. Puedes ver el estado completo en Ajustes." });
      }
    }
    return alerts.length;
  } catch (error) {
    console.error("[avisos] estado del sistema:", error instanceof Error ? error.message : error);
    return 0;
  }
}
