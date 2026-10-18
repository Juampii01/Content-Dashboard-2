CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."carousel_status" AS ENUM('DRAFT', 'READY', 'EXPORTED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."clone_video_status" AS ENUM('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."link_status" AS ENUM('NONE', 'SUGGESTED', 'LINKED');--> statement-breakpoint
CREATE TYPE "public"."planned_format" AS ENUM('REEL', 'CAROUSEL', 'VIDEO', 'SHORT', 'STORY', 'POST', 'CLONE_VIDEO');--> statement-breakpoint
CREATE TYPE "public"."video_project_status" AS ENUM('UPLOADING', 'PROCESSING', 'AWAITING_REVIEW', 'RENDERING', 'DONE', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'VIDEO_ANALYZE' BEFORE 'CAROUSEL_GENERATE';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'VIDEO_RENDER' BEFORE 'CAROUSEL_GENERATE';--> statement-breakpoint
CREATE TABLE "calendar_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"link_status" "link_status" DEFAULT 'NONE' NOT NULL,
	"content_item_id" uuid,
	"link_score" real,
	"linked_at" timestamp with time zone,
	"rejected_item_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carousels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"topic" text,
	"status" "carousel_status" DEFAULT 'DRAFT' NOT NULL,
	"template" text DEFAULT 'editorial' NOT NULL,
	"theme" jsonb,
	"slides" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"caption" text,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"cta_keyword" text,
	"source_text" text,
	"script_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clone_videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"script_id" uuid,
	"script_text" text NOT NULL,
	"avatar_id" text NOT NULL,
	"avatar_name" text,
	"voice_id" text NOT NULL,
	"engine" text NOT NULL,
	"aspect_ratio" text DEFAULT '9:16' NOT NULL,
	"resolution" text DEFAULT '1080p' NOT NULL,
	"captions" boolean DEFAULT false NOT NULL,
	"background" jsonb,
	"speed" real DEFAULT 1 NOT NULL,
	"estimated_seconds" integer,
	"estimated_cost_usd" real,
	"heygen_video_id" text,
	"status" "clone_video_status" DEFAULT 'QUEUED' NOT NULL,
	"error_message" text,
	"video_url" text,
	"subtitle_url" text,
	"thumbnail_url" text,
	"duration_seconds" real,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "clone_videos_heygen_video_id_unique" UNIQUE("heygen_video_id")
);
--> statement-breakpoint
CREATE TABLE "video_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"status" "video_project_status" DEFAULT 'UPLOADING' NOT NULL,
	"format" text DEFAULT '9:16' NOT NULL,
	"caption_preset" text DEFAULT 'clasico' NOT NULL,
	"script_id" uuid,
	"source_key" text,
	"source_name" text,
	"source_bytes" bigint,
	"media" jsonb,
	"transcript" jsonb,
	"plan" jsonb,
	"output_key" text,
	"srt_key" text,
	"output_meta" jsonb,
	"error_message" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"key" text PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"version" text,
	"capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_entries" DROP CONSTRAINT "calendar_entries_content_item_id_content_items_id_fk";
--> statement-breakpoint
DROP INDEX "calendar_entries_scheduled_for_idx";--> statement-breakpoint
ALTER TABLE "calendar_entries" ALTER COLUMN "format" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "calendar_entries" ALTER COLUMN "format" SET DATA TYPE "public"."planned_format" USING "format"::text::"public"."planned_format";--> statement-breakpoint
ALTER TABLE "calendar_entries" ALTER COLUMN "format" SET DEFAULT 'REEL';--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD COLUMN "hook" text;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD COLUMN "pillar" text;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD COLUMN "scheduled_date" date;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD COLUMN "scheduled_time" text;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD COLUMN "carousel_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD COLUMN "clone_video_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD COLUMN "video_project_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "max_attempts" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "run_after" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "locked_by" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "video_project_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_targets" ADD CONSTRAINT "calendar_targets_entry_id_calendar_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."calendar_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_targets" ADD CONSTRAINT "calendar_targets_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carousels" ADD CONSTRAINT "carousels_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carousels" ADD CONSTRAINT "carousels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clone_videos" ADD CONSTRAINT "clone_videos_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clone_videos" ADD CONSTRAINT "clone_videos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_targets_entry_platform_uq" ON "calendar_targets" USING btree ("entry_id","platform");--> statement-breakpoint
CREATE INDEX "calendar_targets_item_idx" ON "calendar_targets" USING btree ("content_item_id");--> statement-breakpoint
CREATE INDEX "carousels_updated_at_idx" ON "carousels" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "clone_videos_status_idx" ON "clone_videos" USING btree ("status");--> statement-breakpoint
CREATE INDEX "clone_videos_created_at_idx" ON "clone_videos" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "video_projects_updated_at_idx" ON "video_projects" USING btree ("updated_at");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_video_project_id_video_projects_id_fk" FOREIGN KEY ("video_project_id") REFERENCES "public"."video_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_entries_date_idx" ON "calendar_entries" USING btree ("scheduled_date");--> statement-breakpoint
CREATE INDEX "calendar_entries_script_idx" ON "calendar_entries" USING btree ("script_id");--> statement-breakpoint
CREATE INDEX "jobs_queue_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
ALTER TABLE "calendar_entries" DROP COLUMN "platforms";--> statement-breakpoint
ALTER TABLE "calendar_entries" DROP COLUMN "scheduled_for";--> statement-breakpoint
ALTER TABLE "calendar_entries" DROP COLUMN "content_item_id";--> statement-breakpoint
DROP TYPE "public"."content_format";