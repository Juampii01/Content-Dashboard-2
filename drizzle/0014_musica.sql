CREATE TABLE "music_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"status" "broll_clip_status" DEFAULT 'UPLOADING' NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text,
	"file_bytes" bigint,
	"duration" real,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "music_tracks" ADD CONSTRAINT "music_tracks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "music_tracks_created_at_idx" ON "music_tracks" USING btree ("created_at");