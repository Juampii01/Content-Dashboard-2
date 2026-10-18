import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Conexión a Postgres (Supabase) con Drizzle.
 * Usa el pooler en modo transacción (DATABASE_URL), por eso `prepare: false`.
 * Se crea recién en el primer uso (no al importar), así el build no necesita la base.
 * Una sola conexión por proceso; en desarrollo sobrevive a las recargas.
 */
type Db = PostgresJsDatabase<typeof schema>;
const globalForDb = globalThis as unknown as { db?: Db };

export function getDb(): Db {
  if (!globalForDb.db) {
    const client = postgres(env().DATABASE_URL, { prepare: false, max: 5 });
    globalForDb.db = drizzle({ client, schema });
  }
  return globalForDb.db;
}

export { schema };
