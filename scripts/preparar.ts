/**
 * Se ejecuta en cada deploy de producción, antes del build (script "vercel-build").
 *
 * 1. Aplica las migraciones pendientes con la conexión sin pooler.
 * 2. Si la instalación todavía no tiene dueño y está definida OWNER_EMAIL, lo crea y manda la invitación.
 *    Si el correo no está configurado, el enlace queda en el log del build (solo lo ve el equipo de Vercel).
 *
 * En deploys de preview no hace nada: comparten la base con producción y no deben migrarla.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const isVercel = Boolean(process.env.VERCEL);
  if (isVercel && process.env.VERCEL_ENV !== "production") {
    console.log("[preparar] Deploy de preview: no se tocan la base ni el dueño.");
    return;
  }
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    console.log("[preparar] Falta DATABASE_URL_UNPOOLED: se saltan las migraciones.");
    return;
  }

  const pool = new Pool({ connectionString: url.replace(/([?&])sslmode=(prefer|require|verify-ca)(?=&|$)/, "$1sslmode=verify-full"), max: 1 });
  await migrate(drizzle({ client: pool }), { migrationsFolder: "drizzle" });
  console.log("[preparar] Migraciones al día.");

  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const missing = ["BETTER_AUTH_SECRET", "TOKEN_ENCRYPTION_KEY", "CRON_SECRET", "NEXT_PUBLIC_APP_URL"].filter((k) => !process.env[k]);
  if (ownerEmail && missing.length > 0) {
    console.log(`[preparar] Faltan ${missing.join(", ")}: el dueño se crea en el próximo deploy, cuando estén cargadas.`);
  } else if (ownerEmail) {
    const { rows } = await pool.query<{ n: number }>("select count(*)::int as n from team_members where role = 'OWNER' and active");
    if ((rows[0]?.n ?? 0) === 0) {
      const { inviteMember } = await import("../lib/auth/invitations");
      const { sendEmail, invitationEmail } = await import("../lib/email");
      const { url: link } = await inviteMember({ email: ownerEmail, name: process.env.OWNER_NAME ?? null, role: "OWNER", notify: false });
      try {
        await sendEmail(invitationEmail(ownerEmail, null, link));
        console.log(`[preparar] Dueño creado (${ownerEmail}). Le enviamos la invitación por correo.`);
      } catch {
        console.log(`[preparar] Dueño creado (${ownerEmail}). El correo no está configurado; enlace para definir la contraseña (vence en 7 días):\n${link}`);
      }
    }
  }
  await pool.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[preparar] Falló:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
