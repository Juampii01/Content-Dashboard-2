"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Check, Clapperboard, Eye, Link2, Loader2, Send, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { UploadDropzone } from "@/components/ui/upload-dropzone";
import { isReferenceLink } from "@/lib/video/director/request";
import type { LookView } from "@/lib/video/look";
import { cn } from "@/lib/utils";
import { VIDEO_ACCEPT } from "../constants";
import { reserveReferenceAction } from "../director-actions";
import { applyLookAction, lookChatAction, lookStatusAction, startLookAction, toggleLookItemAction } from "../look-actions";
import { putFile } from "../upload-manager";
import type { StudioApi } from "../studio/types";

const MAX_REFERENCE = 500 * 1024 * 1024;
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const WORKING = new Set(["queued", "analyzing", "thinking"]);

/**
 * «Mira este video y dime qué ves»: pegas el link (o subes) una edición que te gusta. Claude la mira cuadro a cuadro, te
 * cuenta qué ve y dónde lo pondría en tu video, conversan y, al tocar «Crear lo elegido», cada momento elegido es una
 * animación a medida con los cuadros de la referencia. Nada cambia hasta que aplicas.
 */
export function LookCard({ api }: { api: StudioApi }) {
  const { projectId, canEdit } = api.props;
  const [look, setLook] = useState<LookView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<"link" | "upload">("link");
  const [link, setLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const [pending, start] = useTransition();
  const list = useRef<HTMLOListElement>(null);

  const load = useCallback(async () => {
    const r = await lookStatusAction(projectId);
    if (r.ok) setLook(r.look);
    setLoaded(true);
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- se consulta al servidor después de montar (retoma lo que siguió en curso).
    void load();
  }, [load]);

  const working = Boolean(look && WORKING.has(look.status));
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [working, load]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [look?.messages.length, pending]);

  const ready = mode === "link" ? isReferenceLink(link.trim()) : Boolean(file);

  function begin() {
    setError(null);
    start(async () => {
      let upload = false;
      if (mode === "upload" && file) {
        const reserved = await reserveReferenceAction(projectId, { fileName: file.name, fileType: file.type, fileSize: file.size });
        if (!reserved.ok) return setError(reserved.error);
        setProgress(0);
        try {
          await putFile({ file, key: reserved.data.key, mode: reserved.data.mode, clientPayload: `referencia:${projectId}`, signal: new AbortController().signal, onProgress: (loaded) => setProgress((loaded / file.size) * 100) });
        } catch {
          setProgress(null);
          return setError("La subida falló. Vuelve a intentarlo.");
        }
        setProgress(null);
        upload = true;
      }
      const r = await startLookAction(projectId, mode === "link" ? { link: link.trim() } : { upload });
      if (!r.ok) return setError(r.error);
      setLook(r.look);
      setFresh(false);
      setLink("");
      setFile(null);
    });
  }

  function send() {
    const msg = text.trim();
    if (!look || msg.length < 2) return;
    setText("");
    setError(null);
    // Se ve enseguida; si falla, vuelve al cuadro.
    setLook({ ...look, messages: [...look.messages, { role: "user", text: msg, at: new Date().toISOString() }] });
    start(async () => {
      const r = await lookChatAction(projectId, look.id, msg);
      if (!r.ok) {
        setText(msg);
        setError(r.error);
        void load();
        return;
      }
      setLook(r.look);
    });
  }

  function toggle(moment: string, include: boolean) {
    if (!look) return;
    setLook({ ...look, items: look.items.map((i) => (i.moment === moment ? { ...i, include } : i)) });
    void toggleLookItemAction(projectId, look.id, moment, include).then((r) => r.ok && setLook(r.look));
  }

  function apply() {
    if (!look) return;
    start(async () => {
      const r = await applyLookAction(projectId, look.id);
      if (!r.ok) return setError(r.error);
      setLook(r.look);
      void api.compos.refresh();
      toast.success(r.count === 1 ? "Creando 1 animación: aparece sola cuando termina." : `Creando ${r.count} animaciones: aparecen solas cuando terminan.`);
      if (r.failed.length) toast.error(`No se pudieron pedir ${r.failed.length}: ${r.failed[0]}`);
    });
  }

  const chosen = look?.items.filter((i) => i.include).length ?? 0;
  const showForm = canEdit && (!look || fresh || look.status === "failed");

  return (
    <div className="card flex flex-col gap-3 p-4" data-testid="look-card">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Eye className="h-4 w-4 text-accent-hi" aria-hidden /> Mira este video y dime qué ves
        </h2>
        <p className="mt-0.5 text-xs text-muted">Pega el link de una edición que te gusta (o súbela). Claude la mira cuadro a cuadro, te cuenta qué ve y dónde lo pondría en tu video, y conversan antes de crear nada.</p>
      </div>

      {!loaded && <p className="text-xs text-muted">Cargando…</p>}

      {look && !fresh && (
        <div className="flex flex-col gap-3">
          <p className="truncate text-[11px] text-muted" title={look.source}>
            Referencia: {look.source}
          </p>
          {working && (
            <p className="flex items-center gap-2 rounded-xl bg-accent/[0.07] px-3 py-2 text-xs text-accent-hi" aria-live="polite">
              <Loader2 className="h-3.5 w-3.5 flex-none animate-spin motion-reduce:animate-none" aria-hidden />
              {look.status === "thinking" ? "Mirando cada momento de la referencia… (unos minutos)" : (look.stage ?? "En cola")}. Puedes seguir editando.
            </p>
          )}
          {look.status === "failed" && <p className="rounded-xl bg-danger/[0.06] px-3 py-2 text-xs text-danger">{look.error ?? "No pudimos mirar ese video."}</p>}

          {look.messages.length > 0 && (
            <ol ref={list} className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1" aria-label="Conversación" aria-live="polite">
              {look.messages.map((m, i) =>
                m.role === "applied" ? (
                  <li key={i} className="flex items-start gap-1.5 self-stretch rounded-xl bg-success/10 px-3 py-2 text-xs text-success">
                    <Check className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden /> Mandaste a crear {m.text}.
                  </li>
                ) : (
                  <li key={i} className={cn("max-w-[94%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap", m.role === "user" ? "self-end bg-white text-paper" : "self-start border border-white/10 bg-card text-text")}>
                    {m.text}
                  </li>
                ),
              )}
              {pending && look.status === "ready" && (
                <li className="self-start rounded-2xl border border-white/10 bg-card px-3 py-2 text-sm text-muted">
                  <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Pensando…
                </li>
              )}
            </ol>
          )}

          {look.status === "ready" && look.items.length > 0 && (
            <section aria-labelledby="look-items" className="flex flex-col gap-1.5">
              <h3 id="look-items" className="text-xs font-semibold tracking-wide text-muted uppercase">
                Qué se adapta ({chosen} de {look.items.length})
              </h3>
              <ul className="flex flex-col gap-1.5">
                {look.items.map((i) => (
                  <li key={i.moment} className={cn("flex items-start gap-2 rounded-xl border px-2.5 py-2", i.include ? "border-accent/40 bg-accent/[0.05]" : "border-white/10 bg-card opacity-70")}>
                    <input type="checkbox" className="mt-1 h-4 w-4 flex-none accent-[var(--color-accent)]" checked={i.include} disabled={!canEdit || pending} onChange={(e) => toggle(i.moment, e.target.checked)} aria-label={`Incluir ${i.label} de ${mmss(i.refAt)}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-white">
                        {i.label} <span className="font-normal text-muted">· referencia {mmss(i.refAt)} → tu video {i.at != null ? `${mmss(i.at)}–${mmss(i.end ?? i.at)}` : "(cae en algo cortado)"}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[11px] text-muted">{i.why || i.brief}</span>
                    </span>
                    {i.at != null && (
                      <button type="button" className="grid h-7 w-7 flex-none place-items-center rounded-lg text-muted hover:bg-white/[0.06] hover:text-white" aria-label="Ver ese momento en tu video" title="Ver ese momento en tu video" onClick={() => api.actions.seek(i.at!)}>
                        <Eye className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {look.status === "ready" && canEdit && (
            <>
              <label htmlFor="look-msg" className="sr-only">
                Tu mensaje
              </label>
              <Textarea
                id="look-msg"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={2000}
                className="!min-h-16 text-sm"
                placeholder="Ej.: el 1 y el 3 sí, el 2 más simple y el título que cae ponlo al final"
                disabled={pending}
                onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && send()}
              />
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="ghost" onClick={send} disabled={pending || text.trim().length < 2} icon={<Send className="h-3.5 w-3.5" aria-hidden />}>
                  Enviar
                </Button>
                <Button size="sm" onClick={apply} disabled={pending || chosen === 0} icon={pending ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Clapperboard className="h-3.5 w-3.5" aria-hidden />}>
                  {chosen === 1 ? "Crear lo elegido (1)" : `Crear lo elegido (${chosen})`}
                </Button>
                <Button size="sm" variant="subtle" onClick={() => setFresh(true)} disabled={pending}>
                  Mirar otro video
                </Button>
              </div>
              <p className="text-[11px] text-muted">Cada momento elegido es una animación a medida, con los cuadros de la referencia. Se crean de a varias y se deshacen con Cmd+Z.</p>
            </>
          )}
        </div>
      )}

      {showForm && (
        <div className="flex flex-col gap-2.5">
          <SegmentedControl
            label="Cómo mandas el video"
            size="sm"
            value={mode}
            onValueChange={setMode}
            options={[
              { value: "link", label: "Link", icon: <Link2 className="h-3.5 w-3.5" aria-hidden /> },
              { value: "upload", label: "Archivo", icon: <Upload className="h-3.5 w-3.5" aria-hidden /> },
            ]}
          />
          {mode === "link" ? (
            <Field label="Link del video" htmlFor="look-link" hint="De Instagram, TikTok o YouTube. Si es privado, descárgalo y súbelo." error={link.trim() && !isReferenceLink(link.trim()) ? "Pega un link de Instagram, TikTok o YouTube." : undefined}>
              <Input id="look-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.instagram.com/reel/…" disabled={pending} />
            </Field>
          ) : (
            <UploadDropzone
              accept={VIDEO_ACCEPT}
              acceptLabel="un video MP4, MOV, WEBM o MKV"
              maxSize={MAX_REFERENCE}
              disabled={pending}
              status={progress != null ? "uploading" : file ? "done" : "idle"}
              progress={progress ?? undefined}
              fileName={file?.name}
              onFiles={([f]) => f && setFile(f)}
              title="Arrastra el video que te gusta"
              hint="Hasta 500 MB. Se borra después de mirarlo: solo guardamos lo que se ve en cada momento."
            />
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" onClick={begin} disabled={!ready || pending} icon={pending ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}>
              {progress != null ? "Subiendo…" : pending ? "Enviando…" : "Mirar el video"}
            </Button>
            {fresh && (
              <Button size="sm" variant="ghost" onClick={() => setFresh(false)} disabled={pending}>
                Volver a la conversación
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted">Mirarlo cuesta poco (Claude con visión, una vez) y sale del tope de IA de este video. Crear las animaciones cuesta aparte, como cualquier pedido.</p>
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
