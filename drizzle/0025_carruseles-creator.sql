ALTER TYPE "public"."job_type" ADD VALUE 'CAROUSEL_COPY';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'CAROUSEL_ANIMATE';--> statement-breakpoint
CREATE TABLE "carousel_copies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "carousel_template_status" DEFAULT 'ANALYZING' NOT NULL,
	"source" text DEFAULT 'link' NOT NULL,
	"source_url" text,
	"reference_count" integer DEFAULT 0 NOT NULL,
	"options" jsonb NOT NULL,
	"reading" jsonb,
	"template_id" uuid,
	"carousel_id" uuid,
	"error_message" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_photo_traits" (
	"photo_key" text PRIMARY KEY NOT NULL,
	"angle" text NOT NULL,
	"expression" text NOT NULL,
	"framing" text NOT NULL,
	"gaze" text NOT NULL,
	"quality" real DEFAULT 0.7 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "carousels" ADD COLUMN "caption_variants" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "carousel_copies" ADD CONSTRAINT "carousel_copies_template_id_carousel_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."carousel_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carousel_copies" ADD CONSTRAINT "carousel_copies_carousel_id_carousels_id_fk" FOREIGN KEY ("carousel_id") REFERENCES "public"."carousels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carousel_copies" ADD CONSTRAINT "carousel_copies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carousel_copies_updated_at_idx" ON "carousel_copies" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "carousel_copies_carousel_idx" ON "carousel_copies" USING btree ("carousel_id");