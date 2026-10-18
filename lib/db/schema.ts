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

/** Curva de retención de un video de YouTube (porcentaje que sigue mirando en cada punto del video). */
export const retentionCurves = pgTable("retention_curves", {
  contentItemId: uuid("content_item_id")
    .primaryKey()
    .references(() => contentItems.id, { onDelete: "cascade" }),
  points: jsonb("points").$type<{ at: number; ratio: number }[]>().notNull(),
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
  template?: string | null; // plantilla propia de este slide; null = la del carrusel
  imageUrl?: string | null; // foto o fondo subido por el cliente
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
    status: cloneVideoStatusEnum("status").notNull().default("QUEUED"),
    errorMessage: text("error_message"),
    videoUrl: text("video_url"), // copia propia (las URLs de HeyGen vencen)
    subtitleUrl: text("subtitle_url"),
    thumbnailUrl: text("thumbnail_url"),
    durationSeconds: real("duration_seconds"),
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
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("video_projects_updated_at_idx").on(t.updatedAt)],
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

export const serviceProviderEnum = pgEnum("service_provider", ["HEYGEN"]);

/** Claves que carga el propio cliente (por ejemplo su API key de HeyGen), cifradas. */
export const serviceCredentials = pgTable("service_credentials", {
  id: id(),
  provider: serviceProviderEnum("provider").notNull().unique(),
  secretEnc: text("secret_enc").notNull(),
  label: text("label"), // últimos 4 caracteres, para mostrar sin exponer la clave
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
