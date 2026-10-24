CREATE TABLE "compos_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"work" jsonb NOT NULL,
	"reserved_usd" real DEFAULT 0 NOT NULL,
	"used_usd" real DEFAULT 0 NOT NULL,
	"delivered" boolean DEFAULT false NOT NULL,
	"error" text,
	"job_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compos_requests" ADD CONSTRAINT "compos_requests_project_id_video_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."video_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compos_requests" ADD CONSTRAINT "compos_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compos_requests_project_idx" ON "compos_requests" USING btree ("project_id","created_at");