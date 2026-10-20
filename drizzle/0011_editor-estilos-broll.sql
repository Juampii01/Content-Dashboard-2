CREATE TYPE "public"."broll_clip_status" AS ENUM('UPLOADING', 'PROCESSING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."video_style_status" AS ENUM('UPLOADING', 'ANALYZING', 'READY', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'VIDEO_STYLE';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'VIDEO_CLIP';--> statement-breakpoint
CREATE TABLE "broll_clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "broll_clip_status" DEFAULT 'UPLOADING' NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text,
	"file_bytes" bigint,
	"thumb_key" text,
	"duration" real,
	"width" integer,
	"height" integer,
	"error_message" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_styles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "video_style_status" DEFAULT 'ANALYZING' NOT NULL,
	"source_kind" text NOT NULL,
	"source_url" text,
	"source_key" text,
	"source_name" text,
	"source_bytes" bigint,
	"thumb_key" text,
	"metrics" jsonb,
	"preset" jsonb,
	"error_message" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "style_id" uuid;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "broll_mode" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "broll_clips" ADD CONSTRAINT "broll_clips_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_styles" ADD CONSTRAINT "video_styles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broll_clips_updated_at_idx" ON "broll_clips" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "video_styles_updated_at_idx" ON "video_styles" USING btree ("updated_at");--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_style_id_video_styles_id_fk" FOREIGN KEY ("style_id") REFERENCES "public"."video_styles"("id") ON DELETE set null ON UPDATE no action;