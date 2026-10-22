/**
 * Esquema de Content 2. Single-tenant: una base por cliente, sin organizaciones.
 * Identificadores en inglés; comentarios en español neutro.
 * Las migraciones se generan con `pnpm db:generate` y viven en `drizzle/`.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { MonthlyReportData } from "@/lib/reports/types";
import type { ReelCopyAnalysis } from "@/lib/scripts/reel-copy";
import type { RetentionDrop, RetentionExplanation, RetentionPoint, ThumbnailConcept, TitleBasis, TitleGroup, TranscriptSegment, TranscriptSource } from "@/lib/youtube/types";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ─── Autenticación (tablas de Better Auth) ────────────────────────────────

/** Usuarios que pueden iniciar sesión. Tener usuario no basta para entrar: hace falta una fila en `team_members`. */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

/** Credenciales de cada usuario. La contraseña se guarda con hash (scrypt) en la cuenta "credential". */
export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

/** Tokens de un solo uso: invitaciones y restablecimiento de contraseña. */
export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/** Contador de intentos (inicio de sesión, recuperación de contraseña) para frenar ataques de fuerza bruta. */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Equipo ────────────────────────────────────────────────────────────────

/** OWNER: todo, incluidas conexiones y usuarios. EDITOR: crea y edita contenido. VIEWER: solo lectura. */
export const roleEnum = pgEnum("role", ["OWNER", "EDITOR", "VIEWER"]);

/** Quién puede entrar y con qué rol. Single-tenant: no hay registro abierto, los usuarios se invitan. */
export const teamMembers = pgTable("team_members", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull().default("EDITOR"),
  active: boolean("active").notNull().default(true),
  invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
  notificationsSeenAt: timestamp("notifications_seen_at", { withTimezone: true }), // hasta cuándo vio los avisos (null = nunca)
  onboardingDismissedAt: timestamp("onboarding_dismissed_at", { withTimezone: true }), // cerró la guía de primer uso ("Ya lo conozco")
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ─── Conexiones con redes ──────────────────────────────────────────────────

export const platformEnum = pgEnum("platform", ["INSTAGRAM", "YOUTUBE", "TIKTOK"]);

/**
 * ACTIVE: funciona. EXPIRED: el token venció y no se pudo refrescar. REVOKED: el usuario quitó el permiso
 * desde la red. MISSING_SCOPES: conectó sin aceptar todos los permisos. ERROR: falla de la red que no se resolvió.
 * DISCONNECTED: se desconectó desde Ajustes (se conserva por el histórico).
 */
export const connectionStatusEnum = pgEnum("connection_status", [
  "ACTIVE",
  "EXPIRED",
  "REVOKED",
  "MISSING_SCOPES",
  "ERROR",
  "DISCONNECTED",
]);

/**
 * Cuentas conectadas. Puede haber varias filas por red (si se cambia de cuenta, la anterior queda
 * DISCONNECTED con su histórico), pero solo una "actual" por red (índice único parcial).
 * Los tokens se guardan cifrados (lib/crypto.ts).
 */
export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: id(),
    platform: platformEnum("platform").notNull(),
    externalId: text("external_id").notNull(),
    handle: text("handle").notNull(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    tokenIssuedAt: timestamp("token_issued_at", { withTimezone: true }),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    status: connectionStatusEnum("status").notNull().default("ACTIVE"),
    statusMessage: text("status_message"), // en español, para mostrar
    current: boolean("current").notNull().default(true),
    meta: jsonb("meta").$type<Record<string, unknown>>(), // datos propios de la red (p. ej. playlist de subidas de YouTube)
    backfillCompletedAt: timestamp("backfill_completed_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    connectedBy: text("connected_by").references(() => users.id, { onDelete: "set null" }),
    connectedAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("social_accounts_platform_external_id_key").on(t.platform, t.externalId),
    uniqueIndex("social_accounts_current_platform_key").on(t.platform).where(sql`${t.current}`),
  ],
);

/** Estado temporal del flujo OAuth (protección CSRF). Se borra al usarse o a los 10 minutos. */
export const oauthStates = pgTable("oauth_states", {
  id: id(),
  state: text("state").notNull().unique(),
  platform: platformEnum("platform").notNull(),
  codeVerifier: text("code_verifier"),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

// ─── Contenido y métricas (modelo común a las tres redes) ──────────────────

/** REEL, CAROUSEL e IMAGE son de Instagram; VIDEO es YouTube largo, video de feed de IG o TikTok; SHORT es YouTube Short. */
export type PieceAnalysis = {
  verdict: string;
  drivers: { factor: string; evidence: string; effect: "positivo" | "negativo" }[];
  hook: string;
  lessons: string[];
  ideas: { title: string; hook: string; angle: string }[];
  ratio: number | null;
};

export const contentTypeEnum = pgEnum("content_type", ["REEL", "CAROUSEL", "IMAGE", "VIDEO", "SHORT"]);

/** OK: llegaron. PENDING: la red todavía no los calcula (hasta 48 h). NOT_SUPPORTED: la red no los da para esta pieza. */
export const insightsStatusEnum = pgEnum("insights_status", ["OK", "PENDING", "NOT_SUPPORTED"]);

/**
 * Una pieza publicada en cualquier red, con sus métricas actuales.
 * Nunca se borra: si deja de venir en la API se marca `available = false` y `unavailableSince`.
 * Métricas en null = la red no da ese dato (nunca se guarda 0 en lugar de "sin dato").
 */
export const contentItems = pgTable(
  "content_items",
  {
    id: id(),
    socialAccountId: uuid("social_account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "restrict" }),
    platform: platformEnum("platform").notNull(),
    externalId: text("external_id").notNull(),
    type: contentTypeEnum("type").notNull(),
    caption: text("caption"),
    title: text("title"), // YouTube y TikTok
    permalink: text("permalink"),
    thumbnailUrl: text("thumbnail_url"), // copia propia (la de la red vence)
    thumbnailSourceUrl: text("thumbnail_source_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    durationSec: integer("duration_sec"),

    // Métricas actuales
    views: bigint("views", { mode: "number" }),
    reach: integer("reach"),
    likes: integer("likes"),
    comments: integer("comments"),
    shares: integer("shares"),
    saves: integer("saves"),
    totalInteractions: integer("total_interactions"),
    follows: integer("follows"),
    profileVisits: integer("profile_visits"),
    avgWatchSec: real("avg_watch_sec"),
    totalWatchSec: real("total_watch_sec"),
    skipRate: real("skip_rate"), // IG: % que salta en los primeros 3 s
    engagedViews: bigint("engaged_views", { mode: "number" }), // YouTube
    watchTimeMinutes: real("watch_time_minutes"), // YouTube
    avgViewPercentage: real("avg_view_percentage"), // YouTube
    subscribersGained: integer("subscribers_gained"), // YouTube

    // Rendimiento a la misma edad (para comparar piezas de forma justa)
    views24h: bigint("views_24h", { mode: "number" }),
    views72h: bigint("views_72h", { mode: "number" }),
    views7d: bigint("views_7d", { mode: "number" }),
    /** views7d ÷ mediana de views7d del mismo tipo y red en los últimos 90 días. */
    perfScore: real("perf_score"),

    insightsStatus: insightsStatusEnum("insights_status").notNull().default("PENDING"),
    available: boolean("available").notNull().default(true),
    unavailableSince: timestamp("unavailable_since", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    aiAnalysis: jsonb("ai_analysis").$type<PieceAnalysis>(), // "¿Por qué funcionó?" (lib/metrics/analysis.ts)
    aiAnalyzedAt: timestamp("ai_analyzed_at", { withTimezone: true }),
    hookType: text("hook_type"), // tipo de gancho según la primera línea (lib/metrics/hooks.ts)
    hookClassifiedAt: timestamp("hook_classified_at", { withTimezone: true }),
    metricsUpdatedAt: timestamp("metrics_updated_at", { withTimezone: true }),
    raw: jsonb("raw"), // respuesta original de la API, para depurar mapeos
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("content_items_platform_external_id_key").on(t.platform, t.externalId),
    index("content_items_platform_published_at_idx").on(t.platform, t.publishedAt),
    index("content_items_published_at_idx").on(t.publishedAt),
    index("content_items_account_idx").on(t.socialAccountId),
    index("content_items_search_idx").using(
      "gin",
      sql`to_tsvector('simple', coalesce(${t.caption}, '') || ' ' || coalesce(${t.title}, ''))`,
    ),
  ],
);

/** Foto de las métricas de una pieza (una por día), para ver su evolución y calcular views a 24 h, 72 h y 7 días. */
export const metricSnapshots = pgTable(
  "metric_snapshots",
  {
    id: id(),
    contentItemId: uuid("content_item_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    capturedOn: date("captured_on", { mode: "string" }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    ageHours: integer("age_hours"),
    views: bigint("views", { mode: "number" }),
    reach: integer("reach"),
    likes: integer("likes"),
    comments: integer("comments"),
    shares: integer("shares"),
    saves: integer("saves"),
    avgWatchSec: real("avg_watch_sec"),
    watchTimeMinutes: real("watch_time_minutes"),
  },
  (t) => [uniqueIndex("metric_snapshots_item_day_key").on(t.contentItemId, t.capturedOn)],
);

/** Foto diaria de la cuenta: seguidores y totales del día. */
export const accountSnapshots = pgTable(
  "account_snapshots",
  {
    id: id(),
    socialAccountId: uuid("social_account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    capturedOn: date("captured_on", { mode: "string" }).notNull(),
    followers: integer("followers"),
    following: integer("following"),
    mediaCount: integer("media_count"),
    totalLikes: bigint("total_likes", { mode: "number" }), // TikTok: likes acumulados de la cuenta
    // Totales del día
    views: bigint("views", { mode: "number" }),
    reach: integer("reach"),
    accountsEngaged: integer("accounts_engaged"),
    interactions: integer("interactions"),
    profileLinksTaps: integer("profile_links_taps"),
    follows: integer("follows"),
    unfollows: integer("unfollows"),
    subscribersGained: integer("subscribers_gained"),
    subscribersLost: integer("subscribers_lost"),
    watchTimeMinutes: real("watch_time_minutes"),
  },
  (t) => [uniqueIndex("account_snapshots_account_day_key").on(t.socialAccountId, t.capturedOn)],
);

/**
 * Curva de retención de un video de YouTube (porcentaje que sigue mirando en cada punto del video).
 * `relative` (relativeRetentionPerformance) llega desde la versión de "Dónde se fue la gente"; las curvas viejas no lo tienen.
 */
export const retentionCurves = pgTable("retention_curves", {
  contentItemId: uuid("content_item_id")
    .primaryKey()
    .references(() => contentItems.id, { onDelete: "cascade" }),
  points: jsonb("points").$type<RetentionPoint[]>().notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
});

export const syncKindEnum = pgEnum("sync_kind", ["BACKFILL", "RECENT", "DAILY", "WEEKLY", "ACCOUNT", "TOKEN", "MANUAL"]);
export const syncStatusEnum = pgEnum("sync_status", ["RUNNING", "SUCCEEDED", "PARTIAL", "FAILED"]);

/** Registro de cada sincronización. También funciona como candado: una sola sincronización por red a la vez. */
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: id(),
    socialAccountId: uuid("social_account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    kind: syncKindEnum("kind").notNull(),
    status: syncStatusEnum("status").notNull().default("RUNNING"),
    cursor: jsonb("cursor").$type<Record<string, unknown>>(), // para retomar un backfill largo
    apiCalls: integer("api_calls").notNull().default(0),
    itemsUpserted: integer("items_upserted").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"), // en español, para mostrar
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("sync_runs_account_started_idx").on(t.socialAccountId, t.startedAt)],
);

// ─── Marca ─────────────────────────────────────────────────────────────────

export type BrandOffer = { name: string; promise: string; cta: string; keyword?: string; link?: string; when?: string };
export type BrandPillar = { name: string; description: string; share: number };
export type VoiceSample = { source: string; text: string };

/**
 * Perfil de marca: alimenta guiones, carruseles, editor y clon. Hay una sola fila (id = "brand").
 * `version` sube con cada cambio: sirve para invalidar la caché de los prompts.
 */
export type GrowthGoals = {
  followers: number; // meta de seguidores
  platform: "TOTAL" | "INSTAGRAM" | "YOUTUBE" | "TIKTOK";
  weeklyPieces: number; // piezas por semana que se propone publicar
  deadline?: string | null; // YYYY-MM-DD opcional
};

export const brandProfile = pgTable("brand_profile", {
  id: text("id").primaryKey().default("brand"),
  name: text("name"),
  handle: text("handle"),
  niche: text("niche"),
  whatYouSell: text("what_you_sell"),
  differentiator: text("differentiator"),
  audience: text("audience"), // público ideal
  audiencePains: text("audience_pains").array().notNull().default(sql`'{}'::text[]`),
  audienceDesires: text("audience_desires").array().notNull().default(sql`'{}'::text[]`),
  objections: text("objections").array().notNull().default(sql`'{}'::text[]`),
  beliefs: text("beliefs").array().notNull().default(sql`'{}'::text[]`), // posturas del creador contra la corriente
  tone: text("tone"),
  signaturePhrases: text("signature_phrases").array().notNull().default(sql`'{}'::text[]`),
  bannedWords: text("banned_words").array().notNull().default(sql`'{}'::text[]`),
  emojiPolicy: text("emoji_policy").notNull().default("pocos"), // ninguno | pocos | libres
  language: text("language").notNull().default("es-neutro"),
  voiceSamples: jsonb("voice_samples").$type<VoiceSample[]>().notNull().default(sql`'[]'::jsonb`),
  offers: jsonb("offers").$type<BrandOffer[]>().notNull().default(sql`'[]'::jsonb`),
  pillars: jsonb("pillars").$type<BrandPillar[]>().notNull().default(sql`'[]'::jsonb`),
  colors: jsonb("colors").$type<{ primary?: string; secondary?: string; accent?: string }>(),
  fonts: jsonb("fonts").$type<{ heading?: string; body?: string }>(),
  characterPhotos: text("character_photos").array().notNull().default(sql`'{}'::text[]`), // rutas en el almacenamiento de archivos
  subtitlePreset: jsonb("subtitle_preset"),
  extraContext: text("extra_context"), // notas libres del cliente
  goals: jsonb("goals").$type<GrowthGoals>(), // meta de seguidores y ritmo de publicación (Inicio)
  version: integer("version").notNull().default(1),
  updatedAt: updatedAt(),
});

export type WeeklyReportContent = {
  headline: string;
  wins: string[];
  watch: string[];
  nextWeek: { title: string; hook: string; why: string }[];
  numbers: Record<string, number | null>;
};

/** Resumen semanal con IA (Inicio). Uno por semana, se genera el lunes o a pedido. */
export const weeklyReports = pgTable("weekly_reports", {
  weekStart: date("week_start", { mode: "string" }).primaryKey(), // lunes de la semana resumida (local)
  content: jsonb("content").$type<WeeklyReportContent>().notNull(),
  createdAt: createdAt(),
});

// ─── Producción ────────────────────────────────────────────────────────────

export const scriptStatusEnum = pgEnum("script_status", ["IDEA", "DRAFT", "READY", "RECORDED", "PUBLISHED", "ARCHIVED"]);
export const scriptFormatEnum = pgEnum("script_format", ["REEL", "SHORT", "YT_LONG", "STORY"]);

export type ScriptHook = { text: string; type: string; score: number; why: string };
export type ScriptBeat = { id: string; purpose: string; spoken: string; onScreenText: string; broll: string; seconds: number };
export type ScriptContent = {
  title: string;
  angle: string;
  hooks: ScriptHook[];
  selectedHook: number;
  beats: ScriptBeat[];
  cta: { spoken: string; onScreenText: string; offer: string | null };
  caption: string;
};

/** Un guion. `content` guarda la estructura completa; cada cambio guarda una versión en script_versions. */
export const scripts = pgTable(
  "scripts",
  {
    id: id(),
    title: text("title").notNull(),
    idea: text("idea"),
    format: scriptFormatEnum("format").notNull().default("REEL"),
    pillar: text("pillar"),
    objective: text("objective"), // alcance | seguidores | ventas
    status: scriptStatusEnum("status").notNull().default("DRAFT"),
    platform: platformEnum("platform"),
    content: jsonb("content").$type<ScriptContent>(),
    wordCount: integer("word_count"),
    estimatedSeconds: integer("estimated_seconds"),
    sourceUrl: text("source_url"), // video de referencia
    sourceText: text("source_text"), // transcripción o texto de referencia
    sourceContentItemId: uuid("source_content_item_id").references(() => contentItems.id, { onDelete: "set null" }),
    parentId: uuid("parent_id"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("scripts_status_updated_idx").on(t.status, t.updatedAt)],
);

/** Historial de un guion: cada generación, reescritura o edición guardada. Permite volver atrás. */
export const scriptVersions = pgTable(
  "script_versions",
  {
    id: id(),
    scriptId: uuid("script_id")
      .notNull()
      .references(() => scripts.id, { onDelete: "cascade" }),
    content: jsonb("content").$type<ScriptContent>().notNull(),
    action: text("action").notNull(), // "generar", "ganchos", "acortar", "editar"…
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("script_versions_script_idx").on(t.scriptId, t.createdAt)],
);

export const reelCopyStatusEnum = pgEnum("reel_copy_status", ["UPLOADING", "ANALYZING", "WRITING", "READY", "FAILED"]);

/**
 * "Copia este reel": a partir de un reel, TikTok o short ajeno se arma la versión propia de la persona.
 * El worker baja el video, lo transcribe y mide su edición (REEL_COPY); la app analiza la estructura con Claude y
 * escribe un guion nuevo sobre el tema de la persona. Se guarda solo la estructura (`analysis`), el guion y el
 * estilo de edición: el video y su transcripción nunca se guardan.
 * El archivo subido (si no vino de un link) vive en la ruta del estilo (`editor/estilos/<styleId>/referencia.<ext>`)
 * y se borra al terminar.
 */
export const reelCopies = pgTable(
  "reel_copies",
  {
    id: id(),
    status: reelCopyStatusEnum("status").notNull().default("ANALYZING"),
    sourceKind: text("source_kind").notNull(), // "upload" | "link"
    sourceUrl: text("source_url"), // link del reel original (se muestra como origen)
    platform: text("platform"), // "Instagram" | "TikTok" | "YouTube" | null (subido)
    topic: text("topic"), // el tema de la persona para su versión (vacío = lo elige la IA según la marca)
    objective: text("objective"), // alcance | seguidores | ventas
    format: scriptFormatEnum("format").notNull().default("REEL"),
    analysis: jsonb("analysis").$type<ReelCopyAnalysis>(), // estructura del original (ver lib/scripts/reel-copy.ts)
    styleId: uuid("style_id").references(() => videoStyles.id, { onDelete: "set null" }),
    scriptId: uuid("script_id").references(() => scripts.id, { onDelete: "set null" }),
    errorMessage: text("error_message"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("reel_copies_updated_at_idx").on(t.updatedAt)],
);

export const calendarStatusEnum = pgEnum("calendar_status", ["IDEA", "SCRIPTING", "PRODUCTION", "READY", "PUBLISHED"]);
export const plannedFormatEnum = pgEnum("planned_format", ["REEL", "CAROUSEL", "VIDEO", "SHORT", "STORY", "POST", "CLONE_VIDEO"]);
export const linkStatusEnum = pgEnum("link_status", ["NONE", "SUGGESTED", "LINKED"]);

/**
 * Pieza planeada en el calendario. La fecha es local (APP_TIMEZONE): `scheduledDate` + `scheduledTime` opcional.
 * Sin fecha = está en la lista "Sin fecha". Las redes de destino van en `calendar_targets`.
 */
export const calendarEntries = pgTable(
  "calendar_entries",
  {
    id: id(),
    title: text("title").notNull(),
    notes: text("notes"),
    hook: text("hook"),
    pillar: text("pillar"),
    format: plannedFormatEnum("format").notNull().default("REEL"),
    status: calendarStatusEnum("status").notNull().default("IDEA"),
    scheduledDate: date("scheduled_date"),
    scheduledTime: text("scheduled_time"), // "HH:MM" local; null = sin hora
    position: integer("position").notNull().default(0), // orden dentro del día o de "Sin fecha"
    source: text("source").notNull().default("manual"), // manual | guion | carrusel | clon | editor | plan
    scriptId: uuid("script_id").references(() => scripts.id, { onDelete: "set null" }),
    carouselId: uuid("carousel_id"),
    cloneVideoId: uuid("clone_video_id"),
    videoProjectId: uuid("video_project_id"),
    demo: boolean("demo").notNull().default(false), // creada por los datos de demostración: se borra con ellos
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("calendar_entries_date_idx").on(t.scheduledDate),
    index("calendar_entries_script_idx").on(t.scriptId),
  ],
);

/** Una red de destino de una pieza planeada, con su vínculo a la pieza real publicada. */
export const calendarTargets = pgTable(
  "calendar_targets",
  {
    id: id(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => calendarEntries.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    linkStatus: linkStatusEnum("link_status").notNull().default("NONE"),
    contentItemId: uuid("content_item_id").references(() => contentItems.id, { onDelete: "set null" }),
    linkScore: real("link_score"),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
    rejectedItemIds: uuid("rejected_item_ids").array().notNull().default(sql`'{}'::uuid[]`), // sugerencias descartadas
  },
  (t) => [
    uniqueIndex("calendar_targets_entry_platform_uq").on(t.entryId, t.platform),
    index("calendar_targets_item_idx").on(t.contentItemId),
  ],
);

// ─── Carruseles ────────────────────────────────────────────────────────────

export const carouselStatusEnum = pgEnum("carousel_status", ["DRAFT", "READY", "EXPORTED", "ARCHIVED"]);

export type CarouselSlide = {
  id: string;
  type: "cover" | "item" | "step" | "data" | "quote" | "cta";
  kicker: string;
  headline: string;
  highlight: string; // palabra o frase del titular que va en color de acento
  body: string;
  cta: string;
  template?: string | null; // plantilla propia de este slide (de fábrica o `custom:<uuid>`); null = la del carrusel
  imageUrl?: string | null; // imagen del slide (foto subida o escena con IA), servida por /api/carruseles/archivos/…
  imageSource?: "upload" | "ai" | null; // de dónde salió la imagen
  scenePrompt?: string | null; // escena que propone la IA para la imagen (sin texto); editable
};

/** Un carrusel de Instagram (1080×1350). Los slides son texto; la imagen final se dibuja con la plantilla. */
export const carousels = pgTable(
  "carousels",
  {
    id: id(),
    title: text("title").notNull(),
    topic: text("topic"),
    status: carouselStatusEnum("status").notNull().default("DRAFT"),
    template: text("template").notNull().default("editorial"),
    theme: jsonb("theme").$type<Record<string, string>>(), // colores o fuentes propios de este carrusel
    slides: jsonb("slides").$type<CarouselSlide[]>().notNull().default(sql`'[]'::jsonb`),
    caption: text("caption"),
    hashtags: text("hashtags").array().notNull().default(sql`'{}'::text[]`),
    ctaKeyword: text("cta_keyword"),
    sourceText: text("source_text"),
    scriptId: uuid("script_id").references(() => scripts.id, { onDelete: "set null" }),
    /** Carrusel de ejemplo para la demo de venta: se borra con la demo sin tocar los reales. */
    demo: boolean("demo").notNull().default(false),
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("carousels_updated_at_idx").on(t.updatedAt)],
);

export const carouselTemplateStatusEnum = pgEnum("carousel_template_status", ["ANALYZING", "READY", "FAILED"]);

/**
 * Plantilla propia creada copiando el estilo de un carrusel de referencia (imágenes subidas o un link).
 * Se guarda solo el diseño (spec validado con Zod en lib/carousels/template-spec.ts): nunca el texto, las fotos
 * ni los logos del original. Las imágenes de referencia se borran al terminar el análisis.
 */
export const carouselTemplates = pgTable(
  "carousel_templates",
  {
    id: id(),
    name: text("name").notNull(),
    status: carouselTemplateStatusEnum("status").notNull().default("ANALYZING"),
    source: text("source").notNull().default("upload"), // upload | link
    sourceUrl: text("source_url"), // link del post, si vino de un link
    referenceCount: integer("reference_count").notNull().default(0),
    spec: jsonb("spec").$type<Record<string, unknown>>(), // TemplateSpec; null mientras se analiza
    measurements: jsonb("measurements").$type<Record<string, unknown>>(), // medidas de Tesseract y colores (sin texto)
    errorMessage: text("error_message"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("carousel_templates_updated_at_idx").on(t.updatedAt)],
);

// ─── Videos con clon (HeyGen) ──────────────────────────────────────────────

export const cloneVideoStatusEnum = pgEnum("clone_video_status", ["QUEUED", "PROCESSING", "COMPLETED", "FAILED"]);

/** Un video generado con el clon del cliente en su propia cuenta de HeyGen. */
export const cloneVideos = pgTable(
  "clone_videos",
  {
    id: id(),
    title: text("title").notNull(),
    scriptId: uuid("script_id").references(() => scripts.id, { onDelete: "set null" }),
    scriptText: text("script_text").notNull(),
    avatarId: text("avatar_id").notNull(),
    avatarName: text("avatar_name"),
    voiceId: text("voice_id").notNull(),
    engine: text("engine").notNull(), // avatar_iii | avatar_iv | avatar_v
    aspectRatio: text("aspect_ratio").notNull().default("9:16"),
    resolution: text("resolution").notNull().default("1080p"),
    captions: boolean("captions").notNull().default(false),
    background: jsonb("background").$type<{ type: "color"; value: string } | null>(),
    speed: real("speed").notNull().default(1),
    estimatedSeconds: integer("estimated_seconds"),
    estimatedCostUsd: real("estimated_cost_usd"),
    heygenVideoId: text("heygen_video_id").unique(),
    retriedInto: uuid("retried_into"), // video nuevo creado al reintentar este (evita cobrar dos veces)
    copyingUntil: timestamp("copying_until", { withTimezone: true }), // candado de la copia de archivos
    status: cloneVideoStatusEnum("status").notNull().default("QUEUED"),
    errorMessage: text("error_message"),
    videoUrl: text("video_url"), // copia propia (las URLs de HeyGen vencen)
    subtitleUrl: text("subtitle_url"),
    thumbnailUrl: text("thumbnail_url"),
    durationSeconds: real("duration_seconds"),
    /** true cuando el MP4, el SRT y la miniatura ya están en nuestro almacenamiento; false = siguen solo en HeyGen. */
    filesStored: boolean("files_stored").notNull().default(false),
    /**
     * Última consulta a HeyGen. Sirve de freno (no consultar el mismo video más de una vez cada pocos segundos)
     * y de candado: mientras se copian los archivos se pone en el futuro para que nadie más los copie a la vez.
     */
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("clone_videos_status_idx").on(t.status), index("clone_videos_created_at_idx").on(t.createdAt)],
);

/** Eventos de webhooks ya procesados (para no procesar dos veces el mismo). */
export const webhookEvents = pgTable("webhook_events", {
  key: text("key").primaryKey(), // proveedor:evento:id
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Editor de video ───────────────────────────────────────────────────────

export const videoProjectStatusEnum = pgEnum("video_project_status", [
  "UPLOADING",
  "PROCESSING", // ingesta, transcripción y plan
  "AWAITING_REVIEW", // el usuario revisa cortes, gancho y subtítulos
  "RENDERING",
  "DONE",
  "FAILED",
]);

/** Un video crudo que el cliente sube para editar. El detalle técnico vive en jsonb; el trabajo pesado lo hace el worker. */
export const videoProjects = pgTable(
  "video_projects",
  {
    id: id(),
    title: text("title").notNull(),
    status: videoProjectStatusEnum("status").notNull().default("UPLOADING"),
    format: text("format").notNull().default("9:16"), // 9:16 | 16:9
    captionPreset: text("caption_preset").notNull().default("clasico"),
    scriptId: uuid("script_id").references(() => scripts.id, { onDelete: "set null" }),
    sourceKey: text("source_key"), // ruta del original en el almacenamiento
    sourceName: text("source_name"),
    sourceBytes: bigint("source_bytes", { mode: "number" }),
    media: jsonb("media").$type<Record<string, unknown>>(), // duración, tamaño, fps, hdr, rutas de proxy y audio
    transcript: jsonb("transcript").$type<unknown>(), // palabras con id, inicio y fin
    plan: jsonb("plan").$type<unknown>(), // plan de edición v2 (ver lib/video/plan.ts)
    outputKey: text("output_key"),
    srtKey: text("srt_key"),
    outputMeta: jsonb("output_meta").$type<Record<string, unknown>>(),
    errorMessage: text("error_message"),
    // Estilo copiado de un video de referencia (ver video_styles). null = sin estilo.
    styleId: uuid("style_id").references(() => videoStyles.id, { onDelete: "set null" }),
    // B-roll: "auto" (Claude elige dónde y busca en Pexels y en la biblioteca) o "off".
    brollMode: text("broll_mode").notNull().default("off"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("video_projects_updated_at_idx").on(t.updatedAt)],
);

export const videoStyleStatusEnum = pgEnum("video_style_status", ["UPLOADING", "ANALYZING", "READY", "FAILED"]);

/**
 * Estilo de edición medido en un video de referencia ("Edita como este"). Se copia el estilo (ritmo de cortes,
 * zooms, subtítulos, b-roll), nunca el contenido: el video de referencia se borra después del análisis.
 */
export const videoStyles = pgTable(
  "video_styles",
  {
    id: id(),
    name: text("name").notNull(),
    status: videoStyleStatusEnum("status").notNull().default("ANALYZING"),
    sourceKind: text("source_kind").notNull(), // "upload" | "link"
    sourceUrl: text("source_url"), // link de Instagram, TikTok o YouTube (se muestra como origen)
    sourceKey: text("source_key"), // archivo subido; se borra al terminar el análisis
    sourceName: text("source_name"),
    sourceBytes: bigint("source_bytes", { mode: "number" }),
    thumbKey: text("thumb_key"),
    metrics: jsonb("metrics").$type<Record<string, unknown>>(), // lo medido (ver worker/video/style.py)
    preset: jsonb("preset").$type<Record<string, unknown>>(), // preset validado (ver lib/video/style.ts)
    errorMessage: text("error_message"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("video_styles_updated_at_idx").on(t.updatedAt)],
);

export const longVideoStatusEnum = pgEnum("long_video_status", ["UPLOADING", "PROCESSING", "READY", "FAILED"]);

/**
 * "Clips desde un video largo": un podcast, un live o un video de YouTube del que se sacan shorts.
 * El worker lo transcribe, la app elige los momentos (reglas + Claude) y el worker sigue las caras de cada uno.
 */
export const longVideos = pgTable(
  "long_videos",
  {
    id: id(),
    title: text("title").notNull(),
    status: longVideoStatusEnum("status").notNull().default("UPLOADING"),
    sourceKind: text("source_kind").notNull(), // "upload" | "link"
    sourceUrl: text("source_url"), // link de YouTube (o Instagram, TikTok) que baja el worker con yt-dlp
    sourceKey: text("source_key"), // `editor/largos/<id>/original.<ext>` (subido o bajado)
    sourceName: text("source_name"),
    sourceBytes: bigint("source_bytes", { mode: "number" }),
    media: jsonb("media").$type<Record<string, unknown>>(), // duración, tamaño, fps y póster
    transcript: jsonb("transcript").$type<unknown>(), // palabras con id, inicio y fin (como en video_projects)
    analysis: jsonb("analysis").$type<Record<string, unknown>>(), // quién eligió (IA o reglas), avisos y candidatos vistos
    errorMessage: text("error_message"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("long_videos_updated_at_idx").on(t.updatedAt)],
);

/** Un momento de un video largo que funciona solo como short, con su puntaje, su explicación y su reencuadre. */
export const longVideoClips = pgTable(
  "long_video_clips",
  {
    id: id(),
    longVideoId: uuid("long_video_id")
      .notNull()
      .references(() => longVideos.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(), // orden por puntaje dentro del video (1 = el mejor)
    discarded: boolean("discarded").notNull().default(false),
    fromWord: integer("from_word").notNull(),
    toWord: integer("to_word").notNull(),
    start: real("start").notNull(), // segundos del video largo (con un margen corto antes de la primera palabra)
    end: real("end").notNull(),
    // Tramo de la vista previa y del reencuadre: el clip con margen, para poder mover el inicio y el fin.
    windowStart: real("window_start").notNull(),
    windowEnd: real("window_end").notNull(),
    title: text("title").notNull(),
    hookText: text("hook_text").notNull(), // texto de gancho sugerido para poner arriba del video
    reason: text("reason").notNull(), // "por qué este momento"
    hookType: text("hook_type"), // tipo de gancho (las mismas categorías que el ranking de Métricas)
    score: integer("score").notNull(), // 0 a 100, relativo dentro del video (no es una probabilidad de nada)
    scoreDetail: jsonb("score_detail").$type<Record<string, unknown>>().notNull(),
    framing: jsonb("framing").$type<Record<string, unknown>>(), // camino de la cámara virtual (ver worker/video/reframe.py)
    previewKey: text("preview_key"),
    posterKey: text("poster_key"),
    // Proyecto del Editor creado a partir del clip ("Abrir en el editor" o "Exportar directo").
    projectId: uuid("project_id").references(() => videoProjects.id, { onDelete: "set null" }),
    exportMode: text("export_mode"), // "editor" | "export"
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("long_video_clips_video_idx").on(t.longVideoId, t.rank)],
);

export const brollClipStatusEnum = pgEnum("broll_clip_status", ["UPLOADING", "PROCESSING", "READY", "FAILED"]);

/** Biblioteca de b-roll del cliente: clips propios que sube una vez y el editor reutiliza. */
export const brollClips = pgTable(
  "broll_clips",
  {
    id: id(),
    title: text("title").notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    status: brollClipStatusEnum("status").notNull().default("UPLOADING"),
    fileKey: text("file_key").notNull(),
    fileName: text("file_name"),
    fileBytes: bigint("file_bytes", { mode: "number" }),
    thumbKey: text("thumb_key"), // la genera el worker
    duration: real("duration"),
    width: integer("width"),
    height: integer("height"),
    errorMessage: text("error_message"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("broll_clips_updated_at_idx").on(t.updatedAt)],
);

/**
 * Música propia del cliente para el fondo de sus videos (Biblioteca → Música). Solo pistas que el cliente sube:
 * la app no trae música de terceros. Ciclo: UPLOADING → READY (el worker la valida al renderizar).
 */
export const musicTracks = pgTable(
  "music_tracks",
  {
    id: id(),
    title: text("title").notNull(),
    status: brollClipStatusEnum("status").notNull().default("UPLOADING"),
    fileKey: text("file_key").notNull(),
    fileName: text("file_name"),
    fileBytes: bigint("file_bytes", { mode: "number" }),
    duration: real("duration"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("music_tracks_created_at_idx").on(t.createdAt)],
);

// ─── Trabajos en segundo plano ─────────────────────────────────────────────

export const jobTypeEnum = pgEnum("job_type", [
  "SYNC_METRICS",
  "VIDEO_EDIT",
  "VIDEO_ANALYZE",
  "VIDEO_RENDER",
  "CAROUSEL_GENERATE",
  "CLONE_TRAIN",
  "CLONE_VIDEO",
  "CAROUSEL_STYLE", // analizar un carrusel de referencia (Tesseract + colores) para crear una plantilla
  "CAROUSEL_IMAGES", // generar imágenes sin texto para slides (ChatGPT vía Codex o API de OpenAI)
  "CODEX_LOGIN", // conectar la cuenta de ChatGPT del cliente (login por código de dispositivo)
  "VIDEO_STYLE", // análisis de un video de referencia (input.styleId)
  "VIDEO_CLIP", // miniatura y datos de un clip de la biblioteca de b-roll (input.clipId)
  "LONG_VIDEO_CLIPS", // clips desde un video largo: transcribir, elegir momentos y seguir caras (input.longVideoId)
  "YT_THUMBNAILS", // fondos sin texto de las miniaturas de YouTube y recorte de fotos del personaje (input.packageId)
  "YOUTUBE_TRANSCRIPT", // subtítulos de un video publicado de YouTube con yt-dlp (input.contentItemId)
  "REEL_COPY", // "Copia este reel": bajar, transcribir y medir un reel ajeno; la app escribe la versión propia (input.reelCopyId)
]);
export const jobStatusEnum = pgEnum("job_status", ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]);

/**
 * Cola de trabajos y registro visible de cada uno. El worker toma trabajos con
 * `FOR UPDATE SKIP LOCKED` sobre esta tabla (sin Redis ni servicios extra) y renueva `lockedUntil` mientras trabaja.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: jobTypeEnum("type").notNull(),
    status: jobStatusEnum("status").notNull().default("QUEUED"),
    progress: integer("progress").notNull().default(0), // 0 a 100
    stage: text("stage"), // texto corto para la UI: "Transcribiendo", "Renderizando"…
    input: jsonb("input").notNull(),
    output: jsonb("output"),
    errorMessage: text("error_message"), // en español, para mostrar al usuario
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedBy: text("locked_by"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    videoProjectId: uuid("video_project_id").references(() => videoProjects.id, { onDelete: "cascade" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("jobs_type_status_idx").on(t.type, t.status),
    index("jobs_queue_idx").on(t.status, t.runAfter),
    index("jobs_created_at_idx").on(t.createdAt),
  ],
);

/** Latido del worker: así la app sabe si el servicio de procesamiento está encendido. */
export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  version: text("version"),
  capabilities: text("capabilities").array().notNull().default(sql`'{}'::text[]`),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Consumo de IA por llamada, para saber cuánto cuesta cada función. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    feature: text("feature").notNull(), // "guiones.generar", "video.plan"…
    provider: text("provider").notNull(), // "anthropic", "openai"…
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_created_at_idx").on(t.createdAt)],
);

// ─── Claves de servicios del cliente ───────────────────────────────────────

export const serviceProviderEnum = pgEnum("service_provider", ["HEYGEN", "CHATGPT", "OPENAI"]);

/** Claves que carga el propio cliente (por ejemplo su API key de HeyGen), cifradas. */
export const serviceCredentials = pgTable("service_credentials", {
  id: id(),
  provider: serviceProviderEnum("provider").notNull().unique(),
  secretEnc: text("secret_enc").notNull(),
  label: text("label"), // últimos 4 caracteres, para mostrar sin exponer la clave
  // Webhook registrado en el servicio (HeyGen): su id y su secreto de firma, cifrado.
  webhookEndpointId: text("webhook_endpoint_id"),
  webhookSecretEnc: text("webhook_secret_enc"),
  webhookError: text("webhook_error"), // por qué no se pudo registrar (en español); null = registrado o sin intentar
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ─── Avisos ───────────────────────────────────────────────────────────────

/**
 * Avisos de "listo" o "falló" de los trabajos lentos (renders, carruseles, clon). `key` evita duplicados
 * (job:<id>, clone-video:<id>); userId null = para todo el equipo. emailedAt: cuándo salió el correo.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    key: text("key").notNull().unique(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    tone: text("tone").notNull().$type<"success" | "error">(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href").notNull(),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_created_at_idx").on(t.createdAt)],
);

// ─── Informe mensual ───────────────────────────────────────────────────────

/** Archivo binario (el PDF del informe). `pg` lo devuelve como Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/**
 * Informe mensual en PDF (Inicio → Informes). Uno por mes: se guarda la foto de los datos y el PDF ya dibujado
 * para no regenerarlo (ni volver a pagar la IA) cada vez que alguien lo baja o se reenvía.
 */
export const monthlyReports = pgTable("monthly_reports", {
  month: text("month").primaryKey(), // "2026-10"
  data: jsonb("data").$type<MonthlyReportData>().notNull(),
  pdf: bytea("pdf").notNull(),
  pdfBytes: integer("pdf_bytes").notNull(),
  /** true si se generó con el mes en curso: el cron lo rehace cuando el mes cierra. */
  partial: boolean("partial").notNull().default(false),
  generatedBy: text("generated_by").references(() => users.id, { onDelete: "set null" }),
  /** Último envío (manual o automático) y a quiénes. */
  sentAt: timestamp("sent_at", { withTimezone: true }),
  sentTo: text("sent_to").array().notNull().default(sql`'{}'::text[]`),
  /** Envío automático del día 1: se marca antes de mandar para que salga una sola vez. */
  autoSentAt: timestamp("auto_sent_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Ajustes del informe mensual (una sola fila): destinatarios y envío automático. */
export const reportSettings = pgTable("report_settings", {
  id: text("id").primaryKey().default("report"),
  recipients: text("recipients").array().notNull().default(sql`'{}'::text[]`), // correos del equipo o externos (máx. 10)
  autoSend: boolean("auto_send").notNull().default(false),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
});

// ─── Estratega ─────────────────────────────────────────────────────────────

/** Fuente citada en una respuesta del estratega: una pieza, una cifra o una entrada del calendario. */
export type StrategistCitation = {
  ref: string; // "P3", "C1", "E2"
  kind: "pieza" | "cifra" | "calendario";
  label: string;
  detail: string | null;
  href: string;
  /** id de la pieza o de la entrada del calendario (para volver a usarla en la conversación). */
  targetId: string | null;
  platform: "INSTAGRAM" | "YOUTUBE" | "TIKTOK" | null;
};

/** Idea que propuso el estratega, con botones para crear el guion o agregarla al calendario. */
export type StrategistIdea = {
  id: string;
  title: string;
  idea: string;
  hook: string | null;
  format: "REEL" | "CAROUSEL" | "VIDEO" | "SHORT" | "STORY" | "POST";
  platforms: ("INSTAGRAM" | "YOUTUBE" | "TIKTOK")[];
  date: string | null; // YYYY-MM-DD sugerido
  why: string | null;
  /** Entrada del calendario creada desde esta idea (para no duplicarla). */
  calendarEntryId?: string | null;
};

/** Herramienta que usó el estratega para responder (para mostrar "Revisé…" y depurar). */
export type StrategistToolCall = { name: string; input: unknown; summary: string; error?: boolean };

/** Conversaciones con el estratega. Cada una es de quien la empezó. */
export const strategistConversations = pgTable(
  "strategist_conversations",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("strategist_conversations_user_idx").on(t.userId, t.updatedAt)],
);

/** Mensajes de una conversación. Los del usuario cuentan para el límite diario. */
export const strategistMessages = pgTable(
  "strategist_messages",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => strategistConversations.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    role: text("role").notNull().$type<"user" | "assistant">(),
    content: text("content").notNull(),
    citations: jsonb("citations").$type<StrategistCitation[]>().notNull().default([]),
    ideas: jsonb("ideas").$type<StrategistIdea[]>().notNull().default([]),
    toolCalls: jsonb("tool_calls").$type<StrategistToolCall[]>().notNull().default([]),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    /** Mensaje de error en español si la respuesta no se pudo completar. */
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("strategist_messages_conversation_idx").on(t.conversationId, t.createdAt), index("strategist_messages_user_idx").on(t.userId, t.createdAt)],
);

// ─── Sacarle todo el jugo ──────────────────────────────────────────────────

/** Textos para publicar el contenido de origen en cada red (editables). */
export type RepurposeCopy = {
  instagram: { caption: string; hashtags: string[] };
  tiktok: { caption: string; hashtags: string[] };
  youtube: { title: string; description: string; hashtags: string[] };
};
export type RepurposePartStatus = "pending" | "ready" | "failed";
/** Estado de cada parte del paquete: se generan en paralelo y cada una avisa por separado. */
export type RepurposeParts = {
  carousel: { status: RepurposePartStatus; error?: string | null; carouselId?: string | null };
  copy: { status: RepurposePartStatus; error?: string | null; data?: RepurposeCopy | null };
  shorts: { status: RepurposePartStatus; error?: string | null; scriptIds?: string[] };
};

/**
 * Un video, todo el contenido: a partir de un video editado, un guion o una pieza publicada se arma un carrusel
 * (borrador en Carruseles), los textos para cada red y 2 o 3 guiones de shorts (en Guiones). Aquí se guarda el
 * origen y qué se creó; el carrusel y los guiones viven en sus tablas.
 */
export const repurposePacks = pgTable(
  "repurpose_packs",
  {
    id: id(),
    sourceKind: text("source_kind").notNull().$type<"video" | "guion" | "pieza">(),
    videoProjectId: uuid("video_project_id").references(() => videoProjects.id, { onDelete: "set null" }),
    scriptId: uuid("script_id").references(() => scripts.id, { onDelete: "set null" }),
    contentItemId: uuid("content_item_id").references(() => contentItems.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    sourceText: text("source_text").notNull(), // la transcripción o el texto que se usó
    parts: jsonb("parts").$type<RepurposeParts>().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("repurpose_packs_created_at_idx").on(t.createdAt)],
);

// ─── Autopiloto semanal ────────────────────────────────────────────────────

/** Ajustes del autopiloto (una sola fila). piecesPerWeek null = la meta semanal de Inicio. */
export const autopilotSettings = pgTable("autopilot_settings", {
  id: text("id").primaryKey().default("autopilot"),
  enabled: boolean("enabled").notNull().default(false),
  piecesPerWeek: integer("pieces_per_week"),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
});

/** Paquete semanal para aprobar: uno por semana (lunes local). GENERATING sirve también de candado. */
export const weeklyPacks = pgTable("weekly_packs", {
  weekStart: date("week_start", { mode: "string" }).primaryKey(),
  status: text("status").notNull().$type<"GENERATING" | "READY" | "FAILED">(),
  trigger: text("trigger").notNull().default("cron").$type<"cron" | "manual">(),
  errorMessage: text("error_message"),
  /** Tokens estimados antes de generar y los que se registraron en ai_usage (autopiloto.*). */
  estimatedTokens: integer("estimated_tokens"),
  usedTokens: integer("used_tokens"),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Una pieza del paquete semanal, con su guion o su carrusel ya escrito y la decisión de la persona. */
export const weeklyPackItems = pgTable(
  "weekly_pack_items",
  {
    id: id(),
    weekStart: date("week_start", { mode: "string" })
      .notNull()
      .references(() => weeklyPacks.weekStart, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    title: text("title").notNull(),
    hook: text("hook"),
    pillar: text("pillar"),
    why: text("why"),
    format: plannedFormatEnum("format").notNull(),
    platforms: text("platforms").array().notNull().$type<("INSTAGRAM" | "YOUTUBE" | "TIKTOK")[]>(),
    scheduledDate: date("scheduled_date", { mode: "string" }),
    scriptId: uuid("script_id").references(() => scripts.id, { onDelete: "set null" }),
    carouselId: uuid("carousel_id").references(() => carousels.id, { onDelete: "set null" }),
    genStatus: text("gen_status").notNull().default("pending").$type<"pending" | "ready" | "failed">(),
    genError: text("gen_error"),
    decision: text("decision").notNull().default("pending").$type<"pending" | "approved" | "discarded">(),
    calendarEntryId: uuid("calendar_entry_id").references(() => calendarEntries.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("weekly_pack_items_week_idx").on(t.weekStart, t.position)],
);

// ─── YouTube: retención y miniaturas ───────────────────────────────────────

/**
 * Transcripción con tiempos del video publicado de una pieza (para "Dónde se fue la gente"): sale del Editor (si el
 * video se editó ahí), de un archivo de subtítulos que sube el cliente o de los subtítulos públicos de YouTube.
 */
export const pieceTranscripts = pgTable("piece_transcripts", {
  contentItemId: uuid("content_item_id")
    .primaryKey()
    .references(() => contentItems.id, { onDelete: "cascade" }),
  source: text("source").notNull().$type<TranscriptSource>(),
  language: text("language"),
  segments: jsonb("segments").$type<TranscriptSegment[]>().notNull(),
  videoProjectId: uuid("video_project_id").references(() => videoProjects.id, { onDelete: "set null" }),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Explicación con IA de las caídas de retención de una pieza, con la foto de la curva y las caídas que vio. */
export const retentionInsights = pgTable("retention_insights", {
  contentItemId: uuid("content_item_id")
    .primaryKey()
    .references(() => contentItems.id, { onDelete: "cascade" }),
  curveCapturedAt: timestamp("curve_captured_at", { withTimezone: true }).notNull(),
  transcriptSource: text("transcript_source").$type<TranscriptSource>(),
  drops: jsonb("drops").$type<RetentionDrop[]>().notNull(),
  explanation: jsonb("explanation").$type<RetentionExplanation>().notNull(),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Títulos y miniaturas de YouTube para un video: sale de un guion, de un video del Editor, de una pieza publicada o
 * de un tema. Los títulos y los 3 conceptos de miniatura son jsonb; las imágenes (fondos) viven en el almacenamiento
 * privado (`miniaturas/<paquete>/…`). El texto de la miniatura lo dibuja una plantilla, nunca el modelo de imágenes.
 */
export const ytPackages = pgTable(
  "yt_packages",
  {
    id: id(),
    title: text("title").notNull(),
    sourceKind: text("source_kind").notNull().$type<"guion" | "video" | "pieza" | "tema">(),
    scriptId: uuid("script_id").references(() => scripts.id, { onDelete: "set null" }),
    videoProjectId: uuid("video_project_id").references(() => videoProjects.id, { onDelete: "set null" }),
    contentItemId: uuid("content_item_id").references(() => contentItems.id, { onDelete: "set null" }),
    sourceText: text("source_text").notNull(),
    format: text("format").notNull().default("VIDEO").$type<"VIDEO" | "SHORT">(),
    titles: jsonb("titles").$type<TitleGroup[]>().notNull().default(sql`'[]'::jsonb`),
    titleBasis: jsonb("title_basis").$type<TitleBasis>(),
    selectedTitle: text("selected_title"),
    concepts: jsonb("concepts").$type<ThumbnailConcept[]>().notNull().default(sql`'[]'::jsonb`),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("yt_packages_updated_at_idx").on(t.updatedAt)],
);

/** Foto del personaje sin fondo (PNG con transparencia), hecha una vez en el worker y reutilizada en cada miniatura. */
export const characterCutouts = pgTable("character_cutouts", {
  photoKey: text("photo_key").primaryKey(),
  status: text("status").notNull().$type<"pending" | "ready" | "failed">(),
  cutoutKey: text("cutout_key"),
  method: text("method"), // modelo usado ("u2net_human_seg") o "sin-recorte"
  error: text("error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
