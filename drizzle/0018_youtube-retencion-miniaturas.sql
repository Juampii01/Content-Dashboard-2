ALTER TYPE "public"."job_type" ADD VALUE 'YT_THUMBNAILS';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'YOUTUBE_TRANSCRIPT';--> statement-breakpoint
CREATE TABLE "character_cutouts" (
	"photo_key" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"cutout_key" text,
	"method" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "piece_transcripts" (
	"content_item_id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"language" text,
	"segments" jsonb NOT NULL,
	"video_project_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_insights" (
	"content_item_id" uuid PRIMARY KEY NOT NULL,
	"curve_captured_at" timestamp with time zone NOT NULL,
	"transcript_source" text,
	"drops" jsonb NOT NULL,
	"explanation" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yt_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"source_kind" text NOT NULL,
	"script_id" uuid,
	"video_project_id" uuid,
	"content_item_id" uuid,
	"source_text" text NOT NULL,
	"format" text DEFAULT 'VIDEO' NOT NULL,
	"titles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"title_basis" jsonb,
	"selected_title" text,
	"concepts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "piece_transcripts" ADD CONSTRAINT "piece_transcripts_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piece_transcripts" ADD CONSTRAINT "piece_transcripts_video_project_id_video_projects_id_fk" FOREIGN KEY ("video_project_id") REFERENCES "public"."video_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piece_transcripts" ADD CONSTRAINT "piece_transcripts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_insights" ADD CONSTRAINT "retention_insights_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_insights" ADD CONSTRAINT "retention_insights_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yt_packages" ADD CONSTRAINT "yt_packages_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yt_packages" ADD CONSTRAINT "yt_packages_video_project_id_video_projects_id_fk" FOREIGN KEY ("video_project_id") REFERENCES "public"."video_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yt_packages" ADD CONSTRAINT "yt_packages_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yt_packages" ADD CONSTRAINT "yt_packages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "yt_packages_updated_at_idx" ON "yt_packages" USING btree ("updated_at");