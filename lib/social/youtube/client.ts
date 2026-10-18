import "server-only";
import { requireEnv } from "@/lib/env";
import { isoDay, num, requestJson, type ErrorClassifier, type SyncContext } from "../http";
import { SocialApiError, type AccountDay, type AccountProfile, type NormalizedItem, type TokenSet } from "../types";

/**
 * YouTube Data API v3 + YouTube Analytics API v2. Solo lectura.
 * Docs: https://developers.google.com/youtube/v3 · https://developers.google.com/youtube/analytics
 */
export const YT_SCOPES = ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/yt-analytics.readonly"];
const DATA = "https://www.googleapis.com/youtube/v3";
const ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports";

type GoogleError = { error?: { code?: number; message?: string; errors?: { reason?: string }[]; status?: string } | string; error_description?: string };

const classify: ErrorClassifier = (status, body) => {
  if (status < 400) return null;
  const b = body as GoogleError | null;
  const err = typeof b?.error === "object" ? b.error : undefined;
  const reason = err?.errors?.[0]?.reason ?? (typeof b?.error === "string" ? b.error : undefined);
  const detail = `${status} reason=${reason ?? "-"} ${err?.message ?? b?.error_description ?? ""}`.slice(0, 300);

  if (reason === "invalid_grant") {
    return new SocialApiError("YOUTUBE", "AUTH_REVOKED", "Google quitó el permiso de la app o venció la conexión. Vuelve a conectar YouTube.", detail);
  }
  if (status === 401) return new SocialApiError("YOUTUBE", "AUTH_EXPIRED", "Tu conexión con YouTube venció. Vuelve a conectarla.", detail);
  if (reason === "quotaExceeded" || reason === "rateLimitExceeded" || reason === "userRateLimitExceeded" || status === 429) {
    return new SocialApiError("YOUTUBE", "RATE_LIMITED", "YouTube pidió esperar un poco. La sincronización sigue sola más tarde.", detail, 60);
  }
  if (reason === "insufficientPermissions" || reason === "forbidden" || status === 403) {
    return new SocialApiError("YOUTUBE", "MISSING_SCOPES", "Falta el permiso de estadísticas de YouTube. Reconecta la cuenta y acepta todos los permisos.", detail);
  }
  if (status === 400) return new SocialApiError("YOUTUBE", "NOT_SUPPORTED", "YouTube no da este dato.", detail);
  if (status >= 500) return new SocialApiError("YOUTUBE", "TRANSIENT", "YouTube tuvo un problema temporal. Lo intentamos de nuevo más tarde.", detail);
  return new SocialApiError("YOUTUBE", "UNKNOWN", "YouTube devolvió un error inesperado.", detail);
};

export function youtubeAuthorizeUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YT_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

type GoogleToken = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };

function toTokenSet(t: GoogleToken): TokenSet {
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    accessTokenExpiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000),
    scopes: (t.scope ?? "").split(" ").filter(Boolean),
  };
}

export async function youtubeExchange(code: string, redirectUri: string): Promise<{ tokens: TokenSet; profile: AccountProfile; meta: Record<string, unknown> }> {
  const token = await requestJson<GoogleToken>(
    null,
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: requireEnv("GOOGLE_CLIENT_ID"),
        client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    },
    classify,
  );
  const tokens = toTokenSet(token);
  const { profile, meta } = await youtubeChannel(null, tokens.accessToken);
  return { tokens, profile, meta };
}

export async function youtubeRefresh(refreshToken: string): Promise<TokenSet> {
  const token = await requestJson<GoogleToken>(
    null,
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: requireEnv("GOOGLE_CLIENT_ID"),
        client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    },
    classify,
  );
  // Google no siempre devuelve un refresh token nuevo: se conserva el anterior.
  return { ...toTokenSet(token), refreshToken: token.refresh_token ?? refreshToken };
}

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

export async function youtubeChannel(ctx: SyncContext | null, token: string): Promise<{ profile: AccountProfile; meta: Record<string, unknown> }> {
  const data = await requestJson<{
    items?: {
      id: string;
      snippet?: { title?: string; customUrl?: string; publishedAt?: string; thumbnails?: { default?: { url?: string }; medium?: { url?: string } } };
      statistics?: { subscriberCount?: string; videoCount?: string; viewCount?: string; hiddenSubscriberCount?: boolean };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }[];
  }>(ctx, `${DATA}/channels?part=snippet,statistics,contentDetails&mine=true`, { method: "GET", ...auth(token) }, classify);

  const channel = data.items?.[0];
  if (!channel) {
    throw new SocialApiError("YOUTUBE", "BAD_ACCOUNT", "Esta cuenta de Google no tiene un canal de YouTube. Entra con la cuenta del canal.", "sin canal");
  }
  return {
    profile: {
      externalId: channel.id,
      handle: channel.snippet?.customUrl ?? channel.snippet?.title ?? channel.id,
      displayName: channel.snippet?.title ?? null,
      avatarUrl: channel.snippet?.thumbnails?.medium?.url ?? channel.snippet?.thumbnails?.default?.url ?? null,
      followers: channel.statistics?.hiddenSubscriberCount ? null : num(channel.statistics?.subscriberCount),
      following: null,
      mediaCount: num(channel.statistics?.videoCount),
      totalLikes: null,
    },
    meta: {
      uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads ?? null,
      channelPublishedAt: channel.snippet?.publishedAt ?? null,
    },
  };
}

export type YtPage = { ids: { id: string; publishedAt: Date }[]; next: string | null };

/** Una página de la lista de subidas (más nuevas primero). */
export async function youtubeUploadsPage(ctx: SyncContext, token: string, playlistId: string, pageToken: string | null): Promise<YtPage> {
  const params = new URLSearchParams({ part: "contentDetails", playlistId, maxResults: "50" });
  if (pageToken) params.set("pageToken", pageToken);
  const data = await requestJson<{ items?: { contentDetails?: { videoId?: string; videoPublishedAt?: string } }[]; nextPageToken?: string }>(
    ctx,
    `${DATA}/playlistItems?${params}`,
    { method: "GET", ...auth(token) },
    classify,
  );
  const ids = (data.items ?? [])
    .map((i) => ({ id: i.contentDetails?.videoId ?? "", publishedAt: new Date(i.contentDetails?.videoPublishedAt ?? 0) }))
    .filter((i) => i.id && i.publishedAt.getTime() > 0);
  return { ids, next: data.nextPageToken ?? null };
}

/** Duración ISO 8601 (PT1H2M3S) a segundos. */
export function parseIsoDuration(value: string | undefined): number | null {
  if (!value) return null;
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(value);
  if (!m) return null;
  const [, d, h, min, s] = m.map((x) => Number(x ?? 0));
  return (d ?? 0) * 86400 + (h ?? 0) * 3600 + (min ?? 0) * 60 + (s ?? 0);
}

type AnalyticsReport = { columnHeaders?: { name: string }[]; rows?: (string | number)[][] };

function rowsToObjects(report: AnalyticsReport): Record<string, string | number>[] {
  const headers = (report.columnHeaders ?? []).map((h) => h.name);
  return (report.rows ?? []).map((row) => Object.fromEntries(row.map((v, i) => [headers[i]!, v])));
}

async function analytics(ctx: SyncContext, token: string, params: Record<string, string>): Promise<Record<string, string | number>[]> {
  const report = await requestJson<AnalyticsReport>(ctx, `${ANALYTICS}?${new URLSearchParams({ ids: "channel==MINE", ...params })}`, { method: "GET", ...auth(token) }, classify);
  return rowsToObjects(report);
}

const VIDEO_METRICS_FULL = "views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,comments,shares";
const VIDEO_METRICS_BASIC = "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,comments,shares";

/** Detalle y estadísticas de hasta 50 videos, con métricas de Analytics de toda su vida. */
export async function youtubeNormalize(ctx: SyncContext, token: string, ids: string[], channelPublishedAt: string | null): Promise<NormalizedItem[]> {
  if (ids.length === 0) return [];
  const data = await requestJson<{
    items?: {
      id: string;
      snippet?: { title?: string; description?: string; publishedAt?: string; thumbnails?: Record<string, { url?: string; width?: number }> };
      contentDetails?: { duration?: string };
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
      status?: { privacyStatus?: string };
    }[];
  }>(ctx, `${DATA}/videos?${new URLSearchParams({ part: "snippet,contentDetails,statistics,status", id: ids.join(",") })}`, { method: "GET", ...auth(token) }, classify);

  const videos = (data.items ?? []).filter((v) => v.status?.privacyStatus === "public");
  if (videos.length === 0) return [];

  const startDate = channelPublishedAt ? channelPublishedAt.slice(0, 10) : "2006-01-01";
  const endDate = isoDay(new Date());
  const filters = `video==${videos.map((v) => v.id).join(",")}`;

  // Métricas de por vida. engagedViews es nuevo: si la API no lo acepta, se pide el resto.
  let stats = new Map<string, Record<string, string | number>>();
  let analyticsOk = true;
  for (const metrics of [VIDEO_METRICS_FULL, VIDEO_METRICS_BASIC]) {
    try {
      const rows = await analytics(ctx, token, { startDate, endDate, metrics, dimensions: "video", filters, maxResults: "200", sort: "-views" });
      stats = new Map(rows.map((r) => [String(r.video), r]));
      analyticsOk = true;
      break;
    } catch (error) {
      if (!(error instanceof SocialApiError) || error.kind !== "NOT_SUPPORTED") throw error;
      analyticsOk = false;
    }
  }

  // Shorts: se pregunta a Analytics; si no responde, se usa la duración (≤ 3 min).
  const shorts = new Set<string>();
  let shortsKnown = false;
  try {
    const rows = await analytics(ctx, token, { startDate, endDate, metrics: "views", dimensions: "video,creatorContentType", filters, maxResults: "200", sort: "-views" });
    for (const r of rows) if (r.creatorContentType === "SHORTS") shorts.add(String(r.video));
    shortsKnown = true;
  } catch (error) {
    if (!(error instanceof SocialApiError) || error.kind !== "NOT_SUPPORTED") throw error;
  }

  return videos.map((v) => {
    const durationSec = parseIsoDuration(v.contentDetails?.duration);
    const s = stats.get(v.id);
    const isShort = shortsKnown ? shorts.has(v.id) : durationSec !== null && durationSec <= 180;
    const thumbs = v.snippet?.thumbnails ?? {};
    const thumb = thumbs.maxres?.url ?? thumbs.standard?.url ?? thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? null;
    const publishedAt = new Date(v.snippet?.publishedAt ?? Date.now());
    const ageHours = (Date.now() - publishedAt.getTime()) / 3_600_000;
    return {
      externalId: v.id,
      type: isShort ? "SHORT" : "VIDEO",
      caption: v.snippet?.description ?? null,
      title: v.snippet?.title ?? null,
      permalink: isShort ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`,
      thumbnailSourceUrl: thumb,
      publishedAt,
      durationSec,
      // Analytics tarda 48-72 h en tener datos de un video nuevo.
      insightsStatus: s ? "OK" : analyticsOk && ageHours < 72 ? "PENDING" : analyticsOk ? "OK" : "NOT_SUPPORTED",
      metrics: {
        views: num(v.statistics?.viewCount),
        likes: num(v.statistics?.likeCount),
        comments: num(v.statistics?.commentCount),
        shares: s ? num(s.shares) : undefined,
        engagedViews: s ? num(s.engagedViews) : undefined,
        watchTimeMinutes: s ? num(s.estimatedMinutesWatched) : undefined,
        avgWatchSec: s ? num(s.averageViewDuration) : undefined,
        avgViewPercentage: s ? num(s.averageViewPercentage) : undefined,
        subscribersGained: s ? num(s.subscribersGained) : undefined,
      },
      raw: { video: v, analytics: s ?? null },
    } satisfies NormalizedItem;
  });
}

/** Totales diarios del canal. Analytics tiene 2-3 días de retraso: se piden los últimos días otra vez. */
export async function youtubeAccountDays(ctx: SyncContext, token: string, days: string[]): Promise<AccountDay[]> {
  if (days.length === 0) return [];
  const rows = await analytics(ctx, token, {
    startDate: days[0]!,
    endDate: days[days.length - 1]!,
    metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments,shares",
    dimensions: "day",
    sort: "day",
  });
  return rows.map((r) => ({
    day: String(r.day),
    views: num(r.views),
    watchTimeMinutes: num(r.estimatedMinutesWatched),
    subscribersGained: num(r.subscribersGained),
    subscribersLost: num(r.subscribersLost),
    interactions: (num(r.likes) ?? 0) + (num(r.comments) ?? 0) + (num(r.shares) ?? 0),
  }));
}

/** Curva de retención: qué parte del público sigue mirando en cada punto del video (0 a 1). */
export async function youtubeRetention(ctx: SyncContext, token: string, videoId: string, publishedAt: Date): Promise<{ at: number; ratio: number }[]> {
  const rows = await analytics(ctx, token, {
    startDate: isoDay(publishedAt),
    endDate: isoDay(new Date()),
    metrics: "audienceWatchRatio",
    dimensions: "elapsedVideoTimeRatio",
    filters: `video==${videoId}`,
  });
  return rows.map((r) => ({ at: Number(r.elapsedVideoTimeRatio), ratio: Number(r.audienceWatchRatio) })).filter((p) => Number.isFinite(p.at) && Number.isFinite(p.ratio));
}
