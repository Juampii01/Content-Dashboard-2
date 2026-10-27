ALTER TABLE "broll_clips" ADD COLUMN "kind" text DEFAULT 'video' NOT NULL;--> statement-breakpoint
ALTER TABLE "broll_clips" ADD COLUMN "ficha" jsonb;--> statement-breakpoint
ALTER TABLE "broll_clips" ADD COLUMN "ficha_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "broll_clips" ADD COLUMN "ficha_error" text;--> statement-breakpoint
ALTER TABLE "broll_clips" ADD COLUMN "ficha_sheets" jsonb;--> statement-breakpoint
ALTER TABLE "broll_clips" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "broll_clips_search_idx" ON "broll_clips" USING gin (to_tsvector('spanish', "search_text"));--> statement-breakpoint
-- Los clips que ya estaban se pueden buscar por su nombre y sus etiquetas (en minúsculas y sin tildes, como la app).
UPDATE "broll_clips" SET "search_text" = regexp_replace(translate(lower("title" || ' ' || array_to_string("tags", ' ')), 'áéíóúüàèìòùâêîôûäëïö', 'aeiouuaeiouaeiouaeio'), '[^a-z0-9ñ ]+', ' ', 'g');
