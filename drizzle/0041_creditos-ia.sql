CREATE TABLE "ai_credit_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"monthly_usd" double precision NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_credit_limits" ADD CONSTRAINT "ai_credit_limits_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;