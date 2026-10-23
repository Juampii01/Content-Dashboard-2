#!/usr/bin/env node
/**
 * Empaqueta los motores para el worker (Node + skia-canvas): gráficos (lib/video/motion → worker/motion/engine.mjs) y
 * efectos (lib/video/fx/engine → worker/motion/fx-engine.mjs).
 * El worker se construye solo con la carpeta worker/, así que el paquete se guarda en el repo: si cambias el motor,
 * corre `pnpm motion:bundle` (`--check` avisa si quedó viejo; lo usan las pruebas).
 */
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const bundles = [
  {
    entry: "lib/video/motion/index.ts",
    out: "worker/motion/engine.mjs",
    banner: "// Generado por scripts/motion-bundle.mjs desde lib/video/motion (no lo edites a mano).\n// Incluye íconos de Lucide (ISC, ver lib/video/motion/LICENSE-lucide.txt) y Zod (MIT).",
  },
  {
    entry: "lib/video/fx/engine/index.ts",
    out: "worker/motion/fx-engine.mjs",
    banner: "// Generado por scripts/motion-bundle.mjs desde lib/video/fx/engine (no lo edites a mano).",
  },
];
let stale = false;
for (const b of bundles) {
  const outfile = join(root, b.out);
  const result = await build({
    entryPoints: [join(root, b.entry)],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "node22",
    outfile,
    write: false,
    legalComments: "eof",
    banner: { js: b.banner },
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
      console.error(`${b.out} está desactualizado: corre \`pnpm motion:bundle\`.`);
      stale = true;
    } else console.log(`${b.out} al día`);
  } else {
    writeFileSync(outfile, fresh);
    console.log(`${b.out} listo (${Math.round(fresh.length / 1024)} KB)`);
  }
}
if (stale) process.exit(1);
