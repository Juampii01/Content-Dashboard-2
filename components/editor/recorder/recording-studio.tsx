"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  CloudOff,
  ExternalLink,
  FlipHorizontal2,
  Loader2,
  Minus,
  Monitor,
  Plus,
  RefreshCcw,
  RotateCcw,
  Smartphone,
  Square,
  Upload,
  Video,
} from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Notice, Progress } from "@/components/ui/feedback";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import type { RecordingScript } from "@/lib/dal/recording";
import { formatBytes, formatDuration, formatTimecode } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EditorDefaults } from "@/lib/video/defaults";
import type { VideoFormat } from "@/lib/video/types";
import { AutoExportToggle } from "../auto-export-toggle";
import { statusLabel, type ProjectStatus } from "../labels";
import { addChunk, deleteTake, finishTake, recoverTakes, startTake, storageAvailable, type TakeMeta } from "./take-store";
import { enqueueFromMemory, enqueueTake, resumePendingTakes, useTakeUploads, type TakeUpload } from "./take-uploader";
import { Teleprompter } from "./teleprompter";
import { pickRecorderType, useCamera, useVoiceActivity } from "./use-camera";

/** El Editor acepta hasta 20 minutos por video. */
const MAX_SECONDS = 20 * 60;
const PREFS_KEY = "content2.teleprompter";

type Phase = "preview" | "countdown" | "recording" | "review";
type Prefs = { wpm: number; size: number; followVoice: boolean; mirror: boolean };
const DEFAULT_PREFS: Prefs = { wpm: 140, size: 34, followVoice: true, mirror: true };

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    return { ...DEFAULT_PREFS, ...(raw ?? {}) };
  } catch {
    return DEFAULT_PREFS;
  }
}

type LocalTake = { takeId: string; scriptId: string | null; title: string };

/** Pantalla de al menos 768 px (en el servidor, se asume ancha). */
function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(min-width: 768px)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-width: 768px)").matches,
    () => true,
  );
}

/**
 * Grabar en el navegador con teleprompter, y el "Día de grabación": varios guiones seguidos, cada toma su propio video
 * del Editor. La toma se guarda en el navegador mientras se graba (IndexedDB) y se sube sola, directo al
 * almacenamiento privado, con reintentos. Con "Hazlo por mí", cada video se edita y se exporta solo.
 */
export function RecordingStudio({
  session,
  defaults,
  autoSummary,
  freeMode,
}: {
  session: RecordingScript[];
  defaults: EditorDefaults;
  autoSummary: string;
  /** Sin guion: sin teleprompter, una toma libre. */
  freeMode: boolean;
}) {
  const [format, setFormat] = useState<VideoFormat>(() => (session.length && session.every((s) => s.format === "YT_LONG") ? "16:9" : defaults.format));
  const [autoExport, setAutoExport] = useState(true);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [index, setIndex] = useState(() => {
    const first = session.findIndex((s) => !s.lastTake);
    return first === -1 ? 0 : first;
  });
  const [phase, setPhase] = useState<Phase>("preview");
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [review, setReview] = useState<{ url: string; blob: Blob; meta: TakeMeta; stored: boolean } | null>(null);
  const [local, setLocal] = useState<LocalTake[]>([]);
  const [persist, setPersist] = useState<boolean | null>(null);
  const [resumed, setResumed] = useState(0);
  const [recError, setRecError] = useState<string | null>(null);
  const camera = useCamera(format);
  const stream = camera.state.status === "ready" ? camera.state.stream : null;
  const voice = useVoiceActivity(stream);
  const uploads = useTakeUploads();
  const preview = useRef<HTMLVideoElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const current = freeMode ? null : (session[index] ?? null);

  // Preferencias del teleprompter (solo de este navegador).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- se leen del navegador después de montar (en el servidor no hay localStorage).
    setPrefs(loadPrefs());
  }, []);
  const updatePrefs = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

  // Al entrar: ¿se puede guardar en el navegador? y tomas que quedaron sin subir (pestaña cerrada) se retoman.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const ok = await storageAvailable();
      if (!alive) return;
      setPersist(ok);
      if (!ok) return;
      await recoverTakes();
      const pending = await resumePendingTakes();
      if (!alive) return;
      setResumed(pending.length);
      setLocal((cur) => [...pending.filter((p) => !cur.some((c) => c.takeId === p.id)).map((p) => ({ takeId: p.id, scriptId: p.scriptId, title: p.title })), ...cur]);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // El video en vivo.
  useEffect(() => {
    if (preview.current && stream && preview.current.srcObject !== stream) {
      preview.current.srcObject = stream;
      void preview.current.play().catch(() => undefined);
    }
  }, [stream, phase]);

  // Cronómetro (y corte a los 20 minutos).
  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => {
      const s = (performance.now() - startedAt.current) / 1000;
      setElapsed(s);
      if (s >= MAX_SECONDS) {
        toast.info("Llegaste a 20 minutos, el máximo por video. Cortamos la toma aquí.");
        recorder.current?.stop();
      }
    }, 250);
    return () => clearInterval(t);
  }, [phase]);

  // Si se cierra la pestaña grabando, el navegador pregunta (lo grabado hasta ahí igual queda guardado).
  useEffect(() => {
    if (phase !== "recording" && phase !== "review") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  const beginRecording = useCallback(async () => {
    if (!stream) return;
    const type = pickRecorderType();
    if (!type) {
      setRecError("Este navegador no puede grabar video. Usa Chrome, Edge, Firefox o Safari actualizados, o graba con tu teléfono y sube el archivo.");
      return;
    }
    const takeId = crypto.randomUUID();
    const now = new Date();
    const today = `${now.toLocaleDateString("es-419", { day: "numeric", month: "short" })}, ${now.toLocaleTimeString("es-419", { hour: "2-digit", minute: "2-digit" })}`;
    const meta: TakeMeta = {
      id: takeId,
      scriptId: current?.id ?? null,
      title: current?.title ?? `Toma del ${today}`,
      format,
      mime: type.base,
      ext: type.ext,
      createdAt: Date.now(),
      duration: 0,
      size: 0,
      state: "recording",
      settings: { preset: defaults.captions, brollMode: defaults.broll, autoExport },
    };
    const stored = persist ? await startTake(meta) : false;
    let mr: MediaRecorder;
    try {
      mr = new MediaRecorder(stream, { mimeType: type.mimeType, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 128_000 });
    } catch {
      setRecError("No pudimos empezar a grabar con esta cámara. Prueba con otra cámara o recarga la página.");
      return;
    }
    chunks.current = [];
    let seq = 0;
    mr.ondataavailable = (e) => {
      if (!e.data.size) return;
      chunks.current.push(e.data);
      if (stored) void addChunk(takeId, seq++, e.data);
    };
    mr.onerror = () => {
      setRecError("La grabación se cortó (la cámara o el micrófono dejaron de responder). Lo grabado hasta ahí quedó guardado.");
    };
    mr.onstop = () => {
      const duration = (performance.now() - startedAt.current) / 1000;
      const blob = new Blob(chunks.current, { type: type.base });
      const done = { ...meta, duration, size: blob.size, state: "recorded" as const };
      if (stored) void finishTake(takeId, { duration }, blob);
      setReview({ url: URL.createObjectURL(blob), blob, meta: done, stored });
      setPhase("review");
    };
    recorder.current = mr;
    mr.start(1000);
    startedAt.current = performance.now();
    setElapsed(0);
    setPhase("recording");
  }, [stream, current, format, defaults, autoExport, persist]);

  function record() {
    setRecError(null);
    setPhase("countdown");
    setCount(3);
    let n = 3;
    const tick = () => {
      n -= 1;
      if (n <= 0) {
        void beginRecording();
        return;
      }
      setCount(n);
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  }

  function stopRecording() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  function discardReview() {
    if (!review) return;
    URL.revokeObjectURL(review.url);
    if (review.stored) void deleteTake(review.meta.id);
    setReview(null);
    setPhase("preview");
  }

  function acceptTake() {
    if (!review) return;
    const { meta, blob, stored } = review;
    if (stored) enqueueTake(meta);
    else enqueueFromMemory(meta, blob);
    URL.revokeObjectURL(review.url);
    setLocal((cur) => [...cur, { takeId: meta.id, scriptId: meta.scriptId, title: meta.title }]);
    setReview(null);
    setPhase("preview");
    if (!freeMode && session.length > 1) {
      const next = session.findIndex((s, i) => i > index && !local.some((l) => l.scriptId === s.id) && !s.lastTake);
      if (next !== -1) setIndex(next);
      else if (index < session.length - 1) setIndex(index + 1);
    }
    toast.success(autoExport ? "Toma guardada. La subimos y la editamos sola." : "Toma guardada. La subimos y queda lista para revisar.");
  }

  const busy = phase === "countdown" || phase === "recording";
  const uploadsById = useMemo(() => new Map(uploads.map((u) => [u.takeId, u])), [uploads]);
  const camW = camera.state.status === "ready" ? camera.state.width || 1280 : format === "9:16" ? 9 : 16;
  const camH = camera.state.status === "ready" ? camera.state.height || 720 : format === "9:16" ? 16 : 9;
  const aspect = camW / camH;
  const target = format === "9:16" ? 9 / 16 : 16 / 9;
  // Recorte que hará el Editor (al centro), si la cámara entrega otra forma.
  const crop = Math.abs(aspect - target) < 0.02 ? null : aspect > target ? { w: target / aspect, h: 1 } : { w: 1, h: aspect / target };
  const wide = useWide();
  // En una pantalla angosta con la cámara horizontal, el escenario queda bajito: el teleprompter va arriba, aparte.
  const prompterOutside = !wide && aspect > 1;
  const showPrompter = !freeMode && current != null && phase !== "review" && camera.state.status === "ready";
  const prompter = showPrompter ? (
    <Teleprompter
      paragraphs={current.paragraphs.length ? current.paragraphs : ["Este guion todavía no tiene texto. Escríbelo en Guiones o graba sin guion."]}
      running={phase === "recording"}
      wpm={prefs.wpm}
      size={prompterOutside ? Math.min(prefs.size, 28) : prefs.size}
      followVoice={prefs.followVoice}
      speaking={voice.speaking}
      resetKey={`${current.id}-${phase === "countdown" ? "c" : ""}`}
      className={
        prompterOutside
          ? "h-56 rounded-2xl border border-white/10 bg-black"
          : "absolute inset-x-0 top-0 h-[44%] bg-gradient-to-b from-black/80 via-black/65 to-black/30"
      }
    />
  ) : null;
  const sessionDone = !freeMode && session.length > 0 && session.every((s) => local.some((l) => l.scriptId === s.id) || s.lastTake);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        {persist === false && (
          <Notice tone="warning" title="Este navegador no deja guardar las tomas">
            Puedes grabar igual, pero no cierres esta pestaña hasta que terminen de subir (por ejemplo, en una ventana privada no se guardan).
          </Notice>
        )}
        {resumed > 0 && (
          <Notice tone="info" title={resumed === 1 ? "Retomamos una toma que no había terminado de subir" : `Retomamos ${resumed} tomas que no habían terminado de subir`}>
            Estaban guardadas en este navegador. Se están subiendo; las ves en la lista.
          </Notice>
        )}

        <div className="card flex flex-col gap-4 p-4 sm:p-5">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow mb-1">{freeMode ? "Toma libre" : session.length > 1 ? `Guion ${index + 1} de ${session.length}` : "Grabando tu guion"}</p>
              <h2 className="truncate text-lg font-semibold text-white">{current?.title ?? "Habla a cámara"}</h2>
            </div>
            <SegmentedControl
              label="Formato"
              size="sm"
              value={format}
              onValueChange={(v) => !busy && setFormat(v)}
              options={[
                { value: "9:16", label: "Vertical 9:16", icon: <Smartphone className="h-3.5 w-3.5" aria-hidden /> },
                { value: "16:9", label: "Horizontal 16:9", icon: <Monitor className="h-3.5 w-3.5" aria-hidden /> },
              ]}
            />
          </header>

          {prompterOutside && prompter}

          {/* Escenario: la cámara tal cual llega, con el recorte del formato marcado y el teleprompter arriba (cerca del lente). */}
          <div className="relative mx-auto w-full overflow-hidden rounded-2xl border border-white/10 bg-black" style={{ aspectRatio: `${camW} / ${camH}`, maxWidth: `calc(72vh * ${aspect})` }}>
            {camera.state.status === "ready" && phase !== "review" && (
              <video ref={preview} muted playsInline autoPlay className={cn("absolute inset-0 h-full w-full object-cover", prefs.mirror && "-scale-x-100")} aria-label="Vista de tu cámara" />
            )}
            {phase === "review" && review && (
              <video src={review.url} controls playsInline className="absolute inset-0 h-full w-full bg-black object-contain" aria-label="Tu toma" />
            )}
            {crop && phase !== "review" && camera.state.status === "ready" && (
              <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="rounded-lg border border-white/50 shadow-[0_0_0_9999px_rgba(2,6,26,0.55)]" style={{ width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }} />
              </div>
            )}

            {camera.state.status !== "ready" && phase !== "review" && <CameraGate state={camera.state} onStart={() => void camera.start()} />}

            {!prompterOutside && prompter}

            {phase === "countdown" && (
              <div className="absolute inset-0 grid place-items-center bg-black/40" aria-live="assertive">
                <span className="animate-pop-in font-mono text-8xl font-bold text-white motion-reduce:animate-none" key={count}>
                  {count}
                </span>
              </div>
            )}
            {phase === "recording" && (
              <span className="absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 font-mono text-sm font-semibold text-white" role="timer" aria-live="off">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger motion-reduce:animate-none" aria-hidden /> {formatTimecode(elapsed)}
              </span>
            )}
            {camera.state.status === "ready" && phase !== "review" && (
              <span className="absolute bottom-3 right-3 flex h-8 items-end gap-0.5 rounded-lg bg-black/60 px-2 py-1.5" aria-label={voice.speaking ? "Micrófono: te escuchamos" : "Micrófono: en silencio"} role="img">
                {[0.15, 0.3, 0.45, 0.6, 0.75].map((t) => (
                  <span key={t} className={cn("w-1 rounded-sm transition-colors", voice.level >= t ? (t > 0.7 ? "bg-warning" : "bg-accent-hi") : "bg-white/20")} style={{ height: `${30 + t * 90}%` }} />
                ))}
              </span>
            )}
          </div>

          {recError && <Notice tone="danger">{recError}</Notice>}

          {/* Controles */}
          {phase === "review" && review ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm">
                <p className="font-semibold text-white">¿Te gusta esta toma?</p>
                <p className="text-muted">
                  {formatDuration(review.meta.duration)} · {formatBytes(review.blob.size)}
                  {review.stored ? " · guardada en este navegador" : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" icon={<RotateCcw className="h-4 w-4" aria-hidden />} onClick={discardReview}>
                  Repetir toma
                </Button>
                <Button icon={<Check className="h-4 w-4" aria-hidden />} onClick={acceptTake}>
                  {autoExport ? "Usar y hacerlo por mí" : "Usar esta toma"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-center gap-3">
                {phase === "recording" ? (
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="inline-flex h-14 items-center gap-2.5 rounded-full border border-danger/60 bg-danger/15 px-6 text-base font-semibold text-white transition hover:bg-danger/25"
                  >
                    <Square className="h-4 w-4 fill-current text-danger" aria-hidden /> Detener
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={record}
                    disabled={camera.state.status !== "ready" || phase === "countdown"}
                    className="inline-flex h-14 items-center gap-2.5 rounded-full bg-gradient-to-b from-[#2b92ff] to-accent px-7 text-base font-semibold text-white shadow-[0_8px_24px_rgba(0,112,248,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="h-3.5 w-3.5 rounded-full bg-danger ring-2 ring-white/80" aria-hidden /> {phase === "countdown" ? "Prepárate…" : "Grabar"}
                  </button>
                )}
              </div>

              {!freeMode && (
                <div className="grid gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="prompter-speed" className="flex items-center justify-between text-xs text-muted">
                      Velocidad del teleprompter <span className="font-mono font-semibold text-text">{prefs.wpm} palabras/min</span>
                    </label>
                    <input
                      id="prompter-speed"
                      type="range"
                      className="range"
                      min={80}
                      max={220}
                      step={5}
                      value={prefs.wpm}
                      onChange={(e) => updatePrefs({ wpm: Number(e.target.value) })}
                      style={{ ["--pct" as string]: `${((prefs.wpm - 80) / 140) * 100}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1" role="group" aria-label="Tamaño de la letra">
                      <button type="button" className="grid h-9 w-9 place-items-center rounded-xl border border-white/15 text-text hover:border-accent/60" onClick={() => updatePrefs({ size: Math.max(20, prefs.size - 4) })} aria-label="Letra más chica">
                        <Minus className="h-4 w-4" aria-hidden />
                      </button>
                      <span className="w-12 text-center font-mono text-xs text-muted">{prefs.size} px</span>
                      <button type="button" className="grid h-9 w-9 place-items-center rounded-xl border border-white/15 text-text hover:border-accent/60" onClick={() => updatePrefs({ size: Math.min(64, prefs.size + 4) })} aria-label="Letra más grande">
                        <Plus className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-text" title="Se detiene cuando haces una pausa y sigue cuando vuelves a hablar. No reconoce palabras: si te saltas una frase, muévelo con la rueda o el dedo.">
                      <input type="checkbox" className="h-4 w-4 accent-[#0070f8]" checked={prefs.followVoice} onChange={(e) => updatePrefs({ followVoice: e.target.checked })} />
                      Seguir mi voz
                    </label>
                  </div>
                </div>
              )}

              <details className="group rounded-2xl border border-white/10 bg-white/[0.02] p-4 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-white">
                  <span className="inline-flex items-center gap-2">
                    <Camera className="h-4 w-4 text-accent-hi" aria-hidden /> Cámara y micrófono
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted transition group-open:rotate-90" aria-hidden />
                </summary>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="Cámara" htmlFor="rec-camera">
                    <Select id="rec-camera" value={camera.cameraId ?? ""} disabled={busy || !camera.cameras.length} onChange={(e) => void camera.start({ cameraId: e.target.value || null })}>
                      {camera.cameras.length === 0 && <option value="">Enciende la cámara para elegir</option>}
                      {camera.cameras.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Micrófono" htmlFor="rec-mic">
                    <Select id="rec-mic" value={camera.micId ?? ""} disabled={busy || !camera.mics.length} onChange={(e) => void camera.start({ micId: e.target.value || null })}>
                      {camera.mics.length === 0 && <option value="">Enciende la cámara para elegir</option>}
                      {camera.mics.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-text sm:col-span-2">
                    <input type="checkbox" className="h-4 w-4 accent-[#0070f8]" checked={prefs.mirror} onChange={(e) => updatePrefs({ mirror: e.target.checked })} />
                    <FlipHorizontal2 className="h-4 w-4 text-muted" aria-hidden /> Verme como en un espejo (el video sale sin espejar)
                  </label>
                  {camera.state.status === "ready" && (
                    <p className="text-xs text-muted sm:col-span-2">
                      Tu cámara entrega {camera.state.width}×{camera.state.height}.
                      {crop ? ` El Editor lo recorta a ${format === "9:16" ? "vertical" : "horizontal"} al centro (el recuadro); en la revisión puedes mover el encuadre.` : ""}
                    </p>
                  )}
                </div>
              </details>
            </div>
          )}

          <AutoExportToggle checked={autoExport} onChange={setAutoExport} disabled={busy} summary={autoSummary} />
        </div>
      </div>

      <SessionList
        session={freeMode ? [] : session}
        index={index}
        onSelect={(i) => !busy && phase !== "review" && setIndex(i)}
        local={local}
        uploads={uploadsById}
        done={sessionDone}
      />
    </div>
  );
}

function CameraGate({ state, onStart }: { state: ReturnType<typeof useCamera>["state"]; onStart: () => void }) {
  return (
    <div className="absolute inset-0 grid place-items-center p-6 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <span className="tile-icon h-12 w-12">{state.status === "error" ? <AlertTriangle className="h-5 w-5 text-warning" aria-hidden /> : <Video className="h-5 w-5" aria-hidden />}</span>
        <p className="text-base font-semibold text-white">{state.status === "error" ? state.title : "Enciende tu cámara para empezar"}</p>
        <p className="text-sm text-muted">
          {state.status === "error" ? state.message : "Te vamos a pedir permiso para usar la cámara y el micrófono. No se graba nada hasta que tocas «Grabar»."}
        </p>
        <Button onClick={onStart} disabled={state.status === "asking"} icon={state.status === "asking" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}>
          {state.status === "asking" ? "Esperando permiso…" : state.status === "error" ? "Volver a intentar" : "Encender cámara"}
        </Button>
      </div>
    </div>
  );
}

type LiveProject = { status: ProjectStatus; progress: number | null };

/** Estado real de los proyectos que salieron de las tomas (consulta liviana cada 5 s mientras se preparan). */
function useProjectStatuses(ids: string[]): Record<string, LiveProject> {
  const [map, setMap] = useState<Record<string, LiveProject>>({});
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const next: Record<string, LiveProject> = {};
      await Promise.all(
        key.split(",").map(async (id) => {
          try {
            const res = await fetch(`/api/editor/projects/${id}/status`, { cache: "no-store" });
            if (!res.ok) return;
            const body = (await res.json()) as { status: ProjectStatus; job: { progress: number } | null };
            next[id] = { status: body.status, progress: body.job?.progress ?? null };
          } catch {}
        }),
      );
      if (stopped) return;
      setMap((m) => ({ ...m, ...next }));
      const active = Object.values(next).some((p) => p.status !== "DONE" && p.status !== "FAILED" && p.status !== "AWAITING_REVIEW");
      timer = setTimeout(poll, active ? 5000 : 20000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [key]);
  return map;
}

function SessionList({
  session,
  index,
  onSelect,
  local,
  uploads,
  done,
}: {
  session: RecordingScript[];
  index: number;
  onSelect: (i: number) => void;
  local: LocalTake[];
  uploads: Map<string, TakeUpload>;
  done: boolean;
}) {
  const projectIds = [...uploads.values()].map((u) => (u.status === "done" ? u.projectId : null)).filter((v): v is string => Boolean(v));
  const live = useProjectStatuses(projectIds);
  const extra = local.filter((l) => !session.some((s) => s.id === l.scriptId));
  const uploadedCount = local.filter((l) => uploads.get(l.takeId)?.status === "done").length;

  return (
    <aside className="flex flex-col gap-4 xl:sticky xl:top-6 xl:self-start" aria-label="Día de grabación">
      {session.length > 0 && (
        <div className="card flex flex-col gap-3 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="eyebrow">{session.length > 1 ? "Día de grabación" : "Tu guion"}</p>
            {local.length > 0 && <span className="text-xs text-muted">{uploadedCount === 1 ? "1 subida" : `${uploadedCount} subidas`}</span>}
          </div>
          <ol className="flex flex-col gap-1.5">
            {session.map((s, i) => {
              const take = [...local].reverse().find((l) => l.scriptId === s.id);
              const up = take ? uploads.get(take.takeId) : undefined;
              const isNext = i === index;
              return (
                <li key={s.id} className={cn("rounded-xl border transition", isNext ? "border-accent bg-accent/12" : "border-transparent hover:bg-white/[0.04]")}>
                  <button type="button" onClick={() => onSelect(i)} aria-current={isNext ? "step" : undefined} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left">
                    <span
                      className={cn(
                        "mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full border-2 font-mono text-[11px] font-bold",
                        take ? "border-accent-hi bg-accent-hi text-bg" : isNext ? "border-accent-hi bg-accent text-white" : "border-white/20 text-muted",
                      )}
                      aria-hidden
                    >
                      {take ? <Check className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-semibold text-white">{s.title}</span>
                      {!take && (
                        <span className="mt-0.5 block text-xs text-muted">
                          {isNext ? "Sigue" : s.lastTake ? "Ya lo grabaste antes" : s.estimatedSeconds ? `Unos ${formatDuration(s.estimatedSeconds)}` : "Pendiente"}
                        </span>
                      )}
                    </span>
                  </button>
                  {take && (
                    <div className="-mt-1 pb-2.5 pl-12 pr-3">
                      <UploadLine upload={up} live={up?.projectId ? live[up.projectId] : undefined} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {done && (
            <div className="flex flex-col gap-2 rounded-xl border border-success/40 bg-success/10 p-3 text-sm">
              <p className="flex items-center gap-2 font-semibold text-white">
                <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> ¡Grabaste todo!
              </p>
              <p className="text-xs text-muted">Puedes cerrar esta página cuando terminen las subidas. Te avisamos cuando cada video esté listo.</p>
              <ButtonLink href="/editor" size="sm" variant="ghost">
                Ver mis videos
              </ButtonLink>
            </div>
          )}
        </div>
      )}

      {extra.length > 0 && (
        <div className="card flex flex-col gap-2 p-4">
          <p className="eyebrow">{session.length ? "Otras tomas" : "Tus tomas"}</p>
          <ul className="flex flex-col gap-2">
            {extra.map((l) => {
              const up = uploads.get(l.takeId);
              return (
                <li key={l.takeId} className="rounded-xl border border-white/10 px-3 py-2.5">
                  <p className="truncate text-sm font-semibold text-white">{l.title}</p>
                  <UploadLine upload={up} live={up?.projectId ? live[up.projectId] : undefined} />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="px-1 text-xs leading-relaxed text-muted">
        Cada toma se guarda en este navegador hasta que termina de subir: si se corta la conexión o cierras la pestaña, la retomamos al volver a esta página.
      </p>
    </aside>
  );
}

function UploadLine({ upload, live }: { upload?: TakeUpload; live?: LiveProject }) {
  if (!upload) return <span className="mt-1 block text-xs text-muted">Guardada, esperando para subir</span>;
  const pct = upload.total ? (upload.loaded / upload.total) * 100 : 0;
  if (upload.status === "done" && upload.projectId) {
    const label = live ? (live.status === "PROCESSING" || live.status === "RENDERING" ? `${statusLabel[live.status]}${live.progress != null ? ` · ${Math.round(live.progress)} %` : ""}` : statusLabel[live.status]) : "Subida";
    return (
      <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
        <span className={cn("inline-flex items-center gap-1", live?.status === "DONE" ? "text-success" : live?.status === "FAILED" ? "text-danger" : "text-accent-glow")}>
          {live?.status === "DONE" ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <Upload className="h-3.5 w-3.5" aria-hidden />} {label}
        </span>
        <Link href={`/editor/${upload.projectId}`} className="inline-flex items-center gap-0.5 font-semibold text-accent-hi hover:underline">
          Abrir <ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
      </span>
    );
  }
  if (upload.status === "error") {
    return (
      <span className="mt-1 flex flex-col gap-1 text-xs text-danger" role="alert">
        {upload.error}
        <button
          type="button"
          className="inline-flex w-fit items-center gap-1 font-semibold text-accent-hi hover:underline"
          onClick={() => enqueueTake({ id: upload.takeId, title: upload.title, scriptId: upload.scriptId, size: upload.total })}
        >
          <RefreshCcw className="h-3 w-3" aria-hidden /> Reintentar
        </button>
      </span>
    );
  }
  const text =
    upload.status === "waiting"
      ? "En cola para subir"
      : upload.status === "creating"
        ? "Preparando la subida…"
        : upload.status === "finishing"
          ? "Terminando…"
          : upload.status === "offline"
            ? "Sin conexión: sigue sola cuando vuelva"
            : upload.status === "retrying"
              ? `Se cortó; reintentamos en ${upload.retryIn ?? 0} s`
              : `Subiendo ${formatBytes(upload.loaded)} de ${formatBytes(upload.total)}`;
  return (
    <span className="mt-1.5 flex flex-col gap-1">
      <span className={cn("inline-flex items-center gap-1 text-xs", upload.status === "offline" || upload.status === "retrying" ? "text-warning" : "text-muted")}>
        {upload.status === "offline" ? <CloudOff className="h-3.5 w-3.5" aria-hidden /> : null}
        {text}
      </span>
      {(upload.status === "uploading" || upload.status === "finishing") && <Progress value={pct} />}
    </span>
  );
}
