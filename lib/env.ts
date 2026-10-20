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
  // Zona horaria de la marca: define qué es "hoy", los días de los gráficos y el mapa de horarios.
  APP_TIMEZONE: z
    .string()
    .default("America/Mexico_City")
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Zona horaria no válida (usa un nombre IANA, por ejemplo America/Bogota)."),

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

  // Archivos (Vercel Blob). Lo crea la integración de Blob en el proyecto de Vercel.
  BLOB_READ_WRITE_TOKEN: optional,
  // Videos del Editor: un segundo store de Blob, **privado** (los videos crudos del cliente no son públicos).
  // Al conectarlo al proyecto de Vercel se elige el prefijo VIDEO_BLOB y se crea esta variable.
  VIDEO_BLOB_READ_WRITE_TOKEN: optional,

  // Worker de video (ver docs/worker.md). WORKER_SECRET lo comparten la app y el worker.
  WORKER_SECRET: z.string().trim().min(32, "Debe tener al menos 32 caracteres. Genérala con: openssl rand -base64 32").optional(),
  // Opcionales: si están, la app enciende la Fly Machine del worker al encolar un trabajo.
  FLY_API_TOKEN: optional,
  FLY_WORKER_APP: optional,
  FLY_WORKER_MACHINE_ID: optional,

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
  // B-roll del Editor de video: videos de stock de Pexels (clave gratuita, uso comercial con atribución).
  // Sin clave, el b-roll sale solo de la biblioteca del cliente. PEXELS_API_BASE es para pruebas con un simulador.
  PEXELS_API_KEY: optional,
  PEXELS_API_BASE: z.preprocess((v) => (v === "" ? undefined : v), z.url().default("https://api.pexels.com")),
  // HeyGen: cada cliente guarda su propia API key en Ajustes (cifrada en la base). Esta variable solo
  // cambia la dirección de la API; sirve para pruebas con un servidor simulado. Por defecto, la oficial.
  HEYGEN_API_BASE: z.preprocess((v) => (v === "" ? undefined : v), z.url().default("https://api.heygen.com")),
  // Imágenes de Carruseles: cada cliente conecta su ChatGPT (Codex en el worker) o guarda su API key de OpenAI en
  // Ajustes. Estas variables solo cambian modelos y dirección de la API (pruebas con un simulador). Todas opcionales.
  OPENAI_API_BASE: z.preprocess((v) => (v === "" ? undefined : v), z.url().default("https://api.openai.com/v1")),
  OPENAI_IMAGE_MODEL: z.string().trim().min(1).default("gpt-image-2.5-flare"),
  CODEX_MODEL: z.string().trim().min(1).default("gpt-5.6-terra"),
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
  | "BLOB_READ_WRITE_TOKEN"
  | "VIDEO_BLOB_READ_WRITE_TOKEN"
  | "WORKER_SECRET"
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
