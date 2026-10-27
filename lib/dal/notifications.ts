import "server-only";
import { sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export type NotificationItem = { id: string; tone: "success" | "error"; title: string; body: string; href: string; createdAt: string; unread: boolean };

/** Los avisos del usuario (los suyos y los del equipo) de los últimos 14 días, más nuevos primero. */
export async function getNotifications(): Promise<{ items: NotificationItem[]; unread: number }> {
  const user = await getCurrentUser();
  const result = await getDb().execute<{ id: string; tone: "success" | "error"; title: string; body: string; href: string; created_at: string; unread: boolean }>(sql`
    select n.id, n.tone, n.title, n.body, n.href, n.created_at,
      (tm.notifications_seen_at is null or n.created_at > tm.notifications_seen_at) as unread
    from notifications n
    join team_members tm on tm.user_id = ${user.id}
    where (n.user_id = ${user.id} or n.user_id is null) and n.created_at > now() - interval '14 days'
    order by n.created_at desc
    limit 20
  `);
  const items = result.rows.map((r) => ({ id: r.id, tone: r.tone, title: r.title, body: r.body, href: r.href, createdAt: new Date(r.created_at).toISOString(), unread: r.unread }));
  return { items, unread: items.filter((i) => i.unread).length };
}

/** Marca como vistos todos los avisos hasta ahora. */
export async function markNotificationsSeen(): Promise<void> {
  const user = await getCurrentUser();
  await getDb().execute(sql`update team_members set notifications_seen_at = now() where user_id = ${user.id}`);
}
