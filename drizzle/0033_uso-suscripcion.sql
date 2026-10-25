ALTER TABLE "ai_usage" ADD COLUMN "api_equivalent_usd" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "plan_utilization" real;