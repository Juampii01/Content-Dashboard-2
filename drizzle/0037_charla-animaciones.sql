CREATE TABLE "compos_chats" (
	"project_id" uuid NOT NULL,
	"comp_id" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agreed" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compos_chats_project_id_comp_id_pk" PRIMARY KEY("project_id","comp_id")
);
--> statement-breakpoint
ALTER TABLE "compos_chats" ADD CONSTRAINT "compos_chats_project_id_video_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."video_projects"("id") ON DELETE cascade ON UPDATE no action;