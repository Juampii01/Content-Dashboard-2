/**
 * Esquema de Content 2. Single-tenant: una base por cliente, sin organizaciones.
 * Identificadores en inglés; comentarios en español neutro.
 * Las migraciones se generan con `pnpm db:generate` y viven en `drizzle/`.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ─── Equipo ────────────────────────────────────────────────────────────────

/** OWNER: todo, incluidas conexiones y usuarios. EDITOR: crea y edita contenido. VIEWER: solo lectura. */
export const roleEnum = pgEnum("role", ["OWNER", "EDITOR", "VIEWER"]);

/** Quién puede entrar. Tener cuenta en Supabase Auth no alcanza: hace falta una fila aquí. */
export const teamMembers = pgTable("team_members", {
  id: id(),
  userId: uuid("user_id").notNull().unique(), // auth.users.id de Supabase
  email: text("email").notNull().unique(),
  name: text("name"),
  role: roleEnum("role").notNull().default("EDITOR"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ─── Conexiones con redes ──────────────────────────────────────────────────

export const platformEnum = pgEnum("platform", ["INSTAGRAM", "YOUTUBE", "TIKTOK"]);

/** EXPIRED: el token venció y no se pudo refrescar. REVOKED: el usuario quitó el permiso desde la red. */
export const connectionStatusEnum = pgEnum("connection_status", ["ACTIVE", "EXPIRED", "REVOKED", "ERROR"]);

/** Una cuenta conectada por red. Los tokens se guardan cifrados (lib/crypto.ts). */
export const socialAccounts = pgTable("social_accounts", {
  id: id(),
  platform: platformEnum("platform").notNull().unique(),
  externalId: text("external_id").notNull(),
  handle: text("handle").notNull(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
  status: connectionStatusEnum("status").notNull().default("ACTIVE"),
  statusMessage: text("status_message"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  connectedAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Estado temporal del flujo OAuth (protección CSRF). Se borra al usarse o a los 10 minutos. */
export const oauthStates = pgTable("oauth_states", {
  id: id(),
  state: text("state").notNull().unique(),
  platform: platformEnum("platform").notNull(),
  codeVerifier: text("code_verifier"), // PKCE (TikTok)
  createdBy: uuid("created_by").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

// ─── Contenido y métricas (modelo común a las tres redes) ──────────────────

/** REEL, CAROUSEL e IMAGE son de Instagram; VIDEO es YouTube largo o TikTok; SHORT es YouTube Short. */
export const contentTypeEnum = pgEnum("content_type", ["REEL", "CAROUSEL", "IMAGE", "VIDEO", "SHORT"]);

/**
 * Una pieza publicada en cualquier red, con sus métricas actuales.
 * Nunca se borra: si deja de venir en la API se marca `available = false`.
 * Métricas en null = la red no da ese dato para esta pieza.
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
    title: text("title"), // YouTube
    permalink: text("permalink"),
    thumbnailUrl: text("thumbnail_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    durationSec: integer("duration_sec"),

    views: bigint("views", { mode: "number" }),
    likes: integer("likes"),
    comments: integer("comments"),
    shares: integer("shares"),
    saves: integer("saves"),
    reach: integer("reach"),
    watchTimeMinutes: real("watch_time_minutes"), // YouTube Analytics
    avgViewPercentage: real("avg_view_percentage"), // YouTube Analytics

    available: boolean("available").notNull().default(true),
    metricsUpdatedAt: timestamp("metrics_updated_at", { withTimezone: true }),
    raw: jsonb("raw"), // respuesta original de la API, para depurar mapeos
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("content_items_platform_external_id_key").on(t.platform, t.externalId),
    index("content_items_platform_published_at_idx").on(t.platform, t.publishedAt),
    index("content_items_published_at_idx").on(t.publishedAt),
  ],
);

/** Foto diaria de las métricas de una pieza, para ver su evolución. */
export const metricSnapshots = pgTable(
  "metric_snapshots",
  {
    id: id(),
    contentItemId: uuid("content_item_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    capturedOn: date("captured_on", { mode: "string" }).notNull(),
    views: bigint("views", { mode: "number" }),
    likes: integer("likes"),
    comments: integer("comments"),
    shares: integer("shares"),
    saves: integer("saves"),
    reach: integer("reach"),
  },
  (t) => [uniqueIndex("metric_snapshots_item_day_key").on(t.contentItemId, t.capturedOn)],
);

/** Foto diaria de la cuenta: seguidores y totales. */
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
    totalViews: bigint("total_views", { mode: "number" }),
    totalLikes: bigint("total_likes", { mode: "number" }),
  },
  (t) => [uniqueIndex("account_snapshots_account_day_key").on(t.socialAccountId, t.capturedOn)],
);

// ─── Marca ─────────────────────────────────────────────────────────────────

/** Perfil de marca: alimenta guiones, carruseles, editor y clon. Hay una sola fila (id = "brand"). */
export const brandProfile = pgTable("brand_profile", {
  id: text("id").primaryKey().default("brand"),
  name: text("name"),
  handle: text("handle"),
  niche: text("niche"),
  audience: text("audience"), // público ideal
  tone: text("tone"),
  language: text("language").notNull().default("es-neutro"),
  bannedWords: text("banned_words").array().notNull().default(sql`'{}'::text[]`),
  colors: jsonb("colors").$type<{ primary?: string; secondary?: string; accent?: string }>(),
  fonts: jsonb("fonts").$type<{ heading?: string; body?: string }>(),
  characterPhotos: text("character_photos").array().notNull().default(sql`'{}'::text[]`), // rutas en Storage
  subtitlePreset: jsonb("subtitle_preset"),
  extraContext: text("extra_context"), // notas libres del cliente
  updatedAt: updatedAt(),
});

// ─── Producción ────────────────────────────────────────────────────────────

export const scriptStatusEnum = pgEnum("script_status", ["DRAFT", "READY", "ARCHIVED"]);

export const scripts = pgTable("scripts", {
  id: id(),
  title: text("title").notNull(),
  idea: text("idea"),
  hook: text("hook"),
  body: text("body").notNull().default(""),
  cta: text("cta"),
  status: scriptStatusEnum("status").notNull().default("DRAFT"),
  platform: platformEnum("platform"),
  sourceUrl: text("source_url"), // video de referencia
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const calendarStatusEnum = pgEnum("calendar_status", ["IDEA", "SCRIPTING", "PRODUCTION", "READY", "PUBLISHED"]);
export const contentFormatEnum = pgEnum("content_format", ["REEL", "CAROUSEL", "VIDEO", "SHORT", "CLONE_VIDEO"]);

/** Pieza planeada en el calendario. Al publicarse se vincula con su pieza real en `content_items`. */
export const calendarEntries = pgTable(
  "calendar_entries",
  {
    id: id(),
    title: text("title").notNull(),
    notes: text("notes"),
    format: contentFormatEnum("format").notNull(),
    platforms: platformEnum("platforms").array().notNull().default(sql`'{}'`),
    status: calendarStatusEnum("status").notNull().default("IDEA"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    scriptId: uuid("script_id").references(() => scripts.id, { onDelete: "set null" }),
    contentItemId: uuid("content_item_id").references(() => contentItems.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("calendar_entries_scheduled_for_idx").on(t.scheduledFor)],
);

// ─── Trabajos en segundo plano ─────────────────────────────────────────────

export const jobTypeEnum = pgEnum("job_type", [
  "SYNC_METRICS",
  "VIDEO_EDIT",
  "CAROUSEL_GENERATE",
  "CLONE_TRAIN",
  "CLONE_VIDEO",
]);
export const jobStatusEnum = pgEnum("job_status", ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]);

/** Registro visible de cada trabajo. La cola técnica la maneja pg-boss; esto es lo que ve el usuario. */
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
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("jobs_type_status_idx").on(t.type, t.status), index("jobs_created_at_idx").on(t.createdAt)],
);

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

export const serviceProviderEnum = pgEnum("service_provider", ["HEYGEN"]);

/** Claves que carga el propio cliente (por ejemplo su API key de HeyGen), cifradas. */
export const serviceCredentials = pgTable("service_credentials", {
  id: id(),
  provider: serviceProviderEnum("provider").notNull().unique(),
  secretEnc: text("secret_enc").notNull(),
  label: text("label"), // últimos 4 caracteres, para mostrar sin exponer la clave
  updatedBy: uuid("updated_by").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
