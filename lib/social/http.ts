import "server-only";
import { SocialApiError, type Platform } from "./types";

/**
 * Contexto de una sincronización: cuenta las llamadas a la API y sabe cuánto tiempo queda.
 * Cada llamada pasa por aquí para tener tiempo límite, reintentos y errores clasificados.
 */
export class SyncContext {
  apiCalls = 0;
  constructor(
    readonly platform: Platform,
    readonly deadline: number = Date.now() + 240_000,
  ) {}

  /** true si quedan menos de `marginMs` milisegundos de presupuesto. */
  outOfTime(marginMs = 15_000): boolean {
    return Date.now() > this.deadline - marginMs;
  }
}

export type ErrorClassifier = (status: number, body: unknown, headers: Headers) => SocialApiError | null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET/POST con JSON. Reintenta hasta 2 veces ante errores de red, 5xx y límites de uso cortos.
 * El clasificador de cada red convierte la respuesta de error en un SocialApiError.
 * Nunca registra la URL completa (puede llevar el token).
 */
export async function requestJson<T>(
  ctx: SyncContext | null,
  url: string,
  init: RequestInit & { timeoutMs?: number },
  classify: ErrorClassifier,
): Promise<T> {
  const platform = ctx?.platform ?? "INSTAGRAM";
  const safeUrl = url.split("?")[0];
  let lastError: SocialApiError | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (ctx) ctx.apiCalls++;
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 20_000), cache: "no-store" });
    } catch (error) {
      lastError = new SocialApiError(platform, "TRANSIENT", "La red no respondió a tiempo. Lo intentamos de nuevo más tarde.", `fetch ${safeUrl}: ${String(error)}`);
      await sleep(500 * 2 ** attempt);
      continue;
    }

    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { nonJson: text.slice(0, 200) };
    }

    const classified = classify(response.status, body, response.headers);
    if (!classified && response.ok) return body as T;

    const error =
      classified ??
      new SocialApiError(platform, response.status >= 500 ? "TRANSIENT" : "UNKNOWN", "La red devolvió un error inesperado.", `${response.status} ${safeUrl}: ${text.slice(0, 300)}`);

    const retryable = error.kind === "TRANSIENT" || (error.kind === "RATE_LIMITED" && (error.retryAfterSec ?? 0) <= 10);
    if (!retryable || attempt === 2) throw error;
    lastError = error;
    await sleep(error.retryAfterSec ? error.retryAfterSec * 1000 : 800 * 2 ** attempt);
  }
  throw lastError ?? new SocialApiError(platform, "UNKNOWN", "La red devolvió un error inesperado.", safeUrl);
}

/** Ejecuta `fn` sobre cada elemento con un máximo de `limit` en paralelo. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Número o null (las APIs mandan números como string a veces). */
export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Fecha YYYY-MM-DD en UTC. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
