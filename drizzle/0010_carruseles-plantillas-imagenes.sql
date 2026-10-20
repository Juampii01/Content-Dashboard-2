CREATE TYPE "public"."carousel_template_status" AS ENUM('ANALYZING', 'READY', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'CAROUSEL_STYLE';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'CAROUSEL_IMAGES';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'CODEX_LOGIN';--> statement-breakpoint
ALTER TYPE "public"."service_provider" ADD VALUE 'CHATGPT';--> statement-breakpoint
ALTER TYPE "public"."service_provider" ADD VALUE 'OPENAI';--> statement-breakpoint
CREATE TABLE "carousel_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "carousel_template_status" DEFAULT 'ANALYZING' NOT NULL,
	"source" text DEFAULT 'upload' NOT NULL,
	"source_url" text,
	"reference_count" integer DEFAULT 0 NOT NULL,
	"spec" jsonb,
	"measurements" jsonb,
	"error_message" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "carousel_templates" ADD CONSTRAINT "carousel_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carousel_templates_updated_at_idx" ON "carousel_templates" USING btree ("updated_at");