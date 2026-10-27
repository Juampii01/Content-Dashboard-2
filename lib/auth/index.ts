import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getAuth } from "./server";

/**
 * Capa de acceso a la sesión. Toda página, acción, endpoint y función de datos (`lib/dal`) pasa por aquí.
 *
 * Single-tenant: solo entra quien tiene una fila activa en `team_members`. Tener usuario no basta.
 */
export type Role = "OWNER" | "EDITOR" | "VIEWER";

export type CurrentUser = { id: string; email: string; name: string; role: Role };

/** Resultado de una acción que el usuario no puede hacer. Se muestra tal cual en la interfaz. */
export type Denied = { ok: false; error: string };

async function readSession(): Promise<CurrentUser | null> {
  // Primero los headers: así el prerender se detiene aquí y nunca toca la configuración ni la base.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;

  const [member] = await getDb()
    .select({ role: schema.teamMembers.role, active: schema.teamMembers.active })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.userId, session.user.id))
    .limit(1);
  if (!member?.active) return null;

  return { id: session.user.id, email: session.user.email, name: session.user.name || session.user.email, role: member.role };
}

/** Usuario actual o null. Se memoriza por request: varias llamadas consultan la base una sola vez. */
export const getOptionalUser = cache(readSession);

/** Usuario actual. Si no hay sesión o no es miembro activo, manda al login. */
export async function getCurrentUser(): Promise<CurrentUser> {
  const user = await getOptionalUser();
  if (!user) redirect("/login?error=sin-acceso");
  return user;
}

/** Para acciones que modifican datos. Devuelve el usuario o un error para mostrar. */
export async function requireEditor(): Promise<CurrentUser | Denied> {
  const user = await getCurrentUser();
  if (user.role === "VIEWER") {
    return { ok: false, error: "Tu usuario es de solo lectura. Pide acceso de edición al dueño de la cuenta." };
  }
  return user;
}

export async function requireOwner(): Promise<CurrentUser | Denied> {
  const user = await getCurrentUser();
  if (user.role !== "OWNER") return { ok: false, error: "Solo el dueño de la cuenta puede hacer este cambio." };
  return user;
}

export function isDenied(value: CurrentUser | Denied): value is Denied {
  return "ok" in value && value.ok === false;
}
