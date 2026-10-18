#!/usr/bin/env node
/**
 * Prueba del webhook de HeyGen (/api/webhooks/heygen) contra la app en marcha y el servidor simulado.
 *
 * Requisitos: la app corriendo con HEYGEN_API_BASE apuntando al simulador (tests/mocks/heygen-mock.mjs)
 * y una API key de prueba guardada en Ajustes (así el simulador tiene el endpoint registrado con su secreto).
 *
 *   APP=http://localhost:3003 MOCK=http://localhost:4010 node tests/heygen-webhook.mjs
 *
 * Casos: bien firmado (200), repetido (200 duplicado, no se procesa dos veces), mal firmado (401),
 * cuerpo alterado después de firmar (401) y sin firma (400).
 */
import { createHmac, randomBytes } from "node:crypto";

const APP = process.env.APP ?? "http://localhost:3000";
const MOCK = process.env.MOCK ?? "http://localhost:4010";
const url = `${APP}/api/webhooks/heygen`;

const state = await (await fetch(`${MOCK}/__mock/state`)).json();
const endpoint = state.endpoints.find((e) => e.url === url);
if (!endpoint) {
  console.error(`No hay un webhook registrado para ${url} en el simulador. Guarda una API key de prueba en Ajustes y vuelve a correr.`);
  process.exit(1);
}

const videoId = state.videos.at(-1)?.id ?? `v_prueba_${randomBytes(4).toString("hex")}`;
const body = JSON.stringify({
  event_id: `evt_${randomBytes(4).toString("hex")}`,
  event_type: "avatar_video.success",
  event_data: { video_id: videoId, url: null, callback_id: null },
  created_at: new Date().toISOString(),
});
const sign = (raw, secret) => createHmac("sha256", secret).update(raw).digest("hex");
const post = (raw, headers) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: raw });

let failed = 0;
async function expect(name, res, status, check) {
  const json = await res.json().catch(() => ({}));
  const ok = res.status === status && (!check || check(json));
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}: ${res.status} ${JSON.stringify(json)}`);
}

await expect("bien firmado", await post(body, { signature: sign(body, endpoint.secret) }), 200, (j) => j.ok && !j.duplicate);
await expect("repetido", await post(body, { signature: sign(body, endpoint.secret) }), 200, (j) => j.duplicate === true);
await expect("mal firmado", await post(body, { signature: sign(body, "otro-secreto") }), 401);
await expect("cuerpo alterado", await post(body.replace("success", "fail"), { signature: sign(body, endpoint.secret) }), 401);
await expect("sin firma", await post(body, {}), 400);

console.log(failed ? `${failed} caso(s) fallaron.` : "Todos los casos pasaron.");
process.exit(failed ? 1 : 0);
