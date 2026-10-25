"use server";

import { refresh } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { isDenied, requireOwner } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { allowAttempt } from "@/lib/rate-limit";
import {
  ClaudePlanError,
  removeClaudePlanToken,
  saveClaudePlanToken,
} from "@/lib/ai/claude-plan";

/** Ajustes → Claves de servicios: el token de la suscripción de Claude del cliente. Solo el dueño. */
export type ClaudePlanState = { ok?: boolean; error?: string; label?: string };

const tokenSchema = z
  .string()
  .trim()
  .min(20, "Pega el token completo.")
  .max(2000, "Eso es demasiado largo para un token.");

export async function saveClaudePlanAction(
  _prev: ClaudePlanState,
  formData: FormData,
): Promise<ClaudePlanState> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { error: owner.error };
  const parsed = tokenSchema.safeParse(String(formData.get("token") ?? ""));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (!(await allowAttempt(`claude-plan:${owner.id}`, 10, 3600)))
    return { error: "Probaste muchas veces seguidas. Espera unos minutos." };
  try {
    const saved = await saveClaudePlanToken(parsed.data, owner.id);
    refresh();
    return { ok: true, label: saved.label };
  } catch (error) {
    if (error instanceof ClaudePlanError) return { error: error.message };
    console.error(
      "[claude-plan] guardar:",
      error instanceof Error ? error.message : "error",
    );
    return { error: "No pudimos guardar el token. Prueba de nuevo." };
  }
}

export async function removeClaudePlanAction(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { ok: false, error: owner.error };
  await removeClaudePlanToken();
  refresh();
  return { ok: true };
}

// ─── Conectar desde la plataforma (sin terminal) ─────────────────────────

/**
 * Encola el login de Claude: el worker corre `claude setup-token` y deja el enlace de inicio de sesión en la salida del
 * trabajo; la persona entra con su cuenta y pega acá el código que le muestra Claude. Cancela uno anterior a medias.
 */
export async function startClaudeLoginAction(): Promise<{
  ok: boolean;
  jobId?: string;
  error?: string;
}> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { ok: false, error: owner.error };
  if (!(await allowAttempt(`claude-login:${owner.id}`, 10, 3600)))
    return {
      ok: false,
      error: "Intentaste conectar muchas veces seguidas. Espera unos minutos.",
    };
  await cancelClaudeLogins();
  const jobId = await enqueueJob({
    type: "CLAUDE_LOGIN",
    input: {},
    createdBy: owner.id,
    maxAttempts: 1,
    stage: "En cola",
  });
  return { ok: true, jobId };
}

async function cancelClaudeLogins() {
  await getDb()
    .update(schema.jobs)
    .set({ status: "CANCELED", finishedAt: new Date(), lockedUntil: null })
    .where(
      and(
        eq(schema.jobs.type, "CLAUDE_LOGIN"),
        inArray(schema.jobs.status, ["QUEUED", "RUNNING"]),
      ),
    );
}

export async function cancelClaudeLoginAction(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { ok: false, error: owner.error };
  await cancelClaudeLogins();
  return { ok: true };
}

const codeSchema = z
  .string()
  .trim()
  .min(10, "Pega el código completo que te mostró Claude.")
  .max(400, "Eso es demasiado largo para el código.")
  .regex(
    /^[A-Za-z0-9_#.~-]+$/,
    "El código tiene caracteres raros. Cópialo de nuevo desde la página de Claude.",
  );

/** El código que muestra Claude después de iniciar sesión: el worker lo toma y termina la conexión. */
export async function sendClaudeCodeAction(
  jobId: string,
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { ok: false, error: owner.error };
  if (!/^[0-9a-f-]{36}$/i.test(jobId))
    return { ok: false, error: "Conexión no válida." };
  const parsed = codeSchema.safeParse(code);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message };
  const updated = await getDb()
    .update(schema.jobs)
    .set({
      input: sql`coalesce(${schema.jobs.input}, '{}'::jsonb) || ${JSON.stringify({ code: parsed.data })}::jsonb`,
    })
    .where(
      and(
        eq(schema.jobs.id, jobId),
        eq(schema.jobs.type, "CLAUDE_LOGIN"),
        eq(schema.jobs.status, "RUNNING"),
      ),
    )
    .returning({ id: schema.jobs.id });
  if (!updated.length)
    return {
      ok: false,
      error: "Esa conexión ya terminó o se canceló. Empieza de nuevo.",
    };
  return { ok: true };
}
