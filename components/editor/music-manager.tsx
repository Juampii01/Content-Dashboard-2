"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Music, Pause, Play, Trash2, X } from "lucide-react";
import { StatusBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { UploadDropzone } from "@/components/ui/upload-dropzone";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { completeTrackUploadAction, createTrackUploadAction, deleteTrackAction, renameTrackAction } from "./media-actions";
import { putFile } from "./upload-manager";

export type TrackItem = { id: string; title: string; status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED"; duration: number | null; url: string | null };

export const AUDIO_ACCEPT = ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav", "audio/ogg", "audio/flac", ".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac"];
const MAX_TRACK = 200 * 1024 ** 2;

type Uploading = { name: string; pct: number; error?: string };

/** Duración de una pista leída en el navegador (solo para mostrarla; el worker la vuelve a medir). */
function audioDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    audio.src = url;
  });
}

/** Un solo reproductor para toda la página: al tocar otra pista, la anterior se detiene. */
export function useTrackPlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  function toggle(id: string, url: string | null) {
    if (!url) return;
    if (playing === id) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const el = new Audio(url);
    el.volume = 0.8;
    el.onended = () => setPlaying((p) => (p === id ? null : p));
    el.onerror = () => {
      setPlaying(null);
      toast.error("No se pudo reproducir la pista en este navegador.");
    };
    audio.current = el;
    void el.play().catch(() => setPlaying(null));
    setPlaying(id);
  }
  return { playing, toggle };
}

/** Biblioteca → Música: subir pistas propias, escucharlas, renombrarlas y borrarlas. */
export function MusicManager({ tracks, canEdit }: { tracks: TrackItem[]; canEdit: boolean }) {
  const router = useRouter();
  const [uploads, setUploads] = useState<Record<string, Uploading>>({});
  const player = useTrackPlayer();

  async function uploadOne(file: File, tempId: string) {
    const created = await createTrackUploadAction({ fileName: file.name, fileType: file.type, fileSize: file.size });
    if (!created.ok || !created.data) {
      setUploads((u) => ({ ...u, [tempId]: { name: file.name, pct: 0, error: created.ok ? "No pudimos preparar la subida." : created.error } }));
      return;
    }
    const { id, key, mode } = created.data;
    try {
      const duration = await audioDuration(file);
      await putFile({ file, key, mode, clientPayload: `musica:${id}`, signal: new AbortController().signal, onProgress: (loaded) => setUploads((u) => ({ ...u, [tempId]: { name: file.name, pct: (loaded / file.size) * 100 } })) });
      const done = await completeTrackUploadAction(id, duration);
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
    for (const file of files.slice(0, 10)) {
      const tempId = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      setUploads((u) => ({ ...u, [tempId]: { name: file.name, pct: 0 } }));
      void uploadOne(file, tempId);
    }
  }

  const pending = Object.entries(uploads);
  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <UploadDropzone
          accept={AUDIO_ACCEPT}
          acceptLabel="pistas MP3, M4A, WAV, AAC, OGG o FLAC"
          maxSize={MAX_TRACK}
          multiple
          onFiles={onFiles}
          title="Arrastra tu música"
          hint="Solo música que puedas usar en tus videos (tuya, comprada con licencia o libre de derechos). Va debajo de tu voz y baja sola cuando hablas."
        />
      )}
      {pending.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Subidas de música en curso">
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
      {tracks.length > 0 ? (
        <ul className="card divide-y divide-white/10" aria-label="Tus pistas">
          {tracks.map((t) => (
            <TrackRow key={t.id} track={t} canEdit={canEdit} playing={player.playing === t.id} onToggle={() => player.toggle(t.id, t.url)} />
          ))}
        </ul>
      ) : (
        pending.length === 0 && (
          <div className="card flex items-center gap-3 p-4 text-sm text-muted">
            <span className="tile-icon grid h-9 w-9 flex-none place-items-center">
              <Music className="h-4 w-4" aria-hidden />
            </span>
            Todavía no subiste música. Cuando tengas pistas, las eliges en la revisión de cada video.
          </div>
        )
      )}
    </div>
  );
}

function TrackRow({ track, canEdit, playing, onToggle }: { track: TrackItem; canEdit: boolean; playing: boolean; onToggle: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(track.title);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const ready = track.status === "READY";
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
      <button
        type="button"
        onClick={onToggle}
        disabled={!ready || !track.url}
        className={cn("grid h-9 w-9 flex-none place-items-center rounded-full border transition", playing ? "border-accent bg-accent text-white" : "border-white/15 text-accent-hi hover:border-accent/60")}
        aria-label={playing ? `Pausar ${track.title}` : `Escuchar ${track.title}`}
      >
        {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="ml-0.5 h-4 w-4" aria-hidden />}
      </button>
      <label className="sr-only" htmlFor={`track-title-${track.id}`}>
        Nombre de la pista
      </label>
      <input
        id={`track-title-${track.id}`}
        className="field !h-9 min-w-0 flex-1 !text-sm font-medium"
        value={title}
        maxLength={120}
        disabled={!canEdit}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title.trim() && title.trim() !== track.title)
            start(async () => {
              const r = await renameTrackAction(track.id, title);
              if (!r.ok) toast.error(r.error);
            });
        }}
      />
      {ready ? (
        <span className="hidden w-14 text-right font-mono text-xs text-muted tabular-nums sm:block">{track.duration ? formatDuration(track.duration) : "—"}</span>
      ) : (
        <StatusBadge tone="info">Subida incompleta</StatusBadge>
      )}
      {canEdit && (
        <Button size="sm" variant="subtle" className="!px-2" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => setConfirm(true)} aria-label={`Borrar ${track.title}`}>
          <span className="hidden sm:inline">Borrar</span>
        </Button>
      )}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="¿Borrar esta pista?"
        description="Los videos ya renderizados no cambian. En los que estás revisando, el video queda sin música."
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
                  const r = await deleteTrackAction(track.id);
                  if (!r.ok) toast.error(r.error);
                  else {
                    setConfirm(false);
                    router.refresh();
                  }
                })
              }
            >
              {pending ? "Borrando…" : "Borrar pista"}
            </Button>
          </>
        }
      />
    </li>
  );
}
