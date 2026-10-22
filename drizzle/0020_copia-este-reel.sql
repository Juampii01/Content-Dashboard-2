CREATE TYPE "public"."reel_copy_status" AS ENUM('UPLOADING', 'ANALYZING', 'WRITING', 'READY', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'REEL_COPY';--> statement-breakpoint
CREATE TABLE "reel_copies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "reel_copy_status" DEFAULT 'ANALYZING' NOT NULL,
	"source_kind" text NOT NULL,
	"source_url" text,
	"platform" text,
	"topic" text,
	"objective" text,
	"format" "script_format" DEFAULT 'REEL' NOT NULL,
	"analysis" jsonb,
	"style_id" uuid,
	"script_id" uuid,
	"error_message" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reel_copies" ADD CONSTRAINT "reel_copies_style_id_video_styles_id_fk" FOREIGN KEY ("style_id") REFERENCES "public"."video_styles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_copies" ADD CONSTRAINT "reel_copies_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_copies" ADD CONSTRAINT "reel_copies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reel_copies_updated_at_idx" ON "reel_copies" USING btree ("updated_at");