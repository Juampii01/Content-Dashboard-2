"use client";

import { useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Captions, Clapperboard, FileUp, Lightbulb, LogOut, RefreshCw, Sparkles, Trash2, MonitorPlay } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice, Skeleton } from "@/components/ui/feedback";
import { Select } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { formatDate, formatDuration, formatNumber, formatPercent, formatRelative } from "@/lib/format";
import type { RetentionView } from "@/lib/dal/youtube";
import { relativeLabel } from "@/lib/youtube/retention";
import { jobActive, useYtJob } from "@/lib/youtube/use-job";
import { RetentionDropsChart } from "./retention-chart";
import { applyEditorTranscriptAction, clearTranscriptAction, explainRetentionAction, fetchYoutubeTranscriptAction, refreshRetentionAction, uploadSubtitlesAction } from "./actions";

type YoutubeView = Extract<RetentionView, { kind: "youtube" }>;
/** Fechas que llegan del servidor como texto (las props de un componente de cliente se serializan). */
type Serialized<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] };
export type RetentionPanelData =
  | Extract<RetentionView, { kind: "unsupported" }>
  | (Omit<Serialized<YoutubeView>, "transcript" | "insight"> & {
      transcript: (Omit<NonNullable<YoutubeView["transcript"]>, "updatedAt"> & { updatedAt: string | null }) | null;
      insight: (Omit<NonNullable<YoutubeView["insight"]>, "createdAt"> & { createdAt: string }) | null;
    });

const FETCH_MESSAGES: Record<string, { tone: "info" | "warning"; text: string }> = {
  "too-new": { tone: "info", text: "YouTube tarda 2 a 3 días en calcular la retención de un video nuevo. Vuelve en unos días y la verás aquí." },
  empty: { tone: "info", text: "YouTube todavía no tiene la curva de este video. Pasa con videos nuevos o de pocas vistas: lo volvemos a intentar solo." },
  "no-account": { tone: "warning", text: "Reconecta YouTube en Ajustes para traer la curva de retención." },
  demo: { tone: "info", text: "Es una pieza de demostración: no se consulta YouTube." },
};

function span(from: number | null, to: number | null) {
  return from == null || to == null ? null : `${formatDuration(from)}–${formatDuration(to)}`;
}

/** "Dónde se fue la gente": curva con las caídas marcadas, lo que se decía en cada una y la explicación con IA. */
export function RetentionPanel({ data, canEdit, aiReady }: { data: RetentionPanelData; canEdit: boolean; aiReady: boolean }) {
  if (data.kind === "unsupported") {
    return (
      <section className="card flex items-start gap-4 p-6" aria-labelledby="ret-title">
        <span className="tile-icon flex-none">
          <LogOut className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <p className="eyebrow mb-1.5">Dónde se fue la gente</p>
          <h2 id="ret-title" className="text-base font-semibold text-white">
            Esta red no da la curva de retención
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{data.message}</p>
        </div>
      </section>
    );
  }
  return <YoutubeRetention data={data} canEdit={canEdit} aiReady={aiReady} />;
}

function YoutubeRetention({ data, canEdit, aiReady }: { data: Exclude<RetentionPanelData, { kind: "unsupported" }>; canEdit: boolean; aiReady: boolean }) {
  const router = useRouter();
  const [fetching, setFetching] = useState(data.shouldFetch);
  const [fetchNote, setFetchNote] = useState<{ tone: "info" | "warning" | "danger"; text: string } | null>(null);
  const [pending, start] = useTransition();
  // El trabajo de subtítulos sale de los datos del servidor (sirve también si se pidió desde otra pestaña).
  const [finishedJob, setFinishedJob] = useState<string | null>(null);
  const serverJob = data.transcriptJob && ["QUEUED", "RUNNING"].includes(data.transcriptJob.status) ? data.transcriptJob.id : null;
  const jobId = serverJob && serverJob !== finishedJob ? serverJob : null;
  const asked = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Al abrir la pieza: si la curva falta o quedó vieja, se pide a YouTube (una vez por visita).
  useEffect(() => {
    if (!data.shouldFetch || asked.current) return;
    asked.current = true;
    refreshRetentionAction(data.itemId)
      .then((res) => {
        if (res.status === "error") setFetchNote({ tone: "danger", text: res.message ?? "No pudimos traer la curva de YouTube." });
        else if (!data.points && FETCH_MESSAGES[res.status]) setFetchNote(FETCH_MESSAGES[res.status]!);
      })
      .catch(() => setFetchNote({ tone: "danger", text: "No pudimos traer la curva de YouTube. Prueba recargar la página." }))
      .finally(() => setFetching(false));
  }, [data.itemId, data.points, data.shouldFetch]);

  const job = useYtJob(jobId, (state) => {
    if (jobActive(state)) return;
    if (state.status === "SUCCEEDED") toast.success("Listo: ya tenemos lo que decías en cada momento.");
    else if (state.status === "FAILED") toast.error(state.error ?? "No pudimos traer los subtítulos de YouTube.");
    setFinishedJob(state.id);
    router.refresh();
  });

  const run = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error);
      else {
        if (res.message) toast.success(res.message);
        after?.();
      }
    });

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 1_500_000) {
      toast.error("El archivo es demasiado grande. Sube el .srt o .vtt de YouTube Studio.");
      return;
    }
    void file.text().then((text) => run(() => uploadSubtitlesAction(data.itemId, file.name, text)));
  };

  const fetchFromYoutube = () =>
    start(async () => {
      const res = await fetchYoutubeTranscriptAction(data.itemId);
      if (!res.ok) toast.error(res.error);
      else {
        toast.info(res.message ?? "Estamos trayendo los subtítulos.");
        router.refresh();
      }
    });

  const insight = data.insight;
  const explanationFor = (n: number) => insight?.explanation.drops.find((d) => d.n === n) ?? null;

  return (
    <section className="card flex flex-col gap-6 p-6" aria-labelledby="ret-title" aria-busy={pending || fetching}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="tile-icon flex-none">
            <LogOut className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="eyebrow mb-1.5">Retención</p>
            <h2 id="ret-title" className="text-lg font-semibold text-white">
              Dónde se fue la gente
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">Los momentos del video en los que más público dejó de mirar y lo que estabas diciendo justo ahí.</p>
          </div>
        </div>
        {data.capturedAt && <p className="text-xs text-placeholder sm:text-right">Curva de YouTube del {formatDate(data.capturedAt)}</p>}
      </header>

      {!data.points ? (
        fetching ? (
          <div className="flex flex-col gap-3" role="status">
            <p className="flex items-center gap-2 text-sm text-muted">
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> Trayendo la curva de retención de YouTube…
            </p>
            <Skeleton className="h-64" />
          </div>
        ) : (
          <Notice tone={fetchNote?.tone ?? "info"}>{fetchNote?.text ?? FETCH_MESSAGES.empty!.text}</Notice>
        )
      ) : (
        <>
          {fetchNote?.tone === "danger" && <Notice tone="warning">{fetchNote.text} Te mostramos la última curva guardada.</Notice>}
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 p-4">
              <dt className="text-xs text-muted">Siguen al terminar el arranque{data.durationSec ? ` (${formatDuration(data.marks.introAt * data.durationSec)})` : ""}</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums text-white">{formatPercent(data.marks.intro)}</dd>
            </div>
            <div className="rounded-xl border border-white/10 p-4">
              <dt className="text-xs text-muted">Siguen a la mitad del video</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums text-white">{formatPercent(data.marks.middle)}</dd>
            </div>
            <div className="rounded-xl border border-white/10 p-4">
              <dt className="text-xs text-muted">Contra videos de su duración (según YouTube)</dt>
              <dd className="mt-1 text-base font-semibold text-white first-letter:uppercase">{data.relative ? `${relativeLabel(data.relative.overall)}` : "YouTube no lo dio"}</dd>
              {data.relative && <p className="mt-0.5 text-xs text-muted">En el arranque: {relativeLabel(data.relative.intro)}</p>}
            </div>
          </dl>

          <RetentionDropsChart points={data.points} drops={data.drops} durationSec={data.durationSec} />

          {data.drops.length > 0 ? (
            <ol className="flex flex-col gap-3" aria-label="Caídas fuertes">
              {data.drops.map((d, i) => {
                const ai = explanationFor(i + 1);
                return (
                  <li key={i} className="flex gap-4 rounded-xl border border-white/10 p-4">
                    <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-danger text-xs font-bold text-[#1a0505]" aria-label={`Caída ${i + 1}`}>
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        <span className="font-mono text-accent-glow">{span(d.startSec, d.endSec) ?? `${Math.round(d.fromAt * 100)}–${Math.round(d.toAt * 100)} %`}</span>
                        <span>· {d.intro ? "Arranque" : `cae ${formatNumber(d.steepness, { digits: 1 })} veces más rápido que lo normal`}</span>
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-white">{d.sentence}</p>
                      {!d.quote && data.transcript && <p className="mt-1 text-xs text-muted">En la transcripción no hay texto en ese tramo (puede ser una pausa, música o b-roll).</p>}
                      {ai && (
                        <div className="mt-3 grid gap-2 border-t border-white/10 pt-3 text-sm md:grid-cols-2">
                          <p className="text-text/90">
                            <span className="font-semibold text-white">Por qué: </span>
                            {ai.why}
                          </p>
                          <p className="text-text/90">
                            <span className="font-semibold text-accent-hi">Qué cambiar: </span>
                            {ai.change}
                          </p>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <Notice tone="success">No hay caídas fuertes: el público se va de a poco y parejo, como en un video que retiene bien.</Notice>
          )}

          <TranscriptBar data={data} canEdit={canEdit} pending={pending} jobActive={Boolean(jobId)} jobStage={job?.stage ?? null} fileRef={fileRef} onFile={onFile} onFetch={fetchFromYoutube}
            onEditor={(videoId) => run(() => applyEditorTranscriptAction(data.itemId, videoId))}
            onClear={() => run(() => clearTranscriptAction(data.itemId))} />

          {data.drops.length > 0 && (
            <div className="flex flex-col gap-3 rounded-xl border border-line bg-accent/[0.06] p-4">
              {insight ? (
                <>
                  <p className="flex items-start gap-2 text-sm font-semibold leading-relaxed text-white">
                    <Lightbulb className="mt-0.5 h-4 w-4 flex-none text-accent-hi" aria-hidden />
                    {insight.explanation.summary}
                  </p>
                  {insight.explanation.keep && <p className="text-sm text-text/90"><span className="font-semibold text-white">Repite: </span>{insight.explanation.keep}</p>}
                  {insight.stale && <p className="text-xs text-warning">La curva o la transcripción cambiaron desde esta explicación. Vuelve a pedirla para verla actualizada.</p>}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-placeholder">Explicado {formatRelative(insight.createdAt)} solo con la curva y lo que decías.</p>
                    {canEdit && aiReady && (
                      <Button variant="subtle" size="sm" disabled={pending} onClick={() => run(() => explainRetentionAction(data.itemId))} icon={<RefreshCw className={pending ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden />}>
                        {pending ? "Explicando…" : "Volver a explicar"}
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-text/90">
                    <span className="font-semibold text-white">¿Por qué se fueron?</span> La IA lee cada caída con lo que decías y te dice qué cambiar.
                    {!data.transcript && " Sin transcripción solo puede guiarse por el momento del video."}
                  </p>
                  {canEdit && aiReady ? (
                    <Button className="flex-none" disabled={pending} onClick={() => run(() => explainRetentionAction(data.itemId))} icon={<Sparkles className={pending ? "h-4 w-4 animate-pulse" : "h-4 w-4"} aria-hidden />}>
                      {pending ? "Explicando…" : "Explicar con IA"}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted">{aiReady ? "Solo editores pueden pedir la explicación." : "La IA no está configurada en esta instalación."}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function TranscriptBar({
  data,
  canEdit,
  pending,
  jobActive: running,
  jobStage,
  fileRef,
  onFile,
  onFetch,
  onEditor,
  onClear,
}: {
  data: Exclude<RetentionPanelData, { kind: "unsupported" }>;
  canEdit: boolean;
  pending: boolean;
  jobActive: boolean;
  jobStage: string | null;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onFile: (e: ChangeEvent<HTMLInputElement>) => void;
  onFetch: () => void;
  onEditor: (videoId: string) => void;
  onClear: () => void;
}) {
  const t = data.transcript;
  const failed = data.transcriptJob?.status === "FAILED" && !t ? data.transcriptJob.error : null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/10 p-4">
      <div className="flex items-start gap-3">
        <Captions className="mt-0.5 h-4 w-4 flex-none text-accent-hi" aria-hidden />
        <div className="min-w-0 flex-1 text-sm">
          {t ? (
            <p className="text-white">
              {t.label} <span className="text-muted">· {t.segments} frases con su tiempo</span>
            </p>
          ) : (
            <p className="text-white">Sin transcripción: no podemos decirte qué estabas diciendo en cada caída.</p>
          )}
          <p className="mt-0.5 text-xs text-muted">
            {t ? "Si el video publicado no es exactamente este, cámbiala." : "Tráela de YouTube, sube los subtítulos que descargas de YouTube Studio o usa el video del Editor."}
          </p>
          {running && (
            <p className="mt-2 flex items-center gap-2 text-xs text-accent-glow" role="status">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden /> {jobStage ?? "Trayendo los subtítulos de YouTube"}…
            </p>
          )}
          {failed && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-warning" role="alert">
              <AlertTriangle className="mt-px h-3.5 w-3.5 flex-none" aria-hidden /> {failed}
            </p>
          )}
        </div>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" disabled={pending || running} onClick={onFetch} icon={<MonitorPlay className="h-4 w-4" aria-hidden />}>
            Traer de YouTube
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => fileRef.current?.click()} icon={<FileUp className="h-4 w-4" aria-hidden />}>
            Subir subtítulos
          </Button>
          <input ref={fileRef} type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" className="sr-only" tabIndex={-1} aria-hidden onChange={onFile} />
          {data.editorOptions.length > 0 && (
            <label className="flex min-w-0 items-center gap-2 text-xs text-muted">
              <Clapperboard className="h-4 w-4 flex-none text-accent-hi" aria-hidden />
              <span className="sr-only">Usar la transcripción de un video del Editor</span>
              <Select
                aria-label="Usar la transcripción de un video del Editor"
                className="!py-1.5 !text-xs max-w-[220px]"
                value=""
                disabled={pending}
                onChange={(e) => e.target.value && onEditor(e.target.value)}
              >
                <option value="">Usar un video del Editor…</option>
                {data.editorOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {t?.updatedAt && (
            <Button size="sm" variant="subtle" disabled={pending} onClick={onClear} icon={<Trash2 className="h-4 w-4" aria-hidden />}>
              Quitar
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
