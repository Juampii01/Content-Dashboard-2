import "server-only";
import { requireEnv } from "@/lib/env";
import { num, requestJson, type ErrorClassifier, type SyncContext } from "../http";
import { SocialApiError, type AccountProfile, type NormalizedItem, type TokenSet } from "../types";

/**
 * TikTok Login Kit v2 + Display API. Solo lectura.
 * La API solo da vistas, me gusta, comentarios y compartidos por video: no da guardados, alcance ni retención.
 * Docs: https://developers.tiktok.com/doc/display-api-overview
 */
export const TT_SCOPES = ["user.info.basic", "user.info.profile", "user.info.stats", "video.list"];
const API = "https://open.tiktokapis.com/v2";

const classify: ErrorClassifier = (status, body) => {
  const b = body as { error?: { code?: string; message?: string; log_id?: string } | string; error_description?: string } | null;
  const code = typeof b?.error === "object" ? b.error.code : b?.error;
  if (status < 400 && (!code || code === "ok")) return null;
  const detail = `${status} code=${code ?? "-"} ${typeof b?.error === "object" ? (b.error.message ?? "") : (b?.error_description ?? "")}`.slice(0, 300);

  if (code === "access_token_invalid" || status === 401) {
    return new SocialApiError("TIKTOK", "AUTH_EXPIRED", "Tu conexión con TikTok venció. Vuelve a conectarla.", detail);
  }
  if (code === "invalid_grant") return new SocialApiError("TIKTOK", "AUTH_REVOKED", "TikTok quitó el permiso de la app. Vuelve a conectar la cuenta.", detail);
  if (code === "scope_not_authorized" || code === "scope_permission_missed") {
    return new SocialApiError("TIKTOK", "MISSING_SCOPES", "Faltan permisos de TikTok. Reconecta la cuenta y acepta todos los permisos.", detail);
  }
  if (code === "rate_limit_exceeded" || status === 429) {
    return new SocialApiError("TIKTOK", "RATE_LIMITED", "TikTok pidió esperar un poco. La sincronización sigue sola más tarde.", detail, 60);
  }
  if (status >= 500 || code === "internal_error") return new SocialApiError("TIKTOK", "TRANSIENT", "TikTok tuvo un problema temporal. Lo intentamos de nuevo más tarde.", detail);
  return new SocialApiError("TIKTOK", "UNKNOWN", "TikTok devolvió un error inesperado.", detail);
};

export function tiktokAuthorizeUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_key: requireEnv("TIKTOK_CLIENT_KEY"),
    response_type: "code",
    scope: TT_SCOPES.join(","),
    redirect_uri: redirectUri,
    state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
}

type TikTokToken = { access_token: string; expires_in: number; refresh_token: string; refresh_expires_in: number; scope?: string; open_id?: string };

function toTokenSet(t: TikTokToken): TokenSet {
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    accessTokenExpiresAt: new Date(Date.now() + t.expires_in * 1000),
    refreshTokenExpiresAt: new Date(Date.now() + t.refresh_expires_in * 1000),
    scopes: (t.scope ?? "").split(",").filter(Boolean),
  };
}

async function tokenRequest(params: Record<string, string>): Promise<TikTokToken> {
  return requestJson<TikTokToken>(
    null,
    `${API}/oauth/token/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams({ client_key: requireEnv("TIKTOK_CLIENT_KEY"), client_secret: requireEnv("TIKTOK_CLIENT_SECRET"), ...params }),
    },
    classify,
  );
}

export async function tiktokExchange(code: string, redirectUri: string): Promise<{ tokens: TokenSet; profile: AccountProfile }> {
  const token = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri });
  const tokens = toTokenSet(token);
  const profile = await tiktokProfile(null, tokens.accessToken);
  return { tokens, profile };
}

/** El refresh token puede rotar: siempre se guarda el que devuelve TikTok. */
export async function tiktokRefresh(refreshToken: string): Promise<TokenSet> {
  return toTokenSet(await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }));
}

export async function tiktokProfile(ctx: SyncContext | null, token: string): Promise<AccountProfile> {
  const data = await requestJson<{
    data?: { user?: { open_id?: string; display_name?: string; username?: string; avatar_url?: string; follower_count?: number; following_count?: number; likes_count?: number; video_count?: number } };
  }>(
    ctx,
    `${API}/user/info/?fields=open_id,display_name,username,avatar_url,follower_count,following_count,likes_count,video_count`,
    { method: "GET", headers: { Authorization: `Bearer ${token}` } },
    classify,
  );
  const user = data.data?.user;
  if (!user?.open_id) throw new SocialApiError("TIKTOK", "UNKNOWN", "TikTok no devolvió los datos de la cuenta.", "sin open_id");
  return {
    externalId: user.open_id,
    handle: user.username ?? user.display_name ?? user.open_id,
    displayName: user.display_name ?? null,
    avatarUrl: user.avatar_url ?? null,
    followers: num(user.follower_count),
    following: num(user.following_count),
    mediaCount: num(user.video_count),
    totalLikes: num(user.likes_count),
  };
}

type TtVideo = {
  id: string;
  title?: string;
  video_description?: string;
  create_time: number;
  cover_image_url?: string;
  share_url?: string;
  duration?: number;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
};

export type TtPage = { items: NormalizedItem[]; next: number | null };

/** Una página de videos públicos (más nuevos primero). `cursor` es la marca de tiempo que devuelve TikTok. */
export async function tiktokVideosPage(ctx: SyncContext, token: string, cursor: number | null): Promise<TtPage> {
  const data = await requestJson<{ data?: { videos?: TtVideo[]; cursor?: number; has_more?: boolean } }>(
    ctx,
    `${API}/video/list/?fields=id,title,video_description,create_time,cover_image_url,share_url,duration,view_count,like_count,comment_count,share_count`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(cursor ? { max_count: 20, cursor } : { max_count: 20 }),
    },
    classify,
  );
  const items = (data.data?.videos ?? []).map(
    (v): NormalizedItem => ({
      externalId: v.id,
      type: "VIDEO",
      caption: v.video_description ?? null,
      title: v.title ?? null,
      permalink: v.share_url ?? null,
      thumbnailSourceUrl: v.cover_image_url ?? null,
      publishedAt: new Date(v.create_time * 1000),
      durationSec: num(v.duration),
      insightsStatus: "OK",
      metrics: { views: num(v.view_count), likes: num(v.like_count), comments: num(v.comment_count), shares: num(v.share_count) },
      raw: v,
    }),
  );
  return { items, next: data.data?.has_more ? (data.data.cursor ?? null) : null };
}
