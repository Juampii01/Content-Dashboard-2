CREATE TYPE "public"."calendar_status" AS ENUM('IDEA', 'SCRIPTING', 'PRODUCTION', 'READY', 'PUBLISHED');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('ACTIVE', 'EXPIRED', 'REVOKED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."content_format" AS ENUM('REEL', 'CAROUSEL', 'VIDEO', 'SHORT', 'CLONE_VIDEO');--> statement-breakpoint
CREATE TYPE "public"."content_type" AS ENUM('REEL', 'CAROUSEL', 'IMAGE', 'VIDEO', 'SHORT');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('SYNC_METRICS', 'VIDEO_EDIT', 'CAROUSEL_GENERATE', 'CLONE_TRAIN', 'CLONE_VIDEO');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('INSTAGRAM', 'YOUTUBE', 'TIKTOK');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('OWNER', 'EDITOR', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."script_status" AS ENUM('DRAFT', 'READY', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."service_provider" AS ENUM('HEYGEN');--> statement-breakpoint
CREATE TABLE "account_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"social_account_id" uuid NOT NULL,
	"captured_on" date NOT NULL,
	"followers" integer,
	"following" integer,
	"media_count" integer,
	"total_views" bigint,
	"total_likes" bigint
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_profile" (
	"id" text PRIMARY KEY DEFAULT 'brand' NOT NULL,
	"name" text,
	"handle" text,
	"niche" text,
	"audience" text,
	"tone" text,
	"language" text DEFAULT 'es-neutro' NOT NULL,
	"banned_words" text[] DEFAULT '{}'::text[] NOT NULL,
	"colors" jsonb,
	"fonts" jsonb,
	"character_photos" text[] DEFAULT '{}'::text[] NOT NULL,
	"subtitle_preset" jsonb,
	"extra_context" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"format" "content_format" NOT NULL,
	"platforms" "platform"[] DEFAULT '{}' NOT NULL,
	"status" "calendar_status" DEFAULT 'IDEA' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"script_id" uuid,
	"content_item_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"social_account_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"external_id" text NOT NULL,
	"type" "content_type" NOT NULL,
	"caption" text,
	"title" text,
	"permalink" text,
	"thumbnail_url" text,
	"published_at" timestamp with time zone NOT NULL,
	"duration_sec" integer,
	"views" bigint,
	"likes" integer,
	"comments" integer,
	"shares" integer,
	"saves" integer,
	"reach" integer,
	"watch_time_minutes" real,
	"avg_view_percentage" real,
	"available" boolean DEFAULT true NOT NULL,
	"metrics_updated_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "job_type" NOT NULL,
	"status" "job_status" DEFAULT 'QUEUED' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"stage" text,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_item_id" uuid NOT NULL,
	"captured_on" date NOT NULL,
	"views" bigint,
	"likes" integer,
	"comments" integer,
	"shares" integer,
	"saves" integer,
	"reach" integer
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" text NOT NULL,
	"platform" "platform" NOT NULL,
	"code_verifier" text,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_states_state_unique" UNIQUE("state")
);
--> statement-breakpoint
CREATE TABLE "scripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"idea" text,
	"hook" text,
	"body" text DEFAULT '' NOT NULL,
	"cta" text,
	"status" "script_status" DEFAULT 'DRAFT' NOT NULL,
	"platform" "platform",
	"source_url" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "service_provider" NOT NULL,
	"secret_enc" text NOT NULL,
	"label" text,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_credentials_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "platform" NOT NULL,
	"external_id" text NOT NULL,
	"handle" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "connection_status" DEFAULT 'ACTIVE' NOT NULL,
	"status_message" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_accounts_platform_unique" UNIQUE("platform")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" "role" DEFAULT 'EDITOR' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "team_members_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "account_snapshots" ADD CONSTRAINT "account_snapshots_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_snapshots_account_day_key" ON "account_snapshots" USING btree ("social_account_id","captured_on");--> statement-breakpoint
CREATE INDEX "ai_usage_created_at_idx" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "calendar_entries_scheduled_for_idx" ON "calendar_entries" USING btree ("scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "content_items_platform_external_id_key" ON "content_items" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "content_items_platform_published_at_idx" ON "content_items" USING btree ("platform","published_at");--> statement-breakpoint
CREATE INDEX "content_items_published_at_idx" ON "content_items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "jobs_type_status_idx" ON "jobs" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "jobs_created_at_idx" ON "jobs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_snapshots_item_day_key" ON "metric_snapshots" USING btree ("content_item_id","captured_on");