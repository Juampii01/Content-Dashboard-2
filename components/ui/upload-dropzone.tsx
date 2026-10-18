"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { AlertCircle, CheckCircle2, FileUp, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import { Progress } from "./feedback";

export type UploadStatus = "idle" | "uploading" | "done" | "error";

/** Valida un archivo contra los tipos aceptados (MIME, "video/*" o extensión ".mov") y el tamaño máximo. */
export function validateFile(file: File, accept: string[] | undefined, maxSize: number | undefined, acceptLabel?: string): string | null {
  if (accept?.length) {
    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();
    const ok = accept.some((rule) => {
      const r = rule.trim().toLowerCase();
      if (r.startsWith(".")) return name.endsWith(r);
      if (r.endsWith("/*")) return type.startsWith(r.slice(0, -1));
      return type === r;
    });
    if (!ok) {
      return `«${file.name}» no es un formato compatible.${acceptLabel ? ` Sube ${acceptLabel}.` : ""}`;
    }
  }
  if (maxSize != null && file.size > maxSize) {
    return `«${file.name}» pesa ${formatBytes(file.size)}. El máximo es ${formatBytes(maxSize)}.`;
  }
  if (file.size === 0) return `«${file.name}» está vacío.`;
  return null;
}

/**
 * Zona para arrastrar y soltar archivos (o hacer clic para elegirlos).
 * Valida tipo y tamaño con mensajes en español y muestra el progreso que le pase el padre:
 * la subida real (directa a Blob) no vive aquí.
 */
export function UploadDropzone({
  onFiles,
  accept,
  acceptLabel,
  maxSize,
  multiple = false,
  disabled = false,
  status = "idle",
  progress,
  fileName,
  error,
  onCancel,
  title = "Arrastra tu archivo aquí",
  hint,
  className,
}: {
  /** Archivos válidos elegidos o soltados. */
  onFiles: (files: File[]) => void;
  /** Tipos aceptados: MIME ("video/mp4"), comodín ("video/*") o extensión (".mov"). */
  accept?: string[];
  /** Cómo se nombran los tipos para la persona: "un video MP4 o MOV". */
  acceptLabel?: string;
  /** Tamaño máximo en bytes. */
  maxSize?: number;
  multiple?: boolean;
  disabled?: boolean;
  status?: UploadStatus;
  /** 0–100 mientras `status` es "uploading". */
  progress?: number;
  fileName?: string;
  /** Error de la subida (lo pone el padre). Los errores de validación los maneja el componente. */
  error?: string | null;
  /** Si se pasa, aparece "Cancelar" durante la subida. */
  onCancel?: () => void;
  title?: string;
  hint?: string;
  className?: string;
}) {
  const inputId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [rejections, setRejections] = useState<string[]>([]);

  const busy = status === "uploading";
  const blocked = disabled || busy;

  function handle(list: FileList | null) {
    if (!list?.length) return;
    const files = Array.from(list).slice(0, multiple ? undefined : 1);
    const errors: string[] = [];
    const valid: File[] = [];
    for (const file of files) {
      const problem = validateFile(file, accept, maxSize, acceptLabel);
      if (problem) errors.push(problem);
      else valid.push(file);
    }
    if (!multiple && list.length > 1) errors.push("Sube un solo archivo a la vez.");
    setRejections(errors);
    if (valid.length) onFiles(valid);
  }

  function onDrag(event: DragEvent<HTMLDivElement>, kind: "enter" | "leave" | "over" | "drop") {
    event.preventDefault();
    if (blocked) return;
    if (kind === "enter") {
      dragDepth.current += 1;
      setDragging(true);
    } else if (kind === "leave") {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    } else if (kind === "over") {
      event.dataTransfer.dropEffect = "copy";
    } else {
      dragDepth.current = 0;
      setDragging(false);
      handle(event.dataTransfer.files);
    }
  }

  const defaultHint = [acceptLabel && `Formato: ${acceptLabel}`, maxSize != null && `hasta ${formatBytes(maxSize)}`].filter(Boolean).join(", ");
  const shownError = error ?? rejections[0] ?? null;

  return (
    <div className={className}>
      <div
        onDragEnter={(e) => onDrag(e, "enter")}
        onDragLeave={(e) => onDrag(e, "leave")}
        onDragOver={(e) => onDrag(e, "over")}
        onDrop={(e) => onDrag(e, "drop")}
        data-dragging={dragging || undefined}
        className={cn(
          "relative flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center transition",
          dragging ? "border-accent-hi bg-accent/10" : "border-white/15 bg-white/[0.02]",
          shownError && !dragging && "border-danger/50",
          blocked && "opacity-80",
        )}
      >
        {busy ? (
          <div className="w-full max-w-sm" aria-live="polite">
            <div className="tile-icon mx-auto mb-4 h-11 w-11">
              <FileUp aria-hidden className="h-5 w-5" />
            </div>
            <p className="mb-3 truncate text-sm font-semibold text-white">{fileName ?? "Subiendo archivo"}</p>
            <Progress value={progress ?? 0} label="Subiendo" />
            {onCancel && (
              <button type="button" onClick={onCancel} className="btn-ghost mt-4 !py-1.5 !text-xs">
                <X aria-hidden className="h-3.5 w-3.5" /> Cancelar
              </button>
            )}
          </div>
        ) : status === "done" ? (
          <div role="status" className="flex flex-col items-center">
            <CheckCircle2 aria-hidden className="mb-3 h-9 w-9 text-success" />
            <p className="text-sm font-semibold text-white">{fileName ? `«${fileName}» subido` : "Archivo subido"}</p>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled} className="btn-ghost mt-4 !py-1.5 !text-xs">
              Subir otro
            </button>
          </div>
        ) : (
          <>
            <div className={cn("tile-icon mb-4 h-12 w-12 transition", dragging && "scale-110 border-accent-hi/60")}>
              <UploadCloud aria-hidden className="h-5 w-5" />
            </div>
            <p className="text-base font-semibold text-white">{dragging ? "Suelta para subir" : title}</p>
            <p id={hintId} className="mt-1 text-sm text-muted">
              {hint ?? defaultHint}
            </p>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={blocked} aria-describedby={hintId} className="btn mt-5">
              Elegir {multiple ? "archivos" : "archivo"}
            </button>
          </>
        )}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          accept={accept?.join(",")}
          multiple={multiple}
          disabled={blocked}
          onChange={(event) => {
            handle(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {shownError && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-sm font-medium text-danger">
          <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 flex-none" />
          <span>
            {shownError}
            {rejections.length > 1 && !error && ` (y ${rejections.length - 1} más)`}
          </span>
        </p>
      )}
    </div>
  );
}
