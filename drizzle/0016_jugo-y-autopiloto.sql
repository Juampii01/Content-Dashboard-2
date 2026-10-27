CREATE TABLE "autopilot_settings" (
	"id" text PRIMARY KEY DEFAULT 'autopilot' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"pieces_per_week" integer,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repurpose_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_kind" text NOT NULL,
	"video_project_id" uuid,
	"script_id" uuid,
	"content_item_id" uuid,
	"title" text NOT NULL,
	"source_text" text NOT NULL,
	"parts" jsonb NOT NULL,
	"finished_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_pack_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_start" date NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"hook" text,
	"pillar" text,
	"why" text,
	"format" "planned_format" NOT NULL,
	"platforms" text[] NOT NULL,
	"scheduled_date" date,
	"script_id" uuid,
	"carousel_id" uuid,
	"gen_status" text DEFAULT 'pending' NOT NULL,
	"gen_error" text,
	"decision" text DEFAULT 'pending' NOT NULL,
	"calendar_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_packs" (
	"week_start" date PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"trigger" text DEFAULT 'cron' NOT NULL,
	"error_message" text,
	"estimated_tokens" integer,
	"used_tokens" integer,
	"notified_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "autopilot_settings" ADD CONSTRAINT "autopilot_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repurpose_packs" ADD CONSTRAINT "repurpose_packs_video_project_id_video_projects_id_fk" FOREIGN KEY ("video_project_id") REFERENCES "public"."video_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repurpose_packs" ADD CONSTRAINT "repurpose_packs_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repurpose_packs" ADD CONSTRAINT "repurpose_packs_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repurpose_packs" ADD CONSTRAINT "repurpose_packs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_pack_items" ADD CONSTRAINT "weekly_pack_items_week_start_weekly_packs_week_start_fk" FOREIGN KEY ("week_start") REFERENCES "public"."weekly_packs"("week_start") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_pack_items" ADD CONSTRAINT "weekly_pack_items_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_pack_items" ADD CONSTRAINT "weekly_pack_items_carousel_id_carousels_id_fk" FOREIGN KEY ("carousel_id") REFERENCES "public"."carousels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_pack_items" ADD CONSTRAINT "weekly_pack_items_calendar_entry_id_calendar_entries_id_fk" FOREIGN KEY ("calendar_entry_id") REFERENCES "public"."calendar_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_packs" ADD CONSTRAINT "weekly_packs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repurpose_packs_created_at_idx" ON "repurpose_packs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "weekly_pack_items_week_idx" ON "weekly_pack_items" USING btree ("week_start","position");