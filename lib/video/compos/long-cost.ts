/**
 * Piezas largas (la pieza única de «Animar todo», hasta 180 s y 90 mil caracteres de código): cuántos tokens de salida
 * piden, con qué tope se llaman y cuánto cuestan. Sin nada de servidor (lo usan el taller, la reserva y las pruebas).
 *
 * Datos (api_usage de producción, 27-oct-2026): una pieza de 69 s con Opus y razonamiento bajo se cortó 3 veces en el
 * tope de 32 mil tokens (USD 2,08 sin resultado). El razonamiento de Opus 5.5 es adaptativo y siempre está prendido, y
 * comparte el tope con el código: 90 mil caracteres de código en JSON son ~28 mil tokens solos (3,2 letras por token,
 * lib/ai/pricing.ts). Por eso la salida esperada crece con la duración: 8 mil de base + 500 por segundo
 * (60 s ≈ 38 mil, 69 s ≈ 42 mil, 180 s ≈ 98 mil).
 *
 * Con esa salida la llamada pasa los 13 minutos de la función de la app, así que la hace el worker (sin ese límite) con
 * un tope alto. El máximo de salida de Opus 5.5 y Sonnet 5.5 es 128 mil tokens
 * (platform.claude.com/docs/en/models/opus-5-5/overview, consultado el 27-oct-2026).
 */
import { MODELS } from "@/lib/ai/models";
import { costOf } from "@/lib/ai/pricing";

/** Salida máxima de Opus 5.5 y Sonnet 5.5 en la API de Mensajes (sin lotes). */
export const MAX_OUTPUT_TOKENS = 128_000;
/** Tope de salida de una llamada dentro de la app: con más, pasaba los 13 minutos de la función. */
export const APP_MAX_TOKENS = 32_000;
/** Tope mínimo de una llamada en el worker (una animación corta que se cortó en la app). */
const WORKER_MIN_TOKENS = 64_000;
/** Reglas y marca en caché (se leen en cada llamada) y entrada propia de la tarea (palabras, escenas, imágenes). */
const RULES_TOKENS = 17_000;
const taskTokens = (seconds: number) => Math.round(6_000 + 60 * seconds);

/** Salida esperada (razonamiento + código) de una pieza larga de `seconds` segundos. */
export function longCodeTokens(seconds: number): number {
  return Math.min(MAX_OUTPUT_TOKENS, Math.round(8_000 + 500 * Math.max(0, seconds)));
}

/** Tope de salida de la llamada en el worker: la mitad más de lo esperado, entre 64 mil y el máximo del modelo. */
export function workerMaxTokens(seconds: number | null): number {
  if (seconds == null) return WORKER_MIN_TOKENS;
  return Math.min(MAX_OUTPUT_TOKENS, Math.max(WORKER_MIN_TOKENS, Math.ceil(longCodeTokens(seconds) * 1.5)));
}

/** Costo esperado del código de una pieza larga (USD, Opus 5.5). */
export function longCodeCost(seconds: number): number {
  return costOf(MODELS.deep, { input: taskTokens(seconds), output: longCodeTokens(seconds), cacheRead: RULES_TOKENS, cacheWrite: 0 });
}

/** Lo que se reserva para escribir una pieza larga: lo peor que puede costar (la llamada usa todo su tope). */
export function longCodeReserve(seconds: number): number {
  return costOf(MODELS.deep, { input: taskTokens(seconds), output: workerMaxTokens(seconds), cacheRead: RULES_TOKENS, cacheWrite: 0 });
}

/** Revisión con cuadros de una pieza larga (Sonnet): lee el código entero y, si corrige, lo devuelve entero. */
export function longLookCost(seconds: number): number {
  const code = Math.round(longCodeTokens(seconds) * 0.6);
  return costOf(MODELS.main, { input: taskTokens(seconds) + code + 6_000, output: Math.round(code * 1.3), cacheRead: RULES_TOKENS, cacheWrite: 0 });
}

/** Lo que cuestan `tokens` de salida de un modelo (USD). */
export function outputCost(model: string, tokens: number): number {
  return costOf(model, { input: 0, output: Math.max(0, tokens), cacheRead: 0, cacheWrite: 0 });
}

/** Lo peor que cuesta una llamada: su entrada (con las reglas en caché) y todo su tope de salida. */
export function callCost(model: string, inputTokens: number, maxTokens: number): number {
  return costOf(model, { input: inputTokens, output: Math.max(0, maxTokens), cacheRead: RULES_TOKENS, cacheWrite: 0 });
}

/**
 * Tope de salida que se puede pagar con `usd` (lo que queda del tope del video o de la reserva del pedido), descontada
 * la entrada. Nunca se pide más de lo que se puede pagar.
 */
export function affordableTokens(model: string, usd: number, inputTokens: number): number {
  const perOutput = outputCost(model, 1_000_000) / 1_000_000;
  const inputCost = costOf(model, { input: inputTokens, output: 0, cacheRead: RULES_TOKENS, cacheWrite: 0 });
  return Math.max(0, Math.floor((usd - inputCost) / perOutput));
}
