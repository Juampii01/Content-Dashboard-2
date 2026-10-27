/**
 * Simulador local de la API de videos de Pexels, para probar el b-roll sin red.
 *
 *   node tests/mocks/pexels-mock.mjs --port 4105 --dir <carpeta con pexels-N.mp4, pexels-N-sd.mp4 y pexels-N.jpg>
 *
 * Responde GET /videos/search (con la misma forma que la API real: videos[] con user, image y video_files[])
 * y sirve los archivos en /files/… y /img/…. Exige la cabecera Authorization (cualquier valor no vacío; "mala"
 * responde 401) y cuenta las búsquedas en GET /__stats. En la app: PEXELS_API_KEY=… y
 * PEXELS_API_BASE=http://localhost:4105; en el worker, BROLL_EXTRA_HOSTS=localhost.
 */
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const port = Number(arg("port", "4105"));
const dir = path.resolve(arg("dir", "."));
const base = `http://localhost:${port}`;
const stats = { searches: 0, queries: [] };

const ids = readdirSync(dir)
  .map((f) => f.match(/^pexels-(\d+)\.mp4$/)?.[1])
  .filter(Boolean)
  .map(Number)
  .sort((a, b) => a - b);
const AUTHORS = ["Ana Pérez", "Luis Gómez", "Marta Ruiz", "Diego Sosa"];

function video(id, orientation) {
  const portrait = orientation !== "landscape";
  const [w, h] = portrait ? [1080, 1920] : [1920, 1080];
  return {
    id: 9000 + id,
    width: w,
    height: h,
    url: `https://www.pexels.com/video/clip-de-prueba-${9000 + id}/`,
    image: `${base}/img/pexels-${id}.jpg`,
    duration: 6,
    user: { id: 100 + id, name: AUTHORS[(id - 1) % AUTHORS.length], url: `https://www.pexels.com/@autor${id}` },
    video_files: [
      { id: id * 10 + 1, quality: "sd", file_type: "video/mp4", width: portrait ? 360 : 640, height: portrait ? 640 : 360, fps: 25, link: `${base}/files/pexels-${id}-sd.mp4` },
      { id: id * 10 + 2, quality: "hd", file_type: "video/mp4", width: portrait ? 1080 : 1920, height: portrait ? 1920 : 1080, fps: 25, link: `${base}/files/pexels-${id}.mp4` },
    ],
    video_pictures: [{ id: id * 10, nr: 0, picture: `${base}/img/pexels-${id}.jpg` }],
  };
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function serveFile(res, file, type) {
  if (!existsSync(file)) return send(res, 404, { error: "no existe" });
  res.writeHead(200, { "content-type": type, "content-length": statSync(file).size, "access-control-allow-origin": "*" });
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", base);
  if (url.pathname === "/__stats") return send(res, 200, stats);
  if (url.pathname.startsWith("/files/")) return serveFile(res, path.join(dir, path.basename(url.pathname)), "video/mp4");
  if (url.pathname.startsWith("/img/")) return serveFile(res, path.join(dir, path.basename(url.pathname)), "image/jpeg");
  if (url.pathname === "/videos/search") {
    const auth = req.headers.authorization ?? "";
    if (!auth || auth === "mala") return send(res, 401, { error: "Unauthorized" });
    const query = url.searchParams.get("query") ?? "";
    stats.searches += 1;
    stats.queries.push(query);
    const perPage = Math.min(15, Number(url.searchParams.get("per_page") ?? 15));
    // Resultados distintos según la búsqueda (se rotan los clips), como haría la API real.
    const shift = [...query].reduce((n, c) => n + c.charCodeAt(0), 0) % Math.max(1, ids.length);
    const order = [...ids.slice(shift), ...ids.slice(0, shift)];
    const videos = order.slice(0, perPage).map((id) => video(id, url.searchParams.get("orientation")));
    return send(res, 200, { page: 1, per_page: perPage, total_results: videos.length, url: `https://www.pexels.com/search/videos/${encodeURIComponent(query)}/`, videos });
  }
  send(res, 404, { error: "no existe" });
}).listen(port, () => console.log(`Pexels simulado en ${base} con ${ids.length} clips de ${dir}`));
