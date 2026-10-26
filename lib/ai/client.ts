import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { readAnthropicKey } from "./anthropic-key";
import { costOf, imageTokens, textTokens } from "./pricing";

/**
 * Única puerta a Claude. Todas las funciones de IA pasan por aquí para tener:
 * - salida estructurada validada con Zod (nunca se parsea texto a mano),
 * - el contexto de marca en caché (es lo que más se repite entre llamadas),
 * - registro del consumo en ai_usage,
 * - errores en español para mostrar.
 */
import { MODELS, type ModelKey } from "./models";
export { MODELS, type ModelKey };

export class AiError extends Error {
  constructor(
    readonly userMessage: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "AiError";
  }
}

let client: { key: string; sdk: Anthropic } | null = null;
/** El cliente de Anthropic con la clave del cliente (Ajustes) o, si no cargó una, la del servidor. */
async function getClient(): Promise<Anthropic> {
  const key = (await readAnthropicKey().catch(() => null)) ?? env().ANTHROPIC_API_KEY;
  if (!key) throw new AiError("Agrega tu clave de API de Anthropic en Ajustes → Claves de servicios para usar la IA.", "sin clave de Anthropic");
  if (!client || client.key !== key) client = { key, sdk: new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 }) };
  return client.sdk;
}

/**
 * Ámbito del consumo: todo lo que se llame a Claude dentro de `withAiScope` se carga a ese video del Editor
 * (ai_usage.video_project_id), también las llamadas internas (gráficos, reintentos) que no saben de proyectos.
 */
const scope = new AsyncLocalStorage<{ videoProjectId: string | null }>();
export function withAiScope<T>(videoProjectId: string | null, fn: () => Promise<T>): Promise<T> {
  return scope.run({ videoProjectId }, fn);
}

/** Respuesta simulada (AI_FAKE=1) de una función que la arma con los datos reales en lugar de leer la tarea. */
export type FakeFn = () => unknown;

/**
 * ¿Se puede ofrecer la IA? La clave puede estar en Ajustes (eso no se sabe sin leer la base), así que se ofrece siempre
 * que haya base de datos o clave del servidor; si al llamar no hay ninguna clave, la llamada avisa qué hacer.
 * Para saberlo de verdad (Estado del sistema, Ajustes), usa `aiReady()`.
 */
export function aiConfigured(): boolean {
  return Boolean(env().ANTHROPIC_API_KEY) || Boolean(env().DATABASE_URL) || (process.env.AI_FAKE === "1" && process.env.NODE_ENV !== "production");
}

/** Hay una clave de Anthropic con qué llamar (la del cliente o la del servidor). */
export async function aiReady(): Promise<boolean> {
  if (process.env.AI_FAKE === "1" && process.env.NODE_ENV !== "production") return true;
  return Boolean(env().ANTHROPIC_API_KEY) || Boolean(await readAnthropicKey().catch(() => null));
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
  /** Imágenes para modelos con visión (base64, sin el prefijo data:). Van antes de la tarea. Opcional. */
  images?: { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string }[];
  /** Trabajo de la cola al que se carga el consumo (ai_usage.job_id). */
  jobId?: string | null;
  /** Video del Editor al que se carga el consumo (si no, el de `withAiScope`). */
  videoProjectId?: string | null;
  /** Razonamiento adaptativo (Opus y Sonnet 5.5) y su esfuerzo. El razonamiento se cobra como salida. */
  thinking?: { effort: "low" | "medium" | "high" | "xhigh" | "max" } | null;
  /** Tiempo máximo de la llamada. Las largas (razonamiento o mucha salida) van por streaming. */
  timeoutMs?: number;
  /** Tamaño de cada imagen (para registrar la estimación del consumo cuando la respuesta es simulada). */
  imageSizes?: { width: number; height: number }[];
  /** AI_FAKE=1: respuesta simulada armada con los datos reales (en lugar de los casos de fake.ts). */
  fake?: FakeFn;
}): Promise<z.infer<S>> {
  const model = MODELS[input.model ?? "main"];
  const videoProjectId = input.videoProjectId ?? scope.getStore()?.videoProjectId ?? null;
  // Solo para probar la interfaz en desarrollo: nunca en producción.
  if (process.env.AI_FAKE === "1" && process.env.NODE_ENV !== "production") {
    await new Promise((r) => setTimeout(r, 800));
    let raw: unknown;
    if (input.fake) raw = input.fake();
    else {
      const { fakeResponse } = await import("./fake");
      raw = fakeResponse(input.feature, input.task);
    }
    const parsed = input.schema.parse(raw) as z.infer<S>;
    // En un video del Editor se registra el consumo estimado (proveedor "simulado") para probar el tope y la vista del costo.
    if (videoProjectId) {
      const inputTok = textTokens(input.context) + textTokens(input.task) + (input.imageSizes ?? []).reduce((n, i) => n + imageTokens(i.width, i.height), 0);
      const outputTok = textTokens(JSON.stringify(parsed)) * (input.thinking ? 3 : 1);
      await getDb()
        .insert(schema.aiUsage)
        .values({ feature: input.feature, provider: "simulado", model, inputTokens: inputTok, outputTokens: outputTok, jobId: input.jobId ?? null, videoProjectId, costUsd: costOf(model, { input: inputTok, output: outputTok, cacheRead: 0, cacheWrite: 0 }) })
        .catch(() => undefined);
    }
    return parsed;
  }
  // La clave de API del cliente (Ajustes) o, si no cargó una, la del servidor. Nunca la suscripción de Claude: los
  // términos de Anthropic no permiten usar planes Pro o Max desde productos de terceros.
  const api = await getClient();
  const params = {
    model,
    max_tokens: input.maxTokens ?? 4096,
    system: [{ type: "text" as const, text: input.context, cache_control: { type: "ephemeral" as const, ttl: "1h" as const } }],
    messages: [
      {
        role: "user" as const,
        content: input.images?.length
          ? [...input.images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.data } })), { type: "text" as const, text: input.task }]
          : input.task,
      },
    ],
    ...(input.thinking ? { thinking: { type: "adaptive" as const } } : {}),
    output_config: { format: zodOutputFormat(input.schema), ...(input.thinking ? { effort: input.thinking.effort } : {}) },
  };
  // Razonamiento o mucha salida: por streaming (sin streaming, el SDK corta a los 2 minutos de este cliente).
  const long = Boolean(input.thinking) || (input.maxTokens ?? 4096) > 16_000 || (input.timeoutMs ?? 0) > 120_000;
  const call = (p: typeof params | Omit<typeof params, "output_config">) =>
    long || !("output_config" in p)
      ? api.messages.stream(p as typeof params, { timeout: input.timeoutMs ?? 600_000 }).finalMessage()
      : api.messages.parse(p as typeof params, input.timeoutMs ? { timeout: input.timeoutMs } : undefined);
  let message: Awaited<ReturnType<typeof call>>;
  let freeform = false;
  try {
    try {
      message = await call(params);
    } catch (error) {
      // La salida estructurada compila el esquema a una gramática con tamaño máximo. Si un esquema la supera,
      // se pide el mismo JSON como texto (con el JSON Schema en la tarea) y se valida con Zod acá.
      if (!(error instanceof APIError && error.status === 400 && /grammar is too large|too many|schema.*too (large|complex)/i.test(error.message))) throw error;
      console.warn(`[ia] ${input.feature}: esquema demasiado grande para la salida estructurada; se pide como texto.`);
      const { output_config, ...rest } = params;
      const jsonSchema = JSON.stringify(zodOutputFormat(input.schema).schema);
      freeform = true;
      message = await call({
        ...rest,
        ...(output_config.effort ? { output_config: { effort: output_config.effort } } : {}),
        messages: [
          {
            role: "user" as const,
            content: [
              ...(Array.isArray(params.messages[0]!.content) ? params.messages[0]!.content : [{ type: "text" as const, text: params.messages[0]!.content }]),
              { type: "text" as const, text: `FORMATO DE SALIDA: responde SOLO con un objeto JSON válido (sin texto antes ni después, sin bloques de código) que cumpla este JSON Schema:\n${jsonSchema}` },
            ],
          },
        ],
      } as Omit<typeof params, "output_config">);
    }
  } catch (error) {
    if (error instanceof AiError) throw error;
    // El SDK no puede leer la salida estructurada cuando la respuesta llegó cortada (se quedó sin tokens a la mitad).
    if (error instanceof Error && /Failed to parse structured output/i.test(error.message)) {
      throw new AiError("La IA devolvió un resultado incompleto. Prueba de nuevo.", `truncada: ${error.message.slice(0, 200)}`);
    }
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
      jobId: input.jobId ?? null,
      videoProjectId,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      costUsd: costOf(model, {
        input: message.usage.input_tokens ?? 0,
        output: message.usage.output_tokens ?? 0,
        cacheRead: message.usage.cache_read_input_tokens ?? 0,
        cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
      }),
    })
    .catch(() => undefined);

  if (message.stop_reason === "refusal") throw new AiError("La IA no quiso generar ese contenido. Prueba con otra idea o redáctala distinto.", "refusal");
  if (message.stop_reason === "max_tokens") throw new AiError("El resultado salió demasiado largo. Prueba con un formato más corto.", "truncada: max_tokens");
  const parsedOutput = (message as { parsed_output?: unknown }).parsed_output;
  if (parsedOutput != null && !freeform) return parsedOutput as z.infer<S>;
  // Sin parsed_output (streaming o pedido como texto): se lee el JSON del texto y se valida con el esquema.
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("La IA devolvió un resultado incompleto. Prueba de nuevo.", "sin JSON en la respuesta");
  try {
    return input.schema.parse(JSON.parse(text.slice(start, end + 1))) as z.infer<S>;
  } catch (error) {
    throw new AiError("La IA devolvió un resultado incompleto. Prueba de nuevo.", `JSON inválido: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`);
  }
}
