import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getCurrentUser, type Role } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";

export type TeamMember = {
  userId: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  /** true si todavía no definió su contraseña (invitación pendiente). */
  pending: boolean;
  joinedAt: Date;
};

/** Miembros del equipo, con el dueño primero. Cualquier miembro puede ver la lista. */
export async function listTeamMembers(): Promise<TeamMember[]> {
  await getCurrentUser();
  const db = getDb();
  const rows = await db
    .select({
      userId: schema.teamMembers.userId,
      role: schema.teamMembers.role,
      active: schema.teamMembers.active,
      joinedAt: schema.teamMembers.createdAt,
      name: schema.users.name,
      email: schema.users.email,
      credentialId: schema.accounts.id,
    })
    .from(schema.teamMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.teamMembers.userId))
    .leftJoin(schema.accounts, and(eq(schema.accounts.userId, schema.users.id), eq(schema.accounts.providerId, "credential")))
    .orderBy(asc(schema.teamMembers.createdAt));

  const order: Record<Role, number> = { OWNER: 0, EDITOR: 1, VIEWER: 2 };
  return rows
    .map((r) => ({ userId: r.userId, name: r.name, email: r.email, role: r.role, active: r.active, pending: !r.credentialId, joinedAt: r.joinedAt }))
    .sort((a, b) => Number(b.active) - Number(a.active) || order[a.role] - order[b.role]);
}

/** Cantidad de dueños activos (nunca puede quedar en cero). */
export async function countActiveOwners(): Promise<number> {
  const rows = await getDb()
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.role, "OWNER"), eq(schema.teamMembers.active, true)));
  return rows.length;
}
