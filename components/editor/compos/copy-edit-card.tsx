"use client";

import { useRef, useState, useTransition } from "react";
import { AlertTriangle, Check, Copy, Link2, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { UploadDropzone } from "@/components/ui/upload-dropzone";
import { formatUsd } from "@/lib/format";
import { isReferenceLink } from "@/lib/video/director/request";
import type { CopyReport } from "@/lib/video/compos/flows";
import { cn } from "@/lib/utils";
import { VIDEO_ACCEPT } from "../constants";
import { editAction, reserveReferenceAction } from "../director-actions";
import { putFile } from "../upload-manager";

const MAX_REFERENCE = 500 * 1024 * 1024;
const INSTRUCTION = "Copia la edición de este video: los mismos efectos, animaciones, transiciones, textos y ritmo, adaptados a lo que digo.";

/** Costo típico de "Copiar edición" en un reel de 45–60 s (receta + adaptación + 6 a 10 animaciones con revisión). */
export const COPY_COST = { min: 3, max: 7 };

/**
 * "Copiar edición": pegas (o subes) un video editado como te gusta y la plataforma hace la misma edición sobre el tuyo:
 * desarma la referencia momento a momento, lleva cada momento a lo que dices y programa cada animación a medida.
 * Al terminar muestra cuántos momentos copió y cuáles no (y por qué).
 */
export function CopyEditCard({ projectId, canEdit, dirty, spent, cap, report }: { projectId: string; canEdit: boolean; dirty: boolean; spent: number; cap: number; report: CopyReport | null }) {
  const [mode, setMode] = useState<"link" | "upload">("link");
  const [link, setLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [pending, start] = useTransition();
  const linkInvalid = mode === "link" && link.trim().length > 0 && !isReferenceLink(link.trim());
  const ready = mode === "link" ? isReferenceLink(link.trim()) : Boolean(file);
  const left = cap - spent;
  const short = left < COPY_COST.min;

  function send() {
    setError(null);
    start(async () => {
      let upload = false;
      if (mode === "upload" && file) {
        const reserved = await reserveReferenceAction(projectId, { fileName: file.name, fileType: file.type, fileSize: file.size });
        if (!reserved.ok) return setError(reserved.error);
        const controller = new AbortController();
        abort.current = controller;
        setProgress(0);
        try {
          await putFile({ file, key: reserved.data.key, mode: reserved.data.mode, clientPayload: `referencia:${projectId}`, signal: controller.signal, onProgress: (loaded) => setProgress((loaded / file.size) * 100) });
        } catch (e) {
          setProgress(null);
          if (!(e instanceof DOMException && e.name === "AbortError")) setError("La subida falló. Vuelve a intentarlo.");
          return;
        }
        setProgress(null);
        upload = true;
      }
      const r = await editAction(projectId, INSTRUCTION, "edit", mode === "link" ? { link: link.trim(), copy: true } : { upload, copy: true });
      if (!r.ok) toast.error(r.error);
    });
  }

  const busy = pending || progress != null;
  return (
    <div className="card flex flex-col gap-3 p-4" data-testid="copy-edit">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Copy className="h-4 w-4 text-accent-hi" aria-hidden /> Copiar edición
        </h2>
        <p className="mt-0.5 text-xs text-muted">Pega el link de un reel editado como te gusta (o súbelo). Hacemos la misma edición sobre tu video: cada efecto, animación, transición y texto, programado a medida y adaptado a lo que dices.</p>
      </div>

      {report && <CopyReportView report={report} />}

      {canEdit && (
        <>
          <SegmentedControl
            label="Origen de la referencia"
            value={mode}
            onValueChange={(v) => {
              setMode(v);
              setError(null);
            }}
            options={[
              { value: "link", label: "Link", icon: <Link2 className="h-3.5 w-3.5" aria-hidden /> },
              { value: "upload", label: "Archivo", icon: <Upload className="h-3.5 w-3.5" aria-hidden /> },
            ]}
          />
          {mode === "link" ? (
            <Field label="Link del video a copiar" htmlFor="copy-link" hint="De Instagram, TikTok o YouTube. Si es privado, descárgalo y súbelo." error={linkInvalid ? "Pega un link de Instagram, TikTok o YouTube." : (error ?? undefined)}>
              <Input id="copy-link" type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.instagram.com/reel/…" disabled={busy} />
            </Field>
          ) : (
            <UploadDropzone
              accept={VIDEO_ACCEPT}
              acceptLabel="un video MP4, MOV, WEBM o MKV"
              maxSize={MAX_REFERENCE}
              disabled={busy}
              status={progress != null ? "uploading" : file ? "done" : "idle"}
              progress={progress ?? undefined}
              fileName={file?.name}
              error={error}
              onCancel={progress != null ? () => abort.current?.abort() : undefined}
              onFiles={([f]) => f && setFile(f)}
              title="Arrastra el video a copiar"
              hint="Hasta 500 MB. Se borra después de mirarlo: solo guardamos la receta de la edición."
            />
          )}
          <Button onClick={send} disabled={!ready || busy || dirty || linkInvalid} icon={busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}>
            {progress != null ? "Subiendo…" : pending ? "Enviando…" : "Copiar esta edición"}
          </Button>
          <p className={cn("text-xs", short ? "text-warning" : "text-muted")}>
            Costo típico en un reel de 45–60 s: {formatUsd(COPY_COST.min)} a {formatUsd(COPY_COST.max)} de IA · llevas {formatUsd(spent)} de {formatUsd(cap)}.
            {short ? " Queda poco tope: se copiarán menos momentos (súbelo en el brief del director)." : ""} Tarda de 5 a 15 minutos.
            {dirty ? " Esperando a que se guarden tus cambios…" : ""}
          </p>
        </>
      )}
    </div>
  );
}

const STATUS = {
  copiado: { icon: <Check className="h-3.5 w-3.5" aria-hidden />, label: "Copiado", className: "text-success" },
  aproximado: { icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden />, label: "Parecido", className: "text-warning" },
  no: { icon: <X className="h-3.5 w-3.5" aria-hidden />, label: "No se pudo", className: "text-danger" },
} as const;

/** El informe de la última copia: "copié N de M momentos", cada momento con cómo se hizo o por qué no. */
export function CopyReportView({ report }: { report: CopyReport }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-accent/30 bg-accent/10 p-3 text-xs" aria-live="polite" data-testid="copy-report">
      <p className="text-sm font-semibold text-white">
        Copié {report.copied} de {report.total} momentos
        {report.approx ? <span className="font-normal text-text"> · {report.approx} parecidos</span> : null}
        {report.missed ? <span className="font-normal text-text"> · {report.missed} sin copiar</span> : null}
      </p>
      <p className="text-muted">
        Costó {formatUsd(report.costUsd)} de IA.
        {report.reused ? ` Reusamos ${report.reused === 1 ? "1 animación" : `${report.reused} animaciones`} de Mis efectos (ahorró unos ${formatUsd(report.savedUsd ?? 0)}).` : ""}
      </p>
      <details>
        <summary className="cursor-pointer text-muted hover:text-text">Momento a momento</summary>
        <ul className="mt-2 flex flex-col gap-1.5">
          {report.moments.map((m) => {
            const st = STATUS[m.status];
            return (
              <li key={m.id} className="flex gap-2 rounded-lg bg-white/[0.04] p-2">
                <span className={cn("mt-0.5 flex-none", st.className)} aria-hidden>
                  {st.icon}
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-[10px] font-semibold uppercase tracking-wide", st.className)}>
                    {st.label}
                    {m.score != null ? ` · ${m.score} %` : ""}
                  </span>
                  <span className="block font-semibold text-white">{m.label.charAt(0).toUpperCase() + m.label.slice(1)}</span>
                  {m.how && <span className="block text-text/80">Con {m.how}.</span>}
                  {m.note && <span className="block text-muted">{m.note}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
