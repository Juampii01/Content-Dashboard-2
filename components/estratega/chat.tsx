"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, BarChart3, CalendarCheck2, CalendarDays, CalendarPlus, Check, Compass, FilePlus2, Loader2, MessageSquarePlus, RotateCcw, Square, Trash2 } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Select } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import type { StrategistCitation, StrategistIdea } from "@/lib/db/schema";
import { formatDate, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { addIdeaToCalendarAction, deleteConversationAction } from "./actions";
import { InlineText, RichText } from "./rich-text";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: StrategistCitation[];
  ideas: StrategistIdea[];
  error: string | null;
  createdAt: string;
};

export type ConversationItem = { id: string; title: string; updatedAt: string; messages: number };

type Live = { tools: string[]; text: string };

const formatLabel: Record<StrategistIdea["format"], string> = { REEL: "Reel", CAROUSEL: "Carrusel", VIDEO: "Video", SHORT: "Short", STORY: "Historias", POST: "Post" };
const platformName: Record<StrategistIdea["platforms"][number], string> = { INSTAGRAM: "Instagram", YOUTUBE: "YouTube", TIKTOK: "TikTok" };
const kindIcon = { pieza: BarChart3, cifra: BarChart3, calendario: CalendarDays } as const;

function ideaToScript(idea: StrategistIdea): string {
  return `${idea.title}. ${idea.idea}${idea.hook ? ` Gancho: «${idea.hook}»` : ""}`.slice(0, 600);
}

function IdeaCard({ idea, messageId, canEdit, citations }: { idea: StrategistIdea; messageId: string; canEdit: boolean; citations: StrategistCitation[] }) {
  const [scheduled, setScheduled] = useState<{ entryId: string; date: string | null } | null>(idea.calendarEntryId ? { entryId: idea.calendarEntryId, date: idea.date } : null);
  const [pending, start] = useTransition();
  const add = () =>
    start(async () => {
      const res = await addIdeaToCalendarAction(messageId, idea.id);
      if (!res.ok) return void toast.error(res.error);
      setScheduled(res.data ?? null);
      toast.success(res.data?.date ? `Agregada al calendario para el ${formatDate(res.data.date)}.` : "Agregada al calendario, sin fecha.");
    });
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="pill !py-0.5 !text-[11px]">{formatLabel[idea.format]}</span>
        {idea.platforms.map((p) => (
          <span key={p} className="pill !py-0.5 !text-[11px] !text-muted">
            {platformName[p]}
          </span>
        ))}
        {idea.date && <span className="pill !py-0.5 !text-[11px] !text-muted">{formatDate(idea.date)}</span>}
      </div>
      <div>
        <p className="font-semibold text-white">{idea.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          <InlineText text={idea.idea} citations={citations} />
        </p>
        {idea.hook && <p className="mt-2 border-l-2 border-accent-hi/60 pl-3 text-sm text-text">«{idea.hook}»</p>}
        {idea.why && (
          <p className="mt-2 text-xs leading-relaxed text-placeholder">
            <InlineText text={idea.why} citations={citations} />
          </p>
        )}
      </div>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/guiones/nuevo?idea=${encodeURIComponent(ideaToScript(idea))}`} size="sm" icon={<FilePlus2 className="h-3.5 w-3.5" aria-hidden />}>
            Crear guion con esta idea
          </ButtonLink>
          {scheduled ? (
            <ButtonLink href={scheduled.date ? `/calendario?fecha=${scheduled.date}` : "/calendario"} variant="ghost" size="sm" icon={<CalendarCheck2 className="h-3.5 w-3.5 text-success" aria-hidden />}>
              Ver en el calendario
            </ButtonLink>
          ) : (
            <Button variant="ghost" size="sm" disabled={pending} onClick={add} icon={pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CalendarPlus className="h-3.5 w-3.5" aria-hidden />}>
              {pending ? "Agregando…" : "Agregar al calendario"}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function Sources({ citations }: { citations: StrategistCitation[] }) {
  if (citations.length === 0) return null;
  return (
    <details className="group rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-sm">
      <summary className="cursor-pointer list-none text-xs font-semibold text-muted transition hover:text-white [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-1.5">
          Fuentes ({citations.length}) <span className="font-normal text-placeholder group-open:hidden">· ver de dónde sale cada dato</span>
        </span>
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {citations.map((c) => {
          const Icon = kindIcon[c.kind];
          return (
            <li key={c.ref}>
              <Link href={c.href} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-white/5">
                <span className="mt-0.5 font-mono text-[11px] font-semibold text-accent-glow">{c.ref}</span>
                <Icon className="mt-0.5 h-3.5 w-3.5 flex-none text-accent-hi" aria-hidden />
                <span className="min-w-0">
                  <span className="line-clamp-1 text-text">{c.label}</span>
                  {c.detail && <span className="line-clamp-1 text-xs text-placeholder">{c.detail}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function AssistantAvatar() {
  return (
    <span className="tile-icon h-8 w-8 flex-none" aria-hidden>
      <Compass className="h-4 w-4" />
    </span>
  );
}

function MessageView({ message, canEdit, onRetry }: { message: ChatMessage; canEdit: boolean; onRetry?: () => void }) {
  if (message.role === "user") {
    return (
      <li className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md border border-accent/30 bg-accent/15 px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-white">{message.content}</p>
      </li>
    );
  }
  return (
    <li className="flex gap-3">
      <AssistantAvatar />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {message.error ? (
          <div className="flex flex-col gap-2">
            <Notice tone="danger">{message.error}</Notice>
            {onRetry && (
              <Button variant="ghost" size="sm" className="self-start" onClick={onRetry} icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}>
                Preguntar de nuevo
              </Button>
            )}
          </div>
        ) : (
          <>
            <RichText text={message.content} citations={message.citations} />
            {message.ideas.length > 0 && (
              <ul className="grid gap-3 md:grid-cols-2" aria-label="Ideas propuestas">
                {message.ideas.map((idea) => (
                  <IdeaCard key={idea.id} idea={idea} messageId={message.id} canEdit={canEdit} citations={message.citations} />
                ))}
              </ul>
            )}
            <Sources citations={message.citations} />
          </>
        )}
      </div>
    </li>
  );
}

function LiveView({ live }: { live: Live }) {
  return (
    <li className="flex gap-3" aria-live="polite">
      <AssistantAvatar />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {live.tools.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {live.tools.map((t, i) => {
              const current = i === live.tools.length - 1 && !live.text;
              return (
                <li key={`${t}-${i}`} className={cn("flex items-center gap-2", current ? "text-accent-glow" : "text-placeholder")}>
                  {current ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5 text-success" aria-hidden />}
                  {t}
                </li>
              );
            })}
          </ul>
        )}
        {live.text ? (
          <RichText text={live.text} citations={[]} />
        ) : (
          live.tools.length === 0 && (
            <p className="flex items-center gap-2 text-sm text-accent-glow">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Pensando…
            </p>
          )
        )}
      </div>
    </li>
  );
}

function ConversationList({ items, activeId, onDelete, canEdit }: { items: ConversationItem[]; activeId: string | null; onDelete: (item: ConversationItem) => void; canEdit: boolean }) {
  return (
    <nav aria-label="Tus conversaciones" className="card hidden max-h-[calc(100vh-8rem)] flex-col gap-1 self-start overflow-y-auto p-3 lg:sticky lg:top-6 lg:flex">
      <ButtonLink href="/estratega" variant="ghost" size="sm" className="mb-2" icon={<MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />}>
        Nueva conversación
      </ButtonLink>
      <p className="eyebrow px-2 pb-1">Conversaciones</p>
      {items.length === 0 ? (
        <p className="px-2 py-3 text-xs leading-relaxed text-placeholder">Aquí quedan guardadas tus preguntas para volver a ellas.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {items.map((c) => (
            <li key={c.id} className="group relative">
              <Link
                href={`/estratega?c=${c.id}`}
                aria-current={c.id === activeId ? "page" : undefined}
                className={cn("block rounded-lg py-2 pr-9 pl-2.5 text-sm transition", c.id === activeId ? "bg-accent/15 text-white" : "text-muted hover:bg-white/5 hover:text-white")}
              >
                <span className="line-clamp-2 leading-snug">{c.title}</span>
                <span className="mt-0.5 block text-[11px] text-placeholder">{formatRelative(c.updatedAt)}</span>
              </Link>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onDelete(c)}
                  aria-label={`Borrar la conversación «${c.title}»`}
                  className="absolute top-2 right-1.5 grid h-7 w-7 place-items-center rounded-md text-placeholder opacity-0 transition group-hover:opacity-100 hover:bg-white/10 hover:text-danger focus-visible:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

/**
 * Chat con el estratega. Manda la pregunta a /api/estratega y va mostrando lo que llega en streaming:
 * qué datos está revisando y el texto de la respuesta. Al terminar, la respuesta trae sus fuentes y sus ideas.
 */
export function StrategistChat({
  conversationId: initialId,
  initialMessages,
  conversations: initialConversations,
  suggestions,
  remaining: initialRemaining,
  limit,
  canEdit,
  aiReady,
  initialQuestion,
  autoSend,
}: {
  conversationId: string | null;
  initialMessages: ChatMessage[];
  conversations: ConversationItem[];
  suggestions: string[];
  remaining: number;
  limit: number;
  canEdit: boolean;
  aiReady: boolean;
  initialQuestion: string;
  autoSend: boolean;
}) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState(initialId);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [conversations, setConversations] = useState(initialConversations);
  const [question, setQuestion] = useState(initialQuestion);
  const [live, setLive] = useState<Live | null>(null);
  const [remaining, setRemaining] = useState(initialRemaining);
  const [toDelete, setToDelete] = useState<ConversationItem | null>(null);
  const [deleting, startDelete] = useTransition();
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autoSent = useRef(false);
  const busy = live !== null;
  const blocked = !canEdit || !aiReady || remaining <= 0;

  useEffect(() => {
    if (messages.length || live) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, live?.tools.length, live?.text.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  async function ask(text: string) {
    const q = text.trim();
    if (q.length < 3 || busy || blocked) return;
    const now = new Date().toISOString();
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", content: q, citations: [], ideas: [], error: null, createdAt: now }]);
    setQuestion("");
    setLive({ tools: [], text: "" });
    const controller = new AbortController();
    abortRef.current = controller;
    let convId = conversationId;
    let finished = false;
    try {
      const res = await fetch("/api/estratega", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: convId, question: q }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "No pudimos responder. Prueba de nuevo.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as
            | { type: "conversation"; id: string; title: string }
            | { type: "tool"; label: string }
            | { type: "text"; delta: string }
            | { type: "reset" }
            | { type: "done"; message: ChatMessage; remaining: number }
            | { type: "error"; error: string };
          if (event.type === "conversation") {
            convId = event.id;
            setConversationId(event.id);
            setConversations((c) => [{ id: event.id, title: event.title, updatedAt: now, messages: 1 }, ...c]);
            window.history.replaceState(null, "", `/estratega?c=${event.id}`);
          } else if (event.type === "tool") setLive((l) => (l ? { ...l, tools: [...l.tools, event.label] } : l));
          else if (event.type === "text") setLive((l) => (l ? { ...l, text: l.text + event.delta } : l));
          else if (event.type === "reset") setLive((l) => (l ? { ...l, text: "" } : l));
          else if (event.type === "done") {
            finished = true;
            setMessages((m) => [...m, event.message]);
            setRemaining(event.remaining);
            setConversations((c) => c.map((x) => (x.id === convId ? { ...x, updatedAt: event.message.createdAt, messages: x.messages + 2 } : x)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
          } else if (event.type === "error") {
            finished = true;
            setMessages((m) => [...m, { id: `error-${Date.now()}`, role: "assistant", content: "", citations: [], ideas: [], error: event.error, createdAt: new Date().toISOString() }]);
            setRemaining((r) => Math.max(0, r - 1));
          }
        }
      }
      if (!finished) throw new Error("La respuesta se cortó. Prueba de nuevo.");
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      setMessages((m) => [
        ...m,
        { id: `error-${Date.now()}`, role: "assistant", content: "", citations: [], ideas: [], error: aborted ? "Detuviste la respuesta." : error instanceof Error ? error.message : "No pudimos responder. Prueba de nuevo.", createdAt: new Date().toISOString() },
      ]);
    } finally {
      setLive(null);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }

  useEffect(() => {
    if (autoSend && initialQuestion && !autoSent.current) {
      autoSent.current = true;
      void ask(initialQuestion);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function submit(e: FormEvent) {
    e.preventDefault();
    void ask(question);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask(question);
    }
  }

  function confirmDelete() {
    if (!toDelete) return;
    const target = toDelete;
    startDelete(async () => {
      const res = await deleteConversationAction(target.id);
      if (!res.ok) return void toast.error(res.error);
      setToDelete(null);
      setConversations((c) => c.filter((x) => x.id !== target.id));
      toast.success("Conversación borrada.");
      if (target.id === conversationId) router.push("/estratega");
    });
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const empty = messages.length === 0 && !live;

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <ConversationList items={conversations} activeId={conversationId} onDelete={setToDelete} canEdit={canEdit} />

      <div className="flex min-w-0 flex-col gap-4">
        {conversations.length > 0 && (
          <div className="flex items-center gap-2 lg:hidden">
            <label htmlFor="conversacion" className="sr-only">
              Tus conversaciones
            </label>
            <Select id="conversacion" value={conversationId ?? ""} onChange={(e) => router.push(e.target.value ? `/estratega?c=${e.target.value}` : "/estratega")} className="min-w-0 flex-1 !py-2 text-sm">
              <option value="">{conversationId ? "Nueva conversación" : `Tus conversaciones (${conversations.length})`}</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </div>
        )}

        <section className="card flex min-h-[420px] flex-col p-4 sm:p-6" aria-label="Conversación con el estratega">
          {empty ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-5 py-6 text-center">
              <span className="tile-icon h-12 w-12 animate-float">
                <Compass className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h2 className="text-lg font-semibold">¿Qué quieres saber de tu contenido?</h2>
                <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted">Responde con tus métricas, tus ganchos, tu calendario y tu meta. Cada dato viene con el enlace a la pieza de donde sale.</p>
              </div>
              <ul className="flex w-full max-w-xl flex-col gap-2" aria-label="Preguntas sugeridas">
                {suggestions.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      disabled={blocked}
                      onClick={() => void ask(s)}
                      className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm text-text transition hover:border-accent-hi/50 hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ol className="flex flex-col gap-6" aria-label="Mensajes">
              {messages.map((m) => (
                <MessageView key={m.id} message={m} canEdit={canEdit} onRetry={m.error && lastUser && !busy && !blocked ? () => void ask(lastUser.content) : undefined} />
              ))}
              {live && <LiveView live={live} />}
            </ol>
          )}
          <div ref={endRef} />
        </section>

        {!aiReady ? (
          <Notice tone="warning">La IA no está configurada en esta instalación. Avísale a soporte para activar el estratega.</Notice>
        ) : !canEdit ? (
          <Notice tone="info">Tu usuario es de solo lectura: puedes ver tus conversaciones, pero para preguntar pide acceso de edición al dueño de la cuenta.</Notice>
        ) : remaining <= 0 ? (
          <Notice tone="warning">Llegaste al límite de {limit} preguntas por hoy. Vuelve mañana.</Notice>
        ) : null}

        <form onSubmit={submit} className="card sticky bottom-3 z-10 flex flex-col gap-2 !bg-card/95 p-3 shadow-[0_-12px_32px_rgba(2,6,26,0.7)] backdrop-blur-xl sm:p-4">
          <label htmlFor="pregunta" className="sr-only">
            Tu pregunta
          </label>
          <div className="flex items-end gap-2">
            <textarea
              id="pregunta"
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={onKey}
              rows={question.split("\n").length > 1 || question.length > 70 ? 3 : 1}
              maxLength={1000}
              disabled={blocked}
              placeholder={empty ? "Pregunta lo que quieras…" : "Pregunta algo más…"}
              className="field max-h-40 min-h-11 flex-1 resize-none !py-2.5 text-[15px]"
            />
            {busy ? (
              <Button variant="ghost" className="h-11 flex-none !px-3.5" onClick={() => abortRef.current?.abort()} aria-label="Detener la respuesta">
                <Square className="h-4 w-4 fill-current" aria-hidden />
              </Button>
            ) : (
              <Button type="submit" className="h-11 flex-none !px-3.5" disabled={blocked || question.trim().length < 3} aria-label="Preguntar">
                <ArrowUp className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </div>
          <p className="flex flex-wrap justify-between gap-x-3 gap-y-1 px-1 text-[11px] text-placeholder">
            <span className="hidden sm:inline">Enter para enviar · Shift + Enter para otra línea</span>
            <span aria-live="polite">
              {remaining} de {limit} preguntas disponibles hoy
            </span>
          </p>
        </form>
      </div>

      <Dialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="¿Borrar esta conversación?"
        description={toDelete ? `«${toDelete.title}» y sus respuestas se borran para siempre. Las ideas que agregaste al calendario se quedan.` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setToDelete(null)}>
              Cancelar
            </Button>
            <Button variant="danger" disabled={deleting} onClick={confirmDelete} icon={<Trash2 className="h-4 w-4" aria-hidden />}>
              {deleting ? "Borrando…" : "Borrar"}
            </Button>
          </>
        }
      />
    </div>
  );
}
