/**
 * Tipos comunes a las tres redes. Cada red traduce su API a estas formas; el resto de la app
 * (sync, métricas, inicio) solo conoce el modelo común.
 */
export type Platform = "INSTAGRAM" | "YOUTUBE" | "TIKTOK";
export type ContentType = "REEL" | "CAROUSEL" | "IMAGE" | "VIDEO" | "SHORT";
export type InsightsStatus = "OK" | "PENDING" | "NOT_SUPPORTED";

export const PLATFORMS: Platform[] = ["INSTAGRAM", "YOUTUBE", "TIKTOK"];

export const platformSlug: Record<Platform, string> = { INSTAGRAM: "instagram", YOUTUBE: "youtube", TIKTOK: "tiktok" };
export const platformLabel: Record<Platform, string> = { INSTAGRAM: "Instagram", YOUTUBE: "YouTube", TIKTOK: "TikTok" };

export function platformFromSlug(slug: string): Platform | null {
  const entry = Object.entries(platformSlug).find(([, s]) => s === slug);
  return (entry?.[0] as Platform | undefined) ?? null;
}

/** Métricas de una pieza. `undefined` = la red no lo dio en esta llamada (se conserva el valor anterior). */
export type ItemMetrics = {
  views?: number | null;
  reach?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  totalInteractions?: number | null;
  follows?: number | null;
  profileVisits?: number | null;
  avgWatchSec?: number | null;
  totalWatchSec?: number | null;
  skipRate?: number | null;
  engagedViews?: number | null;
  watchTimeMinutes?: number | null;
  avgViewPercentage?: number | null;
  subscribersGained?: number | null;
};

export type NormalizedItem = {
  externalId: string;
  type: ContentType;
  caption: string | null;
  title: string | null;
  permalink: string | null;
  thumbnailSourceUrl: string | null;
  publishedAt: Date;
  durationSec: number | null;
  metrics: ItemMetrics;
  insightsStatus: InsightsStatus;
  raw: unknown;
};

/** Totales de un día de la cuenta. */
export type AccountDay = {
  day: string; // YYYY-MM-DD
  views?: number | null;
  reach?: number | null;
  accountsEngaged?: number | null;
  interactions?: number | null;
  profileLinksTaps?: number | null;
  follows?: number | null;
  unfollows?: number | null;
  subscribersGained?: number | null;
  subscribersLost?: number | null;
  watchTimeMinutes?: number | null;
};

export type AccountProfile = {
  externalId: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  followers: number | null;
  following: number | null;
  mediaCount: number | null;
  totalLikes: number | null;
};

export type TokenSet = {
  accessToken: string;
  refreshToken?: string | null;
  accessTokenExpiresAt?: Date | null;
  refreshTokenExpiresAt?: Date | null;
  scopes: string[];
};

export type SocialErrorKind =
  | "AUTH_EXPIRED"
  | "AUTH_REVOKED"
  | "MISSING_SCOPES"
  | "RATE_LIMITED"
  | "NOT_SUPPORTED"
  | "BAD_ACCOUNT"
  | "TRANSIENT"
  | "UNKNOWN";

/**
 * Error de una red, ya clasificado. `userMessage` está en español y se puede mostrar tal cual;
 * `detail` es técnico (sin tokens) y va solo a los logs.
 */
export class SocialApiError extends Error {
  constructor(
    readonly platform: Platform,
    readonly kind: SocialErrorKind,
    readonly userMessage: string,
    readonly detail: string,
    readonly retryAfterSec?: number,
  ) {
    super(`[${platform}] ${kind}: ${detail}`);
    this.name = "SocialApiError";
  }
}
