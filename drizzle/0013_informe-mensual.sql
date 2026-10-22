CREATE TABLE "monthly_reports" (
	"month" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"pdf" "bytea" NOT NULL,
	"pdf_bytes" integer NOT NULL,
	"partial" boolean DEFAULT false NOT NULL,
	"generated_by" text,
	"sent_at" timestamp with time zone,
	"sent_to" text[] DEFAULT '{}'::text[] NOT NULL,
	"auto_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_settings" (
	"id" text PRIMARY KEY DEFAULT 'report' NOT NULL,
	"recipients" text[] DEFAULT '{}'::text[] NOT NULL,
	"auto_send" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monthly_reports" ADD CONSTRAINT "monthly_reports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_settings" ADD CONSTRAINT "report_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;