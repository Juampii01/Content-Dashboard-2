/**
 * Simulador local de la API de Jamendo (v3.0), para probar el catálogo de música sin red.
 *
 *   node tests/mocks/jamendo-mock.mjs --port 4107
 *
 * Responde GET /v3.0/tracks/ con la forma de la API real (headers + results) y mezcla licencias: CC BY (se aceptan),
 * BY-NC, BY-ND y BY-SA (la app las descarta). `client_id=malo` responde el error de credenciales. Sirve el audio en
 * /audio/<id>.mp3 (un tono de 6 s; la app lo guarda tal cual). En la app: JAMENDO_API_BASE=http://localhost:4107/v3.0.
 */
import { createServer } from "node:http";

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1] || 4107);
const base = `http://localhost:${port}`;

const LICENSES = ["https://creativecommons.org/licenses/by/4.0/", "https://creativecommons.org/licenses/by-nc/3.0/", "https://creativecommons.org/licenses/by/3.0/", "https://creativecommons.org/licenses/by-nd/4.0/", "https://creativecommons.org/licenses/by-sa/4.0/"];
const TRACKS = Array.from({ length: 10 }, (_, i) => ({
  id: String(1500 + i),
  name: ["Sunrise Drive", "Quiet Hours", "Paper Planes", "Night Shift", "Open Road", "Coffee Talk", "Bright Side", "Low Tide", "Momentum", "Glass City"][i],
  duration: 120 + i * 7,
  artist_name: ["Lumen", "Okra", "Vela Sound", "Mar Azul", "Duna"][i % 5],
  audio: `${base}/audio/${1500 + i}.mp3`,
  audiodownload: `${base}/audio/${1500 + i}.mp3`,
  audiodownload_allowed: i !== 2,
  license_ccurl: LICENSES[i % LICENSES.length],
  shareurl: `https://www.jamendo.com/track/${1500 + i}`,
  image: "",
  musicinfo: { tags: { genres: [["lounge", "pop", "electronic", "acoustic", "cinematic"][i % 5]], vartags: ["positive"] } },
}));

/** Un WAV de 6 s (la app no lo decodifica: lo guarda y el worker lo lee con ffmpeg). */
function tone(seconds = 6, sr = 22050) {
  const n = seconds * sr;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / sr) * 8000 * Math.min(1, i / 2000)), 44 + i * 2);
  return buf;
}
const AUDIO = tone();

createServer((req, res) => {
  const url = new URL(req.url, base);
  if (url.pathname.startsWith("/audio/")) {
    res.writeHead(200, { "content-type": "audio/mpeg", "content-length": AUDIO.length });
    return res.end(AUDIO);
  }
  if (url.pathname.replace(/\/$/, "") === "/v3.0/tracks") {
    const json = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.searchParams.get("client_id") === "malo") return json(200, { headers: { status: "failed", code: 5, error_message: "Your credential is not authorized." }, results: [] });
    let list = TRACKS;
    const id = url.searchParams.get("id");
    if (id) list = TRACKS.filter((t) => t.id === id);
    const q = (url.searchParams.get("search") || "").toLowerCase();
    if (q) list = list.filter((t) => `${t.name} ${t.artist_name} ${t.musicinfo.tags.genres.join(" ")}`.toLowerCase().includes(q) || q.length < 3);
    if (url.searchParams.get("ccnc") === "false") list = list.filter((t) => !t.license_ccurl.includes("-nc"));
    if (url.searchParams.get("ccnd") === "false") list = list.filter((t) => !t.license_ccurl.includes("-nd"));
    // El simulador ignora ccsa a propósito: la app tiene que descartar la BY-SA sola.
    const limit = Number(url.searchParams.get("limit") || 10);
    return json(200, { headers: { status: "success", code: 0, results_count: list.length }, results: list.slice(0, limit) });
  }
  res.writeHead(404);
  res.end();
}).listen(port, () => console.log(`Jamendo simulado en ${base}/v3.0`));
