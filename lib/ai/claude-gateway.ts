import "server-only";
import { env } from "@/lib/env";
import { readClaudePlanToken } from "./claude-plan";

/**
 * Llamadas de IA con la suscripción de Claude del cliente: van a la puerta de IA del worker (worker/comunes/ia_server.py),
 * que las resuelve con el SDK de agentes de Claude y gasta el uso semanal del plan, no la API. Vercel no puede correr la
 * CLI de Claude, por eso pasa por el worker (el proxy de Fly lo enciende si estaba apagado).
 */

export class PlanUnavailable extends Error {
  constructor(
    readonly kind: "quota" | "auth" | "down" | "other",
    readonly detail: string,
  ) {
    super(detail);
    this.name = "PlanUnavailable";
  }
}

export type PlanUsage = { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; apiEquivalentUsd?: number; turns?: number; ms?: number; model?: string; utilization?: number };

export function gatewayUrl(): string | null {
  const e = env();
  if (e.CLAUDE_GATEWAY_URL) return e.CLAUDE_GATEWAY_URL.replace(/\/+$/, "");
  return e.FLY_WORKER_APP ? `https://${e.FLY_WORKER_APP}.fly.dev` : null;
}

/** El token del plan si se puede usar ahora (conectado y con la puerta configurada); si no, null. */
export async function planToken(): Promise<string | null> {
  if (!gatewayUrl() || !env().WORKER_SECRET) return null;
  return readClaudePlanToken().catch(() => null);
}

export async function callPlan(input: {
  token: string;
  feature: string;
  model: string;
  system: string;
  task: string;
  schema: unknown;
  images?: { mediaType: string; data: string }[];
  effort?: string | null;
  timeoutMs?: number;
}): Promise<{ data: unknown; usage: PlanUsage }> {
  const url = gatewayUrl();
  if (!url) throw new PlanUnavailable("down", "sin puerta de IA");
  let res: Response;
  try {
    res = await fetch(`${url}/ia`, {
      method: "POST",
      headers: { authorization: `Bearer ${env().WORKER_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ token: input.token, feature: input.feature, model: input.model, system: input.system, task: input.task, schema: input.schema, images: input.images ?? [], effort: input.effort ?? null }),
      // Con margen sobre el tope de la puerta (14 min) y nunca más que lo que pidió quien llama.
      signal: AbortSignal.timeout(Math.min(input.timeoutMs ?? 780_000, 780_000)),
      cache: "no-store",
    });
  } catch (error) {
    throw new PlanUnavailable("down", `sin conexión con la puerta de IA: ${error instanceof Error ? error.message : String(error)}`);
  }
  // La puerta manda espacios mientras trabaja y al final el JSON.
  const text = (await res.text().catch(() => "")).trim();
  if (!res.ok) throw new PlanUnavailable(res.status === 401 ? "other" : "down", `puerta de IA ${res.status}: ${text.slice(0, 200)}`);
  let body: { ok?: boolean; data?: unknown; usage?: PlanUsage; kind?: string; error?: string };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    throw new PlanUnavailable("down", "la puerta de IA devolvió algo que no es JSON");
  }
  if (!body.ok) {
    const kind = body.kind === "quota" || body.kind === "auth" ? body.kind : "other";
    throw new PlanUnavailable(kind, body.error ?? "sin detalle");
  }
  return { data: body.data, usage: body.usage ?? {} };
}
