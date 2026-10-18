CREATE TABLE "weekly_reports" (
	"week_start" date PRIMARY KEY NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_profile" ADD COLUMN "goals" jsonb;