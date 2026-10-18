import "server-only";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Capa de acceso a la sesión. Toda página, acción y endpoint privado pasa por aquí.
 *
 * Single-tenant: solo entra quien tiene una fila en `TeamMember`. Tener cuenta en Supabase
 * no alcanza; los usuarios se invitan desde Ajustes, no hay registro abierto.
 */
export type Role = "OWNER" | "EDITOR" | "VIEWER";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export async function getCurrentUser(): Promise<CurrentUser> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");

  const member = await getDb().query.teamMembers.findFirst({
    where: eq(schema.teamMembers.userId, claims.sub),
  });
  if (!member || !member.active) redirect("/login?error=sin-acceso");

  return { id: member.userId, email: member.email, name: member.name ?? member.email, role: member.role };
}

/** Para acciones que modifican datos: los usuarios de solo lectura no pueden. */
export async function requireEditor(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user.role === "VIEWER") {
    throw new Error("Tu usuario es de solo lectura. Pide acceso de edición al dueño de la cuenta.");
  }
  return user;
}

export async function requireOwner(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user.role !== "OWNER") {
    throw new Error("Solo el dueño de la cuenta puede hacer este cambio.");
  }
  return user;
}
