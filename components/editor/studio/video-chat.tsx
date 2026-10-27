"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Eye, Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { sentences } from "@/lib/ai/prompts/editor";
import { FX_INFO } from "@/lib/video/fx/catalog";
import { CAPTION_PRESETS } from "@/lib/video/captions";
import type { RefImage } from "@/lib/video/compos/schema";
import type { Word } from "@/lib/video/types";
import { cn } from "@/lib/utils";
import { clearVideoChatAction, loadVideoChatAction, videoChatAction, videoChatDoneAction, type VideoChatItem, type VideoChatThread } from "../video-chat-actions";
import { AttachButton, AttachList, refsOf, useAttachments } from "./attachments";
import type { StudioApi } from "./types";

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const IDEAS = ["¿Qué le falta a este video para retener más?", "Ponle subtítulos y anima el gancho", "Dame 3 ideas de animaciones para el principio", "Recorta los silencios"];
const KIND_LABEL: Record<VideoChatItem["kind"], string> = { animacion: "Animación", grafico: "Gráfico", video: "Tu video como b-roll", subtitulos: "Subtítulos", recortar: "Recortar" };

/**
 * Chat con la IA (panel derecho sin nada elegido): conversas sobre tu video, la IA contesta mirando la transcripción y lo
 * que ya tiene, y propone acciones con su tramo que ejecutas con un toque. La charla queda guardada en este video.
 */
export function VideoChat({ api }: { api: StudioApi }) {
  const { props, state, timeline } = api;
  const projectId = props.projectId;
  const [thread, setThread] = useState<VideoChatThread>({ messages: [] });
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const files = useAttachments(projectId, { video: true });
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let alive = true;
    void loadVideoChatAction(projectId).then((r) => alive && r.ok && setThread(r.thread));
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [thread.messages.length, pending]);

  /** Lo que ya tiene el video, para que la IA no proponga encima sin saberlo. */
  function stateText(): string {
    const out = [`Subtítulos: ${state.preset === "ninguno" ? "apagados" : (CAPTION_PRESETS[state.preset]?.label ?? state.preset)}`, `Palabras cortadas: ${api.removedSet.size}`];
    for (const s of api.composSegs.slice(0, 40)) out.push(`Animación «${s.item.name}» ${s.start.toFixed(1)}–${s.end.toFixed(1)} s`);
    for (const s of api.segments.slice(0, 30)) out.push(`${s.option.source === "graphic" ? "Gráfico" : "B-roll"} ${s.start.toFixed(1)}–${s.end.toFixed(1)} s`);
    for (const s of api.fxSegs.slice(0, 30)) out.push(`Efecto «${FX_INFO[s.item.kind]?.label ?? s.item.kind}» ${s.start.toFixed(1)}–${s.end.toFixed(1)} s`);
    return out.join("\n").slice(0, 5900);
  }

  function send(msg = text) {
    const t = msg.trim();
    if (t.length < 2 || pending || files.uploading) return;
    setText("");
    setError(null);
    const before = thread;
    setThread({ messages: [...thread.messages, { role: "user", text: t, at: new Date().toISOString() }] });
    const sel = api.selection?.kind === "range" ? { from: api.selection.from, to: api.selection.to } : null;
    const attachments = files.list.filter((a) => a.status === "ready").map((a) => ({ ref: a.ref, kind: a.kind, name: a.name, duration: a.duration ?? null }));
    start(async () => {
      const list = sentences(timeline.words as unknown as Word[]).map((f) => ({ from: f.from, to: f.to, start: f.start, end: f.end, text: f.text.slice(0, 600) }));
      const r = await videoChatAction({ projectId, text: t, sentences: list.slice(0, 800), duration: timeline.duration, format: state.format, playhead: api.time, selection: sel, state: stateText(), attachments });
      if (!r.ok) {
        setThread(before);
        setText(t);
        setError(r.error);
        return;
      }
      setThread(r.thread);
    });
  }

  function timeOf(it: VideoChatItem): string {
    if (it.scope === "todo") return "todo el video";
    const a = timeline.words.find((w) => w.id >= it.from_word);
    const b = [...timeline.words].reverse().find((w) => w.id <= it.to_word);
    return a && b ? `${mmss(a.start)}–${mmss(b.end)}` : "";
  }

  async function run(it: VideoChatItem, key: string) {
    const range = { from: it.from_word, to: it.to_word };
    if (it.kind === "subtitulos") api.tools.subtitle();
    else if (it.kind === "recortar") {
      const r = await api.tools.trim();
      if (!r.ok) return toast.error(r.error);
      toast.success(r.removed ? `Se cortaron ${r.removed} palabras y se acortaron los silencios.` : "Solo se acortaron los silencios.");
    } else if (it.kind === "video") {
      const clip = files.list.find((a) => a.ref === it.attachments.find((x) => x.use === "broll")?.ref)?.clip;
      if (!clip) return toast.error("Ese video ya no está en los adjuntos. Vuelve a adjuntarlo.");
      api.tools.clipAt(range, clip);
    } else if (it.scope === "todo") api.tools.wholeVideo(it.prompt);
    else if (it.kind === "grafico") api.tools.graphicAt(range, it.prompt);
    else {
      const pick = it.attachments.filter((x) => x.use !== "broll").map((x) => ({ ref: x.ref, use: x.use as RefImage["use"] }));
      api.tools.animationAt(range, it.prompt, pick.length ? refsOf(files.list, pick) : undefined);
    }
    setDone((d) => new Set(d).add(key));
    void videoChatDoneAction(projectId, `${KIND_LABEL[it.kind]}: ${it.title} (${timeOf(it)})`);
  }

  const canEdit = props.canEdit;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ol ref={list} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3" aria-label="Conversación con la IA" aria-live="polite">
        {thread.messages.length === 0 && (
          <li className="flex flex-col gap-2">
            <p className="text-sm text-text">Pregúntame lo que quieras de este video o dime qué cambiar. Miro tu transcripción y lo que ya tiene, y te propongo acciones que haces con un toque.</p>
            {canEdit && (
              <div className="flex flex-wrap gap-1.5" aria-label="Ideas">
                {IDEAS.map((s) => (
                  <button key={s} type="button" className="pill border border-white/10 text-left text-[11px] text-muted transition hover:border-white/25 hover:text-text" onClick={() => send(s)} disabled={pending}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </li>
        )}
        {thread.messages.map((m, i) =>
          m.role === "applied" ? (
            <li key={i} className="flex items-start gap-1.5 self-stretch rounded-xl bg-success/10 px-3 py-1.5 text-xs text-success">
              <Check className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden /> {m.text}
            </li>
          ) : (
            <li key={i} className={cn("flex flex-col gap-2", m.role === "user" ? "items-end" : "items-start")}>
              <span className={cn("max-w-[94%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap", m.role === "user" ? "bg-white text-paper" : "border border-white/10 bg-card text-text")}>{m.text}</span>
              {m.items?.map((it, k) => {
                const key = `${i}-${k}`;
                const isDone = done.has(key);
                return (
                  <div key={key} className={cn("flex w-full flex-col gap-1.5 rounded-xl border p-2.5", isDone ? "border-success/30 bg-success/[0.05]" : "border-accent/30 bg-accent/[0.04]")}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold text-white">{it.title}</span>
                        <span className="block text-[11px] text-muted">
                          {KIND_LABEL[it.kind]} · {timeOf(it)}
                        </span>
                      </span>
                      {it.scope !== "todo" && (
                        <button
                          type="button"
                          className="grid h-7 w-7 flex-none place-items-center rounded-lg text-muted hover:bg-white/[0.06] hover:text-white"
                          aria-label="Ver ese momento"
                          title="Ver ese momento"
                          onClick={() => {
                            const w = timeline.words.find((x) => x.id >= it.from_word);
                            if (w) api.actions.seek(w.start);
                          }}
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </div>
                    {(it.kind === "animacion" || it.kind === "grafico") && <p className="line-clamp-3 text-[11px] text-muted">{it.prompt}</p>}
                    {canEdit && (
                      <Button size="sm" variant={isDone ? "ghost" : "primary"} className="self-start" disabled={isDone} onClick={() => void run(it, key)} icon={isDone ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}>
                        {isDone ? "Hecho" : it.kind === "animacion" ? "Crear la animación" : it.kind === "grafico" ? "Crear el gráfico" : it.kind === "video" ? "Ponerlo ahí" : it.kind === "subtitulos" ? "Poner subtítulos" : it.kind === "recortar" ? "Recortar" : "Hacerlo"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </li>
          ),
        )}
        {pending && (
          <li className="self-start rounded-2xl border border-white/10 bg-card px-3 py-2 text-sm text-muted">
            <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Pensando…
          </li>
        )}
      </ol>
      {canEdit && (
        <div className="flex flex-col gap-2 border-t border-white/10 bg-card px-4 py-3">
          <AttachList api={files} showUse={false} />
          <label htmlFor="video-chat-msg" className="sr-only">
            Tu mensaje para la IA
          </label>
          <Textarea
            id="video-chat-msg"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            className="!min-h-16 text-sm"
            placeholder="Escríbele a la IA… (Enter para enviar, Shift+Enter para otra línea)"
            disabled={pending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" onClick={() => send()} disabled={pending || files.uploading || text.trim().length < 2} icon={<Send className="h-3.5 w-3.5" aria-hidden />}>
              {files.uploading ? "Subiendo…" : "Enviar"}
            </Button>
            <AttachButton api={files} video disabled={pending} />
            {thread.messages.length > 0 && (
              <button
                type="button"
                className="ml-auto text-[11px] text-muted hover:text-white"
                disabled={pending}
                onClick={() => {
                  void clearVideoChatAction(projectId);
                  setThread({ messages: [] });
                  setDone(new Set());
                }}
              >
                Empezar de nuevo
              </button>
            )}
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
