import "server-only";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Límite de intentos por ventana fija, guardado en la base (funciona igual con varias instancias).
 * Devuelve `true` si el intento está permitido. Cada llamada cuenta un intento.
 */
export async function allowAttempt(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const t = schema.rateLimits;
  const [row] = await getDb()
    .insert(t)
    .values({ key, count: 1 })
    .onConflictDoUpdate({
      target: t.key,
      set: {
        count: sql`case when ${t.windowStartedAt} < now() - make_interval(secs => ${windowSeconds}) then 1 else ${t.count} + 1 end`,
        windowStartedAt: sql`case when ${t.windowStartedAt} < now() - make_interval(secs => ${windowSeconds}) then now() else ${t.windowStartedAt} end`,
      },
    })
    .returning({ count: t.count });
  return (row?.count ?? 1) <= max;
}

/** Borra el contador (por ejemplo, después de un inicio de sesión correcto). */
export async function resetAttempts(key: string): Promise<void> {
  await getDb().delete(schema.rateLimits).where(sql`${schema.rateLimits.key} = ${key}`);
}
