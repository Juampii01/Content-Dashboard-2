CREATE TYPE "public"."phrase_fix_status" AS ENUM('VOICE', 'READY', 'LIPSYNC', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'VIDEO_PHRASE_CLIP';--> statement-breakpoint
CREATE TABLE "video_phrase_fixes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"from_word" integer NOT NULL,
	"to_word" integer NOT NULL,
	"original_text" text NOT NULL,
	"new_text" text NOT NULL,
	"voice_id" text NOT NULL,
	"voice_name" text,
	"status" "phrase_fix_status" DEFAULT 'VOICE' NOT NULL,
	"window_start" real NOT NULL,
	"window_end" real NOT NULL,
	"audio_key" text,
	"audio_seconds" real,
	"tempo" real DEFAULT 1 NOT NULL,
	"cover" text DEFAULT 'broll' NOT NULL,
	"lipsync" jsonb,
	"estimated_cost_usd" real,
	"error_message" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clone_videos" ALTER COLUMN "avatar_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clone_videos" ALTER COLUMN "voice_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clone_videos" ADD COLUMN "kind" text DEFAULT 'avatar' NOT NULL;--> statement-breakpoint
ALTER TABLE "clone_videos" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "clone_videos" ADD COLUMN "voice_locale" text;--> statement-breakpoint
ALTER TABLE "clone_videos" ADD COLUMN "source" jsonb;--> statement-breakpoint
ALTER TABLE "clone_videos" ADD COLUMN "source_seconds" real;--> statement-breakpoint
ALTER TABLE "video_phrase_fixes" ADD CONSTRAINT "video_phrase_fixes_project_id_video_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."video_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_phrase_fixes" ADD CONSTRAINT "video_phrase_fixes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_phrase_fixes_project_idx" ON "video_phrase_fixes" USING btree ("project_id");