/**
 * Vuelca los números del lienzo de la revisión que el worker tiene que repetir igual (lib/video/canvas/dump.ts). Lo
 * usan las pruebas del worker (worker/tests/test_canvas_place.py).
 *   node --import tsx scripts/canvas-dump.mts [salida.json]
 */
import { writeFileSync } from "node:fs";
import { canvasDump } from "../lib/video/canvas/dump";

const out = process.argv[2] ?? "worker/tests/fixtures/canvas-place.json";
writeFileSync(out, `${JSON.stringify(canvasDump())}\n`);
console.log(out);
