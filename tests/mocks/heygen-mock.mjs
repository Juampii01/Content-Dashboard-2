#!/usr/bin/env node
/**
 * Servidor simulado de la API v3 de HeyGen para probar el módulo "Videos con clon" sin red ni saldo real.
 * Imita las formas de respuesta documentadas en developers.heygen.com (18-oct-2026).
 *
 * Uso:
 *   node tests/mocks/heygen-mock.mjs            # puerto 4010 (HEYGEN_MOCK_PORT para cambiarlo)
 *   HEYGEN_API_BASE=http://localhost:4010 pnpm dev
 *
 * API keys de prueba:
 *   hg_test_valida_00000000001234   billetera con US$ 25
 *   hg_test_pobre_000000000005678   billetera con US$ 0.40 (para probar "saldo insuficiente")
 *   hg_test_creditos_0000000009999  billetera en créditos (300)
 *   cualquier otra                  401 (key inválida)
 *
 * Trucos en el texto del video: "[falla]" → el video termina en failed; "[limite]" → el primer POST devuelve 429.
 * Variables: MOCK_RENDER_MS (por defecto 7000), MOCK_WEBHOOKS=0 (no manda webhooks), MOCK_REJECT_HTTP=1
 * (rechaza registrar webhooks que no sean https, como hace HeyGen con localhost).
 * Depuración: GET /__mock/state (endpoints con su secreto y videos), POST /__mock/reset,
 * POST /__mock/revoke {"apiKey": "..."} (simula una key revocada).
 */
import { createServer } from "node:http";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, statSync, createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.HEYGEN_MOCK_PORT ?? 4010);
const BASE = `http://localhost:${PORT}`;
const RENDER_MS = Number(process.env.MOCK_RENDER_MS ?? 7000);
const SEND_WEBHOOKS = process.env.MOCK_WEBHOOKS !== "0";
const REJECT_HTTP = process.env.MOCK_REJECT_HTTP === "1";

// ─── Archivos de prueba (generados con ffmpeg) ─────────────────────────────
const dir = mkdtempSync(join(tmpdir(), "heygen-mock-"));
const files = { mp4: join(dir, "video.mp4"), jpg: join(dir, "thumb.jpg"), mp3: join(dir, "voice.mp3") };
function ffmpeg(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}
ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=360x640:rate=25:duration=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", files.mp4]);
ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=360x640", "-frames:v", "1", files.jpg]);
ffmpeg(["-f", "lavfi", "-i", "sine=frequency=330:duration=2", "-c:a", "libmp3lame", files.mp3]);

// ─── Datos ────────────────────────────────────────────────────────────────
const RATES = { avatar_iii: 0.6, avatar_iv: 4.83, avatar_v: 7.2 };
function freshAccounts() {
  return {
    hg_test_valida_00000000001234: { username: "user_valida", email: "clon@example.com", first_name: "Juampi", last_name: "Prueba", wallet: { currency: "usd", remaining_balance: 25 } },
    hg_test_pobre_000000000005678: { username: "user_pobre", email: "pobre@example.com", first_name: "Sin", last_name: "Saldo", wallet: { currency: "usd", remaining_balance: 0.4 } },
    hg_test_creditos_0000000009999: { username: "user_creditos", email: "creditos@example.com", first_name: "Con", last_name: "Créditos", wallet: { currency: "credits", remaining_balance: 300 } },
  };
}
let accounts = freshAccounts();
let videos = new Map(); // video_id → video
let endpoints = new Map(); // endpoint_id → { apiKey, url, events, secret }
let idempotency = new Map(); // apiKey:key → { status, body }
let limited = new Set();

const ENGINES_ALL = ["avatar_iii", "avatar_iv", "avatar_v"];
const privateLooks = [
  { id: "look_juampi_oficina", name: "Juampi · Oficina", avatar_type: "digital_twin", group_id: "group_juampi", gender: "male", default_voice_id: "voz_clon_juampi", tags: ["business"], supported_api_engines: ENGINES_ALL, status: "completed" },
  { id: "look_juampi_estudio", name: "Juampi · Estudio", avatar_type: "digital_twin", group_id: "group_juampi", gender: "male", default_voice_id: "voz_clon_juampi", tags: [], supported_api_engines: ENGINES_ALL, status: "processing" },
  { id: "look_juampi_foto", name: "Juampi · Foto", avatar_type: "photo_avatar", group_id: "group_juampi_foto", gender: "male", default_voice_id: null, tags: [], supported_api_engines: ["avatar_iv", "avatar_v"], status: "completed" },
];
const publicLooks = Array.from({ length: 30 }, (_, i) => ({
  id: `look_public_${i + 1}`,
  name: `${["Ana", "Luis", "Marta", "Diego", "Sofía", "Pablo"][i % 6]} · ${["Casual", "Oficina", "Estudio", "Calle", "Podcast"][i % 5]}`,
  avatar_type: "studio_avatar",
  group_id: `group_public_${Math.floor(i / 5)}`,
  gender: i % 2 ? "male" : "female",
  default_voice_id: `voz_publica_${(i % 10) + 1}`,
  tags: ["casual"],
  supported_api_engines: i % 7 === 0 ? ["avatar_iii", "avatar_iv"] : ENGINES_ALL,
}));
const privateVoices = [{ voice_id: "voz_clon_juampi", name: "Juampi (clon)", language: "Spanish", gender: "male", support_pause: true, support_locale: true, type: "private" }];
const publicVoices = Array.from({ length: 35 }, (_, i) => ({
  voice_id: `voz_publica_${i + 1}`,
  name: `${["Valentina", "Mateo", "Camila", "Santiago", "Lucía", "Andrés", "Isabella"][i % 7]} ${i + 1}`,
  language: "Spanish",
  gender: i % 2 ? "male" : "female",
  support_pause: true,
  support_locale: true,
  type: "public",
}));

const withPreview = (look) => ({ ...look, preview_image_url: `${BASE}/files/look/${look.id}.svg`, preview_video_url: null });
const withAudio = (voice) => ({ ...voice, preview_audio_url: `${BASE}/files/voice/${voice.voice_id}.mp3` });

// ─── Utilidades ───────────────────────────────────────────────────────────
function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "X-HeyGen-Request-Id": randomUUID(), ...headers });
  res.end(JSON.stringify(body));
}
function error(res, status, code, message, headers) {
  send(res, status, { error: { code, message, param: null, doc_url: null, request_id: randomUUID() } }, headers);
}
async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return null;
  }
}
function paginate(list, url) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
  const token = url.searchParams.get("token");
  const start = token ? Number(Buffer.from(token, "base64url").toString()) : 0;
  const data = list.slice(start, start + limit);
  const next = start + limit;
  const hasMore = next < list.length;
  return { data, has_more: hasMore, next_token: hasMore ? Buffer.from(String(next)).toString("base64url") : null };
}
function words(text) {
  return String(text ?? "").split(/\s+/).filter(Boolean).length;
}
function avatarSvg(id) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  const label = id.replace(/^look_/, "").split("_").map((p) => p[0]?.toUpperCase() ?? "").join("").slice(0, 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hash},55%,42%)"/><stop offset="1" stop-color="hsl(${(hash + 40) % 360},60%,18%)"/></linearGradient></defs><rect width="300" height="400" fill="url(#g)"/><circle cx="150" cy="150" r="62" fill="rgba(255,255,255,.85)"/><rect x="60" y="230" width="180" height="170" rx="80" fill="rgba(255,255,255,.85)"/><text x="150" y="166" font-family="sans-serif" font-size="44" font-weight="700" text-anchor="middle" fill="hsl(${hash},50%,30%)">${label}</text></svg>`;
}
function serveFile(req, res, path, type) {
  const size = statSync(path).size;
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" });
    createReadStream(path, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
  createReadStream(path).pipe(res);
}

function videoView(v) {
  const now = Date.now();
  const elapsed = now - v.createdMs;
  const status = v.final ?? (elapsed < 2000 ? "pending" : elapsed < RENDER_MS ? "processing" : v.fail ? "failed" : "completed");
  const done = status === "completed";
  return {
    id: v.id,
    title: v.title ?? null,
    status,
    created_at: Math.floor(v.createdMs / 1000),
    completed_at: done ? Math.floor((v.createdMs + RENDER_MS) / 1000) : null,
    video_url: done ? `${BASE}/files/video/${v.id}.mp4?X-Amz-Expires=3600` : null,
    thumbnail_url: done ? `${BASE}/files/thumb/${v.id}.jpg` : null,
    gif_url: null,
    captioned_video_url: done && v.captions ? `${BASE}/files/video/${v.id}_captioned.mp4` : null,
    subtitle_url: done ? `${BASE}/files/srt/${v.id}.srt` : null,
    duration: done ? v.duration : null,
    folder_id: null,
    output_language: null,
    failure_code: status === "failed" ? "avatar_moderation_failed" : null,
    failure_message: status === "failed" ? "The avatar failed content moderation." : null,
    video_page_url: `https://app.heygen.com/videos/${v.id}`,
  };
}

// Pasa los videos a su estado final, cobra y manda el webhook firmado.
setInterval(async () => {
  for (const v of videos.values()) {
    if (v.final) continue;
    const view = videoView(v);
    if (view.status !== "completed" && view.status !== "failed") continue;
    v.final = view.status;
    if (view.status === "completed") {
      const account = accounts[v.apiKey];
      const cost = (v.duration / 60) * RATES[v.engine] * (v.resolution === "1080p" ? 3 : 1);
      if (account?.wallet) account.wallet.remaining_balance = Math.max(0, Math.round((account.wallet.remaining_balance - cost) * 100) / 100);
    }
    if (!SEND_WEBHOOKS) continue;
    for (const ep of endpoints.values()) {
      if (ep.apiKey !== v.apiKey) continue;
      const type = view.status === "completed" ? "avatar_video.success" : "avatar_video.fail";
      if (ep.events && !ep.events.includes(type)) continue;
      const body = JSON.stringify({
        event_id: `evt_${randomBytes(6).toString("hex")}`,
        event_type: type,
        event_data:
          type === "avatar_video.success"
            ? { video_id: v.id, url: view.video_url, gif_download_url: null, video_page_url: view.video_page_url, video_share_page_url: null, folder_id: null, callback_id: v.callbackId ?? null }
            : { video_id: v.id, msg: view.failure_message, callback_id: v.callbackId ?? null },
        created_at: new Date().toISOString(),
      });
      const signature = createHmac("sha256", ep.secret).update(body).digest("hex");
      try {
        const r = await fetch(ep.url, { method: "POST", headers: { "Content-Type": "application/json", signature }, body });
        console.log(`[mock] webhook ${type} ${v.id} → ${r.status}`);
      } catch (e) {
        console.log(`[mock] webhook ${type} ${v.id} falló: ${e.message}`);
      }
    }
  }
}, 500);

// ─── Rutas ────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  const path = url.pathname;
  const method = req.method;
  if (path !== "/__mock/state") console.log(`[mock] ${method} ${path}${url.search}`);

  // Archivos (sin key: como las URLs firmadas)
  let m;
  if ((m = path.match(/^\/files\/video\/[\w-]+\.mp4$/))) return serveFile(req, res, files.mp4, "video/mp4");
  if ((m = path.match(/^\/files\/thumb\/[\w-]+\.jpg$/))) return serveFile(req, res, files.jpg, "image/jpeg");
  if ((m = path.match(/^\/files\/voice\/[\w-]+\.mp3$/))) return serveFile(req, res, files.mp3, "audio/mpeg");
  if ((m = path.match(/^\/files\/look\/([\w-]+)\.svg$/))) {
    res.writeHead(200, { "Content-Type": "image/svg+xml" });
    return res.end(avatarSvg(m[1]));
  }
  if ((m = path.match(/^\/files\/srt\/([\w-]+)\.srt$/))) {
    const v = videos.get(m[1]);
    const text = v?.script ?? "Hola";
    res.writeHead(200, { "Content-Type": "application/x-subrip" });
    return res.end(`1\n00:00:00,000 --> 00:00:04,000\n${text.slice(0, 80)}\n`);
  }

  // Depuración
  if (path === "/__mock/state") return send(res, 200, { endpoints: [...endpoints.entries()].map(([id, e]) => ({ endpoint_id: id, ...e })), videos: [...videos.values()].map(videoView), accounts });
  if (path === "/__mock/reset" && method === "POST") {
    accounts = freshAccounts();
    videos = new Map();
    endpoints = new Map();
    idempotency = new Map();
    limited = new Set();
    return send(res, 200, { ok: true });
  }

  if (path === "/__mock/revoke" && method === "POST") {
    const body = await readJson(req);
    delete accounts[body?.apiKey];
    return send(res, 200, { ok: true });
  }

  // Autenticación
  const apiKey = req.headers["x-api-key"];
  const account = typeof apiKey === "string" ? accounts[apiKey] : null;
  if (!account) return error(res, 401, "unauthorized", "Invalid or expired API key. Verify your x-api-key header.");

  if (path === "/v3/users/me" && method === "GET") return send(res, 200, { data: { ...account, billing_type: "wallet", subscription: null, usage_based: null } });

  if (path === "/v3/avatars/looks" && method === "GET") {
    const ownership = url.searchParams.get("ownership");
    const list = ownership === "private" ? privateLooks : ownership === "public" ? publicLooks : [...privateLooks, ...publicLooks];
    return send(res, 200, paginate(list.map(withPreview), url));
  }

  if (path === "/v3/voices" && method === "GET") {
    const type = url.searchParams.get("type") ?? "public";
    const language = url.searchParams.get("language");
    let list = type === "private" ? privateVoices : publicVoices;
    if (language) list = list.filter((v) => v.language === language);
    return send(res, 200, paginate(list.map(withAudio), url));
  }

  if (path === "/v3/videos" && method === "POST") {
    const idemKey = req.headers["idempotency-key"];
    const memo = idemKey ? idempotency.get(`${apiKey}:${idemKey}`) : null;
    const body = await readJson(req);
    if (memo) return send(res, memo.status, memo.body);
    if (!body || body.type !== "avatar") return error(res, 400, "invalid_parameter", "type must be avatar");
    if (!body.avatar_id) return error(res, 400, "invalid_parameter", "Exactly one visual source required: avatar_id, image_url, or image_asset_id.");
    if (!body.script || !body.voice_id) return error(res, 400, "invalid_parameter", "script and voice_id are required");
    const look = [...privateLooks, ...publicLooks].find((l) => l.id === body.avatar_id);
    if (!look) return error(res, 404, "not_found", "Avatar not found");
    if (look.status === "processing") return error(res, 409, "resource_not_ready", "Avatar is still processing");
    const engine = body.engine?.type ?? "avatar_iv";
    if (!look.supported_api_engines.includes(engine)) return error(res, 400, "invalid_parameter", `engine ${engine} not supported for this avatar`);
    if (String(body.script).includes("[limite]") && !limited.has(idemKey)) {
      limited.add(idemKey);
      return error(res, 429, "rate_limit_exceeded", "Too many requests", { "Retry-After": "1" });
    }
    if ((account.wallet?.remaining_balance ?? 0) <= 0) return error(res, 402, "insufficient_credit", "Insufficient credit balance");
    const id = `v_${randomBytes(8).toString("hex")}`;
    const speed = body.voice_settings?.speed ?? 1;
    videos.set(id, {
      id,
      apiKey,
      title: body.title,
      script: body.script,
      engine,
      resolution: body.resolution ?? "720p",
      captions: Boolean(body.caption?.style),
      callbackId: body.callback_id ?? null,
      duration: Math.max(1, Math.round(((words(body.script) / 150) * 60) / speed * 10) / 10),
      fail: String(body.script).includes("[falla]"),
      createdMs: Date.now(),
      final: null,
    });
    const response = { status: 200, body: { data: { video_id: id, status: "waiting", output_format: "mp4" } } };
    if (idemKey) idempotency.set(`${apiKey}:${idemKey}`, response);
    return send(res, response.status, response.body);
  }

  if ((m = path.match(/^\/v3\/videos\/([\w-]+)$/)) && method === "GET") {
    const v = videos.get(m[1]);
    if (!v || v.apiKey !== apiKey) return error(res, 404, "not_found", "Video not found");
    return send(res, 200, { data: videoView(v) });
  }

  if (path === "/v3/webhooks/endpoints" && method === "POST") {
    const body = await readJson(req);
    if (!body?.url) return error(res, 400, "invalid_parameter", "url is required");
    if (REJECT_HTTP && !String(body.url).startsWith("https://")) return error(res, 400, "invalid_parameter", "url must be a public https URL");
    const id = `ep_${randomBytes(6).toString("hex")}`;
    const secret = `whsec_${randomBytes(24).toString("hex")}`;
    endpoints.set(id, { apiKey, url: body.url, events: body.events ?? null, secret });
    return send(res, 200, { data: { endpoint_id: id, url: body.url, events: body.events ?? null, status: "active", created_at: new Date().toISOString(), secret } });
  }
  if (path === "/v3/webhooks/endpoints" && method === "GET") {
    const list = [...endpoints.entries()].filter(([, e]) => e.apiKey === apiKey).map(([id, e]) => ({ endpoint_id: id, url: e.url, events: e.events, status: "active", secret: null }));
    return send(res, 200, paginate(list, url));
  }
  if ((m = path.match(/^\/v3\/webhooks\/endpoints\/([\w-]+)$/)) && method === "DELETE") {
    const ep = endpoints.get(m[1]);
    if (!ep || ep.apiKey !== apiKey) return error(res, 404, "webhook_not_found", "Webhook endpoint not found");
    endpoints.delete(m[1]);
    return send(res, 200, { data: {} });
  }

  return error(res, 404, "not_found", `No route for ${method} ${path}`);
});

if (!existsSync(files.mp4)) throw new Error("ffmpeg no generó el video de prueba");
server.listen(PORT, () => console.log(`[mock] HeyGen v3 simulado en ${BASE} (render ${RENDER_MS} ms, webhooks ${SEND_WEBHOOKS ? "sí" : "no"})`));
