"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, Check, Eye, History, Link2, Loader2, Paperclip, Upload, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { UploadDropzone } from "@/components/ui/upload-dropzone";
import { formatRelative, formatUsd } from "@/lib/format";
import type { EditEstimate } from "@/lib/video/director/cost";
import { complianceSummary, findLinks, isReferenceLink, parseRequest, type ComplianceItem } from "@/lib/video/director/request";
import type { EditRequest } from "@/lib/video/director/types";
import { cn } from "@/lib/utils";
import { VIDEO_ACCEPT } from "../constants";
import { editAction, reserveReferenceAction } from "../director-actions";
import { useHumanize } from "../studio/humanize";
import { putFile } from "../upload-manager";

const SUGGESTIONS = ["Más dinámico", "Más gráficos en la segunda mitad", "Versión de 30 s", "Subtítulos más grandes", "Quita todos los zooms", "Otro gancho"];
const MAX_REFERENCE = 500 * 1024 * 1024;

type RefMode = "link" | "upload";

/**
 * "Edítalo así": un pedido en lenguaje natural (y, si quieres, un video de referencia) que vuelve a pasar por el
 * director con todo el contexto. Antes de enviarlo muestra cómo se entendió en partes y cuánto cuesta; después, qué se
 * hizo de cada parte y qué no (y por qué).
 */
export function EditRequestCard({
  projectId,
  canEdit,
  estimate,
  spent,
  cap,
  edits,
  dirty,
}: {
  projectId: string;
  canEdit: boolean;
  estimate: EditEstimate | null;
  spent: number;
  cap: number;
  edits: EditRequest[];
  /** Hay cambios sin guardar en la revisión (se guardan solos en un segundo). */
  dirty: boolean;
}) {
  const [text, setText] = useState("");
  const [attach, setAttach] = useState(false);
  const [refMode, setRefMode] = useState<RefMode>("link");
  const [link, setLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [refError, setRefError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const h = useHumanize();
  const [pending, start] = useTransition();
  const last = edits.at(-1);

  const pasted = useMemo(() => findLinks(text)[0] ?? null, [text]);
  const withReference = Boolean(pasted || (attach && (refMode === "link" ? link.trim() : file)));
  const parts = useMemo(() => {
    const p = parseRequest(text, attach && refMode === "link" && isReferenceLink(link.trim()) ? [link.trim()] : []);
    if (attach && refMode === "upload" && file && !p.items.some((i) => i.kind === "referencia")) p.items.push({ n: p.items.length + 1, kind: "referencia", quote: "", label: "Editar como la referencia" });
    return text.trim().length >= 3 ? p.items : [];
  }, [text, attach, refMode, link, file]);
  const cost = estimate ? (withReference ? estimate.withReference : estimate.usd) : 0;
  const over = spent + cost > cap;
  const linkInvalid = attach && refMode === "link" && link.trim().length > 0 && !isReferenceLink(link.trim());

  function send() {
    setRefError(null);
    start(async () => {
      let upload = false;
      if (attach && refMode === "upload" && file) {
        const reserved = await reserveReferenceAction(projectId, { fileName: file.name, fileType: file.type, fileSize: file.size });
        if (!reserved.ok) {
          setRefError(reserved.error);
          return;
        }
        const controller = new AbortController();
        abort.current = controller;
        setProgress(0);
        try {
          await putFile({ file, key: reserved.data.key, mode: reserved.data.mode, clientPayload: `referencia:${projectId}`, signal: controller.signal, onProgress: (loaded) => setProgress((loaded / file.size) * 100) });
        } catch (e) {
          setProgress(null);
          if (!(e instanceof DOMException && e.name === "AbortError")) setRefError(e instanceof Error && /[áéíóú]|subida|archivo/i.test(e.message) ? e.message : "La subida falló. Vuelve a intentarlo.");
          return;
        }
        setProgress(null);
        upload = true;
      }
      const r = await editAction(projectId, text, "edit", attach && refMode === "link" && link.trim() ? { link: link.trim() } : upload ? { upload: true } : undefined);
      if (!r.ok) toast.error(r.error);
    });
  }

  const uploading = progress != null;
  const busy = pending || uploading;
  const canSend = text.trim().length >= 3 && !dirty && !busy && !linkInvalid;

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Wand2 className="h-4 w-4 text-accent-hi" aria-hidden /> Edítalo así
        </h2>
        <p className="mt-0.5 text-xs text-muted">Pídele cambios como a un editor: lo que pidas manda sobre los topes de tu marca. Al terminar te dice qué hizo de cada cosa.</p>
      </div>

      {last && <LastRequest edit={last} humanize={h} />}

      {canEdit && (
        <>
          <label htmlFor="edit-request" className="sr-only">
            Qué quieres cambiar
          </label>
          <Textarea
            id="edit-request"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={600}
            className="!min-h-20 text-sm"
            placeholder="Más gráficos en la segunda mitad, subtítulos más grandes, como este video: https://…"
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSend) send();
            }}
          />
          <div className="flex flex-wrap gap-1.5" aria-label="Ideas de pedidos">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="pill border border-white/10 text-[11px] text-muted transition hover:border-white/25 hover:text-text" onClick={() => setText((t) => (t.trim() ? `${t.trim().replace(/[.,]$/, "")}, ${s.toLowerCase()}` : s))}>
                {s}
              </button>
            ))}
          </div>

          {pasted && !attach && (
            <p className="flex items-center gap-1.5 text-xs text-accent-glow" aria-live="polite">
              <Link2 className="h-3.5 w-3.5 flex-none" aria-hidden /> Vamos a mirar ese video y a imitar su edición (no su contenido).
            </p>
          )}

          {!attach ? (
            <button type="button" className="flex items-center gap-1.5 self-start text-xs font-semibold text-accent-hi hover:underline" onClick={() => setAttach(true)} disabled={busy}>
              <Paperclip className="h-3.5 w-3.5" aria-hidden /> Adjuntar un video de referencia
            </button>
          ) : (
            <div className="flex flex-col gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-white">Video de referencia</p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="!h-7 !px-2 text-[11px]"
                  icon={<X className="h-3.5 w-3.5" aria-hidden />}
                  disabled={busy}
                  onClick={() => {
                    abort.current?.abort();
                    setAttach(false);
                    setFile(null);
                    setLink("");
                    setRefError(null);
                  }}
                >
                  Quitar
                </Button>
              </div>
              <SegmentedControl
                label="Origen de la referencia"
                value={refMode}
                onValueChange={(v) => {
                  setRefMode(v);
                  setRefError(null);
                }}
                options={[
                  { value: "link", label: "Link", icon: <Link2 className="h-3.5 w-3.5" aria-hidden /> },
                  { value: "upload", label: "Archivo", icon: <Upload className="h-3.5 w-3.5" aria-hidden /> },
                ]}
              />
              {refMode === "link" ? (
                <Field label="Link del video" htmlFor="edit-ref-link" hint="De Instagram, TikTok o YouTube. Si es privado o pide iniciar sesión, descárgalo y súbelo." error={linkInvalid ? "Pega un link de Instagram, TikTok o YouTube." : (refError ?? undefined)}>
                  <Input id="edit-ref-link" type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.instagram.com/reel/…" disabled={busy} />
                </Field>
              ) : (
                <UploadDropzone
                  accept={VIDEO_ACCEPT}
                  acceptLabel="un video MP4, MOV, WEBM o MKV"
                  maxSize={MAX_REFERENCE}
                  disabled={busy}
                  status={uploading ? "uploading" : file ? "done" : "idle"}
                  progress={progress ?? undefined}
                  fileName={file?.name}
                  error={refError}
                  onCancel={uploading ? () => abort.current?.abort() : undefined}
                  onFiles={([f]) => {
                    if (!f) return;
                    setFile(f);
                    setRefError(null);
                  }}
                  title="Arrastra el video de referencia"
                  hint="Un reel, TikTok o short editado como te gusta. Hasta 500 MB; se borra después de mirarlo."
                />
              )}
              <p className="text-[11px] text-muted">El director mira sus cortes, gráficos, subtítulos y zooms, e imita la edición sin copiar lo que dice.</p>
            </div>
          )}

          {parts.length > 0 && (
            <div className="rounded-xl border border-white/10 p-3" aria-live="polite">
              <p className="eyebrow mb-1.5">Lo que vamos a hacer</p>
              <ol className="flex flex-col gap-1 text-xs text-text/90">
                {parts.map((p) => (
                  <li key={p.n} className="flex gap-2">
                    <span className="w-4 flex-none font-mono text-[11px] text-accent-glow tabular-nums">{p.n}.</span>
                    <span className="min-w-0">{p.label}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <Button onClick={send} disabled={!canSend} icon={busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Wand2 className="h-4 w-4" aria-hidden />}>
            {uploading ? "Subiendo la referencia…" : pending ? "Enviando…" : "Aplicar cambios"}
          </Button>
          <p className={over ? "text-xs text-warning" : "text-xs text-muted"}>
            {estimate ? (
              <>
                Costo estimado: {formatUsd(cost)}
                {estimate.rounds > 1 ? ` (hasta ${formatUsd(estimate.max)} si hace falta otra vuelta)` : ""} con {estimate.model} · llevas {formatUsd(spent)} de {formatUsd(cap)}.
              </>
            ) : (
              <>Llevas {formatUsd(spent)} de {formatUsd(cap)}.</>
            )}
            {over ? " Se pasa del tope: se hará con menos razonamiento o sin otra vuelta." : ""}
            {dirty ? " Esperando a que se guarden tus cambios…" : ""}
          </p>
        </>
      )}

      {edits.length > 1 && (
        <details className="text-xs">
          <summary className="flex cursor-pointer items-center gap-1.5 text-muted hover:text-text">
            <History className="h-3.5 w-3.5" aria-hidden /> Pedidos anteriores ({edits.length - 1})
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {edits
              .slice(0, -1)
              .reverse()
              .map((e, i) => (
                <li key={e.id ?? i} className="rounded-lg bg-white/[0.03] p-2">
                  <p className="text-text">“{e.instruction}”</p>
                  <p className="mt-0.5 text-muted">
                    {formatRelative(e.at)} · {e.compliance?.length ? complianceSummary(e.compliance) : e.changes.map((c) => h(c)).join(" ")}
                  </p>
                </li>
              ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const STATUS: Record<ComplianceItem["status"], { icon: React.ReactNode; label: string; className: string }> = {
  hecho: { icon: <Check className="h-3.5 w-3.5" aria-hidden />, label: "Hecho", className: "text-success" },
  parcial: { icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden />, label: "En parte", className: "text-warning" },
  no: { icon: <X className="h-3.5 w-3.5" aria-hidden />, label: "No se pudo", className: "text-danger" },
  revisar: { icon: <Eye className="h-3.5 w-3.5" aria-hidden />, label: "Revísalo", className: "text-accent-glow" },
};

/** El último pedido: qué se hizo de cada parte (y qué no, con el porqué), qué cambió, vueltas y costo. */
function LastRequest({ edit, humanize }: { edit: EditRequest; humanize: (t: string) => string }) {
  const compliance = edit.compliance ?? [];
  const summary = complianceSummary(compliance);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-accent/30 bg-accent/10 p-3 text-xs" aria-live="polite">
      <p className="font-semibold text-white">
        {edit.source === "arreglo" ? "Arreglo" : "Tu pedido"}: <span className="font-normal text-text">“{edit.instruction}”</span>
      </p>
      {compliance.length > 0 ? (
        <>
          <p className="text-text/90">
            {summary}
            {edit.rounds && edit.rounds > 1 ? ` Hicieron falta ${edit.rounds} vueltas.` : ""}
            {edit.costUsd ? ` Costó ${formatUsd(edit.costUsd)}.` : ""}
          </p>
          <ul className="flex flex-col gap-1.5" aria-label="Qué se hizo de cada parte">
            {compliance.map((c) => {
              const st = STATUS[c.status];
              return (
                <li key={c.n} className="flex gap-2 rounded-lg bg-black/15 p-2">
                  <span className={cn("mt-0.5 flex-none", st.className)} aria-hidden>
                    {st.icon}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block text-[10px] font-semibold uppercase tracking-wide", st.className)}>{st.label}</span>
                    <span className="block font-semibold text-white">{c.label}</span>
                    <span className="block text-text/80">{humanize(c.detail)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {edit.reference && !edit.reference.ok && edit.reference.error && !compliance.some((c) => c.label.includes("referencia")) && <p className="text-warning">{edit.reference.error}</p>}
      <details>
        <summary className="cursor-pointer text-muted hover:text-text">Qué cambió ({edit.changes.length})</summary>
        <ul className="mt-1.5 flex flex-col gap-0.5 text-text/90">
          {edit.changes.map((c, i) => (
            <li key={i}>· {humanize(c)}</li>
          ))}
        </ul>
      </details>
      {edit.note && <p className="text-muted">{humanize(edit.note)}</p>}
    </div>
  );
}
