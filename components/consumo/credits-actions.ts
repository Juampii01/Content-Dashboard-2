"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { isDenied, requireOwner } from "@/lib/auth";
import { DEFAULT_ID, INSTALLATION_ID } from "@/lib/ai/credits";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

const input = z.object({
  id: z.string().min(1).max(100),
  /** null: sin tope propio (una persona usa el de por defecto; la instalación queda sin tope). */
  monthlyUsd: z.number().min(0, "El tope no puede ser negativo.").max(100_000, "Ese tope es demasiado alto.").nullable(),
});

/** Solo el dueño: cambia el tope mensual de una persona, el de por defecto o el de toda la instalación. */
export async function setCreditLimitAction(raw: z.input<typeof input>): Promise<{ ok: boolean; error?: string }> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { ok: false, error: owner.error };
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa el tope." };
  const { id, monthlyUsd } = parsed.data;
  const db = getDb();
  if (id !== DEFAULT_ID && id !== INSTALLATION_ID) {
    const [member] = await db.select({ id: schema.teamMembers.id }).from(schema.teamMembers).where(eq(schema.teamMembers.userId, id)).limit(1);
    if (!member) return { ok: false, error: "No encontramos a esa persona en tu equipo." };
  }
  if (monthlyUsd == null) {
    if (id === DEFAULT_ID) return { ok: false, error: "El tope por defecto necesita un monto." };
    await db.delete(schema.aiCreditLimits).where(eq(schema.aiCreditLimits.id, id));
  } else {
    await db
      .insert(schema.aiCreditLimits)
      .values({ id, monthlyUsd, updatedBy: owner.id })
      .onConflictDoUpdate({ target: schema.aiCreditLimits.id, set: { monthlyUsd, updatedBy: owner.id, updatedAt: new Date() } });
  }
  refresh();
  return { ok: true };
}
