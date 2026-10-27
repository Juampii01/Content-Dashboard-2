ALTER TYPE "public"."job_type" ADD VALUE 'AUDIO_SPLIT' BEFORE 'VIDEO_COMPOS';--> statement-breakpoint
ALTER TABLE "music_tracks" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "music_tracks" ADD COLUMN "source_key" text;--> statement-breakpoint
ALTER TABLE "music_tracks" ADD COLUMN "error_message" text;