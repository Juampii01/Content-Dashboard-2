// Pruebas de la guía de primer uso (lib/home/onboarding.ts). Correr con: pnpm test:sistema
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOnboarding, type SetupProgress } from "../lib/home/onboarding";

const none: SetupProgress = { connected: false, brand: false, video: false, script: false, strategist: false, planned: false, dismissed: false };

test("instalación nueva: cinco pasos pendientes, empieza por conectar redes", () => {
  const o = buildOnboarding(none);
  assert.equal(o.total, 5);
  assert.equal(o.doneCount, 0);
  assert.equal(o.percent, 0);
  assert.equal(o.current, "connected");
  assert.equal(o.visible, true);
  assert.deepEqual(
    o.steps.map((s) => s.key),
    ["connected", "brand", "video", "script", "strategist"],
  );
  // Son unos 10 minutos en total.
  assert.equal(o.steps.reduce((n, s) => n + s.minutes, 0), 10);
});

test("el paso actual es el primero pendiente, aunque se hayan hecho otros fuera de orden", () => {
  const o = buildOnboarding({ ...none, connected: true, script: true });
  assert.equal(o.doneCount, 2);
  assert.equal(o.percent, 40);
  assert.equal(o.current, "brand");
  assert.deepEqual(
    o.steps.filter((s) => s.done).map((s) => s.key),
    ["connected", "script"],
  );
});

test("el calendario no cuenta como paso de la guía", () => {
  const o = buildOnboarding({ ...none, planned: true });
  assert.equal(o.doneCount, 0);
});

test("desaparece sola al completar los cinco pasos", () => {
  const o = buildOnboarding({ ...none, connected: true, brand: true, video: true, script: true, strategist: true });
  assert.equal(o.doneCount, 5);
  assert.equal(o.percent, 100);
  assert.equal(o.current, null);
  assert.equal(o.visible, false);
});

test("'Ya lo conozco' la oculta aunque falten pasos", () => {
  const o = buildOnboarding({ ...none, connected: true, dismissed: true });
  assert.equal(o.visible, false);
  assert.equal(o.current, "brand");
});

test("el paso del video ofrece también Clips", () => {
  const video = buildOnboarding(none).steps.find((s) => s.key === "video")!;
  assert.equal(video.primary.href, "/editor/nuevo");
  assert.equal(video.secondary?.href, "/editor/clips");
});
