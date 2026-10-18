import "server-only";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { invitationEmail, sendEmail } from "@/lib/email";
import { getAuth } from "./server";
import type { Role } from "./index";

/**
 * Invitaciones. No hay registro abierto: el dueño invita y la persona define su contraseña.
 *
 * Crea el usuario (sin contraseña) y su fila en `team_members`, y manda un enlace de 7 días a
 * `/definir-contrasena`. El enlace usa el mismo mecanismo de Better Auth que la recuperación de
 * contraseña, así que al usarlo se crea la credencial con hash y el token queda consumido.
 */
const INVITE_DAYS = 7;

export async function inviteMember(input: {
  email: string;
  name?: string | null;
  role: Role;
  invitedBy?: { id: string; name: string } | null;
}): Promise<{ userId: string; url: string }> {
  const email = input.email.trim().toLowerCase();
  const ctx = await getAuth().$context;

  const existing = await ctx.internalAdapter.findUserByEmail(email);
  const user =
    existing?.user ??
    (await ctx.internalAdapter.createUser(
      { email, name: input.name?.trim() || email.split("@")[0]!, emailVerified: true },
      { method: "admin" },
    ));

  await getDb()
    .insert(schema.teamMembers)
    .values({ userId: user.id, role: input.role, active: true, invitedBy: input.invitedBy?.id ?? null })
    .onConflictDoUpdate({ target: schema.teamMembers.userId, set: { role: input.role, active: true } });

  const token = randomBytes(24).toString("base64url");
  await ctx.internalAdapter.createVerificationValue({
    identifier: `reset-password:${token}`,
    value: user.id,
    expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
  });

  const url = `${env().NEXT_PUBLIC_APP_URL}/definir-contrasena?token=${encodeURIComponent(token)}&invitacion=1`;
  await sendEmail(invitationEmail(email, input.invitedBy?.name ?? null, url));
  return { userId: user.id, url };
}

/** Quita el acceso a un miembro y cierra todas sus sesiones. El historial que creó se conserva. */
export async function deactivateMember(userId: string): Promise<void> {
  await getDb().update(schema.teamMembers).set({ active: false }).where(eq(schema.teamMembers.userId, userId));
  const ctx = await getAuth().$context;
  await ctx.internalAdapter.deleteUserSessions(userId);
}
