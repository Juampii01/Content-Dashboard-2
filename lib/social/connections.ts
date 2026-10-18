import "server-only";
import { and, eq, ne } from "drizzle-orm";
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
