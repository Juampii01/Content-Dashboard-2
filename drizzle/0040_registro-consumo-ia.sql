CREATE TABLE "api_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid,
	"user_id" text,
	"step" text NOT NULL,
	"provider" text DEFAULT 'anthropic' NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"video_duration_sec" real,
	"job_id" uuid,
	"request_id" text,
	"status" text DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_video_id_video_projects_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_usage_created_at_idx" ON "api_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "api_usage_video_idx" ON "api_usage" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "api_usage_user_month_idx" ON "api_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "api_usage_step_idx" ON "api_usage" USING btree ("step");--> statement-breakpoint
-- Historial: se copian las filas de ai_usage (no se borran ni se cambian). En ai_usage la entrada incluía la caché;
-- aquí va separada. El usuario de las filas viejas es el que creó el video (si hay video).
INSERT INTO "api_usage" ("video_id", "user_id", "step", "provider", "model", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cost_usd", "video_duration_sec", "job_id", "status", "created_at")
SELECT u."video_project_id", p."created_by", u."feature", u."provider", u."model",
  GREATEST(0, u."input_tokens" - u."cache_read_tokens" - u."cache_write_tokens"), u."output_tokens", u."cache_read_tokens", u."cache_write_tokens",
  u."cost_usd", NULLIF((p."media"->>'duration'), '')::real, u."job_id", 'ok', u."created_at"
FROM "ai_usage" u
LEFT JOIN "video_projects" p ON p."id" = u."video_project_id";
