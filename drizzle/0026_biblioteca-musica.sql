ALTER TYPE "public"."service_provider" ADD VALUE 'JAMENDO';--> statement-breakpoint
ALTER TABLE "music_tracks" ADD COLUMN "source" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "music_tracks" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "music_tracks" ADD COLUMN "attribution" text;--> statement-breakpoint
ALTER TABLE "music_tracks" ADD COLUMN "license_url" text;