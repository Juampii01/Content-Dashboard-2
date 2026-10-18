"use server";

import { after } from "next/server";
import { refresh } from "next/cache";
import { and, eq } from "drizzle-orm";
import { isDenied, requireEditor, requireOwner } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { disconnect } from "@/lib/social/connections";
import { syncAccount } from "@/lib/social/sync/runner";
import { PLATFORMS, type Platform } from "@/lib/social/types";

export type ConnectionActionState = { ok?: boolean; error?: string; message?: string };

export async function syncNowAction(platform: Platform): Promise<ConnectionActionState> {
  const user = await requireEditor();
  if (isDenied(user)) return { error: user.error };
  if (!PLATFORMS.includes(platform)) return { error: "Red no válida." };

  const [account] = await getDb()
    .select({ id: schema.socialAccounts.id, backfill: schema.socialAccounts.backfillCompletedAt })
    .from(schema.socialAccounts)
    .where(and(eq(schema.socialAccounts.platform, platform), eq(schema.socialAccounts.current, true)))
    .limit(1);
  if (!account) return { error: "Esa red no está conectada." };

  // Corre después de responder: la persona puede seguir usando la app.
  after(async () => {
    await syncAccount(account.id, account.backfill ? "MANUAL" : "BACKFILL", 270_000);
  });
  return { ok: true, message: "Sincronizando. Los números se actualizan en uno o dos minutos." };
}

export async function disconnectAction(platform: Platform): Promise<ConnectionActionState> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { error: owner.error };
  if (!PLATFORMS.includes(platform)) return { error: "Red no válida." };
  await disconnect(platform);
  refresh();
  return { ok: true, message: "Listo. La red quedó desconectada y tu histórico se conserva." };
}
