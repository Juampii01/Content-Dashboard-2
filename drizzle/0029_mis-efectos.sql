CREATE TABLE "created_effect_uses" (
	"effect_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "created_effects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'otros' NOT NULL,
	"code" text NOT NULL,
	"code_hash" text NOT NULL,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sounds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hide_captions" boolean DEFAULT false NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"duration" real NOT NULL,
	"uses_mask" boolean DEFAULT false NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"poster_key" text,
	"sample_key" text,
	"source_project_id" uuid,
	"source_comp_id" text,
	"source_kind" text DEFAULT 'director' NOT NULL,
	"source_title" text,
	"reference_url" text,
	"root_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"saved_by" text DEFAULT 'auto' NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"favorite" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "created_effect_uses" ADD CONSTRAINT "created_effect_uses_effect_id_created_effects_id_fk" FOREIGN KEY ("effect_id") REFERENCES "public"."created_effects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "created_effect_uses" ADD CONSTRAINT "created_effect_uses_project_id_video_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."video_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "created_effects" ADD CONSTRAINT "created_effects_source_project_id_video_projects_id_fk" FOREIGN KEY ("source_project_id") REFERENCES "public"."video_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "created_effects" ADD CONSTRAINT "created_effects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "created_effect_uses_pk" ON "created_effect_uses" USING btree ("effect_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "created_effects_code_hash_idx" ON "created_effects" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "created_effects_root_idx" ON "created_effects" USING btree ("root_id");--> statement-breakpoint
CREATE INDEX "created_effects_created_at_idx" ON "created_effects" USING btree ("created_at");