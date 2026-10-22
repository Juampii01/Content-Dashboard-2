"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Clapperboard, Eye, Loader2, Mic, Pause, Play, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/ui/badges";
import { toast } from "@/components/ui/toast";
import { formatUsd, LIPSYNC_MODES, estimateLipsync, estimateSpeech } from "@/lib/heygen/pricing";
import { fixWindow, lipsyncClip, MAX_FIX_SECONDS, MAX_FIX_WORDS, MAX_TEMPO, spokenRange } from "@/lib/video/phrase-fix";
import type { Word } from "@/lib/video/types";
import { cn } from "@/lib/utils";
import {
  createPhraseFixAction,
  deletePhraseFixAction,
  listPhraseFixesAction,
  phraseFixVoicesAction,
  pollPhraseFixesAction,
  setPhraseFixCoverAction,
  type FixView,
  type VoiceChoice,
} from "./phrase-fix-actions";

/**
 * "Corregir una frase sin regrabar" (revisión del Editor): la persona marca una frase mal dicha en la transcripción,
 * escribe cómo tenía que decirla y la app la genera con su voz clonada (HeyGen) y la pone en el audio.
 * La boca no coincide con la voz nueva, así que la imagen se tapa con b-roll (recomendado), se deja como está o se
 * redibuja con la sincronía de labios de HeyGen (cobra aparte).
 *
 * El componente es independiente: la revisión le pasa el rango marcado y recibe dos avisos para su propio estado
 * (subtítulos de la frase nueva y "poner b-roll aquí").
 */

type Cover = FixView["cover"];
type LipMode = "speed" | "precision";

const coverLabel: Record<Cover, string> = { broll: "Tapada con b-roll", none: "Imagen sin cambios", lipsync: "Labios sincronizados" };

export function usePhraseFixes(projectId: string) {
  const [fixes, setFixes] = useState<FixView[] | null>(null);
  const load = useCallback(async () => {
    const res = await listPhraseFixesAction(projectId);
    if (res.ok) setFixes(res.data);
  }, [projectId]);
  useEffect(() => {
    // Primera carga al montar la revisión (la lista vive en la base, no en el plan).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Mientras haya labios en curso, se avanza cada 5 s (se pausa con la pestaña oculta).
  const busy = (fixes ?? []).some((f) => f.status === "LIPSYNC");
  useEffect(() => {
    if (!busy) return;
    let running = false;
    const tick = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      try {
        const res = await pollPhraseFixesAction(projectId);
        if (res.ok) setFixes(res.data);
      } finally {
        running = false;
      }
    };
    const timer = setInterval(tick, 5000);
    return () => clearInterval(timer);
  }, [busy, projectId]);

  const upsert = (fix: FixView) => setFixes((prev) => [...(prev ?? []).filter((f) => f.id !== fix.id && !(f.fromWord <= fix.toWord && fix.fromWord <= f.toWord)), fix].sort((a, b) => a.fromWord - b.fromWord));
  const remove = (id: string) => setFixes((prev) => (prev ?? []).filter((f) => f.id !== id));
  return { fixes, upsert, remove, reload: load };
}

function AudioButton({ url, label }: { url: string | null; label: string }) {
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  if (!url) return null;
  const toggle = () => {
    if (!audio.current) {
      audio.current = new Audio(url);
      audio.current.onended = () => setPlaying(false);
    }
    if (playing) {
      audio.current.pause();
      setPlaying(false);
    } else {
      audio.current.currentTime = 0;
      audio.current.play().then(() => setPlaying(true)).catch(() => toast.error("Tu navegador no pudo reproducir el audio."));
    }
  };
  return (
    <Button variant="ghost" size="sm" onClick={toggle} aria-label={playing ? `Pausar ${label}` : `Escuchar ${label}`} icon={playing ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}>
      {playing ? "Pausar" : "Escuchar"}
    </Button>
  );
}

function CoverOption({ selected, onClick, title, hint, price, disabled }: { selected: boolean; onClick: () => void; title: string; hint: string; price?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      disabled={disabled}
      className={cn("flex flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-45", selected ? "border-accent bg-accent/15" : "border-white/10 hover:border-white/25")}
    >
      <span className="flex items-baseline justify-between gap-2 text-sm font-semibold text-white">
        {title}
        {price && <span className="font-mono text-xs font-normal text-accent-glow">{price}</span>}
      </span>
      <span className="text-xs text-muted">{hint}</span>
    </button>
  );
}

/** Diálogo para corregir el rango marcado. */
export function PhraseFixDialog({
  projectId,
  range,
  words,
  corrections,
  duration,
  onClose,
  onCreated,
}: {
  projectId: string;
  range: { from: number; to: number } | null;
  words: Word[];
  corrections: Record<string, string>;
  duration: number;
  onClose: () => void;
  onCreated: (fix: FixView) => void;
}) {
  const original = range ? spokenRange(words, range.from, range.to, corrections) : "";
  const [text, setText] = useState(original);
  const [voices, setVoices] = useState<VoiceChoice[] | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState<string>("");
  const [cover, setCover] = useState<Cover>("broll");
  const [mode, setMode] = useState<LipMode>("speed");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!range) return;
    let cancelled = false;
    phraseFixVoicesAction().then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setVoices(res.data.voices);
        setVoiceId((v) => v || res.data.preferred || "");
      } else setVoicesError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const win = range ? fixWindow(words, range.from, range.to, duration) : null;
  const seconds = win ? win.end - win.start : 0;
  const count = range ? range.to - range.from + 1 : 0;
  const tooBig = count > MAX_FIX_WORDS || seconds > MAX_FIX_SECONDS;
  const speechCost = estimateSpeech(seconds * MAX_TEMPO).usd;
  const clip = win ? lipsyncClip(win, duration) : null;
  const lipCost = clip ? estimateLipsync(clip.end - clip.start, mode).usd : 0;
  const total = speechCost + (cover === "lipsync" ? lipCost : 0);
  const unchanged = text.trim() === original.trim();

  const submit = () =>
    start(async () => {
      if (!range) return;
      setError(null);
      const res = await createPhraseFixAction({
        projectId,
        fromWord: range.from,
        toWord: range.to,
        newText: text.trim(),
        voiceId,
        voiceName: voices?.find((v) => v.id === voiceId)?.name ?? null,
        cover,
        lipsyncMode: mode,
        corrections,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onCreated(res.data);
      toast.success(cover === "lipsync" ? "Voz lista. Estamos preparando los labios con HeyGen." : "Frase corregida con tu voz.");
      onClose();
    });

  return (
    <Dialog
      open={Boolean(range)}
      onOpenChange={(open) => !open && !pending && onClose()}
      title="Corregir esta frase con tu voz"
      description="Escribe cómo tenía que decirse. La generamos con tu voz clonada de HeyGen y reemplaza a la original en el video."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !voiceId || !text.trim() || unchanged || tooBig} icon={pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}>
            {pending ? "Generando tu voz…" : `Generar con mi voz · ≈ ${formatUsd(Math.max(0.01, total))}`}
          </Button>
        </>
      }
    >
      {range && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-white/[0.04] p-3">
            <p className="eyebrow">Lo que dijiste ({seconds.toFixed(1)} s)</p>
            <p className="mt-1 text-sm text-text/90">“{original}”</p>
          </div>
          {tooBig && <Notice tone="warning">Marca una sola frase: hasta {MAX_FIX_WORDS} palabras y {MAX_FIX_SECONDS} segundos.</Notice>}
          <Field label="Cómo tenía que decirse" htmlFor="pf-texto" hint="Que dure parecido: si es mucho más larga no entra en el mismo lugar.">
            <Textarea id="pf-texto" value={text} onChange={(e) => setText(e.target.value)} className="!min-h-24" maxLength={600} />
          </Field>
          <Field label="Tu voz" htmlFor="pf-voz" hint={voicesError ?? "Tu voz clonada en HeyGen (la del clon)."}>
            {voices ? (
              voices.length ? (
                <Select id="pf-voz" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Notice tone="warning">Tu cuenta de HeyGen no tiene voces propias. Crea tu clon en HeyGen (su voz se clona del mismo video) y vuelve aquí.</Notice>
              )
            ) : voicesError ? (
              <Notice tone="danger">{voicesError}</Notice>
            ) : (
              <div className="skeleton h-11" aria-busy="true" aria-label="Cargando voces" />
            )}
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-white">¿Qué se ve mientras suena?</legend>
            <p className="mb-2 text-xs text-muted">Tu boca en el video dice la frase vieja. Elige cómo resolverlo:</p>
            <div className="grid gap-2" role="radiogroup" aria-label="Qué se ve durante la frase">
              <CoverOption selected={cover === "broll"} onClick={() => setCover("broll")} title="Taparla con b-roll · recomendado" hint="Ponemos un b-roll encima de la frase. Lo eliges en la lista de b-roll." price="sin costo" />
              <CoverOption
                selected={cover === "lipsync"}
                onClick={() => setCover("lipsync")}
                title="Sincronizar los labios con HeyGen"
                hint="HeyGen redibuja tu boca para que diga la frase nueva. Tarda unos minutos."
                price={`≈ ${formatUsd(Math.max(0.01, lipCost))}`}
              />
              <CoverOption selected={cover === "none"} onClick={() => setCover("none")} title="Dejar la imagen como está" hint="Solo si casi no se nota (por ejemplo, una palabra)." />
            </div>
            {cover === "lipsync" && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                Calidad:
                {(["speed", "precision"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} className={cn("rounded-lg border px-2 py-1", mode === m ? "border-accent text-white" : "border-white/10")}>
                    {LIPSYNC_MODES[m].label} · {formatUsd(LIPSYNC_MODES[m].usdPerMinute)}/min
                  </button>
                ))}
              </div>
            )}
          </fieldset>
          <p className="text-xs text-placeholder">
            Estimación con la tabla de precios de la API de HeyGen: la voz cuesta {formatUsd(Math.max(0.01, speechCost))} o menos; los labios se cobran por los segundos del tramo
            ({clip ? (clip.end - clip.start).toFixed(1) : "0"} s, HeyGen no dice si cobra por el tramo o por un mínimo).
          </p>
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
      )}
    </Dialog>
  );
}

/** Lista de frases corregidas de la revisión. */
export function PhraseFixPanel({
  projectId,
  fixes,
  canEdit,
  onUpsert,
  onRemove,
  onCoverWithBroll,
  onListen,
  hasBrollAt,
}: {
  projectId: string;
  fixes: FixView[] | null;
  canEdit: boolean;
  onUpsert: (fix: FixView) => void;
  onRemove: (fix: FixView) => void;
  onCoverWithBroll: (fix: FixView) => void;
  onListen: (wordId: number) => void;
  hasBrollAt: (from: number, to: number) => boolean;
}) {
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmLips, setConfirmLips] = useState<{ fix: FixView; mode: LipMode } | null>(null);
  const list = useMemo(() => fixes ?? [], [fixes]);
  const lipsCost = (fix: FixView, mode: LipMode) => estimateLipsync(fix.windowEnd - fix.windowStart + 0.8, mode).usd;

  const setCover = (fix: FixView, cover: Cover) =>
    start(async () => {
      setBusyId(fix.id);
      const res = await setPhraseFixCoverAction({ projectId, fixId: fix.id, cover, lipsyncMode: fix.lipsyncMode ?? "speed" });
      setBusyId(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onUpsert(res.data);
      if (cover === "broll" && !hasBrollAt(fix.fromWord, fix.toWord)) onCoverWithBroll(res.data);
    });

  const remove = (fix: FixView) =>
    start(async () => {
      setBusyId(fix.id);
      const res = await deletePhraseFixAction(projectId, fix.id);
      setBusyId(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onRemove(fix);
      toast.success("Volvimos a la frase original.");
    });

  return (
    <section aria-labelledby="frases-title" className="flex flex-col gap-3">
      <div>
        <h2 id="frases-title" className="flex items-center gap-2 text-base font-semibold">
          <Wand2 className="h-4 w-4 text-accent-hi" aria-hidden />
          Frases corregidas con tu voz
        </h2>
        <p className="text-sm text-muted">¿Dijiste algo mal? Márcalo en la transcripción y toca «Corregir esta frase». La decimos de nuevo con tu voz clonada, sin regrabar.</p>
      </div>
      {fixes === null ? (
        <div className="skeleton h-16" aria-busy="true" aria-label="Cargando frases corregidas" />
      ) : list.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {list.map((fix) => {
            const working = fix.status === "LIPSYNC" || busyId === fix.id;
            const needsBroll = fix.cover === "broll" && fix.status === "READY" && !hasBrollAt(fix.fromWord, fix.toWord);
            return (
              <li key={fix.id} className="card flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StatusBadge
                    tone={fix.status === "FAILED" ? "danger" : fix.status === "READY" ? "success" : "info"}
                    icon={working ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : undefined}
                  >
                    {fix.status === "FAILED"
                      ? "Falló"
                      : fix.status === "LIPSYNC"
                        ? fix.lipsyncStage === "clip"
                          ? "Recortando el tramo"
                          : "HeyGen ajusta tus labios"
                        : fix.status === "VOICE"
                          ? "Generando tu voz"
                          : coverLabel[fix.cover]}
                  </StatusBadge>
                  <div className="flex flex-wrap gap-1">
                    <Button variant="subtle" size="sm" onClick={() => onListen(fix.fromWord)} icon={<Eye className="h-3.5 w-3.5" aria-hidden />}>
                      Ver en el video
                    </Button>
                    <AudioButton url={fix.audioUrl} label="la frase nueva" />
                  </div>
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <p className="min-w-0 text-muted">
                    <span className="eyebrow block">Antes</span>
                    <span className="line-through decoration-white/30">“{fix.originalText}”</span>
                  </p>
                  <p className="min-w-0 text-white">
                    <span className="eyebrow block">Ahora, con tu voz</span>“{fix.newText}”
                  </p>
                </div>
                {fix.tempo > 1.01 && <p className="text-xs text-muted">Acelerada ×{fix.tempo.toFixed(2)} para que entre en el mismo lugar.</p>}
                {fix.errorMessage && <Notice tone="danger">{fix.errorMessage}</Notice>}
                {needsBroll && (
                  <Notice tone="warning">
                    Falta el b-roll que tapa esta frase: sin él se ve tu boca diciendo la frase vieja.{" "}
                    {canEdit && (
                      <button type="button" className="font-semibold underline" onClick={() => onCoverWithBroll(fix)}>
                        Elegir b-roll
                      </button>
                    )}
                  </Notice>
                )}
                {canEdit && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                    <span className="text-xs text-muted">Qué se ve:</span>
                    <div className="segmented" role="radiogroup" aria-label="Qué se ve durante la frase">
                      {(["broll", "lipsync", "none"] as const).map((c) => (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          aria-checked={fix.cover === c}
                          className="segmented-item !text-xs"
                          disabled={pending || fix.status === "LIPSYNC" || !fix.hasAudio}
                          onClick={() => fix.cover !== c && (c === "lipsync" ? setConfirmLips({ fix, mode: fix.lipsyncMode ?? "speed" }) : setCover(fix, c))}
                        >
                          {c === "broll" ? <Clapperboard className="h-3.5 w-3.5" aria-hidden /> : c === "lipsync" ? <Sparkles className="h-3.5 w-3.5" aria-hidden /> : null}
                          {c === "broll" ? "B-roll" : c === "lipsync" ? "Labios" : "Sin cambios"}
                        </button>
                      ))}
                    </div>
                    <Button variant="subtle" size="sm" className="ml-auto" onClick={() => remove(fix)} disabled={pending} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}>
                      Volver a la original
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Dialog
        open={Boolean(confirmLips)}
        onOpenChange={(open) => !open && setConfirmLips(null)}
        title={`¿Sincronizar los labios por ≈ ${formatUsd(Math.max(0.01, confirmLips ? lipsCost(confirmLips.fix, confirmLips.mode) : 0))}?`}
        description="HeyGen redibuja tu boca en el tramo de la frase para que diga la nueva. Se cobra de tu saldo de API en HeyGen y tarda unos minutos."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmLips(null)}>
              Cancelar
            </Button>
            <Button
              icon={<Sparkles className="h-4 w-4" aria-hidden />}
              onClick={() => {
                if (!confirmLips) return;
                const { fix, mode } = confirmLips;
                setConfirmLips(null);
                start(async () => {
                  setBusyId(fix.id);
                  const res = await setPhraseFixCoverAction({ projectId, fixId: fix.id, cover: "lipsync", lipsyncMode: mode });
                  setBusyId(null);
                  if (!res.ok) toast.error(res.error);
                  else onUpsert(res.data);
                });
              }}
            >
              Sí, sincronizar
            </Button>
          </>
        }
      >
        {confirmLips && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            Calidad:
            {(["speed", "precision"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setConfirmLips({ ...confirmLips, mode: m })} aria-pressed={confirmLips.mode === m} className={cn("rounded-lg border px-2 py-1", confirmLips.mode === m ? "border-accent text-white" : "border-white/10")}>
                {LIPSYNC_MODES[m].label} · ≈ {formatUsd(Math.max(0.01, lipsCost(confirmLips.fix, m)))}
              </button>
            ))}
          </div>
        )}
      </Dialog>
      {list.some((f) => f.status === "LIPSYNC") && (
        <p className="text-xs text-muted" aria-live="polite">
          Los labios tardan unos minutos. Puedes seguir revisando o salir: te avisamos cuando estén. Si renderizas antes, esa frase sale como la grabaste.
        </p>
      )}
    </section>
  );
}
