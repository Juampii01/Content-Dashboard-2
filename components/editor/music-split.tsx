"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Upload, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Notice, Progress } from "@/components/ui/feedback";
import { UploadDropzone } from "@/components/ui/upload-dropzone";
import { completeSplitUploadAction, createSplitFromLinkAction, createSplitUploadAction } from "./media-actions";
import { AUDIO_ACCEPT } from "./music-manager";
import { putFile } from "./upload-manager";

const MEDIA_ACCEPT = ["video/mp4", "video/quicktime", "video/webm", ".mp4", ".mov", ".webm", ".mkv", ".m4v", ...AUDIO_ACCEPT];
const MAX_BYTES = 1024 ** 3;

/**
 * Biblioteca → Música → «Sacar la música de un reel»: un link o un archivo; el worker separa la voz y la pista queda
 * en la lista de abajo (con su avance mientras se separa).
 */
export function MusicSplit() {
  const router = useRouter();
  const [mode, setMode] = useState<"link" | "file">("link");
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ name: string; pct: number } | null>(null);
  const [pending, start] = useTransition();

  const fromLink = () =>
    start(async () => {
      setError(null);
      const res = await createSplitFromLinkAction(link);
      if (!res.ok) return setError(res.error);
      setLink("");
      router.refresh();
    });

  async function fromFile(file: File) {
    setError(null);
    const created = await createSplitUploadAction({ fileName: file.name, fileType: file.type, fileSize: file.size });
    if (!created.ok || !created.data) return setError(created.ok ? "No pudimos preparar la subida." : created.error);
    const { id, key, mode: driver } = created.data;
    setUpload({ name: file.name, pct: 0 });
    try {
      await putFile({ file, key, mode: driver, clientPayload: `separar:${id}`, signal: new AbortController().signal, onProgress: (loaded) => setUpload({ name: file.name, pct: (loaded / file.size) * 100 }) });
      const done = await completeSplitUploadAction(id);
      if (!done.ok) throw new Error(done.error);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error && /[áéíóú]|subida|archivo/i.test(e.message) ? e.message : "La subida falló. Vuelve a intentarlo.");
    } finally {
      setUpload(null);
    }
  }

  return (
    <div className="card flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="tile-icon grid h-9 w-9 flex-none place-items-center">
          <Wand2 className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-white">Sacar la música de un reel</p>
          <p className="text-sm text-muted">Pega el link de un reel, TikTok o video de YouTube (o sube el archivo) y te quedas con la música y los efectos, sin la voz. Queda en tu lista para ponerla debajo de tus videos.</p>
        </div>
      </div>
      <div className="segmented self-start" role="radiogroup" aria-label="De dónde sale la música">
        <button type="button" role="radio" aria-checked={mode === "link"} className="segmented-item" onClick={() => (setMode("link"), setError(null))}>
          <Link2 className="h-3.5 w-3.5" aria-hidden /> Pegar un link
        </button>
        <button type="button" role="radio" aria-checked={mode === "file"} className="segmented-item" onClick={() => (setMode("file"), setError(null))}>
          <Upload className="h-3.5 w-3.5" aria-hidden /> Subir un archivo
        </button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {mode === "link" ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (link.trim()) fromLink();
          }}
        >
          <label htmlFor="split-link" className="sr-only">
            Link del reel
          </label>
          <Input id="split-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.instagram.com/reel/…" autoComplete="off" className="min-w-0 flex-1" inputMode="url" />
          <Button type="submit" disabled={pending || !link.trim()} icon={<Wand2 className="h-4 w-4" aria-hidden />}>
            {pending ? "Preparando…" : "Sacar la música"}
          </Button>
        </form>
      ) : upload ? (
        <Progress value={upload.pct} label={`Subiendo ${upload.name}`} />
      ) : (
        <UploadDropzone accept={MEDIA_ACCEPT} acceptLabel="un video (MP4, MOV, WEBM) o un audio (MP3, M4A, WAV)" maxSize={MAX_BYTES} onFiles={(files) => files[0] && void fromFile(files[0])} title="Arrastra el video o el audio" hint="Hasta 10 minutos. Si viene de un link que no se puede bajar, descárgalo y súbelo aquí." />
      )}
      <p className="text-xs text-muted">La música de otro creador casi nunca es libre: si la usas tal cual, Instagram puede silenciar tu video. Úsala con música tuya, con licencia o libre de derechos. Si la música tiene letra cantada, el canto se va con la voz.</p>
    </div>
  );
}
