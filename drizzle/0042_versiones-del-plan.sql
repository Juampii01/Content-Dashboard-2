CREATE TABLE "video_plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"plan" jsonb NOT NULL,
	"format" text,
	"label" text NOT NULL,
	"source" text NOT NULL,
	"request_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_plan_versions" ADD CONSTRAINT "video_plan_versions_project_id_video_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."video_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_plan_versions" ADD CONSTRAINT "video_plan_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_plan_versions_project_idx" ON "video_plan_versions" USING btree ("project_id","created_at");