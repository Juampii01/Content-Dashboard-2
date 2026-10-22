import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { monthlyReportEmail, sendEmail } from "@/lib/email";
import { formatCompact, formatNumber } from "@/lib/format";
import { allowAttempt } from "@/lib/rate-limit";
import { collectReportData } from "./data";
import { dueReportMonth, monthLabel, reportFileName } from "./month";
import { renderReportPdf } from "./pdf/render";
import { writeSummary } from "./summary";
import type { MonthlyReportData } from "./types";

/**
 * Servicio del informe mensual: generar (datos + resumen con IA + PDF), guardar, enviar por correo y el envío
 * automático del día 1. No pide sesión: lo llaman las acciones (después de `requireEditor`) y el cron.
 */

export class ReportError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "ReportError";
  }
}

/** Genera (o rehace) el informe de un mes y lo guarda con su PDF. */
export async function generateMonthlyReport(month: string, userId: string | null): Promise<MonthlyReportData> {
  const base = await collectReportData(month);
  if (!base) throw new ReportError("Ese mes todavía no empezó.");
  const summary = await writeSummary(base, userId);
  const data: MonthlyReportData = { ...base, summary };
  const pdf = await renderReportPdf(data);
  const values = { data, pdf, pdfBytes: pdf.byteLength, partial: data.partial, generatedBy: userId };
  await getDb()
    .insert(schema.monthlyReports)
    .values({ month, ...values })
    .onConflictDoUpdate({ target: schema.monthlyReports.month, set: { ...values, updatedAt: new Date() } });
  return data;
}

export async function storedReport(month: string): Promise<{ data: MonthlyReportData; pdf: Buffer } | null> {
  const [row] = await getDb()
    .select({ data: schema.monthlyReports.data, pdf: schema.monthlyReports.pdf })
    .from(schema.monthlyReports)
    .where(eq(schema.monthlyReports.month, month))
    .limit(1);
  return row ?? null;
}

export async function reportSettings(): Promise<{ recipients: string[]; autoSend: boolean }> {
  const [row] = await getDb().select().from(schema.reportSettings).limit(1);
  return { recipients: row?.recipients ?? [], autoSend: row?.autoSend ?? false };
}

/** Viñetas del cuerpo del correo: las cifras clave y el resumen (si hay). */
function emailBullets(data: MonthlyReportData): string[] {
  const t = data.totals;
  const sign = (v: number | null) => (v == null ? null : `${v >= 0 ? "+" : "−"}${formatNumber(Math.abs(v))}`);
  const numbers = [
    t.followers != null ? `Seguidores al cierre: ${formatNumber(t.followers)}${t.followersGained.current != null ? ` (${sign(t.followersGained.current)} en el mes)` : ""}` : null,
    t.views.current != null ? `Visualizaciones de lo publicado: ${formatCompact(t.views.current)}` : null,
    `Publicaciones: ${formatNumber(t.pieces.current)}`,
  ].filter((x): x is string => Boolean(x));
  return [...numbers, ...(data.summary?.wins.map((w) => `✓ ${w}`) ?? [])];
}

/**
 * Manda el informe guardado a cada destinatario por separado (así nadie ve los correos de los demás).
 * Devuelve a quiénes salió; si no salió a nadie, lanza un error para mostrar.
 */
export async function sendMonthlyReport(month: string, recipients: string[]): Promise<{ sent: string[]; failed: string[] }> {
  if (recipients.length === 0) throw new ReportError("No hay destinatarios. Agrégalos en Ajustes → Informe mensual.");
  const stored = await storedReport(month);
  if (!stored) throw new ReportError("Primero genera el informe de ese mes.");
  const { data, pdf } = stored;
  const db = getDb();
  const team = await db.execute<{ email: string }>(sql`
    select lower(u.email) as email from team_members tm join users u on u.id = tm.user_id where tm.active
  `);
  const teamEmails = new Set(team.rows.map((r) => r.email));
  const fileName = reportFileName(month, data.brand.name);
  const label = monthLabel(month, { lower: true });

  const sent: string[] = [];
  const failed: string[] = [];
  for (const to of recipients) {
    try {
      await sendEmail(
        monthlyReportEmail(to, {
          brandName: data.brand.name,
          monthLabel: label,
          headline: data.summary?.headline ?? null,
          bullets: emailBullets(data),
          fileName,
          pdf,
          appUrl: teamEmails.has(to.toLowerCase()) ? `${env().NEXT_PUBLIC_APP_URL}/inicio/informes?mes=${month}` : null,
        }),
      );
      sent.push(to);
    } catch (error) {
      console.error("[informe] correo:", error instanceof Error ? error.message : "error");
      failed.push(to);
    }
  }
  if (sent.length === 0) throw new ReportError("No pudimos enviar el informe. Revisa la configuración del correo y prueba de nuevo.");
  await db.update(schema.monthlyReports).set({ sentAt: new Date(), sentTo: sent }).where(eq(schema.monthlyReports.month, month));
  return { sent, failed };
}

/**
 * Para el cron (cada hora): el día 1 desde las 9:00 (hora de la marca) genera el informe del mes anterior
 * y, si el envío automático está encendido, lo manda una sola vez. Reintenta hasta el día 3 si algo falla.
 */
export async function ensureMonthlyReport(now = new Date()): Promise<{ month: string; generated: boolean; sent: number } | null> {
  const month = dueReportMonth(now, env().APP_TIMEZONE);
  if (!month) return null;
  const db = getDb();
  const [existing] = await db
    .select({ partial: schema.monthlyReports.partial, autoSentAt: schema.monthlyReports.autoSentAt })
    .from(schema.monthlyReports)
    .where(eq(schema.monthlyReports.month, month))
    .limit(1);

  let generated = false;
  // Un informe hecho a mitad de mes (parcial) se rehace con el mes cerrado.
  if (!existing || existing.partial) {
    // Si la IA o el PDF fallan, se reintenta como mucho 3 veces en la ventana (no cada hora para siempre).
    if (!(await allowAttempt(`informe-cron:${month}`, 3, 4 * 86_400))) return { month, generated: false, sent: 0 };
    await generateMonthlyReport(month, null);
    generated = true;
  } else if (existing.autoSentAt) {
    return { month, generated: false, sent: 0 };
  }

  const settings = await reportSettings();
  if (!settings.autoSend || settings.recipients.length === 0) return { month, generated, sent: 0 };
  // Se marca antes de enviar: si dos crons coinciden, solo uno lo manda.
  const claimed = await db
    .update(schema.monthlyReports)
    .set({ autoSentAt: new Date() })
    .where(and(eq(schema.monthlyReports.month, month), isNull(schema.monthlyReports.autoSentAt)))
    .returning({ month: schema.monthlyReports.month });
  if (claimed.length === 0) return { month, generated, sent: 0 };
  try {
    const { sent } = await sendMonthlyReport(month, settings.recipients);
    return { month, generated, sent: sent.length };
  } catch (error) {
    // No salió a nadie: se libera para reintentar en la próxima hora (dentro de la ventana de 3 días).
    await db.update(schema.monthlyReports).set({ autoSentAt: null }).where(eq(schema.monthlyReports.month, month));
    throw error;
  }
}
