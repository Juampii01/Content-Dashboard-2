import "server-only";
import { z } from "zod";

/**
 * Variables de entorno del servidor, validadas con Zod.
 *
 * Las de las integraciones (redes, IA, HeyGen) son opcionales: cada módulo
 * pide la suya con `requireEnv` y muestra un error claro si falta. Las de la base son obligatorias
 * y se validan al arrancar el servidor (ver `instrumentation.ts`).
 */
const optional = z.string().trim().min(1).optional();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Base
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_APP_NAME: z.string().trim().min(1).default("Content Studio"),

  // Base de datos (Neon desde el Marketplace de Vercel: la integración crea estas dos variables)
  DATABASE_URL: z.string().startsWith("postgres"),
  DATABASE_URL_UNPOOLED: z.string().startsWith("postgres"),

  // Sesiones: firma de cookies. Genérala con: openssl rand -base64 32
  BETTER_AUTH_SECRET: z.string().min(32, "Debe tener al menos 32 caracteres. Genérala con: openssl rand -base64 32"),

  // Correos (invitaciones y recuperación de contraseña) con Resend
  RESEND_API_KEY: optional,
  EMAIL_FROM: optional, // por ejemplo: "Content Studio <hola@tudominio.com>"

  // Clave para cifrar tokens y claves de servicios: 32 bytes en base64.
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message: "Debe ser una clave de 32 bytes en base64. Genérala con: openssl rand -base64 32",
    }),

  // Tareas programadas (sync diario y refresco de tokens)
  CRON_SECRET: z.string().min(16),

  // Integraciones (se exigen en cada módulo)
  INSTAGRAM_APP_ID: optional,
  INSTAGRAM_APP_SECRET: optional,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  TIKTOK_CLIENT_KEY: optional,
  TIKTOK_CLIENT_SECRET: optional,
  ANTHROPIC_API_KEY: optional,
  GROQ_API_KEY: optional,
  APIFY_API_TOKEN: optional,
  SCRAPECREATORS_API_KEY: optional,
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Devuelve el entorno validado. Lanza un error legible (sin valores) si algo falta o está mal. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Configuración incompleta. Revisa estas variables de entorno:\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}

type OptionalKey =
  | "INSTAGRAM_APP_ID"
  | "INSTAGRAM_APP_SECRET"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "TIKTOK_CLIENT_KEY"
  | "TIKTOK_CLIENT_SECRET"
  | "ANTHROPIC_API_KEY"
  | "GROQ_API_KEY"
  | "APIFY_API_TOKEN"
  | "SCRAPECREATORS_API_KEY";

/** Exige una variable opcional en el momento en que un módulo la necesita. */
export function requireEnv(key: OptionalKey): string {
  const value = env()[key];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${key}. Agrégala para usar esta función.`);
  }
  return value;
}
