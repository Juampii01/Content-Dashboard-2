"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { getAuth } from "@/lib/auth/server";
import { allowAttempt, resetAttempts } from "@/lib/rate-limit";

export type FormState = { error?: string; email?: string; sent?: boolean };

const TOO_MANY = "Hiciste demasiados intentos. Espera unos minutos y vuelve a probar.";

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "desconocida";
}

const credentials = z.object({
  email: z.email("Escribe un correo válido."),
  password: z.string().min(1, "Escribe tu contraseña."),
});

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const parsed = credentials.safeParse({ email, password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, email };

  const ip = await clientIp();
  const [byEmail, byIp] = await Promise.all([
    allowAttempt(`login:email:${email}`, 5, 15 * 60),
    allowAttempt(`login:ip:${ip}`, 30, 15 * 60),
  ]);
  if (!byEmail || !byIp) return { error: TOO_MANY, email };

  try {
    await getAuth().api.signInEmail({ body: parsed.data, headers: await headers() });
  } catch (error) {
    if (error instanceof APIError) {
      // Mensaje único: no revelamos si el correo existe o no.
      return { error: "El correo o la contraseña no son correctos.", email };
    }
    throw error;
  }
  await resetAttempts(`login:email:${email}`);
  redirect("/inicio");
}

export async function signOut() {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/login");
}

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const parsed = z.email().safeParse(email);
  if (!parsed.success) return { error: "Escribe un correo válido.", email };

  const ip = await clientIp();
  const [byEmail, byIp] = await Promise.all([
    allowAttempt(`reset:email:${email}`, 3, 60 * 60),
    allowAttempt(`reset:ip:${ip}`, 10, 60 * 60),
  ]);
  if (!byEmail || !byIp) return { error: TOO_MANY, email };

  // Siempre responde igual, exista o no el correo.
  await getAuth().api.requestPasswordReset({ body: { email }, headers: await headers() });
  return { sent: true, email };
}

const newPassword = z
  .object({
    token: z.string().min(10),
    password: z
      .string()
      .min(10, "La contraseña debe tener al menos 10 caracteres.")
      .max(128, "La contraseña es demasiado larga."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Las contraseñas no coinciden.", path: ["confirm"] });

export async function setPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = newPassword.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  try {
    await getAuth().api.resetPassword({ body: { token: parsed.data.token, newPassword: parsed.data.password } });
  } catch (error) {
    if (error instanceof APIError) {
      return { error: "El enlace venció o ya se usó. Pide uno nuevo desde “¿Olvidaste tu contraseña?”." };
    }
    throw error;
  }
  redirect("/login?aviso=contrasena-lista");
}
