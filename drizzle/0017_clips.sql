CREATE TYPE "public"."long_video_status" AS ENUM('UPLOADING', 'PROCESSING', 'READY', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'LONG_VIDEO_CLIPS';--> statement-breakpoint
CREATE TABLE "long_video_clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"long_video_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"discarded" boolean DEFAULT false NOT NULL,
	"from_word" integer NOT NULL,
	"to_word" integer NOT NULL,
	"start" real NOT NULL,
	"end" real NOT NULL,
	"window_start" real NOT NULL,
	"window_end" real NOT NULL,
	"title" text NOT NULL,
	"hook_text" text NOT NULL,
	"reason" text NOT NULL,
	"hook_type" text,
	"score" integer NOT NULL,
	"score_detail" jsonb NOT NULL,
	"framing" jsonb,
	"preview_key" text,
	"poster_key" text,
	"project_id" uuid,
	"export_mode" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "long_videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"status" "long_video_status" DEFAULT 'UPLOADING' NOT NULL,
	"source_kind" text NOT NULL,
	"source_url" text,
	"source_key" text,
	"source_name" text,
	"source_bytes" bigint,
	"media" jsonb,
	"transcript" jsonb,
	"analysis" jsonb,
	"error_message" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "long_video_clips" ADD CONSTRAINT "long_video_clips_long_video_id_long_videos_id_fk" FOREIGN KEY ("long_video_id") REFERENCES "public"."long_videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "long_video_clips" ADD CONSTRAINT "long_video_clips_project_id_video_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."video_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "long_videos" ADD CONSTRAINT "long_videos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "long_video_clips_video_idx" ON "long_video_clips" USING btree ("long_video_id","rank");--> statement-breakpoint
CREATE INDEX "long_videos_updated_at_idx" ON "long_videos" USING btree ("updated_at");