"use client";

import { useRef, useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Film, RefreshCcw, Tag, Trash2, X } from "lucide-react";
import { StatusBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { UploadDropzone } from "@/components/ui/upload-dropzone";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { VIDEO_ACCEPT } from "./constants";
import { completeClipUploadAction, createClipUploadAction, deleteClipAction, retryClipAction, updateClipAction } from "./media-actions";
import { putFile } from "./upload-manager";
import { useAutoRefresh } from "./use-auto-refresh";

export type ClipItem = {
  id: string;
  title: string;
  tags: string[];
  status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
  thumbUrl: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  errorMessage: string | null;
  job: { progress: number; stage: string | null } | null;
};

type Uploading = { name: string; pct: number; error?: string };

const MAX_CLIP = 2 * 1024 ** 3;

/** Biblioteca de b-roll: subir clips (varios a la vez), etiquetarlos y borrarlos. */
export function LibraryManager({ clips, canEdit }: { clips: ClipItem[]; canEdit: boolean }) {
  const router = useRouter();
  const [uploads, setUploads] = useState<Record<string, Uploading>>({});
  useAutoRefresh(clips.some((c) => c.status === "PROCESSING"));

  async function uploadOne(file: File, tempId: string) {
    const created = await createClipUploadAction({ fileName: file.name, fileType: file.type, fileSize: file.size });
    if (!created.ok || !created.data) {
      setUploads((u) => ({ ...u, [tempId]: { name: file.name, pct: 0, error: created.ok ? "No pudimos preparar la subida." : created.error } }));
      return;
    }
    const { id, key, mode } = created.data;
    try {
      await putFile({ file, key, mode, clientPayload: `clip:${id}`, signal: new AbortController().signal, onProgress: (loaded) => setUploads((u) => ({ ...u, [tempId]: { name: file.name, pct: (loaded / file.size) * 100 } })) });
      const done = await completeClipUploadAction(id);
      if (!done.ok) throw new Error(done.error);
      setUploads((u) => {
        const next = { ...u };
        delete next[tempId];
        return next;
      });
      router.refresh();
    } catch (e) {
      setUploads((u) => ({ ...u, [tempId]: { name: file.name, pct: 0, error: e instanceof Error && /[áéíóú]|subida|archivo/i.test(e.message) ? e.message : "La subida falló. Vuelve a intentarlo." } }));
    }
  }

  function onFiles(files: File[]) {
    for (const file of files.slice(0, 20)) {
      const tempId = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      setUploads((u) => ({ ...u, [tempId]: { name: file.name, pct: 0 } }));
      void uploadOne(file, tempId);
    }
  }

  const pending = Object.entries(uploads);
  return (
    <div className="flex flex-col gap-6">
      {canEdit && (
        <div className="flex flex-col gap-3">
          <UploadDropzone
            accept={VIDEO_ACCEPT}
            acceptLabel="clips MP4, MOV, WEBM o MKV"
            maxSize={MAX_CLIP}
            multiple
            onFiles={onFiles}
            title="Arrastra tus clips de b-roll"
            hint="Tomas tuyas que se repiten en tus videos: tu oficina, tu equipo, tu producto, tus clientes. Puedes subir varios a la vez."
          />
          {pending.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2" aria-label="Subidas en curso">
              {pending.map(([id, u]) => (
                <li key={id} className="card flex flex-col gap-2 p-3">
                  {u.error ? (
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-danger">
                        <span className="font-semibold">{u.name}:</span> {u.error}
                      </p>
                      <button
                        type="button"
                        className="grid h-6 w-6 flex-none place-items-center rounded-md text-muted hover:bg-white/10"
                        aria-label={`Quitar el aviso de ${u.name}`}
                        onClick={() =>
                          setUploads((all) => {
                            const next = { ...all };
                            delete next[id];
                            return next;
                          })
                        }
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  ) : (
                    <Progress value={u.pct} label={`Subiendo ${u.name}`} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {clips.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {clips.map((c) => (
            <li key={c.id}>
              <ClipCard clip={c} canEdit={canEdit} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ClipCard({ clip, canEdit }: { clip: ClipItem; canEdit: boolean }) {
  const router = useRouter();
  const [title, setTitle] = useState(clip.title);
  const [tags, setTags] = useState(clip.tags);
  const [draft, setDraft] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const vertical = (clip.height ?? 16) >= (clip.width ?? 9);

  function save(next: { title?: string; tags?: string[] }) {
    start(async () => {
      const r = await updateClipAction(clip.id, next);
      if (!r.ok) toast.error(r.error);
    });
  }

  function addTag() {
    const t = draft.trim().toLowerCase();
    if (t.length < 2 || tags.includes(t) || tags.length >= 12) {
      setDraft("");
      return;
    }
    const next = [...tags, t.slice(0, 30)];
    setTags(next);
    setDraft("");
    save({ tags: next });
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !draft && tags.length) {
      const next = tags.slice(0, -1);
      setTags(next);
      save({ tags: next });
    }
  }

  return (
    <article className="card flex h-full flex-col overflow-hidden">
      <div className="relative aspect-video w-full overflow-hidden bg-black/50">
        {clip.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={clip.thumbUrl} alt="" className={cn("h-full w-full", vertical ? "object-contain" : "object-cover")} loading="lazy" />
        ) : (
          <span className="grid h-full w-full place-items-center text-placeholder">
            <Film className="h-7 w-7" aria-hidden />
          </span>
        )}
        <span className="absolute top-2 left-2">
          {clip.status === "READY" ? (
            <span className="rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white">{formatDuration(clip.duration)}</span>
          ) : (
            <StatusBadge tone={clip.status === "FAILED" ? "danger" : "info"}>{clip.status === "FAILED" ? "Con error" : clip.status === "UPLOADING" ? "Subida incompleta" : "Preparando"}</StatusBadge>
          )}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        {clip.status === "PROCESSING" && <Progress value={clip.job?.progress ?? 0} label={clip.job?.stage ?? "En cola"} />}
        {clip.status === "FAILED" && <p className="text-xs text-danger">{clip.errorMessage ?? "No pudimos preparar el clip."}</p>}
        <label className="sr-only" htmlFor={`clip-title-${clip.id}`}>
          Nombre del clip
        </label>
        <input
          id={`clip-title-${clip.id}`}
          className="field !h-9 !text-sm font-semibold"
          value={title}
          maxLength={120}
          disabled={!canEdit}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() !== clip.title && save({ title })}
        />
        <div
          className="field flex min-h-10 !h-auto flex-wrap items-center gap-1.5 !py-1.5"
          onClick={() => input.current?.focus()}
          role="group"
          aria-label="Etiquetas del clip"
        >
          <Tag className="h-3.5 w-3.5 flex-none text-placeholder" aria-hidden />
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/15 py-0.5 pr-1 pl-2 text-xs text-accent-glow">
              {t}
              {canEdit && (
                <button
                  type="button"
                  className="grid h-4 w-4 place-items-center rounded-full hover:bg-white/15"
                  aria-label={`Quitar la etiqueta ${t}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = tags.filter((x) => x !== t);
                    setTags(next);
                    save({ tags: next });
                  }}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              )}
            </span>
          ))}
          {canEdit && (
            <input
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              onBlur={() => draft.trim() && addTag()}
              placeholder={tags.length ? "Agregar…" : "Agrega etiquetas: oficina, equipo…"}
              aria-label="Nueva etiqueta (Enter para agregar)"
              className="min-w-[6rem] flex-1 bg-transparent text-xs text-text outline-none placeholder:text-placeholder"
            />
          )}
        </div>
        {canEdit && (
          <div className="mt-auto flex items-center justify-end gap-2">
            {clip.status === "FAILED" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                icon={<RefreshCcw className="h-3.5 w-3.5" aria-hidden />}
                onClick={() =>
                  start(async () => {
                    await retryClipAction(clip.id);
                    router.refresh();
                  })
                }
              >
                Reintentar
              </Button>
            )}
            <Button size="sm" variant="subtle" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => setConfirm(true)} aria-label={`Borrar ${clip.title}`}>
              Borrar
            </Button>
          </div>
        )}
      </div>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="¿Borrar este clip?"
        description="Los videos ya renderizados no cambian. En los que estás revisando, este b-roll deja de estar disponible."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancelar
            </Button>
            <Button
              disabled={pending}
              className="!bg-danger/90 ![background-image:none]"
              onClick={() =>
                start(async () => {
                  const r = await deleteClipAction(clip.id);
                  if (!r.ok) toast.error(r.error);
                  else {
                    setConfirm(false);
                    router.refresh();
                  }
                })
              }
            >
              {pending ? "Borrando…" : "Borrar clip"}
            </Button>
          </>
        }
      />
    </article>
  );
}
