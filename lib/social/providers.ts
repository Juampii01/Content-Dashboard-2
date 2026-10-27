import "server-only";
import { env } from "@/lib/env";
import { instagramAuthorizeUrl, instagramExchange, instagramRefresh, IG_SCOPES } from "./instagram/client";
import { tiktokAuthorizeUrl, tiktokExchange, tiktokRefresh, TT_SCOPES } from "./tiktok/client";
import { youtubeAuthorizeUrl, youtubeExchange, youtubeRefresh, YT_SCOPES } from "./youtube/client";
import { platformSlug, type AccountProfile, type Platform, type TokenSet } from "./types";

/** URL de regreso del OAuth. Hay que registrarla tal cual en Meta, Google y TikTok (ver docs/instalacion.md). */
export function redirectUri(platform: Platform): string {
  return `${env().NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/api/social/${platformSlug[platform]}/callback`;
}

/** true si la red tiene sus credenciales configuradas en las variables de entorno. */
export function platformConfigured(platform: Platform): boolean {
  const e = env();
  if (platform === "INSTAGRAM") return Boolean(e.INSTAGRAM_APP_ID && e.INSTAGRAM_APP_SECRET);
  if (platform === "YOUTUBE") return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
  return Boolean(e.TIKTOK_CLIENT_KEY && e.TIKTOK_CLIENT_SECRET);
}

export function authorizeUrl(platform: Platform, state: string): string {
  const uri = redirectUri(platform);
  if (platform === "INSTAGRAM") return instagramAuthorizeUrl(state, uri);
  if (platform === "YOUTUBE") return youtubeAuthorizeUrl(state, uri);
  return tiktokAuthorizeUrl(state, uri);
}

export type Connection = { tokens: TokenSet; profile: AccountProfile; meta?: Record<string, unknown> };

export async function exchangeCode(platform: Platform, code: string): Promise<Connection> {
  const uri = redirectUri(platform);
  if (platform === "INSTAGRAM") return instagramExchange(code, uri);
  if (platform === "YOUTUBE") return youtubeExchange(code, uri);
  return tiktokExchange(code, uri);
}

export async function refreshTokens(platform: Platform, accessToken: string, refreshToken: string | null): Promise<TokenSet> {
  if (platform === "INSTAGRAM") return instagramRefresh(accessToken);
  if (!refreshToken) throw new Error("No hay refresh token guardado.");
  if (platform === "YOUTUBE") return youtubeRefresh(refreshToken);
  return tiktokRefresh(refreshToken);
}

/** Permisos sin los que la red no sirve para medir. */
export const requiredScopes: Record<Platform, string[]> = {
  INSTAGRAM: IG_SCOPES,
  YOUTUBE: YT_SCOPES,
  TIKTOK: TT_SCOPES.filter((s) => s !== "user.info.profile"),
};

/** Lista de permisos que faltan (vacía si están todos). Si la red no informa permisos, no se marca nada. */
export function missingScopes(platform: Platform, granted: string[]): string[] {
  if (granted.length === 0) return [];
  return requiredScopes[platform].filter((scope) => !granted.includes(scope));
}
