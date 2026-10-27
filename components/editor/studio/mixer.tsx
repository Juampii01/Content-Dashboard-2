"use client";

import { useEffect, useRef } from "react";
import { Headphones, VolumeX } from "lucide-react";
import { Notice } from "@/components/ui/feedback";
import { audible, MIX_TRACK_LABELS, MIX_TRACKS, MUSIC_FADE, VOICE_DB, type AudioMix, type MixTrack } from "@/lib/video/audio-mix";
import { MUSIC_DB, SFX_VOLUME } from "@/lib/video/sfx";
import { cn } from "@/lib/utils";
import type { StudioApi } from "./types";
import type { MixMeters } from "./use-studio-mix";

/**
 * Mezclador del Estudio: volumen, silenciar (M) y solo (S) de la voz, la música y los efectos de sonido, con medidores
 * en vivo mientras suena la vista previa. Lo que se elige aquí es lo que sale en el video exportado (lib/video/audio-mix.ts).
 */

/** Silenciar o poner en solo una pista (clic con Alt en «S»: solo esa, como en los editores de audio). */
export function toggleMix(mix: AudioMix, track: MixTrack, what: "mute" | "solo", exclusive = false): AudioMix {
  const list = mix[what];
  const on = list.includes(track);
  const next = exclusive ? (on && list.length === 1 ? [] : [track]) : on ? list.filter((t) => t !== track) : [...list, track];
  return { ...mix, [what]: MIX_TRACKS.filter((t) => next.includes(t)) };
}

const METER_MIN = -60;
const pct = (db: number) => Math.max(0, Math.min(100, ((db - METER_MIN) / -METER_MIN) * 100));

/** Medidor horizontal (o vertical): se actualiza con requestAnimationFrame sin volver a dibujar React. */
export function MixMeter({ read, track, vertical = false, className }: { read: () => MixMeters; track: keyof MixMeters; vertical?: boolean; className?: string }) {
  const bar = useRef<HTMLSpanElement>(null);
  const hold = useRef<HTMLSpanElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let level = METER_MIN;
    let peak = METER_MIN;
    let peakAt = 0;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const step = (now: number) => {
      const db = read()[track];
      // Sube enseguida y baja despacio (20 dB por segundo), como un medidor de verdad.
      level = db > level ? db : Math.max(db, level - (reduce ? 60 : 1.2));
      if (level >= peak || now - peakAt > 1200) {
        peak = level;
        peakAt = now;
      }
      const p = pct(level);
      if (bar.current) bar.current.style[vertical ? "height" : "width"] = `${p}%`;
      if (hold.current) hold.current.style[vertical ? "bottom" : "left"] = `${pct(peak)}%`;
      if (bar.current) bar.current.dataset.hot = level > -3 ? "2" : level > -12 ? "1" : "0";
      const shown = level <= METER_MIN + 0.5 ? "—" : `${Math.round(level)}`;
      if (label.current && label.current.textContent !== shown) label.current.textContent = shown;
      if (root.current && root.current.getAttribute("aria-valuenow") !== String(Math.round(level))) root.current.setAttribute("aria-valuenow", String(Math.round(level)));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [read, track, vertical]);
  return (
    <span ref={root} className={cn("relative flex items-center gap-1.5", className)} role="meter" aria-valuenow={METER_MIN} aria-label={`Nivel de ${track === "master" ? "la mezcla" : MIX_TRACK_LABELS[track]}`} aria-valuemin={METER_MIN} aria-valuemax={0}>
      <span className={cn("relative overflow-hidden rounded-sm bg-white/[0.07]", vertical ? "h-full w-1.5" : "h-1.5 flex-1")}>
        <span
          ref={bar}
          className={cn(
            "absolute rounded-sm bg-success transition-none data-[hot='1']:bg-[#c98500] data-[hot='2']:bg-danger",
            vertical ? "inset-x-0 bottom-0 h-0" : "inset-y-0 left-0 w-0",
          )}
        />
        <span ref={hold} aria-hidden className={cn("absolute bg-white/60", vertical ? "inset-x-0 h-px" : "inset-y-0 w-px")} />
      </span>
      {!vertical && <span ref={label} className="w-6 text-right font-mono text-[10px] text-muted tabular-nums" aria-hidden />}
    </span>
  );
}

/** Botones M y S del encabezado de una pista de la línea de tiempo. */
export function TrackToggles({ api, track }: { api: StudioApi; track: MixTrack }) {
  const mix = api.state.mix;
  const muted = mix.mute.includes(track);
  const solo = mix.solo.includes(track);
  const edit = api.props.canEdit;
  const set = (what: "mute" | "solo", exclusive: boolean) => api.update((st) => ({ ...st, mix: toggleMix(st.mix, track, what, exclusive) }));
  return (
    <span className="flex flex-none items-center gap-0.5" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        disabled={!edit}
        onClick={() => set("mute", false)}
        aria-pressed={muted}
        aria-label={`${muted ? "Volver a escuchar" : "Silenciar"} ${MIX_TRACK_LABELS[track]}`}
        title={`${muted ? "Volver a escuchar" : "Silenciar"} (M)`}
        className={cn("grid h-4 w-4 place-items-center rounded text-[9px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-accent-hi", muted ? "bg-danger text-paper" : "bg-white/[0.07] text-muted hover:text-white")}
      >
        M
      </button>
      <button
        type="button"
        disabled={!edit}
        onClick={(e) => set("solo", e.altKey)}
        aria-pressed={solo}
        aria-label={`${solo ? "Quitar el solo de" : "Escuchar solo"} ${MIX_TRACK_LABELS[track]}`}
        title="Solo (S). Con Alt: solo esta pista"
        className={cn("grid h-4 w-4 place-items-center rounded text-[9px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-accent-hi", solo ? "bg-[#c98500] text-paper" : "bg-white/[0.07] text-muted hover:text-white")}
      >
        S
      </button>
    </span>
  );
}

type Strip = { track: MixTrack; value: number; min: number; max: number; onChange: (db: number) => void; hint: string };

export function Mixer({ api }: { api: StudioApi }) {
  const { state, props } = api;
  const edit = props.canEdit;
  const hasMusic = Boolean(state.musicGen || state.music.trackId);
  const strips: Strip[] = [
    { track: "voice", value: state.voiceDb, min: VOICE_DB.min, max: VOICE_DB.max, onChange: (voiceDb) => api.update((st) => ({ ...st, voiceDb }), { coalesce: "voiceDb" }), hint: "Tu voz sale a -14 LUFS (lo que piden Instagram, TikTok y YouTube). Aquí solo se baja." },
    { track: "music", value: state.music.db, min: MUSIC_DB.min, max: MUSIC_DB.max, onChange: (db) => api.update((st) => ({ ...st, music: { ...st.music, db } }), { coalesce: "music" }), hint: hasMusic ? "Respecto de tu voz. Baja sola cuando hablas." : "Elige música en la Biblioteca." },
    { track: "sfx", value: state.sfxDb, min: SFX_VOLUME.min, max: 6, onChange: (sfxDb) => api.update((st) => ({ ...st, sfxDb }), { coalesce: "sfxDb" }), hint: "Todos los efectos de sonido juntos (cada uno tiene además su volumen)." },
  ];
  const silenced = MIX_TRACKS.filter((t) => !audible(state.mix, t));
  return (
    <section className="flex flex-col gap-3" aria-labelledby="mixer-title" data-testid="mixer">
      <div className="flex items-center justify-between gap-2">
        <h3 id="mixer-title" className="flex items-center gap-2 text-sm font-semibold text-white">
          <Headphones className="h-4 w-4" aria-hidden /> Mezcla
        </h3>
        <MixMeter read={api.mixer.read} track="master" className="w-32" />
      </div>
      <ul className="flex flex-col gap-2">
        {strips.map((st) => {
          const muted = state.mix.mute.includes(st.track);
          const off = !audible(state.mix, st.track);
          const id = `mix-${st.track}`;
          return (
            <li key={st.track} className={cn("rounded-xl border border-white/10 bg-card px-3 py-2.5", off && "bg-white/[0.03]")} data-strip={st.track}>
              <div className="flex items-center gap-2">
                <label htmlFor={id} className={cn("min-w-0 flex-1 truncate text-sm font-semibold text-white", off && "text-muted")}>
                  {MIX_TRACK_LABELS[st.track]}
                </label>
                <span className="font-mono text-xs text-muted tabular-nums">{st.track === "music" && !hasMusic ? "—" : `${st.value > 0 ? "+" : ""}${st.value} dB`}</span>
                <TrackToggles api={api} track={st.track} />
              </div>
              <input
                id={id}
                type="range"
                className="range mt-2 w-full"
                min={st.min}
                max={st.max}
                step={1}
                value={st.value}
                disabled={!edit || muted || (st.track === "music" && !hasMusic)}
                onChange={(e) => st.onChange(Number(e.target.value))}
                aria-valuetext={`${st.value} decibeles`}
                style={{ ["--pct" as string]: `${((st.value - st.min) / (st.max - st.min)) * 100}%` }}
              />
              <MixMeter read={api.mixer.read} track={st.track} className="mt-1.5" />
              <p className="mt-1 text-[11px] text-muted">{st.hint}</p>
              {st.track === "music" && hasMusic && <MusicFades api={api} />}
            </li>
          );
        })}
      </ul>
      {silenced.length > 0 && (
        <Notice tone="warning">
          <span className="inline-flex items-start gap-1.5">
            <VolumeX className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
            <span>
              {silenced.map((t) => MIX_TRACK_LABELS[t]).join(", ")}: no {silenced.length === 1 ? "suena" : "suenan"} en la vista previa y tampoco {silenced.length === 1 ? "sale" : "salen"} en el video exportado.
            </span>
          </span>
        </Notice>
      )}
      {!api.mixer.voiceReady && <p className="text-[11px] text-muted">Estamos preparando la forma de onda de tu voz; mientras tanto, su medidor no se mueve.</p>}
    </section>
  );
}

function MusicFades({ api }: { api: StudioApi }) {
  const f = api.state.musicFade;
  const edit = api.props.canEdit;
  const set = (which: "in" | "out", v: number) => api.update((st) => ({ ...st, musicFade: { ...st.musicFade, [which]: Math.round(Math.max(0, Math.min(MUSIC_FADE.max, v)) * 10) / 10 } }), { coalesce: `fade:${which}` });
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      {(["in", "out"] as const).map((which) => (
        <label key={which} className="flex flex-col gap-1 text-[11px] text-muted">
          {which === "in" ? "Fundido de entrada" : "Fundido de salida"}
          <span className="flex items-center gap-1">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={MUSIC_FADE.max}
              step={0.1}
              className="field h-8 w-full rounded-lg !py-0 text-sm tabular-nums"
              value={f[which]}
              disabled={!edit}
              onChange={(e) => set(which, Number(e.target.value))}
              aria-label={which === "in" ? "Fundido de entrada de la música, en segundos" : "Fundido de salida de la música, en segundos"}
            />
            <span>s</span>
          </span>
        </label>
      ))}
    </div>
  );
}
