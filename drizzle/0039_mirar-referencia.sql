ALTER TYPE "public"."job_type" ADD VALUE 'VIDEO_LOOK';--> statement-breakpoint
CREATE TABLE "video_looks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"source" jsonb NOT NULL,
	"error" text,
	"data" jsonb,
	"recipe" jsonb,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposal" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"job_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_looks" ADD CONSTRAINT "video_looks_project_id_video_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."video_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_looks_project_idx" ON "video_looks" USING btree ("project_id","created_at");