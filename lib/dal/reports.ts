import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { todayIn } from "@/lib/metrics/params";
import { addMonths, monthOf } from "@/lib/reports/month";
import type { MonthlyReportData } from "@/lib/reports/types";

/** Lecturas del informe mensual (Inicio → Informes y Ajustes). Todas piden sesión. */

export type ReportListItem = {
  month: string;
  partial: boolean;
  pdfBytes: number;
  updatedAt: Date;
  sentAt: Date | null;
  sentTo: string[];
  autoSentAt: Date | null;
};

export type ReportMonthOption = { month: string; current: boolean; report: ReportListItem | null };

/**
 * Meses para elegir: desde el primer dato (pieza o seguidores) hasta el mes en curso, los 12 más recientes,
 * más cualquier mes que ya tenga informe guardado.
 */
export async function listReportMonths(): Promise<ReportMonthOption[]> {
  await getCurrentUser();
  const db = getDb();
  const tz = env().APP_TIMEZONE;
  const current = monthOf(todayIn(tz));
  const [reports, first] = await Promise.all([
    db
      .select({
        month: schema.monthlyReports.month,
        partial: schema.monthlyReports.partial,
        pdfBytes: schema.monthlyReports.pdfBytes,
        updatedAt: schema.monthlyReports.updatedAt,
        sentAt: schema.monthlyReports.sentAt,
        sentTo: schema.monthlyReports.sentTo,
        autoSentAt: schema.monthlyReports.autoSentAt,
      })
      .from(schema.monthlyReports)
      .orderBy(desc(schema.monthlyReports.month)),
    db.execute<{ first: string | null }>(sql`
      select least(
        (select min((published_at at time zone ${tz})::date) from content_items),
        (select min(captured_on) from account_snapshots)
      )::text as first
    `),
  ]);
  const firstMonth = first.rows[0]?.first ? monthOf(first.rows[0].first) : current;
  const months = new Set<string>(reports.map((r) => r.month));
  for (let m = current, i = 0; m >= firstMonth && i < 12; m = addMonths(m, -1), i++) months.add(m);
  return [...months]
    .filter((m) => m <= current)
    .sort((a, b) => b.localeCompare(a))
    .map((month) => ({ month, current: month === current, report: reports.find((r) => r.month === month) ?? null }));
}

export async function getReport(month: string): Promise<(ReportListItem & { data: MonthlyReportData }) | null> {
  await getCurrentUser();
  const [row] = await getDb()
    .select({
      month: schema.monthlyReports.month,
      data: schema.monthlyReports.data,
      partial: schema.monthlyReports.partial,
      pdfBytes: schema.monthlyReports.pdfBytes,
      updatedAt: schema.monthlyReports.updatedAt,
      sentAt: schema.monthlyReports.sentAt,
      sentTo: schema.monthlyReports.sentTo,
      autoSentAt: schema.monthlyReports.autoSentAt,
    })
    .from(schema.monthlyReports)
    .where(eq(schema.monthlyReports.month, month))
    .limit(1);
  return row ?? null;
}

/** PDF guardado (solo para la ruta de descarga, que ya comprobó la sesión). */
export async function getReportPdf(month: string): Promise<{ pdf: Buffer; brandName: string } | null> {
  await getCurrentUser();
  const [row] = await getDb()
    .select({ pdf: schema.monthlyReports.pdf, brandName: sql<string>`${schema.monthlyReports.data}->'brand'->>'name'` })
    .from(schema.monthlyReports)
    .where(eq(schema.monthlyReports.month, month))
    .limit(1);
  return row ?? null;
}

export type ReportSettingsView = {
  recipients: string[];
  autoSend: boolean;
  team: { email: string; name: string }[];
  emailConfigured: boolean;
  canEdit: boolean;
};

export async function getReportSettings(): Promise<ReportSettingsView> {
  const user = await getCurrentUser();
  const db = getDb();
  const [[row], team] = await Promise.all([
    db.select().from(schema.reportSettings).limit(1),
    db.execute<{ email: string; name: string }>(sql`
      select lower(u.email) as email, u.name from team_members tm join users u on u.id = tm.user_id
      where tm.active order by tm.role, u.name
    `),
  ]);
  return {
    recipients: row?.recipients ?? [],
    autoSend: row?.autoSend ?? false,
    team: team.rows,
    emailConfigured: Boolean(env().RESEND_API_KEY && env().EMAIL_FROM),
    canEdit: user.role !== "VIEWER",
  };
}
