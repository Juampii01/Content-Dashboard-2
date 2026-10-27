CREATE TABLE "director_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"result" jsonb,
	"error" text,
	"retry" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "director_calls" ADD CONSTRAINT "director_calls_project_id_video_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."video_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "director_calls_project_idx" ON "director_calls" USING btree ("project_id","created_at");