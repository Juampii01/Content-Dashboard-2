"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Music, Pause, Play, Volume2 } from "lucide-react";
import { Select } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/tabs";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MUSIC_DB, musicLabel, SFX_LEVEL_LABELS, SFX_LEVELS, SFX_VOLUME, type SfxLevel } from "@/lib/video/sfx";
import { STUDIO_LEVEL_LABELS, STUDIO_LEVELS, type AudioPreview, type StudioLevel } from "@/lib/video/studio-audio";
import { useTrackPlayer, type TrackItem } from "./music-manager";
import { StudioPreview } from "./studio-preview";

/** Ganancia de prueba del whoosh por nivel (las mismas proporciones que lib/video/sfx.ts, sin voz encima). */
const DEMO_GAIN: Record<SfxLevel, number> = { off: 0, subtle: 0.35, strong: 0.7 };

/**
 * Sonido del video en la revisión: audio de estudio (Apagado / Suave / Fuerte, con la muestra de antes y después),
 * efectos (Sin efectos / Sutil / Marcado) y música de fondo de la biblioteca con su volumen. La vista previa no mezcla el audio: los botones de escuchar sirven para elegir; la mezcla final la
 * hace el worker (la voz siempre por encima).
 */
export function AudioPanel({
  studio,
  onStudio,
  audioPreview,
  sfx,
  onSfx,
  sfxDb,
  onSfxDb,
  musicId,
  musicDb,
  onMusic,
  tracks,
  canEdit,
  showStudioPreview = true,
}: {
  /** Fuera de un video (valores por defecto de Mi marca) no hay muestra de antes y después. */
  showStudioPreview?: boolean;
  studio: StudioLevel;
  onStudio: (level: StudioLevel) => void;
  audioPreview: AudioPreview | null;
  sfx: SfxLevel;
  onSfx: (level: SfxLevel) => void;
  /** Volumen de todos los efectos (dB). Sin él (valores de Mi marca), no se muestra. */
  sfxDb?: number;
  onSfxDb?: (db: number) => void;
  musicId: string | null;
  musicDb: number;
  onMusic: (music: { trackId: string | null; db: number }) => void;
  tracks: TrackItem[];
  canEdit: boolean;
}) {
  const player = useTrackPlayer();
  const demo = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => demo.current?.pause(), []);
  const missing = musicId != null && !tracks.some((t) => t.id === musicId);
  const track = tracks.find((t) => t.id === musicId) ?? null;

  function playDemo(level: SfxLevel) {
    if (level === "off") return;
    demo.current?.pause();
    const el = new Audio("/sfx/whoosh.wav");
    el.volume = DEMO_GAIN[level];
    demo.current = el;
    void el.play().catch(() => undefined);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-white">Audio de estudio</span>
        <SegmentedControl
          label="Audio de estudio"
          size="sm"
          value={studio}
          onValueChange={(v) => canEdit && onStudio(v)}
          options={STUDIO_LEVELS.map((k) => ({ value: k, label: STUDIO_LEVEL_LABELS[k].label }))}
        />
        <p className="text-xs text-muted">{STUDIO_LEVEL_LABELS[studio].description}</p>
        {showStudioPreview && <StudioPreview key={studio} preview={audioPreview} level={studio} />}
      </div>

      <div className="flex flex-col gap-2">
        <span className="flex items-center justify-between gap-2 text-sm font-semibold text-white">
          Efectos de sonido
          {sfx !== "off" && (
            <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-accent-hi" onClick={() => playDemo(sfx)}>
              <Volume2 className="h-3.5 w-3.5" aria-hidden /> Escuchar
            </button>
          )}
        </span>
        <SegmentedControl
          label="Efectos de sonido"
          size="sm"
          value={sfx}
          onValueChange={(v) => {
            if (!canEdit) return;
            onSfx(v);
            playDemo(v);
          }}
          options={SFX_LEVELS.map((k) => ({ value: k, label: SFX_LEVEL_LABELS[k].label }))}
        />
        <p className="text-xs text-muted">{SFX_LEVEL_LABELS[sfx].description}</p>
        {sfxDb != null && onSfxDb && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sfx-volume" className="flex items-center justify-between text-xs text-muted">
              Volumen de los efectos <span className="font-medium text-text">{sfxVolumeLabel(sfxDb)}</span>
            </label>
            <input
              id="sfx-volume"
              type="range"
              className="range"
              min={SFX_VOLUME.min}
              max={SFX_VOLUME.max}
              step={1}
              value={sfxDb}
              disabled={!canEdit}
              onChange={(e) => onSfxDb(Number(e.target.value))}
              style={{ ["--pct" as string]: `${((sfxDb - SFX_VOLUME.min) / (SFX_VOLUME.max - SFX_VOLUME.min)) * 100}%` }}
              aria-valuetext={`${sfxVolumeLabel(sfxDb)}, ${sfxDb > 0 ? "+" : ""}${sfxDb} dB`}
            />
            <p className="text-xs text-muted">Todos los sonidos del video, también los de las animaciones. Siempre quedan debajo de tu voz y bajan un poco mientras hablas.</p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="music-track" className="text-sm font-semibold text-white">
          Música de fondo
        </label>
        {tracks.length === 0 && !musicId ? (
          <p className="flex items-start gap-2 rounded-xl bg-white/[0.04] px-3 py-2.5 text-xs text-muted">
            <Music className="mt-0.5 h-3.5 w-3.5 flex-none text-accent-hi" aria-hidden />
            <span>
              Sube tu música en{" "}
              <Link href="/editor/biblioteca#musica" className="font-medium text-accent-hi underline-offset-2 hover:underline">
                Biblioteca
              </Link>{" "}
              y elígela aquí. Va debajo de tu voz y baja sola cuando hablas.
            </span>
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Select
                id="music-track"
                className="min-w-0 flex-1 !h-10 !text-sm"
                value={missing ? "" : (musicId ?? "")}
                disabled={!canEdit}
                onChange={(e) => onMusic({ trackId: e.target.value || null, db: musicDb })}
              >
                <option value="">Sin música</option>
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                    {t.duration ? ` · ${formatDuration(t.duration)}` : ""}
                  </option>
                ))}
              </Select>
              {track && (
                <button
                  type="button"
                  onClick={() => player.toggle(track.id, track.url)}
                  disabled={!track.url}
                  className={cn("grid h-10 w-10 flex-none place-items-center rounded-xl border transition", player.playing === track.id ? "border-accent bg-accent text-paper" : "border-white/15 text-accent-hi hover:border-accent/60")}
                  aria-label={player.playing === track.id ? "Pausar la música" : "Escuchar la música"}
                >
                  {player.playing === track.id ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="ml-0.5 h-4 w-4" aria-hidden />}
                </button>
              )}
            </div>
            {missing && <p className="text-xs text-warning">La pista que habías elegido ya no está en tu biblioteca: el video sale sin música.</p>}
            {track && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="music-volume" className="flex items-center justify-between text-xs text-muted">
                  Volumen <span className="font-medium text-text">{musicLabel(musicDb)}</span>
                </label>
                <input
                  id="music-volume"
                  type="range"
                  className="range"
                  min={MUSIC_DB.min}
                  max={MUSIC_DB.max}
                  step={1}
                  value={musicDb}
                  disabled={!canEdit}
                  onChange={(e) => onMusic({ trackId: musicId, db: Number(e.target.value) })}
                  style={{ ["--pct" as string]: `${((musicDb - MUSIC_DB.min) / (MUSIC_DB.max - MUSIC_DB.min)) * 100}%` }}
                  aria-valuetext={`${musicLabel(musicDb)}, ${Math.abs(musicDb)} dB por debajo de tu voz`}
                />
                <p className="text-xs text-muted">Siempre queda por debajo de tu voz y baja sola cuando hablas.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function sfxVolumeLabel(db: number): string {
  if (db <= -12) return "Muy bajo";
  if (db <= -5) return "Bajo";
  if (db < 3) return "Normal";
  return "Alto";
}
