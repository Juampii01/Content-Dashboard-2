import "server-only";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { refreshTokens } from "./providers";
import { SocialApiError, type Platform } from "./types";

/**
 * Único lugar que entrega un token válido para llamar a una red.
 *
 * Refresca antes de que venza, con la fila bloqueada (`FOR UPDATE`): así dos sincronizaciones a la vez
 * no refrescan dos veces (en TikTok el refresh token rota y el segundo intento fallaría).
 * Si el refresh falla por permisos, marca la cuenta para que el usuario la reconecte.
 */
const ctx = (platform: Platform, kind: "access" | "refresh") => `${platform.toLowerCase()}.${kind}`;

export function encryptTokens(platform: Platform, access: string, refresh: string | null | undefined) {
  return {
    accessTokenEnc: encryptSecret(access, ctx(platform, "access")),
    refreshTokenEnc: refresh ? encryptSecret(refresh, ctx(platform, "refresh")) : null,
  };
}

const DAY = 86_400_000;

function needsRefresh(platform: Platform, expiresAt: Date | null, issuedAt: Date | null): boolean {
  const now = Date.now();
  if (platform === "INSTAGRAM") {
    // Instagram: el token dura 60 días y solo se puede renovar si tiene más de 24 h.
    if (!expiresAt) return false;
    const oldEnough = !issuedAt || now - issuedAt.getTime() > DAY;
    return oldEnough && expiresAt.getTime() - now < 30 * DAY;
  }
  if (!expiresAt) return true;
  const margin = platform === "YOUTUBE" ? 5 * 60_000 : 60 * 60_000;
  return expiresAt.getTime() - now < margin;
}

type Outcome =
  | { ok: true; platform: Platform; token: string }
  | { ok: false; platform: Platform; status?: "EXPIRED" | "REVOKED"; error: unknown };

export async function getValidToken(accountId: string): Promise<{ platform: Platform; token: string }> {
  // El estado de error se guarda fuera de la transacción: si se guardara adentro, el rollback lo borraría.
  const outcome = await getDb().transaction(async (tx): Promise<Outcome> => {
    const [account] = await tx.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, accountId)).for("update");
    if (!account) throw new Error("La cuenta conectada ya no existe.");
    const platform = account.platform;

    if (account.status === "REVOKED" || account.status === "EXPIRED" || account.status === "DISCONNECTED") {
      return {
        ok: false,
        platform,
        error: new SocialApiError(platform, account.status === "REVOKED" ? "AUTH_REVOKED" : "AUTH_EXPIRED", account.statusMessage ?? "Vuelve a conectar la cuenta.", `estado ${account.status}`),
      };
    }

    const access = decryptSecret(account.accessTokenEnc, ctx(platform, "access"));
    const now = Date.now();
    const expired = account.accessTokenExpiresAt ? account.accessTokenExpiresAt.getTime() <= now : false;

    if (!needsRefresh(platform, account.accessTokenExpiresAt, account.tokenIssuedAt)) return { ok: true, platform, token: access };

    const refresh = account.refreshTokenEnc ? decryptSecret(account.refreshTokenEnc, ctx(platform, "refresh")) : null;
    const refreshExpired = account.refreshTokenExpiresAt ? account.refreshTokenExpiresAt.getTime() <= now : false;

    if ((platform === "INSTAGRAM" && expired) || (platform !== "INSTAGRAM" && (!refresh || refreshExpired))) {
      const name = platform === "INSTAGRAM" ? "Instagram" : platform === "YOUTUBE" ? "YouTube" : "TikTok";
      return {
        ok: false,
        platform,
        status: "EXPIRED",
        error: new SocialApiError(platform, "AUTH_EXPIRED", `Tu conexión con ${name} venció. Vuelve a conectarla.`, "token vencido sin forma de renovarlo"),
      };
    }

    try {
      const fresh = await refreshTokens(platform, access, refresh);
      await tx
        .update(schema.socialAccounts)
        .set({
          ...encryptTokens(platform, fresh.accessToken, fresh.refreshToken ?? refresh),
          accessTokenExpiresAt: fresh.accessTokenExpiresAt ?? null,
          refreshTokenExpiresAt: fresh.refreshTokenExpiresAt ?? account.refreshTokenExpiresAt,
          tokenIssuedAt: new Date(),
          status: "ACTIVE",
          statusMessage: null,
        })
        .where(eq(schema.socialAccounts.id, accountId));
      return { ok: true, platform, token: fresh.accessToken };
    } catch (error) {
      if (error instanceof SocialApiError && (error.kind === "AUTH_REVOKED" || error.kind === "AUTH_EXPIRED")) {
        return { ok: false, platform, status: error.kind === "AUTH_REVOKED" ? "REVOKED" : "EXPIRED", error };
      }
      // Instagram: si el refresh falla por otra razón pero el token sigue vigente, se usa el actual.
      if (!expired && platform === "INSTAGRAM") return { ok: true, platform, token: access };
      return { ok: false, platform, error };
    }
  });

  if (outcome.ok) return { platform: outcome.platform, token: outcome.token };
  if (outcome.status && outcome.error instanceof SocialApiError) {
    await getDb()
      .update(schema.socialAccounts)
      .set({ status: outcome.status, statusMessage: outcome.error.userMessage })
      .where(eq(schema.socialAccounts.id, accountId));
  }
  throw outcome.error;
}
