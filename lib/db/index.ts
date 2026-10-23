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
 * Neon trae `sslmode=require`, que pg ya trata como `verify-full` pero avisa en cada arranque ("SECURITY WARNING").
 * Se saca el parámetro de la URL y se pide TLS verificado en la configuración: mismo comportamiento, sin el aviso.
 */
export function poolSsl(url: string): { connectionString: string; ssl?: { rejectUnauthorized: true } } {
  const match = /[?&]sslmode=(prefer|require|verify-ca|verify-full)(?=&|$)/.exec(url);
  if (!match) return { connectionString: url };
  const connectionString = url.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, "");
  return { connectionString, ssl: { rejectUnauthorized: true } };
}

export function getDb(): Db {
  if (!globalForDb.db) {
    const pool = new Pool({
      ...poolSsl(env().DATABASE_URL),
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
