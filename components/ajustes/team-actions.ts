"use server";

import { refresh } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { isDenied, requireOwner, type Role } from "@/lib/auth";
import { deactivateMember, inviteMember } from "@/lib/auth/invitations";
import { countActiveOwners } from "@/lib/dal/team";
import { getDb, schema } from "@/lib/db";

export type TeamActionState = { ok?: boolean; error?: string; message?: string };

const roles = ["OWNER", "EDITOR", "VIEWER"] as const satisfies readonly Role[];

const inviteSchema = z.object({
  email: z.email("Escribe un correo válido."),
  name: z.string().trim().max(80, "El nombre es demasiado largo.").optional(),
  role: z.enum(roles, "Elige un rol."),
});

export async function inviteAction(_prev: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { error: owner.error };

  const parsed = inviteSchema.safeParse({
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    name: String(formData.get("name") ?? "") || undefined,
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  // Alguien que ya está activo en el equipo no se reinvita (así nadie se cambia el rol por acá, ni el único dueño).
  const [existing] = await getDb()
    .select({ active: schema.teamMembers.active })
    .from(schema.teamMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.teamMembers.userId))
    .where(eq(schema.users.email, parsed.data.email))
    .limit(1);
  if (existing?.active) return { error: "Esa persona ya está en el equipo. Si quieres cambiar su rol, hazlo desde la lista." };

  try {
    await inviteMember({ ...parsed.data, invitedBy: { id: owner.id, name: owner.name } });
  } catch {
    return { error: "No se pudo enviar la invitación. Revisa la configuración de correo e inténtalo de nuevo." };
  }
  refresh();
  return { ok: true, message: `Listo. Le enviamos la invitación a ${parsed.data.email}.` };
}

async function guardTarget(userId: string, ownerId: string): Promise<string | null> {
  if (userId === ownerId) return "No puedes cambiar tu propio acceso. Pídeselo a otro dueño.";
  const [member] = await getDb().select().from(schema.teamMembers).where(eq(schema.teamMembers.userId, userId)).limit(1);
  if (!member) return "Ese usuario ya no está en el equipo.";
  if (member.role === "OWNER" && member.active && (await countActiveOwners()) <= 1) {
    return "Tiene que quedar al menos un dueño en la cuenta.";
  }
  return null;
}

export async function changeRoleAction(userId: string, role: Role): Promise<TeamActionState> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { error: owner.error };
  if (!roles.includes(role)) return { error: "Rol no válido." };
  const blocked = await guardTarget(userId, owner.id);
  if (blocked) return { error: blocked };

  await getDb().update(schema.teamMembers).set({ role }).where(eq(schema.teamMembers.userId, userId));
  refresh();
  return { ok: true };
}

export async function deactivateAction(userId: string): Promise<TeamActionState> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { error: owner.error };
  const blocked = await guardTarget(userId, owner.id);
  if (blocked) return { error: blocked };

  await deactivateMember(userId);
  refresh();
  return { ok: true };
}

export async function reactivateAction(userId: string): Promise<TeamActionState> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { error: owner.error };
  await getDb().update(schema.teamMembers).set({ active: true }).where(eq(schema.teamMembers.userId, userId));
  refresh();
  return { ok: true };
}

export async function resendInviteAction(userId: string): Promise<TeamActionState> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { error: owner.error };
  const [row] = await getDb()
    .select({ email: schema.users.email, name: schema.users.name, role: schema.teamMembers.role })
    .from(schema.teamMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.teamMembers.userId))
    .where(eq(schema.teamMembers.userId, userId))
    .limit(1);
  if (!row) return { error: "Ese usuario ya no está en el equipo." };
  try {
    await inviteMember({ email: row.email, name: row.name, role: row.role, invitedBy: { id: owner.id, name: owner.name } });
  } catch {
    return { error: "No se pudo reenviar la invitación. Inténtalo de nuevo en unos minutos." };
  }
  return { ok: true, message: `Invitación reenviada a ${row.email}.` };
}
