-- Seguridad: RLS activado en todas las tablas y sin políticas.
-- La app entra con la conexión de servidor (rol postgres), que no pasa por RLS.
-- Así nadie puede leer ni escribir estas tablas desde la API pública de Supabase con la anon key.
ALTER TABLE "team_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "social_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brand_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scripts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendar_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "service_credentials" ENABLE ROW LEVEL SECURITY;
