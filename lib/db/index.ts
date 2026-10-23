import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Conexión a Postgres (Neon, instalado desde el Marketplace de Vercel) con Drizzle.
 *
 * - La app usa `DATABASE_URL` (con pooler). Las migraciones y el worker usan `DATABASE_URL_UNPOOLED`.
 * - `attachDatabasePool` le avisa a Vercel (Fluid compute) que cierre las conexiones ociosas antes de
 *   suspender la función, así no quedan conexiones colgadas.
 * - Se crea en el primer uso (no al importar), así el build no necesita la base.
 */
type Db = NodePgDatabase<typeof schema>;
const globalForDb = globalThis as unknown as { db?: Db; pool?: Pool };

/**
 * `sslmode=require` (el que trae Neon) hoy ya se trata como `verify-full` en pg, pero imprime un aviso de seguridad en
 * cada arranque. Se pide `verify-full` explícito: el mismo comportamiento, sin el aviso en los registros.
 */
export function strictSsl(url: string): string {
  return url.replace(/([?&])sslmode=(prefer|require|verify-ca)(?=&|$)/, "$1sslmode=verify-full");
}

export function getDb(): Db {
  if (!globalForDb.db) {
    const pool = new Pool({
      connectionString: strictSsl(env().DATABASE_URL),
      max: 5,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 10_000,
    });
    attachDatabasePool(pool);
    globalForDb.pool = pool;
    globalForDb.db = drizzle({ client: pool, schema });
  }
  return globalForDb.db;
}

export { schema };
