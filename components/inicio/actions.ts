"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getCurrentUser, isDenied, requireEditor } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { AiError, aiConfigured } from "@/lib/ai/client";
import { generateWeeklyReport } from "@/lib/home/weekly-report";
import { allowAttempt } from "@/lib/rate-limit";

const goalsSchema = z.object({
  followers: z.coerce.number().int().min(100, "La meta tiene que ser de al menos 100 seguidores.").max(100_000_000),
  platform: z.enum(["TOTAL", "INSTAGRAM", "YOUTUBE", "TIKTOK"]),
  weeklyPieces: z.coerce.number().int().min(1, "Al menos 1 pieza por semana.").max(30, "Máximo 30 piezas por semana."),
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
});

export async function saveGoalsAction(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  const parsed = goalsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos de la meta." };
  const goals = { ...parsed.data, deadline: parsed.data.deadline || null };
  await getDb()
    .insert(schema.brandProfile)
    .values({ id: "brand", goals })
    .onConflictDoUpdate({ target: schema.brandProfile.id, set: { goals } });
  refresh();
  return { ok: true };
}

export async function generateWeeklyReportAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  if (!aiConfigured()) return { ok: false, error: "La IA todavía no está configurada en esta instalación." };
  if (!(await allowAttempt(`resumen:${user.id}`, 6, 3600))) return { ok: false, error: "Espera un rato antes de volver a generarlo." };
  try {
    const report = await generateWeeklyReport(undefined, user.id);
    if (!report) return { ok: false, error: "Todavía no hay datos de la semana pasada para resumir." };
    refresh();
    return { ok: true };
  } catch (error) {
    if (error instanceof AiError) {
      console.error("[ia]", error.detail);
      return { ok: false, error: error.userMessage };
    }
    console.error("[inicio] resumen", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos generar el resumen. Prueba de nuevo." };
  }
}

/** "Ya lo conozco": cierra la guía de primer uso para esta persona (no para todo el equipo). */
export async function dismissOnboardingAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  await getDb().update(schema.teamMembers).set({ onboardingDismissedAt: new Date() }).where(eq(schema.teamMembers.userId, user.id));
  refresh();
  return { ok: true };
}
