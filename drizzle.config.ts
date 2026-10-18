import { defineConfig } from "drizzle-kit";

// Carga .env.local si existe (en CI las variables llegan por el entorno).
try {
  process.loadEnvFile(".env.local");
} catch {}

// Las migraciones se aplican con la conexión directa, sin pooler (DATABASE_URL_UNPOOLED).
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? "" },
  strict: true,
  verbose: true,
});
