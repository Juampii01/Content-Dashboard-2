/**
 * Varias animaciones a la vez (pedidos del Estudio): reserva del tope, capas de lo que llega junto y, con una base de
 * prueba, pedidos simultáneos que avanzan sin pisarse (cada uno escribe solo su fila) y sin tocar el plan.
 *   pnpm test:pedidos                                  (sin base: solo lo que no la necesita)
 *   TEST_DATABASE_URL=postgres://... pnpm test:pedidos  (necesita el video de prueba del Estudio en esa base)
 * El bloque con base crea y borra sus propios pedidos y trabajos.
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { nextLayer } from "../lib/video/layers";

describe("capas de lo que llega junto", () => {
  test("cada animación nueva cae en la siguiente capa libre, encima de lo que se le superpone", () => {
    const items: { start: number; end: number; layer?: number }[] = [{ start: 0, end: 5, layer: 0 }];
    const a = nextLayer(items, { start: 1, end: 4 });
    assert.equal(a, 1);
    items.push({ start: 1, end: 4, layer: a });
    const b = nextLayer(items, { start: 2, end: 6 });
    assert.equal(b, 2);
    items.push({ start: 2, end: 6, layer: b });
    assert.equal(nextLayer(items, { start: 3, end: 3.5 }), 3);
    // Lo que no se pisa con nada queda en la capa 0.
    assert.equal(nextLayer(items, { start: 10, end: 12 }), undefined);
    // Solo tocarse en el borde no es pisarse.
    assert.equal(nextLayer(items, { start: 6, end: 8 }), undefined);
  });
});

const url = process.env.TEST_DATABASE_URL;
const PID = process.env.TEST_PROJECT_ID ?? "07f5caf8-af10-4adc-a759-7dc45f5875a3";

describe("pedidos contra la base", { skip: !url && "TEST_DATABASE_URL no está definida" }, async () => {
  if (!url) return;
  Object.assign(process.env, {
    DATABASE_URL: url,
    DATABASE_URL_UNPOOLED: url,
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "x".repeat(40),
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    CRON_SECRET: "y".repeat(40),
    APP_TIMEZONE: "America/Mexico_City",
    AI_FAKE: "1",
  });
  const { getDb, schema } = await import("../lib/db");
  const { and, eq, inArray, sql } = await import("drizzle-orm");
  const { planReservation, requestEstimate, listRequests, cancelRequest, ackRequests } = await import("../lib/video/compos/requests");
  const { startStudioRequest } = await import("../lib/video/compos/flows");
  const { advanceWork } = await import("../lib/video/compos/work");
  const db = getDb();
  const [project] = await db.select().from(schema.videoProjects).where(eq(schema.videoProjects.id, PID)).limit(1);
  if (!project) {
    test("sin el video de prueba", { skip: `no está el proyecto ${PID}` }, () => undefined);
    return;
  }
  const planBefore = JSON.stringify(project.plan);
  const statusBefore = project.status;
  const budgetBefore = project.aiBudgetUsd;
  const made: string[] = [];
  await db.update(schema.videoProjects).set({ status: "AWAITING_REVIEW", aiBudgetUsd: 30 }).where(eq(schema.videoProjects.id, PID));

  after(async () => {
    if (made.length) {
      await db.delete(schema.composRequests).where(inArray(schema.composRequests.id, made));
      await db.delete(schema.jobs).where(and(eq(schema.jobs.type, "VIDEO_COMPOS"), inArray(sql`${schema.jobs.input}->>'workId'`, made)));
    }
    await db.update(schema.videoProjects).set({ status: statusBefore, aiBudgetUsd: budgetBefore }).where(eq(schema.videoProjects.id, PID));
  });

  test("la reserva elige las vueltas que alcanzan y no reserva lo que no hay", () => {
    assert.deepEqual(planReservation(10, true), { lookRounds: 2, reserved: requestEstimate({ plan: true, lookRounds: 2 }) });
    assert.equal(planReservation(1.5, true)?.lookRounds, 1);
    assert.equal(planReservation(0.7, true)?.lookRounds, 0);
    assert.equal(planReservation(0.1, true), null);
  });

  test("tres pedidos a la vez sobre tramos que se pisan: tres filas, tres trabajos, ningún bloqueo", async () => {
    const reqs = await Promise.all(
      [
        { from_word: 10, to_word: 20, instruction: "Una tarjeta con la cifra que gira" },
        { from_word: 14, to_word: 24, instruction: "Un subrayado que se dibuja" },
        { from_word: 12, to_word: 22, instruction: "Lista que aparece al nombrar cada cosa" },
      ].map((r) => startStudioRequest(PID, { ...r, replace: null }, null)),
    );
    for (const r of reqs) {
      made.push(r.workId);
      assert.equal(r.error, null);
    }
    assert.equal(new Set(reqs.map((r) => r.workId)).size, 3);
    const rows = await db.select().from(schema.composRequests).where(inArray(schema.composRequests.id, made));
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => r.status === "queued" && r.reservedUsd > 0 && r.jobId));
    const jobs = await db.select().from(schema.jobs).where(inArray(schema.jobs.id, rows.map((r) => r.jobId!)));
    assert.equal(jobs.length, 3);
  });

  test("el tope se reparte entre los pedidos: el que no alcanza queda fallido con el aviso y no frena a los demás", async () => {
    const [{ held }] = await db.execute<{ held: number }>(sql`select coalesce(sum(reserved_usd - used_usd), 0)::float as held from compos_requests where project_id = ${PID} and status in ('queued','running')`).then((r) => r.rows as { held: number }[]);
    const { spentOn } = await import("../lib/video/compos/work");
    const spent = await spentOn(PID);
    // Un tope que alcanza justo para lo reservado: el próximo pedido no entra.
    await db.update(schema.videoProjects).set({ aiBudgetUsd: Math.max(0.5, spent + held + 0.05) }).where(eq(schema.videoProjects.id, PID));
    const r = await startStudioRequest(PID, { from_word: 30, to_word: 36, instruction: "Una palabra gigante detrás", replace: null }, null);
    made.push(r.workId);
    assert.match(r.error ?? "", /tope de IA/);
    const [row] = await db.select().from(schema.composRequests).where(eq(schema.composRequests.id, r.workId));
    assert.equal(row!.status, "failed");
    await db.update(schema.videoProjects).set({ aiBudgetUsd: 30 }).where(eq(schema.videoProjects.id, PID));
    // Los otros tres siguen en cola.
    const active = (await listRequests(PID)).filter((x) => made.includes(x.id) && x.status === "queued");
    assert.equal(active.length, 3);
  });

  test("avanzan a la vez sin pisarse: cada paso escribe solo su fila y el plan no cambia", async () => {
    const ids = made.slice(0, 3);
    // Pasos simultáneos de los tres, hasta que terminen (respuestas simuladas; los cuadros de revisión se saltean).
    for (let round = 0; round < 12; round++) {
      const res = await Promise.all(
        ids.map(async (id) => {
          const [row] = await db.select({ status: schema.composRequests.status }).from(schema.composRequests).where(eq(schema.composRequests.id, id));
          if (row!.status !== "queued" && row!.status !== "running") return true;
          const r = await advanceWork(PID, { step: "compos", workId: id });
          if (r.next?.step === "compos-stills") await advanceWork(PID, { step: "compos-look", sheets: [], workId: id });
          return r.finished;
        }),
      );
      if (res.every(Boolean)) break;
    }
    const rows = await db.select().from(schema.composRequests).where(inArray(schema.composRequests.id, ids));
    for (const r of rows) {
      assert.equal(r.status, "done", `${r.id}: ${r.error ?? ""}`);
      const work = r.work as { id: string; tasks: { result?: { id: string } }[]; usedUsd?: number };
      assert.equal(work.id, r.id, "cada fila tiene su propio taller");
      assert.ok(work.tasks[0]?.result, "con su animación");
      assert.ok((work.usedUsd ?? 0) > 0 && r.usedUsd > 0, "con lo que gastó");
    }
    // Animaciones distintas y el plan intacto (la entrega la hace el Estudio sobre su estado actual).
    assert.equal(new Set(rows.map((r) => (r.work as { tasks: { result?: { id: string } }[] }).tasks[0]!.result!.id)).size, 3);
    const [now] = await db.select({ plan: schema.videoProjects.plan }).from(schema.videoProjects).where(eq(schema.videoProjects.id, PID));
    assert.equal(JSON.stringify(now!.plan), planBefore);
    // Para el Estudio: terminados y sin entregar, con su animación; entregados, ya no aparecen.
    const listed = (await listRequests(PID)).filter((x) => ids.includes(x.id));
    assert.equal(listed.length, 3);
    assert.ok(listed.every((x) => x.status === "done" && x.made.length === 1));
    await ackRequests(PID, ids);
    assert.equal((await listRequests(PID)).filter((x) => ids.includes(x.id)).length, 0);
  });

  test("cancelar: el pedido en cola no corre y su trabajo se cancela", async () => {
    const r = await startStudioRequest(PID, { from_word: 40, to_word: 46, instruction: "Un contador que sube", replace: null }, null);
    made.push(r.workId);
    assert.ok(await cancelRequest(PID, r.workId));
    const [row] = await db.select().from(schema.composRequests).where(eq(schema.composRequests.id, r.workId));
    assert.equal(row!.status, "canceled");
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, row!.jobId!));
    assert.equal(job!.status, "CANCELED");
    assert.equal((await advanceWork(PID, { step: "compos", workId: r.workId })).finished, true);
    assert.equal(await cancelRequest(PID, r.workId), false);
  });
});
