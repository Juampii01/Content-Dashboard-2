"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { isDenied, requireEditor } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { AiError } from "@/lib/ai/client";
import { allowAttempt } from "@/lib/rate-limit";
import { isMonth, MAX_RECIPIENTS, monthLabel, parseRecipients } from "@/lib/reports/month";
import { generateMonthlyReport, ReportError, reportSettings, sendMonthlyReport } from "@/lib/reports/service";

type Result = { ok: true } | { ok: false; error: string };

function failure(error: unknown, context: string): { ok: false; error: string } {
  if (error instanceof ReportError) return { ok: false, error: error.userMessage };
  if (error instanceof AiError) {
    console.error("[ia]", error.detail);
    return { ok: false, error: error.userMessage };
  }
  console.error(`[informe] ${context}:`, error instanceof Error ? error.message : "error");
  return { ok: false, error: "No pudimos preparar el informe. Prueba de nuevo en un minuto." };
}

/** Genera (o vuelve a generar) el informe de un mes: cifras, resumen con IA y PDF. */
export async function generateReportAction(month: string): Promise<Result> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!isMonth(month)) return { ok: false, error: "Ese mes no es válido." };
  if (!(await allowAttempt(`informe:${user.id}`, 10, 3600))) return { ok: false, error: "Generaste muchos informes seguidos. Espera un rato y vuelve a intentarlo." };
  try {
    await generateMonthlyReport(month, user.id);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error, "generar");
  }
}

/** Envía ahora el informe guardado a los destinatarios de Ajustes. */
export async function sendReportAction(month: string): Promise<{ ok: true; sent: number; failed: string[] } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!isMonth(month)) return { ok: false, error: "Ese mes no es válido." };
  if (!(await allowAttempt(`informe-envio:${user.id}`, 5, 3600))) return { ok: false, error: "Ya enviaste varios informes en la última hora. Espera un rato." };
  const { recipients } = await reportSettings();
  try {
    const { sent, failed } = await sendMonthlyReport(month, recipients);
    refresh();
    return { ok: true, sent: sent.length, failed };
  } catch (error) {
    return failure(error, `enviar ${monthLabel(month)}`);
  }
}

const settingsSchema = z.object({
  recipients: z.array(z.string().max(254)).max(50),
  autoSend: z.boolean(),
});

/** Ajustes → Informe mensual: destinatarios (máximo 10, del equipo o externos) y envío automático. */
export async function saveReportSettingsAction(input: unknown): Promise<Result> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Revisa los destinatarios." };
  const { valid, invalid } = parseRecipients(parsed.data.recipients);
  if (invalid.length) return { ok: false, error: `Este correo no es válido: ${invalid[0]}` };
  if (valid.length > MAX_RECIPIENTS) return { ok: false, error: `Puedes tener hasta ${MAX_RECIPIENTS} destinatarios.` };
  if (parsed.data.autoSend && valid.length === 0) return { ok: false, error: "Agrega al menos un destinatario para encender el envío automático." };
  const values = { recipients: valid, autoSend: parsed.data.autoSend, updatedBy: user.id };
  await getDb()
    .insert(schema.reportSettings)
    .values({ id: "report", ...values })
    .onConflictDoUpdate({ target: schema.reportSettings.id, set: values });
  refresh();
  return { ok: true };
}
