import { NextResponse } from "next/server";
import { z } from "zod";
import { getOptionalUser } from "@/lib/auth";
import { AiError, aiConfigured } from "@/lib/ai/client";
import { conversationFor, createToolRunner, DAILY_QUESTION_LIMIT, questionsToday } from "@/lib/dal/strategist";
import { runStrategistTurn, type StrategistEvent } from "@/lib/strategist/engine";
import { createConversation, saveAssistantMessage, saveUserMessage, systemContext } from "@/lib/strategist/service";
import { extractCitations, RefRegistry } from "@/lib/strategist/tools";

/**
 * POST /api/estratega — una pregunta al estratega. Responde en streaming (NDJSON: un evento por línea):
 * conversation → tool… → text… → done (o error). Guarda la pregunta y la respuesta en la conversación.
 */
const body = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  question: z.string().trim().min(3, "Escribe una pregunta un poco más larga.").max(1000, "La pregunta es demasiado larga (máximo 1,000 caracteres)."),
});

const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  const user = await getOptionalUser();
  if (!user) return fail("Tu sesión terminó. Vuelve a entrar.", 401);
  if (user.role === "VIEWER") return fail("Tu usuario es de solo lectura. Pide acceso de edición al dueño de la cuenta para preguntarle al estratega.", 403);

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Revisa la pregunta.", 400);
  if (!aiConfigured()) return fail("La IA no está configurada en esta instalación. Avísale a soporte.", 503);

  const used = await questionsToday(user.id);
  if (used >= DAILY_QUESTION_LIMIT) return fail(`Llegaste al límite de ${DAILY_QUESTION_LIMIT} preguntas por hoy. Vuelve mañana.`, 429);

  const { question } = parsed.data;
  const existing = parsed.data.conversationId ? await conversationFor(user, parsed.data.conversationId) : null;
  if (parsed.data.conversationId && !existing) return fail("No encontramos esa conversación. Puede que se haya borrado.", 404);

  const runner = await createToolRunner();
  const { system, today } = await systemContext();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let open = true;
      const emit = (event: StrategistEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };

      const conversation = existing ?? (await createConversation(user.id, question));
      if (!existing) emit({ type: "conversation", id: conversation.id, title: conversation.title });
      const history = existing?.messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content, citations: m.citations })) ?? [];
      const registry = new RefRegistry(existing?.messages.flatMap((m) => m.citations) ?? []);
      await saveUserMessage(conversation.id, user.id, question);

      try {
        const result = await runStrategistTurn({ question, history, system, today, registry, run: runner.run, emit, signal: abort.signal, userId: user.id });
        // Las ideas también citan ([P3] en el "por qué"): sus fuentes van en la lista.
        const citations = extractCitations([result.text, ...result.ideas.map((i) => `${i.idea} ${i.why ?? ""}`)].join("\n"), registry);
        const saved = await saveAssistantMessage(conversation.id, { content: result.text, citations, ideas: result.ideas, toolCalls: result.toolCalls, model: result.model, usage: result.usage, error: null });
        emit({
          type: "done",
          message: { id: saved.id, role: "assistant", content: result.text, citations, ideas: result.ideas, error: null, createdAt: saved.createdAt.toISOString() },
          remaining: Math.max(0, DAILY_QUESTION_LIMIT - used - 1),
        });
      } catch (error) {
        const message = error instanceof AiError ? error.userMessage : "No pudimos responder. Prueba de nuevo.";
        console.error("[estratega]", error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
        await saveAssistantMessage(conversation.id, { content: "", citations: [], ideas: [], toolCalls: [], model: null, usage: null, error: message }).catch(() => undefined);
        emit({ type: "error", error: message });
      } finally {
        if (open) controller.close();
        open = false;
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
