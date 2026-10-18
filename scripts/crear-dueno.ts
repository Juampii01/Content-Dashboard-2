/**
 * Crea el primer usuario (dueño de la cuenta) en una instalación nueva.
 *
 * Uso:
 *   pnpm crear-dueno correo@cliente.com "Nombre Apellido"
 *
 * Crea el usuario en Supabase Auth (si no existe), le manda un correo para que defina
 * su contraseña y lo registra en team_members con rol OWNER. Se puede volver a ejecutar sin problema.
 */
import { createClient } from "@supabase/supabase-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { teamMembers } from "../lib/db/schema";

async function main() {
  const [email, name] = process.argv.slice(2);
  if (!email) {
    console.error('Uso: pnpm crear-dueno correo@cliente.com "Nombre Apellido"');
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const databaseUrl = process.env.DIRECT_URL;
  if (!url || !serviceKey || !appUrl || !databaseUrl) {
    console.error("Faltan variables: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_APP_URL y DIRECT_URL.");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Invita (crea el usuario y manda el correo). Si ya existe, lo busca.
  let userId: string | undefined;
  const invite = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo: `${appUrl}/login` });
  if (invite.data.user) {
    userId = invite.data.user.id;
    console.log(`Invitación enviada a ${email}.`);
  } else {
    const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;
    userId = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
    if (!userId) throw invite.error ?? new Error("No se pudo crear ni encontrar el usuario.");
    console.log(`El usuario ${email} ya existía en Supabase Auth.`);
  }

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle({ client });
  await db
    .insert(teamMembers)
    .values({ userId, email, name: name ?? null, role: "OWNER" })
    .onConflictDoUpdate({ target: teamMembers.userId, set: { role: "OWNER", active: true, name: name ?? null } });
  await client.end();

  console.log(`Listo: ${email} es dueño de la cuenta.`);
}

main().catch((error: unknown) => {
  console.error("No se pudo crear el dueño:", error instanceof Error ? error.message : error);
  process.exit(1);
});
