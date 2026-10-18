import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { passwordResetEmail, sendEmail } from "@/lib/email";

/**
 * Configuración de Better Auth.
 *
 * - Solo correo y contraseña. **Sin registro abierto** (`disableSignUp`): los usuarios se crean por
 *   invitación (ver `lib/auth/invitations.ts`) o con `pnpm crear-dueno`.
 * - Las sesiones viven 30 días y se renuevan con el uso. Al cambiar la contraseña se cierran todas.
 * - Se crea en el primer uso, así el build no necesita la base ni las variables.
 */
function createAuth() {
  const { NEXT_PUBLIC_APP_URL, BETTER_AUTH_SECRET } = env();
  return betterAuth({
    appName: env().NEXT_PUBLIC_APP_NAME,
    baseURL: NEXT_PUBLIC_APP_URL,
    secret: BETTER_AUTH_SECRET,
    trustedOrigins: [NEXT_PUBLIC_APP_URL],
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: { user: schema.users, session: schema.sessions, account: schema.accounts, verification: schema.verifications },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, token }) => {
        await sendEmail(passwordResetEmail(user.email, `${NEXT_PUBLIC_APP_URL}/definir-contrasena?token=${encodeURIComponent(token)}`));
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      database: { generateId: () => crypto.randomUUID() },
      cookiePrefix: "cs",
    },
    telemetry: { enabled: false },
    // Debe ir último: permite que las Server Actions escriban las cookies de sesión.
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { auth?: Auth };

export function getAuth(): Auth {
  globalForAuth.auth ??= createAuth();
  return globalForAuth.auth;
}

/** Prefijo de las cookies de sesión; el proxy lo necesita para detectar la sesión sin tocar la base. */
export const AUTH_COOKIE_PREFIX = "cs";
