import "server-only";
import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Única puerta a Claude. Todas las funciones de IA pasan por aquí para tener:
 * - salida estructurada validada con Zod (nunca se parsea texto a mano),
 * - el contexto de marca en caché (es lo que más se repite entre llamadas),
 * - registro del consumo en ai_usage,
 * - errores en español para mostrar.
 */
export const MODELS = {
  /** Generación principal (guiones, perfil de marca). */
  main: "claude-sonnet-5-5",
  /** Ediciones chicas sobre un campo (acortar, otro gancho, otro beat). */
  fast: "claude-haiku-5-5",
  /** Tareas que piden más criterio (adaptar un guion a otro formato). */
  deep: "claude-opus-5-5",
} as const;

export type ModelKey = keyof typeof MODELS;

export class AiError extends Error {
  constructor(
    readonly userMessage: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "AiError";
  }
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  const key = env().ANTHROPIC_API_KEY;
  if (!key) throw new AiError("Falta configurar la IA en esta instalación (ANTHROPIC_API_KEY). Avísale a soporte.", "sin ANTHROPIC_API_KEY");
  client ??= new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 });
  return client;
}

export function aiConfigured(): boolean {
  return Boolean(env().ANTHROPIC_API_KEY) || (process.env.AI_FAKE === "1" && process.env.NODE_ENV !== "production");
}

export async function generateStructured<S extends z.ZodType>(input: {
  feature: string;
  model?: ModelKey;
  /** Contexto estable (reglas + marca): va en caché por una hora. */
  context: string;
  /** La tarea concreta de esta llamada. */
  task: string;
  schema: S;
  maxTokens?: number;
  userId?: string | null;
}): Promise<z.infer<S>> {
  const model = MODELS[input.model ?? "main"];
  // Solo para probar la interfaz en desarrollo: nunca en producción.
  if (process.env.AI_FAKE === "1" && process.env.NODE_ENV !== "production") {
    const { fakeResponse } = await import("./fake");
    await new Promise((r) => setTimeout(r, 800));
    return input.schema.parse(fakeResponse(input.feature, input.task)) as z.infer<S>;
  }
  let message;
  try {
    message = await getClient().messages.parse({
      model,
      max_tokens: input.maxTokens ?? 4096,
      system: [{ type: "text", text: input.context, cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [{ role: "user", content: input.task }],
      output_config: { format: zodOutputFormat(input.schema) },
    });
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (error instanceof APIError) {
      const status = error.status ?? 0;
      if (status === 401 || status === 403) throw new AiError("La clave de IA de esta instalación no es válida. Avísale a soporte.", `${status} ${error.message}`);
      if (status === 429 || status === 529 || status >= 500) throw new AiError("La IA está saturada en este momento. Prueba de nuevo en un minuto.", `${status} ${error.message}`);
      if (status === 400) throw new AiError("No pudimos procesar el pedido. Revisa que el texto no sea demasiado largo y prueba otra vez.", `${status} ${error.message}`);
    }
    throw new AiError("No pudimos generar el resultado. Prueba de nuevo.", error instanceof Error ? error.message : String(error));
  }

  await getDb()
    .insert(schema.aiUsage)
    .values({
      feature: input.feature,
      provider: "anthropic",
      model,
      inputTokens: (message.usage.input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0),
      outputTokens: message.usage.output_tokens ?? 0,
    })
    .catch(() => undefined);

  if (message.stop_reason === "refusal") throw new AiError("La IA no quiso generar ese contenido. Prueba con otra idea o redáctala distinto.", "refusal");
  if (message.stop_reason === "max_tokens") throw new AiError("El resultado salió demasiado largo. Prueba con un formato más corto.", "max_tokens");
  if (message.parsed_output == null) throw new AiError("La IA devolvió un resultado incompleto. Prueba de nuevo.", "sin parsed_output");
  return message.parsed_output as z.infer<S>;
}
