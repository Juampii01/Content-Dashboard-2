ALTER TABLE "clone_videos" ADD COLUMN "files_stored" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clone_videos" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_credentials" ADD COLUMN "webhook_endpoint_id" text;--> statement-breakpoint
ALTER TABLE "service_credentials" ADD COLUMN "webhook_secret_enc" text;--> statement-breakpoint
ALTER TABLE "service_credentials" ADD COLUMN "webhook_error" text;