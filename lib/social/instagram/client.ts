import "server-only";
import { requireEnv } from "@/lib/env";
import { isoDay, mapLimit, num, requestJson, type ErrorClassifier, type SyncContext } from "../http";
import { SocialApiError, type AccountDay, type AccountProfile, type ContentType, type NormalizedItem, type TokenSet } from "../types";

/**
 * Instagram API with Instagram Login (graph.instagram.com).
 * Solo lectura: `instagram_business_basic` + `instagram_business_manage_insights`.
 * Docs: https://developers.facebook.com/docs/instagram-platform
 */
export const IG_GRAPH = "https://graph.instagram.com/v23.0";
export const IG_SCOPES = ["instagram_business_basic", "instagram_business_manage_insights"];

const classify: ErrorClassifier = (status, body, headers) => {
  const err = (body as { error?: { code?: number; error_subcode?: number; message?: string; type?: string } } | null)?.error;
  if (!err && status < 400) return null;
  const code = err?.code;
  const sub = err?.error_subcode;
  const detail = `${status} code=${code ?? "-"} sub=${sub ?? "-"} ${err?.message ?? ""}`.slice(0, 300);

  if (code === 190) {
    if (sub === 458 || sub === 460) {
      return new SocialApiError("INSTAGRAM", "AUTH_REVOKED", "Instagram quitó el permiso de la app. Vuelve a conectar la cuenta.", detail);
    }
    return new SocialApiError("INSTAGRAM", "AUTH_EXPIRED", "Tu conexión con Instagram venció. Vuelve a conectarla.", detail);
  }
  if (code === 4 || code === 17 || code === 32 || code === 613 || status === 429) {
    const usage = headers.get("x-business-use-case-usage") ?? headers.get("x-app-usage");
    return new SocialApiError("INSTAGRAM", "RATE_LIMITED", "Instagram pidió esperar un poco. La sincronización sigue sola más tarde.", `${detail} usage=${usage ?? "-"}`, 60);
  }
  if (code === 10 || code === 200 || (code !== undefined && code >= 200 && code < 300)) {
    return new SocialApiError("INSTAGRAM", "MISSING_SCOPES", "Falta el permiso de estadísticas de Instagram. Reconecta la cuenta y acepta todos los permisos.", detail);
  }
  if (code === 100) {
    return new SocialApiError("INSTAGRAM", "NOT_SUPPORTED", "Instagram no da estadísticas para esta publicación.", detail);
  }
  if (status >= 500 || code === 1 || code === 2) {
    return new SocialApiError("INSTAGRAM", "TRANSIENT", "Instagram tuvo un problema temporal. Lo intentamos de nuevo más tarde.", detail);
  }
  return new SocialApiError("INSTAGRAM", "UNKNOWN", "Instagram devolvió un error inesperado.", detail);
};

/** Extrae un id numérico grande como texto (JSON.parse lo redondearía: ~1.78e16 > 2^53). */
function rawId(text: string, field: string): string | null {
  return new RegExp(`"${field}"\\s*:\\s*"?(\\d+)"?`).exec(text)?.[1] ?? null;
}

export function instagramAuthorizeUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("INSTAGRAM_APP_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });
  // Las comas del scope van literales: Instagram no acepta %2C.
  return `https://www.instagram.com/oauth/authorize?${params.toString()}&scope=${IG_SCOPES.join(",")}`;
}

/** Código → token corto → token largo (60 días) → perfil. Valida que la cuenta sea profesional. */
export async function instagramExchange(code: string, redirectUri: string): Promise<{ tokens: TokenSet; profile: AccountProfile }> {
  const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("INSTAGRAM_APP_ID"),
      client_secret: requireEnv("INSTAGRAM_APP_SECRET"),
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const shortText = await shortRes.text();
  if (!shortRes.ok) {
    throw new SocialApiError("INSTAGRAM", "UNKNOWN", "Instagram no aceptó la conexión. Inténtalo de nuevo.", `short ${shortRes.status} ${shortText.slice(0, 200)}`);
  }
  // La respuesta puede venir plana o dentro de data[].
  const shortJson = JSON.parse(shortText) as { access_token?: string; permissions?: string | string[]; data?: { access_token?: string; permissions?: string | string[] }[] };
  const shortToken = shortJson.access_token ?? shortJson.data?.[0]?.access_token;
  const permissionsRaw = shortJson.permissions ?? shortJson.data?.[0]?.permissions ?? [];
  const scopes = (Array.isArray(permissionsRaw) ? permissionsRaw : permissionsRaw.split(",")).map((s) => s.trim()).filter(Boolean);
  if (!shortToken) throw new SocialApiError("INSTAGRAM", "UNKNOWN", "Instagram no devolvió el acceso. Inténtalo de nuevo.", "sin access_token");

  const long = await requestJson<{ access_token: string; expires_in?: number }>(
    null,
    `https://graph.instagram.com/access_token?${new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: requireEnv("INSTAGRAM_APP_SECRET"),
      access_token: shortToken,
    })}`,
    { method: "GET" },
    classify,
  );

  const profile = await instagramProfile(null, long.access_token);
  return {
    tokens: {
      accessToken: long.access_token,
      accessTokenExpiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : new Date(Date.now() + 60 * 86_400_000),
      scopes,
    },
    profile,
  };
}

/** Renueva el token largo (debe tener más de 24 h y no haber vencido). */
export async function instagramRefresh(accessToken: string): Promise<TokenSet> {
  const data = await requestJson<{ access_token: string; expires_in?: number }>(
    null,
    `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: accessToken })}`,
    { method: "GET" },
    classify,
  );
  return {
    accessToken: data.access_token,
    accessTokenExpiresAt: new Date(Date.now() + (data.expires_in ?? 60 * 86_400) * 1000),
    scopes: [],
  };
}

export async function instagramProfile(ctx: SyncContext | null, token: string): Promise<AccountProfile> {
  if (ctx) ctx.apiCalls++;
  const res = await fetch(
    `${IG_GRAPH}/me?${new URLSearchParams({
      fields: "user_id,username,name,profile_picture_url,account_type,followers_count,follows_count,media_count",
      access_token: token,
    })}`,
    { signal: AbortSignal.timeout(15_000), cache: "no-store" },
  );
  const text = await res.text();
  const body = JSON.parse(text) as {
    username?: string;
    name?: string;
    profile_picture_url?: string;
    account_type?: string;
    followers_count?: number;
    follows_count?: number;
    media_count?: number;
  };
  const error = classify(res.status, body, res.headers);
  if (error) throw error;

  if (body.account_type && !["BUSINESS", "MEDIA_CREATOR"].includes(body.account_type)) {
    throw new SocialApiError(
      "INSTAGRAM",
      "BAD_ACCOUNT",
      "Tu cuenta de Instagram es personal. Cámbiala a profesional (creador o empresa) desde la app de Instagram y vuelve a conectar.",
      `account_type=${body.account_type}`,
    );
  }
  const externalId = rawId(text, "user_id");
  if (!externalId || !body.username) {
    throw new SocialApiError("INSTAGRAM", "UNKNOWN", "Instagram no devolvió los datos de la cuenta.", "perfil incompleto");
  }
  return {
    externalId,
    handle: body.username,
    displayName: body.name ?? null,
    avatarUrl: body.profile_picture_url ?? null,
    followers: num(body.followers_count),
    following: num(body.follows_count),
    mediaCount: num(body.media_count),
    totalLikes: null,
  };
}

type IgMedia = {
  id: string;
  caption?: string;
  media_type?: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_product_type?: "FEED" | "REELS" | "STORY" | "AD";
  permalink?: string;
  thumbnail_url?: string;
  media_url?: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
};

function mapType(m: IgMedia): ContentType | null {
  if (m.media_product_type === "REELS") return "REEL";
  if (m.media_product_type === "STORY" || m.media_product_type === "AD") return null;
  if (m.media_type === "CAROUSEL_ALBUM") return "CAROUSEL";
  if (m.media_type === "VIDEO") return "VIDEO";
  return "IMAGE";
}

export type IgPage = { items: IgMedia[]; next: string | null };

/** Una página de publicaciones (más nuevas primero). `after` es el cursor de la página anterior. */
export async function instagramMediaPage(ctx: SyncContext, token: string, after: string | null): Promise<IgPage> {
  const params = new URLSearchParams({
    fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count",
    limit: "50",
    access_token: token,
  });
  if (after) params.set("after", after);
  const data = await requestJson<{ data: IgMedia[]; paging?: { cursors?: { after?: string }; next?: string } }>(
    ctx,
    `${IG_GRAPH}/me/media?${params}`,
    { method: "GET" },
    classify,
  );
  return { items: data.data ?? [], next: data.paging?.next ? (data.paging.cursors?.after ?? null) : null };
}

type InsightRow = { name: string; values?: { value: number }[]; total_value?: { value: number } };

async function mediaInsights(ctx: SyncContext, token: string, mediaId: string, metrics: string[]): Promise<Map<string, number>> {
  const data = await requestJson<{ data: InsightRow[] }>(
    ctx,
    `${IG_GRAPH}/${mediaId}/insights?${new URLSearchParams({ metric: metrics.join(","), access_token: token })}`,
    { method: "GET" },
    classify,
  );
  const out = new Map<string, number>();
  for (const row of data.data ?? []) {
    const value = row.total_value?.value ?? row.values?.[0]?.value;
    if (typeof value === "number") out.set(row.name, value);
  }
  return out;
}

const REEL_METRICS = ["views", "reach", "saved", "shares", "likes", "comments", "total_interactions", "ig_reels_avg_watch_time", "ig_reels_video_view_total_time"];
const FEED_METRICS = ["views", "reach", "saved", "shares", "likes", "comments", "total_interactions"];

/** Convierte publicaciones en piezas del modelo común, con sus estadísticas. */
export async function instagramNormalize(ctx: SyncContext, token: string, media: IgMedia[]): Promise<NormalizedItem[]> {
  const relevant = media.filter((m) => mapType(m) !== null);
  return mapLimit(relevant, 4, async (m) => {
    const type = mapType(m)!;
    const publishedAt = new Date(m.timestamp);
    const ageHours = (Date.now() - publishedAt.getTime()) / 3_600_000;
    let insights = new Map<string, number>();
    let extra = new Map<string, number>();
    let status: NormalizedItem["insightsStatus"] = "OK";

    try {
      insights = await mediaInsights(ctx, token, m.id, type === "REEL" ? REEL_METRICS : FEED_METRICS);
      if (insights.size === 0) status = ageHours < 48 ? "PENDING" : "NOT_SUPPORTED";
    } catch (error) {
      if (error instanceof SocialApiError && error.kind === "NOT_SUPPORTED") status = "NOT_SUPPORTED";
      else throw error;
    }
    // Métricas que no todas las cuentas o versiones tienen: si fallan, no afectan al resto.
    if (status === "OK") {
      try {
        extra = await mediaInsights(ctx, token, m.id, type === "REEL" ? ["reels_skip_rate"] : ["follows", "profile_visits"]);
      } catch (error) {
        if (!(error instanceof SocialApiError) || !["NOT_SUPPORTED", "UNKNOWN"].includes(error.kind)) throw error;
      }
    }

    const ms = (v: number | undefined) => (v === undefined ? undefined : v / 1000);
    return {
      externalId: m.id,
      type,
      caption: m.caption ?? null,
      title: null,
      permalink: m.permalink ?? null,
      thumbnailSourceUrl: m.thumbnail_url ?? m.media_url ?? null,
      publishedAt,
      durationSec: null,
      insightsStatus: status,
      metrics: {
        views: insights.get("views"),
        reach: insights.get("reach"),
        likes: insights.get("likes") ?? num(m.like_count),
        comments: insights.get("comments") ?? num(m.comments_count),
        shares: insights.get("shares"),
        saves: insights.get("saved"),
        totalInteractions: insights.get("total_interactions"),
        avgWatchSec: ms(insights.get("ig_reels_avg_watch_time")),
        totalWatchSec: ms(insights.get("ig_reels_video_view_total_time")),
        skipRate: extra.get("reels_skip_rate"),
        follows: extra.get("follows"),
        profileVisits: extra.get("profile_visits"),
      },
      raw: { media: m, insights: Object.fromEntries(insights), extra: Object.fromEntries(extra) },
    } satisfies NormalizedItem;
  });
}

/** Totales diarios de la cuenta. Instagram los da por rango, así que se pide un día a la vez. */
export async function instagramAccountDays(ctx: SyncContext, token: string, days: string[]): Promise<AccountDay[]> {
  const results = await mapLimit(days, 3, async (day): Promise<AccountDay | null> => {
    if (ctx.outOfTime()) return null;
    const since = Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000);
    const until = since + 86_400;
    const base = { period: "day", since: String(since), until: String(until), access_token: token };

    const totals = await requestJson<{ data: InsightRow[] }>(
      ctx,
      `${IG_GRAPH}/me/insights?${new URLSearchParams({ ...base, metric: "reach,views,accounts_engaged,total_interactions,profile_links_taps", metric_type: "total_value" })}`,
      { method: "GET" },
      classify,
    ).catch((error: unknown) => {
      if (error instanceof SocialApiError && ["NOT_SUPPORTED", "UNKNOWN"].includes(error.kind)) return { data: [] as InsightRow[] };
      throw error;
    });
    const get = (name: string) => {
      const row = totals.data.find((r) => r.name === name);
      return num(row?.total_value?.value ?? row?.values?.[0]?.value);
    };

    // Seguidores ganados y perdidos: requiere 100 seguidores o más.
    let follows: number | null = null;
    let unfollows: number | null = null;
    try {
      const fu = await requestJson<{ data: { total_value?: { breakdowns?: { results?: { dimension_values: string[]; value: number }[] }[] } }[] }>(
        ctx,
        `${IG_GRAPH}/me/insights?${new URLSearchParams({ ...base, metric: "follows_and_unfollows", metric_type: "total_value", breakdown: "follow_type" })}`,
        { method: "GET" },
        classify,
      );
      for (const r of fu.data[0]?.total_value?.breakdowns?.[0]?.results ?? []) {
        if (r.dimension_values[0] === "FOLLOWER") follows = r.value;
        if (r.dimension_values[0] === "NON_FOLLOWER") unfollows = r.value;
      }
    } catch (error) {
      if (!(error instanceof SocialApiError) || !["NOT_SUPPORTED", "UNKNOWN"].includes(error.kind)) throw error;
    }

    return {
      day,
      reach: get("reach"),
      views: get("views"),
      accountsEngaged: get("accounts_engaged"),
      interactions: get("total_interactions"),
      profileLinksTaps: get("profile_links_taps"),
      follows,
      unfollows,
    };
  });
  return results.filter((r): r is AccountDay => r !== null);
}

/** Días completos anteriores a hoy (UTC), del más viejo al más nuevo. */
export function pastDays(count: number): string[] {
  const out: string[] = [];
  for (let i = count; i >= 1; i--) out.push(isoDay(new Date(Date.now() - i * 86_400_000)));
  return out;
}
