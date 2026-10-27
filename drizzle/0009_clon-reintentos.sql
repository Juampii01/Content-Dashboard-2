ALTER TABLE "clone_videos" ADD COLUMN "retried_into" uuid;--> statement-breakpoint
ALTER TABLE "clone_videos" ADD COLUMN "copying_until" timestamp with time zone;