ALTER TABLE "brand_profile" ADD COLUMN IF NOT EXISTS "editor_defaults" jsonb;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN IF NOT EXISTS "auto_export" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
-- Los clips con "Exportar directo" pasan a usar el mecanismo general ("Hazlo por mí").
UPDATE "video_projects" SET "auto_export" = true, "origin" = 'clip' WHERE "id" IN (SELECT "project_id" FROM "long_video_clips" WHERE "project_id" IS NOT NULL AND "export_mode" = 'export');--> statement-breakpoint
UPDATE "video_projects" SET "origin" = 'clip' WHERE "origin" = 'upload' AND "id" IN (SELECT "project_id" FROM "long_video_clips" WHERE "project_id" IS NOT NULL);
