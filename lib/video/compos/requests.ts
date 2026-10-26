import "server-only";
import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import { claudePlanConnected } from "@/lib/ai/claude-plan";
import { getDb, schema } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import type { Composition } from "./schema";
import { loadWorkCtx, STAGE_COST, workView, type ComposWork, type WorkView } from "./work";

/**
 * Pedidos de animaciones del Estudio, varios a la vez (tabla compos_requests, una fila por pedido):
 * - al encolarse, cada uno reserva su costo estimado del tope de IA del video, con la fila del video bloqueada
 *   (`SELECT … FOR UPDATE`) para que dos pedidos simultáneos no reserven el mismo margen;
 * - si no alcanza, ese pedido queda fallido con el aviso (los demás siguen);
 * - cada uno tiene su trabajo VIDEO_COMPOS (el worker corre hasta 3 del mismo video en paralelo) y escribe solo su
 *   fila en cada paso;
 * - el resultado lo entrega el Estudio sobre su estado actual (con deshacer) y lo marca entregado cuando quedó guardado.
 * - «Animar todo el video» crea muchos de una vez: los que no entran en los activos quedan en espera ("waiting", sin
 *   trabajo ni reserva) y pasan a la cola solos a medida que terminan otros (`promoteWaiting`).
 * Con la suscripción de Claude conectada, las animaciones no gastan la API: el tope de USD del video no las limita.
 */

/** Pedidos activos a la vez por video (cada uno con su trabajo; el worker corre hasta 3 en paralelo). */
export const MAX_ACTIVE = 8;

export const ACTIVE = ["waiting", "queued", "running"] as const;
/** Los que ocupan lugar (tienen trabajo en la cola o corriendo). */
export const RUNNING = ["queued", "running"] as const;

/** Costo estimado de un pedido: plan (si hace falta), escribir con un reintento y las vueltas de revisión. */
export function requestEstimate(input: { plan: boolean; lookRounds: number }): number {
  return Math.round(((input.plan ? STAGE_COST.plan + STAGE_COST.vision : 0) + STAGE_COST.code + input.lookRounds * STAGE_COST.look) * 100) / 100;
}

/**
 * Vueltas de revisión y reserva para un pedido según lo que queda libre del tope (el tope menos lo gastado y menos lo
 * reservado por los otros pedidos en curso). null si no alcanza ni para escribirla.
 */
export function planReservation(free: number, needsPlan: boolean): { lookRounds: number; reserved: number } | null {
  for (const lookRounds of [2, 1, 0]) {
    const reserved = requestEstimate({ plan: needsPlan, lookRounds });
    // Con margen: dos vueltas solo si sobra bastante (como antes: más de USD 2 libres).
    if (lookRounds === 2 && free <= 2) continue;
    if (lookRounds === 1 && free <= 1.2) continue;
    if (reserved <= free) return { lookRounds, reserved };
  }
  return null;
}

/**
 * Encola un pedido. `build` arma el taller con las vueltas que alcanzan. Devuelve el id; si no alcanzó el tope, el
 * pedido queda fallido con el motivo (para mostrarlo en ese pedido, sin frenar a los demás).
 */
export async function enqueueRequest(input: {
  projectId: string;
  userId: string | null;
  cap: number;
  spent: number;
  needsPlan: boolean;
  build: (lookRounds: number) => ComposWork;
  /** En espera: se crea sin trabajo y entra a la cola cuando haya lugar (`promoteWaiting`). */
  wait?: boolean;
}): Promise<{ workId: string; error: string | null }> {
  const db = getDb();
  if (input.wait) {
    const work = input.build(0);
    work.reservedUsd = 0;
    work.usedUsd = 0;
    await db.insert(schema.composRequests).values({ id: work.id, projectId: input.projectId, status: "waiting", work: work as unknown as Record<string, unknown>, reservedUsd: 0, createdBy: input.userId });
    return { workId: work.id, error: null };
  }
  const planOn = await claudePlanConnected().catch(() => false);
  const out = await db.transaction(async (tx) => {
    // Un pedido a la vez reserva en este video: los demás esperan aquí unos milisegundos.
    await tx.execute(sql`select id from video_projects where id = ${input.projectId} for update`);
    const active = await tx
      .select({ reserved: schema.composRequests.reservedUsd, used: schema.composRequests.usedUsd })
      .from(schema.composRequests)
      .where(and(eq(schema.composRequests.projectId, input.projectId), inArray(schema.composRequests.status, [...RUNNING])));
    const held = active.reduce((n, r) => n + Math.max(0, r.reserved - r.used), 0);
    const free = input.cap - input.spent - held;
    // Con la suscripción, lo que reserva el pedido no sale del tope en USD (no gasta la API): dos vueltas de revisión.
    const plan = planOn ? { lookRounds: 2, reserved: requestEstimate({ plan: input.needsPlan, lookRounds: 2 }) } : planReservation(free, input.needsPlan);
    const work = input.build(plan?.lookRounds ?? 0);
    work.reservedUsd = plan?.reserved ?? 0;
    work.usedUsd = 0;
    if (!plan) {
      const error =
        held > 0
          ? `No alcanza el tope de IA de este video para esta animación mientras corren las otras (quedan USD ${Math.max(0, input.cap - input.spent).toFixed(2)} y están reservados ${held.toFixed(2)}). Espera a que terminen o sube el tope en el brief del director.`
          : `No queda tope de IA para este video (usaste USD ${input.spent.toFixed(2)} de ${input.cap.toFixed(2)}). Súbelo en el brief del director.`;
      work.done = true;
      work.error = error;
      await tx.insert(schema.composRequests).values({ id: work.id, projectId: input.projectId, status: "failed", work: work as unknown as Record<string, unknown>, reservedUsd: 0, error, createdBy: input.userId });
      return { workId: work.id, error };
    }
    await tx.insert(schema.composRequests).values({ id: work.id, projectId: input.projectId, status: "queued", work: work as unknown as Record<string, unknown>, reservedUsd: plan.reserved, createdBy: input.userId });
    return { workId: work.id, error: null as string | null };
  });
  if (!out.error) {
    const jobId = await enqueueJob({ type: "VIDEO_COMPOS", videoProjectId: input.projectId, createdBy: input.userId, stage: "En cola", maxAttempts: 2, input: { projectId: input.projectId, workId: out.workId } });
    await db.update(schema.composRequests).set({ jobId }).where(eq(schema.composRequests.id, out.workId));
  }
  return out;
}

export type RequestView = WorkView & {
  status: "waiting" | "queued" | "running" | "done" | "failed" | "canceled";
  createdAt: string;
  reservedUsd: number;
  usedUsd: number;
  /** Las animaciones terminadas (para entregarlas al Estudio). */
  made: Composition[];
};

/**
 * Los pedidos que le importan al Estudio: los que están en cola o corriendo, y los terminados o fallidos que todavía no
 * entregó (de las últimas 48 h). Los más viejos primero (se entregan en el orden en que se pidieron).
 */
/**
 * Pedidos huérfanos: si su trabajo de la cola ya terminó como fallido o cancelado (por ejemplo, se cortó varias veces
 * por un reinicio del worker) y el pedido quedó «corriendo», se marca fallido para que el Estudio lo muestre y se pueda
 * volver a pedir. Sin esto quedaba «en curso» para siempre.
 */
async function healOrphans(projectId: string): Promise<void> {
  await getDb()
    .update(schema.composRequests)
    .set({ status: "failed", error: "Se interrumpió el procesamiento antes de terminar. Vuelve a pedir el cambio.", updatedAt: new Date() })
    .where(
      and(
        eq(schema.composRequests.projectId, projectId),
        inArray(schema.composRequests.status, [...RUNNING]),
        sql`${schema.composRequests.jobId} in (select ${schema.jobs.id} from ${schema.jobs} where ${schema.jobs.status} in ('FAILED', 'CANCELED'))`,
      ),
    );
}

export async function listRequests(projectId: string): Promise<RequestView[]> {
  await healOrphans(projectId).catch((e) => console.error("[animaciones] huérfanos:", e instanceof Error ? e.message : e));
  await promoteWaiting(projectId).catch((e) => console.error("[animaciones] en espera:", e instanceof Error ? e.message : e));
  const rows = await getDb()
    .select()
    .from(schema.composRequests)
    .where(
      and(
        eq(schema.composRequests.projectId, projectId),
        or(inArray(schema.composRequests.status, [...ACTIVE]), and(eq(schema.composRequests.delivered, false), inArray(schema.composRequests.status, ["done", "failed"]), gt(schema.composRequests.createdAt, new Date(Date.now() - 48 * 3600_000)))),
      ),
    )
    .orderBy(schema.composRequests.createdAt)
    .limit(60);
  return rows.map((r) => {
    const work = r.work as unknown as ComposWork;
    const view = workView(work)!;
    return {
      ...view,
      error: r.error ?? view.error,
      status: r.status as RequestView["status"],
      createdAt: r.createdAt.toISOString(),
      reservedUsd: r.reservedUsd,
      usedUsd: r.usedUsd,
      made: r.status === "done" ? work.tasks.filter((t) => t.status === "done" && t.result).map((t) => t.result!) : [],
    };
  });
}

/** Cancela un pedido. Si todavía estaba en cola, su trabajo también; si ya corría, se detiene en el próximo paso. */
export async function cancelRequest(projectId: string, workId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .update(schema.composRequests)
    .set({ status: "canceled", delivered: true })
    .where(and(eq(schema.composRequests.id, workId), eq(schema.composRequests.projectId, projectId), inArray(schema.composRequests.status, [...ACTIVE])))
    .returning({ jobId: schema.composRequests.jobId });
  if (!row) return false;
  if (row.jobId) await db.update(schema.jobs).set({ status: "CANCELED", finishedAt: new Date() }).where(and(eq(schema.jobs.id, row.jobId), eq(schema.jobs.status, "QUEUED")));
  await promoteWaiting(projectId).catch(() => 0);
  return true;
}

/** Marca entregados (ya están en el plan guardado, o la persona descartó el aviso de un pedido fallido). */
export async function ackRequests(projectId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await getDb()
    .update(schema.composRequests)
    .set({ delivered: true })
    .where(and(eq(schema.composRequests.projectId, projectId), inArray(schema.composRequests.id, ids.slice(0, 30)), inArray(schema.composRequests.status, ["done", "failed"])));
}

/** ¿Cuántos pedidos activos tiene el video? (para el tope de pedidos simultáneos; los en espera no cuentan). */
export async function activeCount(projectId: string): Promise<number> {
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(schema.composRequests)
    .where(and(eq(schema.composRequests.projectId, projectId), inArray(schema.composRequests.status, [...RUNNING])));
  return Number(r?.n ?? 0);
}

/**
 * Pasa a la cola los pedidos en espera, los más viejos primero, hasta llenar los activos. Se llama al crear una tanda,
 * cuando termina o se cancela un pedido y cada vez que el Estudio consulta (por si algo quedó sin pasar). Cada uno
 * entra con su reserva como un pedido nuevo; si no alcanza el tope, queda fallido con el aviso.
 */
export async function promoteWaiting(projectId: string, info?: { cap: number; spent: number }): Promise<number> {
  const db = getDb();
  const waiting = await db
    .select({ id: schema.composRequests.id, work: schema.composRequests.work, createdBy: schema.composRequests.createdBy })
    .from(schema.composRequests)
    .where(and(eq(schema.composRequests.projectId, projectId), eq(schema.composRequests.status, "waiting")))
    .orderBy(schema.composRequests.createdAt)
    .limit(MAX_ACTIVE);
  if (!waiting.length) return 0;
  const room = MAX_ACTIVE - (await activeCount(projectId));
  if (room <= 0) return 0;
  let money = info;
  if (!money) {
    const ctx = await loadWorkCtx(projectId);
    if (!ctx) return 0;
    money = { cap: ctx.cap, spent: ctx.spent };
  }
  const planOn = await claudePlanConnected().catch(() => false);
  let moved = 0;
  let running = MAX_ACTIVE - room;
  for (const row of waiting.slice(0, room)) {
    // Sin la suscripción, cada uno reserva del tope en USD: si ahora no alcanza, espera a que terminen los que corren
    // (liberan su reserva). Solo si no corre ninguno y aun así no alcanza, entra y queda fallido con el aviso.
    if (!planOn && running > 0) {
      const active = await db
        .select({ reserved: schema.composRequests.reservedUsd, used: schema.composRequests.usedUsd })
        .from(schema.composRequests)
        .where(and(eq(schema.composRequests.projectId, projectId), inArray(schema.composRequests.status, [...RUNNING])));
      const held = active.reduce((n, r) => n + Math.max(0, r.reserved - r.used), 0);
      if (!planReservation(money.cap - money.spent - held, true)) break;
    }
    // Se toma la fila (de "waiting" a "queued") antes de encolar: dos consultas a la vez no la encolan dos veces.
    const [taken] = await db
      .update(schema.composRequests)
      .set({ status: "queued" })
      .where(and(eq(schema.composRequests.id, row.id), eq(schema.composRequests.status, "waiting")))
      .returning({ id: schema.composRequests.id });
    if (!taken) continue;
    const saved = row.work as unknown as ComposWork;
    await db.delete(schema.composRequests).where(eq(schema.composRequests.id, row.id));
    const needsPlan = saved.tasks.some((t) => t.status === "plan");
    await enqueueRequest({
      projectId,
      userId: row.createdBy,
      cap: money.cap,
      spent: money.spent,
      needsPlan,
      build: (lookRounds) => ({ ...saved, lookRounds, startedAt: new Date().toISOString() }),
    });
    moved++;
    running++;
  }
  return moved;
}

