CREATE TABLE "strategist_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategist_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" text,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ideas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "strategist_conversations" ADD CONSTRAINT "strategist_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategist_messages" ADD CONSTRAINT "strategist_messages_conversation_id_strategist_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."strategist_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategist_messages" ADD CONSTRAINT "strategist_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "strategist_conversations_user_idx" ON "strategist_conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "strategist_messages_conversation_idx" ON "strategist_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "strategist_messages_user_idx" ON "strategist_messages" USING btree ("user_id","created_at");