ALTER TABLE "ai_usage" ADD COLUMN "video_project_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "cache_read_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "cache_write_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "cost_usd" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "brief" jsonb;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "eyes" jsonb;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "director" jsonb;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "ai_budget_usd" real DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_video_project_id_video_projects_id_fk" FOREIGN KEY ("video_project_id") REFERENCES "public"."video_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_video_project_idx" ON "ai_usage" USING btree ("video_project_id");