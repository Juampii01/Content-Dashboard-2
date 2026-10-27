import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { notify } from "@/lib/notifications";
import { AiCreditError } from "./errors";
import { resolveUsageUser } from "./usage";

/**
 * Créditos de IA por mes: lo que cada persona puede gastar en Claude (USD de api_usage) en el mes calendario de la
 * instalación (APP_TIMEZONE). Al 80 % se avisa una vez por mes (en la app y por correo) y al 100 % cada llamada nueva se
 * frena con un mensaje claro hasta el 1.º del mes que viene. Un tope de la instalación (opcional) frena a todos.
 *
 * Se revisa ANTES de cada llamada (lib/ai/client.ts y el Estratega): lo que ya está en curso termina, pero no empieza
 * nada nuevo. Una llamada sin usuario (por ejemplo, el cron) solo cuenta para el tope de la instalación.
 */
export const DEFAULT_ID = "default";
export const INSTALLATION_ID = "installation";
export const WARN_AT = 0.8;

export type CreditState = { userId: string | null; spent: number; limit: number | null; installationSpent: number; installationLimit: number | null };

/** Desde cuándo cuenta el mes (inicio del mes en la zona horaria de la instalación). */
function monthStart() {
  return sql`(date_trunc('month', now() at time zone ${env().APP_TIMEZONE}) at time zone ${env().APP_TIMEZONE})`;
}

export function monthKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: env().APP_TIMEZONE, year: "numeric", month: "2-digit" }).format(now);
}

export async function limitsFor(userIds: string[]): Promise<{ byUser: Map<string, number>; fallback: number; installation: number | null }> {
  const rows = await getDb()
    .select()
    .from(schema.aiCreditLimits)
    .where(inArray(schema.aiCreditLimits.id, [...userIds, DEFAULT_ID, INSTALLATION_ID]));
  const byId = new Map(rows.map((r) => [r.id, r.monthlyUsd]));
  return {
    byUser: new Map(userIds.filter((id) => byId.has(id)).map((id) => [id, byId.get(id)!])),
    fallback: byId.get(DEFAULT_ID) ?? env().AI_MONTHLY_CREDIT_USD,
    installation: byId.get(INSTALLATION_ID) ?? null,
  };
}

/** Gasto del mes por persona (y el total de la instalación, con lo que no tiene usuario). */
export async function spentThisMonth(): Promise<{ byUser: Map<string, number>; total: number }> {
  const rows = await getDb().execute<{ user_id: string | null; usd: number }>(sql`
    select user_id, coalesce(sum(cost_usd), 0)::float as usd from api_usage where created_at >= ${monthStart()} group by user_id`);
  const byUser = new Map<string, number>();
  let total = 0;
  for (const r of rows.rows) {
    total += Number(r.usd);
    if (r.user_id) byUser.set(r.user_id, Number(r.usd));
  }
  return { byUser, total };
}

export async function creditState(userId: string | null): Promise<CreditState> {
  const [limits, spent] = await Promise.all([limitsFor(userId ? [userId] : []), spentThisMonth()]);
  return {
    userId,
    spent: userId ? (spent.byUser.get(userId) ?? 0) : 0,
    limit: userId ? (limits.byUser.get(userId) ?? limits.fallback) : null,
    installationSpent: spent.total,
    installationLimit: limits.installation,
  };
}

const usd = (n: number) => `USD ${n.toFixed(2)}`;

/**
 * Antes de llamar a la IA: frena si la persona (o la instalación) llegó a su tope del mes y avisa al pasar el 80 %.
 * Lanza AiCreditError (un AiError con el mensaje para mostrar).
 */
export async function checkCredit(input: { userId?: string | null; videoProjectId?: string | null }): Promise<void> {
  const userId = await resolveUsageUser(input.userId, input.videoProjectId);
  let state: CreditState;
  try {
    state = await creditState(userId);
  } catch (error) {
    // Si no se puede leer el consumo, no se frena el trabajo: el tope por video sigue protegiendo el gasto.
    console.error("[creditos] no se pudo leer el consumo:", error instanceof Error ? error.message : "error");
    return;
  }
  if (state.installationLimit != null && state.installationSpent >= state.installationLimit) {
    throw new AiCreditError(`Esta instalación llegó a su tope de IA del mes (${usd(state.installationLimit)}). Se renueva el 1.º del mes que viene; el dueño puede subirlo en Ajustes → Consumo.`, "tope de la instalación");
  }
  if (state.limit != null && state.spent >= state.limit) {
    throw new AiCreditError(`Llegaste a tus créditos de IA del mes (${usd(state.limit)}). Se renuevan el 1.º del mes que viene; el dueño de la cuenta puede subirlos en Ajustes → Consumo.`, "tope del usuario");
  }
  const month = monthKey();
  if (userId && state.limit != null && state.limit > 0 && state.spent >= state.limit * WARN_AT) {
    void notify({
      key: `creditos-80:${userId}:${month}`,
      userId,
      tone: "error",
      title: "Usaste el 80 % de tus créditos de IA",
      body: `Llevas ${usd(state.spent)} de ${usd(state.limit)} este mes. Al llegar al 100 % la IA se pausa hasta el 1.º del mes que viene.`,
      href: "/ajustes/consumo",
      email: true,
      footnote: "Te avisamos una sola vez por mes, al pasar el 80 % de tus créditos de IA.",
    });
  }
  if (state.installationLimit != null && state.installationLimit > 0 && state.installationSpent >= state.installationLimit * WARN_AT) {
    const owners = await getDb()
      .select({ userId: schema.teamMembers.userId })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.role, "OWNER"));
    for (const o of owners) {
      void notify({
        key: `creditos-instalacion-80:${o.userId}:${month}`,
        userId: o.userId,
        tone: "error",
        title: "La instalación usó el 80 % de su tope de IA",
        body: `Van ${usd(state.installationSpent)} de ${usd(state.installationLimit)} este mes entre todo el equipo.`,
        href: "/ajustes/consumo",
        email: true,
        footnote: "Te avisamos una sola vez por mes, al pasar el 80 % del tope de la instalación.",
      });
    }
  }
}
