import "server-only";
import { APIError } from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { AiError, MODELS, anthropicClient } from "@/lib/ai/client";
import { recordUsage } from "@/lib/ai/usage";
import type { StrategistCitation, StrategistIdea, StrategistToolCall } from "@/lib/db/schema";
import { composeFakeAnswer, fakeIdeaCalls, planFakeTools } from "./fake";
import type { ToolContext, ToolOutput } from "./queries";
import { parseToolCall, stripUnknownRefs, toolDefinitions, toolStatus, type RefRegistry, type ToolInput, type ToolName } from "./tools";

/**
 * Un turno del estratega: Claude con herramientas de solo lectura, en streaming.
 * Emite eventos (texto, herramienta en curso) mientras trabaja y devuelve la respuesta final.
 * Con AI_FAKE=1 (solo desarrollo) corre el flujo simulado de ./fake con las herramientas reales.
 */
export type StrategistEvent =
  | { type: "conversation"; id: string; title: string }
  | { type: "tool"; label: string }
  | { type: "text"; delta: string }
  /** El texto que llegó era previo a usar una herramienta: el cliente lo borra. */
  | { type: "reset" }
  | { type: "done"; message: { id: string; role: "assistant"; content: string; citations: StrategistCitation[]; ideas: StrategistIdea[]; error: null; createdAt: string }; remaining: number }
  | { type: "error"; error: string };

export type HistoryMessage = { role: "user" | "assistant"; content: string; citations: StrategistCitation[] };

export type TurnInput = {
  question: string;
  history: HistoryMessage[];
  system: string;
  today: string;
  registry: RefRegistry;
  run: <N extends ToolName>(name: N, input: ToolInput<N>, ctx: ToolContext) => Promise<ToolOutput>;
  emit: (event: StrategistEvent) => void;
  signal?: AbortSignal;
  /** Quién pregunta (para el registro del consumo). */
  userId?: string | null;
};

export type TurnResult = { text: string; ideas: StrategistIdea[]; toolCalls: StrategistToolCall[]; usage: { input: number; output: number }; model: string };

/** Vueltas máximas de herramientas por pregunta (la última obliga a responder). */
export const MAX_ROUNDS = 5;
const MAX_HISTORY = 12;

export function isFakeMode(): boolean {
  return process.env.AI_FAKE === "1" && process.env.NODE_ENV !== "production";
}

/** Historial para el modelo: los últimos mensajes, con la leyenda de lo que se citó (para seguir usando [P3]). */
export function historyToMessages(history: HistoryMessage[]): MessageParam[] {
  const out: MessageParam[] = [];
  for (const m of history.slice(-MAX_HISTORY)) {
    const legend = m.role === "assistant" && m.citations.length ? `\n\n(Referencias citadas: ${m.citations.map((c) => `${c.ref} = ${c.label}${c.detail ? ` · ${c.detail}` : ""}`).join("; ")})` : "";
    const text = `${m.content}${legend}`.trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role && typeof last.content === "string") last.content = `${last.content}\n\n${text}`;
    else out.push({ role: m.role, content: text });
  }
  while (out[0]?.role === "assistant") out.shift();
  if (out[out.length - 1]?.role === "user") out.pop(); // la pregunta nueva va aparte; si la anterior quedó sin respuesta, se descarta
  return out;
}

async function callTool(name: string, rawInput: unknown, input: TurnInput, ctx: ToolContext, calls: StrategistToolCall[]): Promise<{ content: string; isError: boolean }> {
  input.emit({ type: "tool", label: toolStatus(name, rawInput) });
  const parsed = parseToolCall(name, rawInput);
  if (!parsed.ok) {
    calls.push({ name, input: rawInput, summary: parsed.error, error: true });
    return { content: JSON.stringify({ error: parsed.error }), isError: true };
  }
  try {
    const out = await input.run(parsed.name, parsed.input as never, ctx);
    if (out.idea) ctx.ideas.push(out.idea);
    calls.push({ name, input: parsed.input, summary: out.summary, error: "error" in out.content });
    return { content: JSON.stringify(out.content), isError: "error" in out.content };
  } catch (error) {
    console.error("[estratega] herramienta", name, error instanceof Error ? error.message : error);
    calls.push({ name, input: parsed.input, summary: "falló", error: true });
    return { content: JSON.stringify({ error: "No se pudo leer ese dato en este momento." }), isError: true };
  }
}

function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof APIError) {
    const status = error.status ?? 0;
    if (status === 401 || status === 403) return new AiError("La clave de IA de esta instalación no es válida. Avísale a soporte.", `${status} ${error.message}`);
    if (status === 429 || status === 529 || status >= 500) return new AiError("La IA está saturada en este momento. Prueba de nuevo en un minuto.", `${status} ${error.message}`);
    if (status === 400) return new AiError("No pudimos procesar la pregunta. Prueba con una pregunta más corta.", `${status} ${error.message}`);
  }
  if (error instanceof Error && error.name === "AbortError") return new AiError("Se canceló la respuesta.", "abort");
  return new AiError("No pudimos responder. Prueba de nuevo.", error instanceof Error ? error.message : String(error));
}

async function realTurn(input: TurnInput): Promise<TurnResult> {
  // La misma clave que el resto de la IA: la del cliente (Ajustes) o, si no cargó una, la del servidor.
  const client = await anthropicClient();
  const model = MODELS.main;
  const tools = toolDefinitions();
  const ctx: ToolContext = { registry: input.registry, ideas: [] };
  const calls: StrategistToolCall[] = [];
  const usage = { input: 0, output: 0 };
  const messages: MessageParam[] = [...historyToMessages(input.history), { role: "user", content: input.question }];
  let text = "";

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const last = round === MAX_ROUNDS - 1;
      const stream = client.messages.stream(
        {
          model,
          max_tokens: 2000,
          system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral", ttl: "1h" } }],
          tools,
          tool_choice: last ? { type: "none" } : { type: "auto" },
          messages,
        },
        { signal: input.signal },
      );
      let roundText = "";
      stream.on("text", (delta) => {
        roundText += delta;
        input.emit({ type: "text", delta });
      });
      const message = await stream.finalMessage();
      usage.input += (message.usage.input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
      usage.output += message.usage.output_tokens ?? 0;
      // Cada vuelta (pregunta o herramientas) se registra con sus cuatro tipos de tokens y su costo.
      await recordUsage({ step: "estratega.chat", model, usage: message.usage, userId: input.userId ?? null });

      if (message.stop_reason === "tool_use") {
        if (roundText) input.emit({ type: "reset" });
        messages.push({ role: "assistant", content: message.content });
        const results: ToolResultBlockParam[] = [];
        for (const block of message.content) {
          if (block.type !== "tool_use") continue;
          const out = await callTool(block.name, block.input, input, ctx, calls);
          results.push({ type: "tool_result", tool_use_id: block.id, content: out.content, is_error: out.isError || undefined });
        }
        messages.push({ role: "user", content: results });
        continue;
      }
      if (message.stop_reason === "refusal") throw new AiError("La IA no quiso responder esa pregunta. Prueba redactarla distinto.", "refusal");
      text = roundText;
      break;
    }
  } catch (error) {
    throw toAiError(error);
  }
  if (!text.trim()) throw new AiError("La IA no llegó a una respuesta. Prueba con una pregunta más concreta.", "sin texto");
  return { text: stripUnknownRefs(text, input.registry).trim(), ideas: ctx.ideas, toolCalls: calls, usage, model };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fakeTurn(input: TurnInput): Promise<TurnResult> {
  const ctx: ToolContext = { registry: input.registry, ideas: [] };
  const calls: StrategistToolCall[] = [];
  const outputs: Record<string, unknown>[] = [];
  for (const call of planFakeTools(input.question, input.today)) {
    await sleep(350);
    const out = await callTool(call.name, call.input, input, ctx, calls);
    outputs.push(JSON.parse(out.content) as Record<string, unknown>);
  }
  for (const call of fakeIdeaCalls(input.question, outputs, input.today)) await callTool(call.name, call.input, input, ctx, calls);
  const text = stripUnknownRefs(composeFakeAnswer(input.question, outputs), input.registry);
  for (const chunk of text.match(/\S+\s*/g) ?? []) {
    if (input.signal?.aborted) break;
    input.emit({ type: "text", delta: chunk });
    await sleep(18);
  }
  return { text, ideas: ctx.ideas, toolCalls: calls, usage: { input: 0, output: 0 }, model: "simulado" };
}

export function runStrategistTurn(input: TurnInput): Promise<TurnResult> {
  return isFakeMode() ? fakeTurn(input) : realTurn(input);
}
