CREATE TYPE "public"."script_format" AS ENUM('REEL', 'SHORT', 'YT_LONG', 'STORY');--> statement-breakpoint
ALTER TYPE "public"."script_status" ADD VALUE 'IDEA' BEFORE 'DRAFT';--> statement-breakpoint
ALTER TYPE "public"."script_status" ADD VALUE 'RECORDED' BEFORE 'ARCHIVED';--> statement-breakpoint
ALTER TYPE "public"."script_status" ADD VALUE 'PUBLISHED' BEFORE 'ARCHIVED';--> statement-breakpoint
CREATE TABLE "script_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"script_id" uuid NOT NULL,
	"content" jsonb NOT NULL,
	"action" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_profile" ADD COLUMN "what_you_sell" text;--> statement-breakpoint
ALTER TABLE "brand_profile" ADD COLUMN "differentiator" text;--> statement-breakpoint
ALTER TABLE "brand_profile" ADD COLUMN "audience_pains" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_profile" ADD COLUMN "audience_desires" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_profile" ADD COLUMN "objections" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_profile" ADD COLUMN "beliefs" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_profile" ADD COLUMN "signature_phrases" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_profile" ADD COLUMN "emoji_policy" text DEFAULT 'pocos' NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_profile" ADD COLUMN "voice_samples" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_profile" ADD COLUMN "offers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_profile" ADD COLUMN "pillars" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_profile" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "format" "script_format" DEFAULT 'REEL' NOT NULL;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "pillar" text;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "objective" text;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "word_count" integer;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "estimated_seconds" integer;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "source_text" text;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "source_content_item_id" uuid;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "script_versions" ADD CONSTRAINT "script_versions_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_versions" ADD CONSTRAINT "script_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "script_versions_script_idx" ON "script_versions" USING btree ("script_id","created_at");--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_source_content_item_id_content_items_id_fk" FOREIGN KEY ("source_content_item_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scripts_status_updated_idx" ON "scripts" USING btree ("status","updated_at");--> statement-breakpoint
ALTER TABLE "scripts" DROP COLUMN "hook";--> statement-breakpoint
ALTER TABLE "scripts" DROP COLUMN "body";--> statement-breakpoint
ALTER TABLE "scripts" DROP COLUMN "cta";