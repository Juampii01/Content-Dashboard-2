// Pruebas del armado del estado del sistema (lib/system/status.ts). Correr con: pnpm test:sistema
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemStatus,
  connectionAlertKey,
  connectionProblems,
  failStreakKey,
  failureViews,
  serviceViews,
  workerView,
  type ConnectionRow,
  type FailedJobRow,
  type ServicesInput,
  type WorkerInput,
} from "../lib/system/status";

const now = new Date("2026-10-22T15:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3_600_000);

const worker: WorkerInput = { online: true, lastSeen: ago(0), version: "1.4.0", autoStart: true, stuck: 0, secretConfigured: true };
const services: ServicesInput = {
  anthropic: true,
  resend: true,
  pexels: true,
  pixabay: false,
  storage: true,
  videoStorage: true,
  heygen: true,
  heygenWebhookError: null,
  openai: false,
  platformsConfigured: { INSTAGRAM: true, YOUTUBE: true, TIKTOK: true },
};
const conn = (over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  id: "c1",
  platform: "INSTAGRAM",
  handle: "marca",
  status: "ACTIVE",
  statusMessage: null,
  demo: false,
  lastSyncedAt: ago(2),
  refreshTokenExpiresAt: null,
  accessTokenExpiresAt: new Date(now.getTime() + 40 * 86_400_000),
  hasRefreshToken: false,
  lastRunFailed: false,
  lastRunError: null,
  ...over,
});
const job = (over: Partial<FailedJobRow> = {}): FailedJobRow => ({
  id: "j1",
  type: "VIDEO_ANALYZE",
  errorMessage: "No pudimos leer el audio del video.",
  finishedAt: ago(5),
  refId: "p1",
  refTitle: "Mi primer video",
  refStatus: "FAILED",
  ...over,
});

describe("worker", () => {
  test("encendido y sin cola: todo bien", () => {
    const w = workerView(worker);
    assert.equal(w.tone, "success");
    assert.equal(w.version, "1.4.0");
  });
  test("apagado con Fly configurado y sin trabajos: en reposo, no es un problema", () => {
    assert.equal(workerView({ ...worker, online: false }).tone, "neutral");
    assert.equal(workerView({ ...worker, online: false }).label, "En reposo");
  });
  test("apagado con trabajos esperando: problema", () => {
    const w = workerView({ ...worker, online: false, stuck: 2 });
    assert.equal(w.tone, "danger");
    assert.match(w.message, /2 trabajos esperando/);
  });
  test("sin WORKER_SECRET lo dice en claro, sin mostrar ningún valor", () => {
    const w = workerView({ ...worker, secretConfigured: false });
    assert.equal(w.tone, "danger");
    assert.match(w.message, /WORKER_SECRET/);
  });
});

describe("trabajos fallidos", () => {
  test("un aviso por proyecto, el más reciente, con su reintento", () => {
    const views = failureViews([job({ id: "a", finishedAt: ago(30) }), job({ id: "b", type: "VIDEO_RENDER", errorMessage: "Se cortó el render.", finishedAt: ago(1) })], []);
    assert.equal(views.length, 1);
    assert.equal(views[0]!.key, "job:b");
    assert.equal(views[0]!.message, "Se cortó el render.");
    assert.deepEqual(views[0]!.retry, { kind: "video", id: "p1" });
    assert.equal(views[0]!.href, "/editor/p1");
  });
  test("si ya se reintentó (el proyecto no está fallido), no aparece", () => {
    assert.equal(failureViews([job({ refStatus: "PROCESSING" })], []).length, 0);
    assert.equal(failureViews([job({ refStatus: null })], []).length, 0); // se borró
  });
  test("estilos, b-roll y clips tienen su reintento; carruseles se resuelven desde su página", () => {
    const views = failureViews(
      [
        job({ id: "s", type: "VIDEO_STYLE", refId: "st1", refTitle: "Como Hormozi" }),
        job({ id: "b", type: "VIDEO_CLIP", refId: "bc1", refTitle: "Toma de la oficina" }),
        job({ id: "l", type: "LONG_VIDEO_CLIPS", refId: "lv1", refTitle: "Podcast 12" }),
        job({ id: "c", type: "CAROUSEL_IMAGES", refId: "car1", refTitle: "5 errores", refStatus: null }),
        job({ id: "r", type: "CAROUSEL_IMAGES", refId: "car2", refTitle: "Ya salió", refStatus: "RECOVERED" }),
        job({ id: "g", type: "CAROUSEL_IMAGES", refId: "car3", refTitle: null, refStatus: null }), // carrusel borrado
      ],
      [],
    );
    const byKey = Object.fromEntries(views.map((v) => [v.key, v]));
    assert.equal(byKey["job:s"]!.retry?.kind, "style");
    assert.equal(byKey["job:b"]!.retry?.kind, "broll");
    assert.equal(byKey["job:l"]!.retry?.kind, "long");
    assert.equal(byKey["job:c"]!.retry, null);
    assert.equal(byKey["job:c"]!.href, "/carruseles/car1");
    assert.equal(byKey["job:r"], undefined);
    assert.equal(byKey["job:g"], undefined);
  });
  test("sin mensaje del worker, uno en español con qué hacer", () => {
    const [v] = failureViews([job({ errorMessage: "  " })], []);
    assert.match(v!.message, /Vuelve a intentarlo/);
  });
  test("clon: si ya llegó a HeyGen no se reintenta directo (volvería a cobrar)", () => {
    const views = failureViews([], [
      { id: "v1", title: "Clon A", errorMessage: null, updatedAt: ago(3), reachedHeyGen: true, retriedInto: null },
      { id: "v2", title: "Clon B", errorMessage: "Sin saldo", updatedAt: ago(2), reachedHeyGen: false, retriedInto: null },
      { id: "v3", title: "Clon C", errorMessage: null, updatedAt: ago(1), reachedHeyGen: true, retriedInto: "v9" },
    ]);
    assert.deepEqual(views.map((v) => v.key), ["clone:v2", "clone:v1"]);
    assert.deepEqual(views[0]!.retry, { kind: "clone", id: "v2" });
    assert.equal(views[1]!.retry, null);
  });
});

describe("conexiones", () => {
  test("activa y lejos de vencer: sin problemas; demo y desconectadas no cuentan", () => {
    assert.equal(connectionProblems([conn(), conn({ id: "d", demo: true, status: "EXPIRED" }), conn({ id: "x", status: "DISCONNECTED" })], now).length, 0);
  });
  test("vencida, sin permisos o con error piden reconectar", () => {
    const p = connectionProblems([conn({ status: "EXPIRED" }), conn({ id: "y", platform: "YOUTUBE", status: "MISSING_SCOPES" })], now);
    assert.equal(p.length, 2);
    assert.equal(p[0]!.reconnectHref, "/api/social/instagram/connect");
    assert.equal(p[1]!.label, "Faltan permisos");
  });
  test("token que vence en menos de 7 días y no se refresca solo: aviso", () => {
    const [p] = connectionProblems([conn({ accessTokenExpiresAt: new Date(now.getTime() + 3 * 86_400_000) })], now);
    assert.equal(p!.label, "Vence pronto");
    assert.match(p!.message, /3 días/);
  });
  test("con refresh token se mira el vencimiento del refresh, no del acceso", () => {
    const ok = conn({ hasRefreshToken: true, accessTokenExpiresAt: new Date(now.getTime() + 3_600_000), refreshTokenExpiresAt: new Date(now.getTime() + 300 * 86_400_000) });
    assert.equal(connectionProblems([ok], now).length, 0);
  });
});

describe("servicios", () => {
  test("todo configurado: sin problemas; stock opcional se dice como opcional", () => {
    const s = serviceViews({ ...services, pexels: false });
    const stock = s.find((x) => x.key === "stock")!;
    assert.equal(stock.tone, "neutral");
    assert.equal(stock.status, "Opcional");
    assert.ok(s.every((x) => x.tone !== "danger"));
  });
  test("falta Anthropic o el almacenamiento: problema serio, en lenguaje claro", () => {
    const s = serviceViews({ ...services, anthropic: false, videoStorage: false });
    assert.equal(s.find((x) => x.key === "anthropic")!.tone, "danger");
    assert.match(s.find((x) => x.key === "storage")!.message, /videos/);
  });
  test("apps de redes sin configurar se nombran", () => {
    const s = serviceViews({ ...services, platformsConfigured: { INSTAGRAM: true, YOUTUBE: false, TIKTOK: false } });
    assert.match(s.find((x) => x.key === "apps")!.message, /YouTube ni TikTok/);
  });
  test("ningún texto muestra un secreto", () => {
    const text = JSON.stringify(serviceViews({ ...services, resend: false, heygenWebhookError: "No pudimos registrar el webhook." }));
    assert.doesNotMatch(text, /sk-|re_|Bearer/);
  });
});

describe("resumen y avisos", () => {
  test("cuenta los problemas de todas las secciones", () => {
    const s = buildSystemStatus({ worker: { ...worker, online: false, stuck: 1 }, failedJobs: [job()], failedClones: [], connections: [conn({ status: "REVOKED" })], services: { ...services, resend: false }, now });
    assert.equal(s.problemCount, 4);
    const clean = buildSystemStatus({ worker, failedJobs: [], failedClones: [], connections: [conn()], services, now });
    assert.equal(clean.problemCount, 0);
  });
  test("aviso de conexión: una vez por problema, de nuevo si se arregla y se rompe otra vez", () => {
    const broken = conn({ status: "EXPIRED", lastSyncedAt: ago(30) });
    const k1 = connectionAlertKey(broken);
    assert.ok(k1);
    assert.equal(connectionAlertKey({ ...broken }), k1); // misma rotura, misma clave
    assert.notEqual(connectionAlertKey({ ...broken, lastSyncedAt: ago(1) }), k1); // sincronizó bien entre medio
    assert.equal(connectionAlertKey(conn()), null);
    assert.equal(connectionAlertKey(conn({ status: "EXPIRED", demo: true })), null);
  });
  test("racha del worker: avisa desde 3 fallos seguidos, atada al primero", () => {
    assert.equal(failStreakKey({ count: 2, firstFailedId: "a" }), null);
    assert.equal(failStreakKey({ count: 3, firstFailedId: "a" }), "system:worker-streak:a");
    assert.equal(failStreakKey({ count: 7, firstFailedId: "a" }), "system:worker-streak:a");
    assert.equal(failStreakKey({ count: 0, firstFailedId: null }), null);
  });
});
