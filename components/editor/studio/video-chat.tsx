"use client";

import { GRADE_PRESETS, matchingGradePreset } from "@/lib/video/grade";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Eye, ImagePlus, Loader2, Mic, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { sentences } from "@/lib/ai/prompts/editor";
import { FX_INFO } from "@/lib/video/fx/catalog";
import { CAPTION_PRESETS } from "@/lib/video/captions";
import type { RefImage } from "@/lib/video/compos/schema";
import type { Word } from "@/lib/video/types";
import { cn } from "@/lib/utils";
import { mentionSlug } from "@/lib/video/library-ficha";
import { clearVideoChatAction, loadVideoChatAction, videoChatAction, videoChatClipAction, videoChatDoneAction, videoChatLookAction, type VideoChatItem, type VideoChatThread } from "../video-chat-actions";
import { mentionLibraryAction } from "../library-mention-actions";
import { editAction } from "../director-actions";
import { AttachButton, AttachList, refsOf, useAttachments, type Attachment } from "./attachments";
import { clipOptionAction } from "../edit-actions";
import { MentionMenu, useLibraryMention } from "./library-mention";
import type { SignedOption } from "../broll-panel";
import type { StudioApi } from "./types";
import { LIBRARY_MIME, type LibraryDrop } from "./studio-timeline";
import { useDictation } from "./use-dictation";

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const IDEAS = ["¿Qué le falta a este video para retener más?", "Ponle subtítulos y anima el gancho", "Dame 3 ideas de animaciones para el principio", "Recorta los silencios"];
const POLL_MS = 5000;
const KIND_LABEL: Record<VideoChatItem["kind"], string> = { animacion: "Animación", grafico: "Gráfico", video: "Tu video como b-roll", subtitulos: "Subtítulos", recortar: "Recortar", editar: "Edición del video", texto: "Texto", color: "Color del video" };

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
  // Adjuntos que ya se mandaron, por el mensaje de la persona (así los botones de las acciones los encuentran).
  const [sent, setSent] = useState<Record<number, Attachment[]>>({});
  const filesFor = (i: number): Attachment[] => {
    for (let j = i; j >= 0; j--) if (sent[j]) return sent[j]!;
    return files.list;
  };
  const list = useRef<HTMLOListElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  // Dictado: lo que dices se suma a lo que ya estaba escrito (se ve mientras hablas y queda firme al terminar).
  const dictBase = useRef("");
  // Al enviar se deja de escuchar y lo que llegue después ya no escribe en el campo (el mensaje se fue).
  const dictOn = useRef(false);
  const dictation = useDictation((final, interim) => {
    if (dictOn.current) setText(`${dictBase.current}${[final, interim].filter(Boolean).join(" ")}`.slice(0, 2000));
  });
  function toggleDictation() {
    if (!dictation.listening) {
      dictBase.current = text.trim() ? `${text.trim()} ` : "";
      dictOn.current = true;
    }
    dictation.toggle();
  }

  // Soltar en el chat: archivos de la computadora (se adjuntan) o piezas de la Biblioteca (se nombran con @).
  const [over, setOver] = useState(false);
  const canDrop = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    return types.includes("Files") || types.includes(LIBRARY_MIME);
  };
  function onDrop(e: React.DragEvent) {
    if (!canDrop(e)) return;
    e.preventDefault();
    setOver(false);
    if (!canEdit || pending) return;
    const raw = e.dataTransfer.getData(LIBRARY_MIME);
    if (raw) {
      let item: LibraryDrop | null = null;
      try {
        item = JSON.parse(raw) as LibraryDrop;
      } catch {
        item = null;
      }
      if (item?.type !== "clip") return void toast.info("Al chat se pueden soltar clips e imágenes de tu biblioteca, o archivos de tu computadora.");
      const o = item.option;
      const slug = mentionSlug(o.title ?? "pieza");
      const ref = files.addLibrary({ id: o.id, kind: o.kind === "image" ? "image" : "video", title: o.title ?? "Pieza", slug, duration: o.duration ?? null, thumbUrl: o.thumbUrl, hasFicha: true, summary: null });
      if (!ref) return void toast.info("Ya hay demasiados adjuntos en este mensaje.");
      setText((t) => (t.includes(`@${slug}`) ? t : `${t.trim() ? `${t.trim()} ` : ""}@${slug} `));
      field.current?.focus();
      return;
    }
    const dropped = Array.from(e.dataTransfer.files);
    const usable = dropped.filter((f) => f.type.startsWith("video/") || f.type.startsWith("image/") || /\.(mp4|mov|webm|mkv|m4v)$/i.test(f.name));
    if (!usable.length) return void toast.info("Suelta un video o una imagen.");
    files.add(usable);
    if (usable.length < dropped.length) toast.info("Algunos archivos no son videos ni imágenes y no se adjuntaron.");
    field.current?.focus();
  }

  const mention = useLibraryMention({ text, setText, field, onPick: (item) => files.addLibrary(item) });
  const looking = thread.looking;
  const watching = thread.watching;

  useEffect(() => {
    let alive = true;
    void loadVideoChatAction(projectId).then((r) => alive && r.ok && setThread(r.thread));
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [thread.messages.length, pending, looking, watching]);

  /** Lo que ya tiene el video, para que la IA no proponga encima sin saberlo. */
  function stateText(): string {
    const out = [`Subtítulos: ${state.preset === "ninguno" ? "apagados" : (CAPTION_PRESETS[state.preset]?.label ?? state.preset)}`, `Palabras cortadas: ${api.removedSet.size}`];
    for (const s of api.composSegs.slice(0, 40)) out.push(`Animación «${s.item.name}» ${s.start.toFixed(1)}–${s.end.toFixed(1)} s`);
    for (const s of api.segments.slice(0, 30)) out.push(`${s.option.text ? `Texto «${s.option.text.text.slice(0, 60)}»` : s.option.source === "graphic" ? "Gráfico" : "B-roll"} ${s.start.toFixed(1)}–${s.end.toFixed(1)} s`);
    for (const s of api.fxSegs.slice(0, 30)) out.push(`Efecto «${FX_INFO[s.item.kind]?.label ?? s.item.kind}» ${s.start.toFixed(1)}–${s.end.toFixed(1)} s`);
    const look = matchingGradePreset(state.grade);
    out.push(`Color del video: ${state.grade ? (GRADE_PRESETS.find((p) => p.id === look)?.label ?? "ajustado a mano") : "como se grabó"}`);
    return out.join("\n").slice(0, 5900);
  }

  /** Lo que la IA mira en cada turno: frases, cabezal, tramo elegido, lo que ya tiene y los adjuntos listos. */
  function context() {
    const sel = api.selection?.kind === "range" ? { from: api.selection.from, to: api.selection.to } : null;
    const ready = files.list.filter((a) => a.status === "ready");
    // Un video subido aquí también queda en tu biblioteca: el servidor le muestra a Claude sus cuadros y su ficha.
    const attachments = ready.map((a) => {
      const libraryId = a.libraryId ?? (a.kind === "video" ? a.clip?.id : undefined);
      return { ref: a.ref, kind: a.kind, name: a.name, duration: a.duration ?? null, ...(libraryId ? { libraryId } : {}) };
    });
    const images = ready.flatMap((a) => (a.kind === "image" && a.image ? [{ ...a.image, use: "style" as const }] : [])).slice(0, 4);
    const list = sentences(timeline.words as unknown as Word[]).map((f) => ({ from: f.from, to: f.to, start: f.start, end: f.end, text: f.text.slice(0, 600) }));
    return { projectId, sentences: list.slice(0, 800), duration: timeline.duration, format: state.format, playhead: api.time, selection: sel, state: stateText(), attachments, images };
  }
  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  });

  // Mientras la IA mira un link de referencia, se pregunta cada pocos segundos hasta que contesta.
  useEffect(() => {
    if (!looking) return;
    let alive = true;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      const r = await videoChatLookAction({ ...contextRef.current(), lookId: looking }).catch(() => null);
      busy = false;
      if (!alive || !r) return;
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (!r.waiting) setThread(r.thread);
    };
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [looking]);

  // Mientras la app mira un video adjunto, se pregunta cada pocos segundos hasta que la IA contesta.
  useEffect(() => {
    if (!watching) return;
    let alive = true;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      const r = await videoChatClipAction({ ...contextRef.current(), waitId: watching }).catch(() => null);
      busy = false;
      if (!alive || !r) return;
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (!r.waiting) setThread(r.thread);
    };
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [watching]);

  function send(msg = text) {
    const t = msg.trim();
    if (t.length < 2 || pending || files.uploading) return;
    dictOn.current = false;
    dictation.stop();
    setText("");
    setError(null);
    const before = thread;
    const sending = files.list.filter((a) => a.status === "ready");
    const ctx = context();
    setThread({ messages: [...thread.messages, { role: "user", text: t, at: new Date().toISOString(), ...(sending.some((a) => a.kind === "image") ? { images: sending.filter((a) => a.kind === "image").length } : {}) }], ...(thread.looking ? { looking: thread.looking } : {}) });
    // Los adjuntos se van con el mensaje: el cuadro de escribir queda libre.
    if (sending.length) files.clear();
    start(async () => {
      const r = await videoChatAction({ ...ctx, text: t });
      if (!r.ok) {
        setThread(before);
        setText(t);
        setError(r.error);
        return;
      }
      if (sending.length) {
        const userIdx = [...r.thread.messages].map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0).pop();
        if (userIdx != null) setSent((m) => ({ ...m, [userIdx]: sending }));
      }
      setThread(r.thread);
      // «Edítalo», «dale», «hazlo»: las acciones del último mensaje se hacen solas.
      if (r.go) {
        const i = r.thread.messages.length - 1;
        const items = r.thread.messages[i]?.items ?? [];
        for (const [k, it] of items.entries()) await run(it, `${i}-${k}`);
      }
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
    if (it.kind === "editar") {
      // Lo hace el director sobre lo guardado (tarda unos minutos).
      const r = await editAction(projectId, it.prompt.slice(0, 600));
      if (!r.ok) return toast.error(r.error);
      toast.success("Editando el video con lo que pediste.", { description: "Tarda unos minutos. Puedes ver el avance en el video." });
    } else if (it.kind === "subtitulos") api.tools.subtitle();
    else if (it.kind === "color" && it.look) api.tools.lookPreset(it.look);
    else if (it.kind === "texto") api.tools.textAt(range, it.text_style ?? "title", it.prompt);
    else if (it.kind === "recortar") {
      const r = await api.tools.trim();
      if (!r.ok) return toast.error(r.error);
      toast.success(r.removed ? `Se cortaron ${r.removed} palabras y se acortaron los silencios.` : "Solo se acortaron los silencios.");
    } else if (it.kind === "video") {
      let clip: SignedOption | undefined = filesFor(Number(key.split("-")[0])).find((a) => a.ref === it.attachments.find((x) => x.use === "broll")?.ref)?.clip;
      if (!clip && it.clipId) {
        // Un clip de tu biblioteca que eligió la IA por lo que se ve.
        const r = await clipOptionAction(it.clipId, { duration: 0, width: 1080, height: 1920 });
        if (!r.ok) return toast.error(r.error);
        clip = r.option;
      }
      if (!clip) return toast.error("Ese video ya no está en los adjuntos. Vuelve a adjuntarlo.");
      const start = it.clipStart ?? it.clip_start;
      // Desde el segundo del clip que muestra lo que se dice (el estudio lo aplica al ponerlo).
      api.tools.clipAt(range, start != null && clip.kind !== "image" ? { ...clip, moment: { start, end: Math.min(clip.duration || start + 8, start + 8), what: it.title } } : clip);
    } else if (it.scope === "todo" && it.kind === "animacion") {
      // Directo, sin pantalla de plan: la animación recibe la charla entera.
      if (!(await api.tools.wholeFromChat(it.prompt, it.layout ?? "full"))) return;
    } else if (it.scope === "todo") api.tools.wholeVideo(it.prompt);
    else if (it.kind === "grafico") api.tools.graphicAt(range, it.prompt);
    else {
      const pick = it.attachments.filter((x) => x.use !== "broll").map((x) => ({ ref: x.ref, use: x.use as RefImage["use"] }));
      const refs = pick.length ? refsOf(filesFor(Number(key.split("-")[0])), pick) : [];
      // Las hojas de cuadros de los videos de referencia de la charla van como referencia de estilo.
      for (const clipId of it.styleClips ?? []) {
        if (refs.length >= 4) break;
        const r = await mentionLibraryAction(projectId, clipId);
        if (r.ok && r.attachment.kind === "video") for (const sheet of r.attachment.refs) refs.push({ ...sheet, use: "style", note: `Cuadros del video «${r.attachment.name}» que mandaste de referencia` });
      }
      api.tools.animationAt(range, it.prompt, refs.length ? refs.slice(0, 4) : undefined, { fromChat: true });
    }
    setDone((d) => new Set(d).add(key));
    void videoChatDoneAction(projectId, `${KIND_LABEL[it.kind]}: ${it.title} (${timeOf(it)})`);
  }

  const canEdit = props.canEdit;
  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (!canEdit || !canDrop(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={onDrop}
    >
      {over && (
        <div className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-card/90 text-center">
          <p className="flex flex-col items-center gap-1.5 text-sm font-semibold text-white">
            <ImagePlus className="h-6 w-6 text-accent" aria-hidden />
            Suelta para adjuntarlo al mensaje
            <span className="text-xs font-normal text-muted">Después dile dónde ponerlo: «pon este video cuando hablo de…»</span>
          </p>
        </div>
      )}
      <ol ref={list} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3" aria-label="Conversación con la IA" aria-live="polite">
        {thread.messages.length === 0 && (
          <li className="flex flex-col gap-2">
            <p className="text-sm text-text">Pregúntame lo que quieras de este video o dime qué cambiar. Miro tu transcripción y lo que ya tiene, y te propongo acciones que haces con un toque. También puedes pegarme un link de Instagram, TikTok o YouTube: lo miro y te digo qué copiaría.</p>
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
              <span className={cn("max-w-[94%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap", m.role === "user" ? "bg-white text-paper" : "border border-white/10 bg-card text-text")}>
                {m.text}
                {m.images || m.videos ? <span className="mt-1 block text-[11px] opacity-75">Con {[m.images ? (m.images === 1 ? "1 imagen" : `${m.images} imágenes`) : "", m.videos ? (m.videos === 1 ? "1 video" : `${m.videos} videos`) : ""].filter(Boolean).join(" y ")}</span> : null}
              </span>
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
                    {it.kind === "texto" && <p className="line-clamp-2 text-[11px] text-white">«{it.prompt}»</p>}
                    {canEdit && (
                      <Button size="sm" variant={isDone ? "ghost" : "primary"} className="self-start" disabled={isDone} onClick={() => void run(it, key)} icon={isDone ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}>
                        {isDone ? "Hecho" : it.kind === "animacion" ? "Crear la animación" : it.kind === "grafico" ? "Crear el gráfico" : it.kind === "video" ? "Ponerlo ahí" : it.kind === "subtitulos" ? "Poner subtítulos" : it.kind === "recortar" ? "Recortar" : it.kind === "editar" ? "Editar así" : it.kind === "texto" ? "Poner el texto" : it.kind === "color" ? "Aplicar el color" : "Hacerlo"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </li>
          ),
        )}
        {watching && !pending && (
          <li className="self-start rounded-2xl border border-accent/30 bg-accent/[0.04] px-3 py-2 text-sm text-muted">
            <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Estoy mirando tu video…
          </li>
        )}
        {looking && !pending && (
          <li className="self-start rounded-2xl border border-accent/30 bg-accent/[0.04] px-3 py-2 text-sm text-muted">
            <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Mirando el video de referencia…
          </li>
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
          <div className="relative">
          <MentionMenu api={mention} id="video-chat-mention" />
          <Textarea
            id="video-chat-msg"
            value={text}
            ref={field}
            onChange={(e) => {
              setText(e.target.value);
              mention.sync(e.target.value, e.target.selectionStart);
            }}
            onBlur={() => setTimeout(mention.close, 150)}
            maxLength={2000}
            className="!min-h-16 text-sm"
            placeholder={dictation.listening ? "Te escucho… toca el micrófono para terminar" : "Escríbele o dicta con el micrófono. Arrastra aquí videos o imágenes; con @ nombras algo de tu biblioteca"}
            disabled={pending}
            aria-controls={mention.open ? "video-chat-mention" : undefined}
            onKeyDown={(e) => {
              if (mention.onKeyDown(e)) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" onClick={() => send()} disabled={pending || files.uploading || text.trim().length < 2} icon={<Send className="h-3.5 w-3.5" aria-hidden />}>
              {files.uploading ? "Subiendo…" : "Enviar"}
            </Button>
            <AttachButton api={files} video disabled={pending} />
            {dictation.supported && (
              <Button
                size="sm"
                variant={dictation.listening ? "primary" : "ghost"}
                onClick={toggleDictation}
                disabled={pending}
                aria-pressed={dictation.listening}
                icon={<Mic className={cn("h-3.5 w-3.5", dictation.listening && "animate-pulse motion-reduce:animate-none")} aria-hidden />}
                title={dictation.listening ? "Terminar de dictar" : "Dictar con el micrófono"}
              >
                {dictation.listening ? "Escuchando…" : "Dictar"}
              </Button>
            )}
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
          {dictation.error && <p className="text-xs text-danger">{dictation.error}</p>}
        </div>
      )}
    </div>
  );
}
