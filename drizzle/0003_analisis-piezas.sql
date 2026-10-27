ALTER TABLE "content_items" ADD COLUMN "ai_analysis" jsonb;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "ai_analyzed_at" timestamp with time zone;