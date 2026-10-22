#!/usr/bin/env node
/**
 * Genera lib/video/motion/icons.data.ts: un set curado de íconos de Lucide (licencia ISC, ver
 * lib/video/motion/LICENSE-lucide.txt) convertidos a trazados SVG (`d`) en su grilla de 24×24.
 *
 * Sale de `lucide-react`, que ya es dependencia de la app (no se agrega nada). El motor no depende de Lucide en
 * tiempo de ejecución: los íconos quedan como datos.
 *   node scripts/motion-icons.mjs
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const pkgDir = dirname(require.resolve("lucide-react/package.json"));
const version = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;

/** Los íconos del set: nombre de Lucide (también es el nombre en las escenas). */
export const ICONS = [
  // Mensajes y contacto
  "message-circle", "message-square", "messages-square", "message-circle-more", "send", "reply", "inbox", "mail", "phone", "at-sign",
  // Notificaciones y atención
  "bell", "bell-ring", "megaphone", "circle-alert", "sparkles", "zap", "flame", "magnet",
  // Personas
  "user", "users", "user-plus", "user-check", "handshake", "crown", "bot",
  // Dinero y ventas
  "dollar-sign", "banknote", "coins", "wallet", "piggy-bank", "credit-card", "receipt", "shopping-cart", "store", "gift", "percent",
  // Datos y crecimiento
  "trending-up", "trending-down", "chart-line", "chart-column", "chart-no-axes-column", "chart-pie", "funnel", "target", "layers", "infinity",
  // Tiempo
  "calendar", "calendar-check", "clock", "alarm-clock", "timer", "hourglass",
  // Estados y flechas
  "check", "circle-check", "badge-check", "x", "circle-x", "arrow-right", "arrow-up-right", "arrow-up", "arrow-down", "repeat", "workflow",
  // Contenido y redes (genéricos, sin logos de marcas)
  "play", "video", "camera", "image", "mic", "scissors", "heart", "thumbs-up", "star", "share-2", "bookmark", "hash", "eye", "mouse-pointer-click", "link",
  // Negocio y herramientas
  "rocket", "trophy", "medal", "party-popper", "brain", "lightbulb", "graduation-cap", "book-open", "pen-line", "file-text", "clipboard-list", "list-checks",
  "briefcase", "building-2", "smartphone", "laptop", "wrench", "settings", "sliders-horizontal", "search", "lock", "key", "shield-check", "globe", "map-pin",
];

const n = (v) => Number(v ?? 0);
const f = (v) => String(Math.round(v * 1000) / 1000);

/** Un nodo de SVG de Lucide → `d` equivalente. */
function toPath([tag, a]) {
  switch (tag) {
    case "path":
      return a.d;
    case "circle": {
      const cx = n(a.cx), cy = n(a.cy), r = n(a.r);
      return `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
    }
    case "ellipse": {
      const cx = n(a.cx), cy = n(a.cy), rx = n(a.rx), ry = n(a.ry);
      return `M${f(cx - rx)} ${f(cy)}a${f(rx)} ${f(ry)} 0 1 0 ${f(2 * rx)} 0a${f(rx)} ${f(ry)} 0 1 0 ${f(-2 * rx)} 0Z`;
    }
    case "rect": {
      const x = n(a.x), y = n(a.y), w = n(a.width), h = n(a.height);
      const r = Math.min(n(a.rx ?? a.ry), w / 2, h / 2);
      if (!r) return `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}Z`;
      return `M${f(x + r)} ${f(y)}h${f(w - 2 * r)}a${f(r)} ${f(r)} 0 0 1 ${f(r)} ${f(r)}v${f(h - 2 * r)}a${f(r)} ${f(r)} 0 0 1 ${f(-r)} ${f(r)}h${f(-(w - 2 * r))}a${f(r)} ${f(r)} 0 0 1 ${f(-r)} ${f(-r)}v${f(-(h - 2 * r))}a${f(r)} ${f(r)} 0 0 1 ${f(r)} ${f(-r)}Z`;
    }
    case "line":
      return `M${f(n(a.x1))} ${f(n(a.y1))}L${f(n(a.x2))} ${f(n(a.y2))}`;
    case "polyline":
    case "polygon": {
      const pts = String(a.points).trim().split(/[\s,]+/).map(Number);
      let d = `M${f(pts[0])} ${f(pts[1])}`;
      for (let i = 2; i < pts.length; i += 2) d += `L${f(pts[i])} ${f(pts[i + 1])}`;
      return tag === "polygon" ? `${d}Z` : d;
    }
    default:
      throw new Error(`Nodo de SVG sin soporte: ${tag}`);
  }
}

const out = {};
for (const name of ICONS) {
  let file = join(pkgDir, "dist/esm/icons", `${name}.mjs`);
  // Algunos nombres son alias que reexportan otro ícono ("building-2" → "building-complex").
  const alias = readFileSync(file, "utf8").match(/export \{ default \} from '\.\/([\w-]+)\.mjs'/);
  if (alias) file = join(pkgDir, "dist/esm/icons", `${alias[1]}.mjs`);
  const mod = await import(pathToFileURL(file).href);
  const data = mod.__iconData;
  if (!data?.node) throw new Error(`No se encontró el ícono ${name} en lucide-react ${version}`);
  out[name] = data.node.map(toPath);
}

const body = Object.entries(out)
  .map(([name, paths]) => `  ${JSON.stringify(name)}: [${paths.map((p) => JSON.stringify(p)).join(", ")}],`)
  .join("\n");
const file = `/**
 * Archivo generado por scripts/motion-icons.mjs (no lo edites a mano).
 * Íconos de Lucide ${version} (https://lucide.dev), licencia ISC: ver lib/video/motion/LICENSE-lucide.txt.
 * Cada ícono es una lista de trazados SVG en una grilla de 24×24, con trazo de 2 y puntas redondeadas.
 */
export const ICON_PATHS = {
${body}
} as const satisfies Record<string, readonly string[]>;
`;
writeFileSync(join(root, "lib/video/motion/icons.data.ts"), file);
copyFileSync(join(pkgDir, "LICENSE"), join(root, "lib/video/motion/LICENSE-lucide.txt"));
console.log(`${ICONS.length} íconos de Lucide ${version} → lib/video/motion/icons.data.ts`);
