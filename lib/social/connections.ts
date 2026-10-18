import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { missingScopes, type Connection } from "./providers";
import { encryptTokens } from "./tokens";
import { platformLabel, type Platform } from "./types";

/**
 * Guarda una conexión nueva o renovada. Si es la misma cuenta, se actualiza la fila (y su histórico sigue).
 * Si es otra cuenta de la misma red, la anterior queda DISCONNECTED con su histórico y la nueva pasa a ser la actual.
 */
export async function saveConnection(platform: Platform, connection: Connection, userId: string): Promise<{ accountId: string; isNew: boolean }> {
  const { tokens, profile, meta } = connection;
  const missing = missingScopes(platform, tokens.scopes);
  const status = missing.length > 0 ? ("MISSING_SCOPES" as const) : ("ACTIVE" as const);
  const statusMessage =
    missing.length > 0 ? `Faltan permisos de ${platformLabel[platform]}. Reconecta la cuenta y acepta todos los permisos para ver las estadísticas.` : null;

  return getDb().transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: schema.socialAccounts.id, backfill: schema.socialAccounts.backfillCompletedAt })
      .from(schema.socialAccounts)
      .where(and(eq(schema.socialAccounts.platform, platform), eq(schema.socialAccounts.externalId, profile.externalId)))
      .limit(1);

    // Si había datos de demostración de esta red, se borran: nunca se mezclan con los reales
    // (las medianas, el puntaje y lo que lee la IA saldrían de números inventados).
    const demo = await tx
      .select({ id: schema.socialAccounts.id })
      .from(schema.socialAccounts)
      .where(and(eq(schema.socialAccounts.platform, platform), sql`(${schema.socialAccounts.meta} ->> 'demo') = 'true'`));
    if (demo.length > 0) {
      const ids = demo.map((d) => d.id);
      await tx.delete(schema.contentItems).where(inArray(schema.contentItems.socialAccountId, ids));
      await tx.delete(schema.socialAccounts).where(inArray(schema.socialAccounts.id, ids));
    }

    // Otra cuenta de la misma red deja de ser la actual (se conserva por el histórico).
    await tx
      .update(schema.socialAccounts)
      .set({ current: false, status: "DISCONNECTED", statusMessage: null })
      .where(and(eq(schema.socialAccounts.platform, platform), eq(schema.socialAccounts.current, true), ne(schema.socialAccounts.externalId, profile.externalId)));

    const values = {
      handle: profile.handle,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      ...encryptTokens(platform, tokens.accessToken, tokens.refreshToken),
      accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? null,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? null,
      tokenIssuedAt: new Date(),
      scopes: tokens.scopes,
      status,
      statusMessage,
      current: true,
      meta: meta ?? null,
      connectedBy: userId,
    };

    if (existing) {
      await tx.update(schema.socialAccounts).set(values).where(eq(schema.socialAccounts.id, existing.id));
      return { accountId: existing.id, isNew: !existing.backfill };
    }
    const [created] = await tx
      .insert(schema.socialAccounts)
      .values({ platform, externalId: profile.externalId, ...values })
      .returning({ id: schema.socialAccounts.id });
    return { accountId: created!.id, isNew: true };
  });
}

/** Desconecta una red: borra los tokens guardados y conserva todo el histórico de métricas. */
export async function disconnect(platform: Platform): Promise<void> {
  await getDb()
    .update(schema.socialAccounts)
    .set({ current: false, status: "DISCONNECTED", statusMessage: null, accessTokenEnc: "revocado", refreshTokenEnc: null })
    .where(and(eq(schema.socialAccounts.platform, platform), eq(schema.socialAccounts.current, true)));
}

/**
 * Borra todo lo medido de una red (todas sus cuentas, actuales y anteriores): piezas, snapshots,
 * curvas de retención, totales diarios y registros de sincronización. Es irreversible: solo lo pide el dueño.
 * Los guiones y el calendario no se borran; solo pierden el vínculo con la pieza.
 */
export async function purgePlatformData(platform: Platform): Promise<number> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const accounts = await tx.select({ id: schema.socialAccounts.id }).from(schema.socialAccounts).where(eq(schema.socialAccounts.platform, platform));
    const ids = accounts.map((a) => a.id);
    if (ids.length === 0) return 0;
    // metric_snapshots y retention_curves se borran en cascada con content_items.
    const removed = await tx.delete(schema.contentItems).where(inArray(schema.contentItems.socialAccountId, ids)).returning({ id: schema.contentItems.id });
    // account_snapshots y sync_runs se borran en cascada con social_accounts.
    await tx.delete(schema.socialAccounts).where(inArray(schema.socialAccounts.id, ids));
    return removed.length;
  });
}
