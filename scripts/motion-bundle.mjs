#!/usr/bin/env node
/**
 * Empaqueta el motor (lib/video/motion) en worker/motion/engine.mjs para el worker (Node + skia-canvas).
 * El worker se construye solo con la carpeta worker/, así que el paquete se guarda en el repo: si cambias el motor,
 * corre `pnpm motion:bundle` (`--check` avisa si quedó viejo; lo usan las pruebas).
 */
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const outfile = join(root, "worker/motion/engine.mjs");
const result = await build({
  entryPoints: [join(root, "lib/video/motion/index.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "node22",
  outfile,
  write: false,
  legalComments: "eof",
  banner: { js: "// Generado por scripts/motion-bundle.mjs desde lib/video/motion (no lo edites a mano).\n// Incluye íconos de Lucide (ISC, ver lib/video/motion/LICENSE-lucide.txt) y Zod (MIT)." },
  logLevel: "warning",
  minify: true,
});
const fresh = result.outputFiles[0].text;
if (check) {
  let current = "";
  try {
    current = readFileSync(outfile, "utf8");
  } catch {}
  if (current !== fresh) {
    console.error("worker/motion/engine.mjs está desactualizado: corre `pnpm motion:bundle`.");
    process.exit(1);
  }
  console.log("worker/motion/engine.mjs al día");
} else {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outfile, fresh);
  console.log(`worker/motion/engine.mjs listo (${Math.round(fresh.length / 1024)} KB)`);
}
