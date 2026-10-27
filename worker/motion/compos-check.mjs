#!/usr/bin/env node
/**
 * Valida una composición igual que la app antes de guardarla (validateComposition de lib/video/compos, empaquetado en
 * compos-engine.mjs): revisión estática y prueba en el sandbox en 18 instantes. La usa el agente de animaciones del
 * worker (video/compos_agent.py) en su herramienta «probar».
 *
 * Entrada (JSON por stdin): { code, env }. Salida (JSON por stdout): el resultado de validateComposition.
 */
import { readFileSync } from "node:fs";
import { loadComposEngine } from "./lib.mjs";

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.stdout.write(JSON.stringify({ ok: false, error: "La entrada no es un JSON válido.", line: null, kind: "input" }) + "\n");
  process.exit(2);
}
if (typeof input?.code !== "string" || !input.env || typeof input.env !== "object") {
  process.stdout.write(JSON.stringify({ ok: false, error: "Falta el código o el entorno.", line: null, kind: "input" }) + "\n");
  process.exit(2);
}
const compos = await loadComposEngine();
const result = await compos.validateComposition(input.code, input.env);
process.stdout.write(JSON.stringify(result) + "\n");
process.exit(0);
