"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Dices, ExternalLink, Library, Loader2, Music, Pause, Play, Plus, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { formatDuration } from "@/lib/format";
import { musicGenLabel, tracksOf, type LibraryTrack } from "@/lib/video/music-gen/catalog";
import { MUSIC_STYLE_INFO, MUSIC_STYLES, type MusicGenSpec, type MusicStyle } from "@/lib/video/music-gen/spec";
import type { ProviderTrack } from "@/lib/video/music-providers/types";
import { musicLabel, MUSIC_DB } from "@/lib/video/sfx";
import { cn } from "@/lib/utils";
import { Chip, SearchBox } from "../fx/fx-library";
import { importCatalogTrackAction, searchCatalogMusicAction } from "../music-catalog-actions";
import { useGeneratedMusic, usePreviewPlayer } from "../sound/use-sound";
import type { StudioApi } from "./types";

const PREVIEW_SECONDS = 20;

/**
 * Biblioteca → Música: la generada (licencia nuestra, 7 estilos × 20 pistas y "a medida"), las pistas del cliente y,
 * si conectó Jamendo, su catálogo con licencia CC BY. Escuchar una muestra arma 20 s en el navegador con el mismo
 * generador del render.
 */
export function LibraryMusic({ api }: { api: StudioApi }) {
  const { props, state } = api;
  const edit = props.canEdit;
  const [style, setStyle] = useState<MusicStyle>(state.musicGen?.style ?? "lofi");
  const [request, setRequest] = useState<{ id: string; spec: Pick<MusicGenSpec, "style" | "seed" | "bpm"> } | null>(null);
  const preview = usePreviewPlayer();
  const gen = useGeneratedMusic(request?.spec ?? null, PREVIEW_SECONDS);
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (request && gen.buffer && started.current !== request.id) {
      started.current = request.id;
      preview.playBuffer(request.id, gen.buffer);
    }
  }, [request, gen.buffer, preview]);
  const toggle = (id: string, spec: Pick<MusicGenSpec, "style" | "seed" | "bpm">) => {
    if (preview.playing === id || (request?.id === id && !gen.buffer)) {
      preview.stop();
      setRequest(null);
      started.current = null;
      return;
    }
    started.current = null;
    setRequest({ id, spec });
  };
  const choose = (spec: MusicGenSpec | null) => api.update((s) => ({ ...s, musicGen: spec, music: spec ? { ...s.music, trackId: null } : s.music }));
  const current = state.musicGen;
  const [customBpm, setCustomBpm] = useState(() => Math.round((MUSIC_STYLE_INFO[style].bpm[0] + MUSIC_STYLE_INFO[style].bpm[1]) / 2));
  // Semilla de la versión a medida (cambia con «Otra variación»).
  const customSeed = useRef(MUSIC_STYLES.indexOf(style) * 7919 + 4242);
  const uploaded = props.tracks ?? [];
  const selectedUpload = !current && state.music.trackId ? uploaded.find((t) => t.id === state.music.trackId) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col gap-2 p-3">
        <p className="eyebrow">Música del video</p>
        <p className="flex items-center gap-2 text-sm font-semibold text-white">
          <Music className="h-4 w-4 flex-none text-accent-hi" aria-hidden />
          <span className="min-w-0 truncate">{current ? musicGenLabel(current) : selectedUpload ? selectedUpload.title : "Sin música"}</span>
        </p>
        {(current || selectedUpload) && (
          <>
            <label htmlFor="lib-music-db" className="flex items-center justify-between text-xs text-muted">
              <span className="flex items-center gap-1.5">
                <Volume2 className="h-3.5 w-3.5" aria-hidden /> Volumen bajo tu voz
              </span>
              <span className="font-semibold text-text">{musicLabel(state.music.db)}</span>
            </label>
            <input
              id="lib-music-db"
              type="range"
              className="range"
              min={MUSIC_DB.min}
              max={MUSIC_DB.max}
              step={1}
              value={state.music.db}
              disabled={!edit}
              onChange={(e) => {
                const db = Number(e.target.value);
                api.update((s) => ({ ...s, music: { ...s.music, db } }), { coalesce: "music" });
              }}
              style={{ ["--pct" as string]: `${((state.music.db - MUSIC_DB.min) / (MUSIC_DB.max - MUSIC_DB.min)) * 100}%` }}
              aria-valuetext={musicLabel(state.music.db)}
            />
            {selectedUpload?.attribution && <p className="text-[11px] text-muted">Atribución (va en los créditos del video): {selectedUpload.attribution}</p>}
            {edit && (
              <button type="button" className="self-start text-xs font-semibold text-accent-hi hover:underline" onClick={() => api.update((s) => ({ ...s, musicGen: null, music: { ...s.music, trackId: null } }))}>
                Quitar la música
              </button>
            )}
          </>
        )}
      </div>

      <section aria-labelledby="gen-music" className="flex flex-col gap-2">
        <div>
          <h3 id="gen-music" className="text-sm font-semibold text-white">
            Música generada <span className="ml-1 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">Sin derechos de autor</span>
          </h3>
          <p className="text-xs text-muted">Compuesta para tus reels por el Estudio: es tuya, sin atribución ni reclamos. 140 pistas en 7 estilos.</p>
        </div>
        <div role="tablist" aria-label="Estilos de música" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
          {MUSIC_STYLES.map((s) => (
            <Chip key={s} active={style === s} onClick={() => setStyle(s)} label={MUSIC_STYLE_INFO[s].label} title={MUSIC_STYLE_INFO[s].description} />
          ))}
        </div>
        <p className="text-xs text-muted">{MUSIC_STYLE_INFO[style].description}</p>
        <ul className="flex max-h-72 flex-col overflow-y-auto rounded-xl border border-white/10 [scrollbar-width:thin]" aria-label={`Pistas ${MUSIC_STYLE_INFO[style].label}`}>
          {tracksOf(style).map((t) => (
            <TrackRow key={t.id} track={t} active={Boolean(current && current.style === t.style && current.seed === t.seed && current.bpm === t.bpm)} playing={preview.playing === t.id} loading={request?.id === t.id && !gen.buffer ? gen.progress : null} onToggle={() => toggle(t.id, t)} onChoose={edit ? () => choose({ style: t.style, seed: t.seed, bpm: t.bpm }) : undefined} />
          ))}
        </ul>
        <div className="flex flex-col gap-2 rounded-xl border border-white/10 p-3">
          <p className="text-xs font-semibold text-white">A medida: {MUSIC_STYLE_INFO[style].label}</p>
          <label htmlFor="lib-bpm" className="flex items-center justify-between text-xs text-muted">
            Tempo <span className="font-mono text-text">{customBpm} BPM</span>
          </label>
          <input
            id="lib-bpm"
            type="range"
            className="range"
            min={MUSIC_STYLE_INFO[style].bpm[0] - 10}
            max={MUSIC_STYLE_INFO[style].bpm[1] + 10}
            step={1}
            value={customBpm}
            onChange={(e) => setCustomBpm(Number(e.target.value))}
            style={{ ["--pct" as string]: `${((customBpm - MUSIC_STYLE_INFO[style].bpm[0] + 10) / (MUSIC_STYLE_INFO[style].bpm[1] - MUSIC_STYLE_INFO[style].bpm[0] + 20)) * 100}%` }}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="subtle" icon={preview.playing === "custom" ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />} onClick={() => toggle("custom", { style, seed: customSeed.current, bpm: customBpm })}>
              {preview.playing === "custom" ? "Parar" : request?.id === "custom" && !gen.buffer ? "Componiendo…" : "Escuchar"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Dices className="h-3.5 w-3.5" aria-hidden />}
              onClick={() => {
                customSeed.current = (customSeed.current * 48271 + 11) % 2147483647;
                toggle(`custom-${customSeed.current}`, { style, seed: customSeed.current, bpm: customBpm });
              }}
            >
              Otra variación
            </Button>
            {edit && (
              <Button size="sm" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={() => choose({ style, seed: customSeed.current, bpm: customBpm })}>
                Usar esta
              </Button>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="own-music" className="flex flex-col gap-2">
        <h3 id="own-music" className="text-sm font-semibold text-white">
          Tus pistas
        </h3>
        {uploaded.length === 0 ? (
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">Todavía no subiste música propia. La de tu biblioteca y la que agregues de Jamendo aparece aquí.</p>
        ) : (
          <div role="radiogroup" aria-label="Tus pistas" className="flex flex-col gap-1.5">
            {uploaded.map((t) => {
              const active = !current && state.music.trackId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={!edit}
                  onClick={() => api.update((s) => ({ ...s, musicGen: null, music: { ...s.music, trackId: t.id } }))}
                  className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition", active ? "border-accent bg-accent/12 text-white" : "border-white/10 text-text hover:border-white/25")}
                >
                  <Music className="h-3.5 w-3.5 flex-none text-accent-hi" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  {t.duration ? <span className="font-mono text-[11px] text-muted">{formatDuration(t.duration)}</span> : null}
                </button>
              );
            })}
          </div>
        )}
        <Link href="/editor/biblioteca" className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-hi hover:underline">
          <Library className="h-3.5 w-3.5" aria-hidden /> Subir o administrar tu música
        </Link>
      </section>

      <CatalogSection api={api} />
    </div>
  );
}

function TrackRow({ track, active, playing, loading, onToggle, onChoose }: { track: LibraryTrack; active: boolean; playing: boolean; loading: number | null; onToggle: () => void; onChoose?: () => void }) {
  return (
    <li className={cn("flex items-center gap-2 border-b border-white/[0.06] px-2 py-1.5 last:border-b-0", active && "bg-accent/12")}>
      <button type="button" onClick={onToggle} className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-white/[0.06] text-white transition hover:bg-white/[0.12]" aria-label={playing ? `Parar «${track.title}»` : `Escuchar «${track.title}»`}>
        {loading != null ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : playing ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
      </button>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-white">{track.title}</span>
        <span className="block font-mono text-[10px] text-muted">{track.bpm} BPM</span>
      </span>
      {onChoose &&
        (active ? (
          <span className="rounded-md bg-accent/25 px-2 py-1 text-[11px] font-semibold text-accent-glow">En uso</span>
        ) : (
          <button type="button" onClick={onChoose} className="rounded-md border border-white/15 px-2 py-1 text-[11px] font-semibold text-white transition hover:border-accent hover:bg-accent/15">
            Usar
          </button>
        ))}
    </li>
  );
}

function CatalogSection({ api }: { api: StudioApi }) {
  const { props } = api;
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ProviderTrack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [adding, setAdding] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const configured = Boolean(props.musicCatalog?.jamendo);
  const search = () =>
    startSearch(async () => {
      const res = await searchCatalogMusicAction(q);
      if (!res.ok) {
        setError(res.error);
        setResults(null);
      } else {
        setError(null);
        setResults(res.data);
      }
    });
  const listen = (t: ProviderTrack) => {
    audio.current?.pause();
    if (playing === t.id) {
      setPlaying(null);
      return;
    }
    const a = new Audio(t.previewUrl);
    a.volume = 0.7;
    a.onended = () => setPlaying(null);
    void a.play().catch(() => setPlaying(null));
    audio.current = a;
    setPlaying(t.id);
  };
  const add = async (t: ProviderTrack) => {
    setAdding(t.id);
    const res = await importCatalogTrackAction(t.id);
    setAdding(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    api.update((s) => ({ ...s, musicGen: null, music: { ...s.music, trackId: res.data.id } }));
    toast.success("Pista agregada a tu música.", { description: "La atribución va sola en los créditos del video." });
    router.refresh();
  };
  const sample = useMemo(() => ["lofi", "motivacional", "acústico", "electrónica", "épica"], []);
  return (
    <section aria-labelledby="catalog-music" className="flex flex-col gap-2">
      <div>
        <h3 id="catalog-music" className="text-sm font-semibold text-white">
          Catálogo de Jamendo
        </h3>
        <p className="text-xs text-muted">Música de artistas independientes con licencia CC BY: se puede usar en videos de tu marca nombrando al artista.</p>
      </div>
      {!configured ? (
        <Notice tone="info">
          Conecta tu client_id de Jamendo en{" "}
          <Link href="/ajustes#claves" className="font-semibold text-accent-hi hover:underline">
            Ajustes → Claves de servicios
          </Link>{" "}
          para buscar aquí. Es opcional: la música generada no lo necesita.
        </Notice>
      ) : (
        <>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <div className="min-w-0 flex-1">
              <SearchBox value={q} onChange={setQ} label="Buscar en Jamendo" placeholder="Ej.: lofi, motivacional, piano" />
            </div>
            <Button type="submit" size="sm" disabled={searching} icon={searching ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : undefined}>
              Buscar
            </Button>
          </form>
          {!results && !error && (
            <div className="flex flex-wrap gap-1.5">
              {sample.map((s) => (
                <Chip key={s} active={false} label={s} onClick={() => (setQ(s), startSearch(async () => {
                  const res = await searchCatalogMusicAction(s);
                  if (res.ok) {
                    setResults(res.data);
                    setError(null);
                  } else setError(res.error);
                }))} />
              ))}
            </div>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
          {results && results.length === 0 && <p className="text-xs text-muted">No encontramos pistas con licencia comercial para «{q}». Prueba con otra palabra.</p>}
          {results && results.length > 0 && (
            <ul className="flex max-h-72 flex-col overflow-y-auto rounded-xl border border-white/10 [scrollbar-width:thin]" aria-label="Resultados de Jamendo">
              {results.map((t) => (
                <li key={t.id} className="flex items-center gap-2 border-b border-white/[0.06] px-2 py-1.5 last:border-b-0">
                  <button type="button" onClick={() => listen(t)} className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-white/[0.06] text-white hover:bg-white/[0.12]" aria-label={playing === t.id ? `Parar «${t.title}»` : `Escuchar «${t.title}»`}>
                    {playing === t.id ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white">{t.title}</span>
                    <span className="block truncate text-[11px] text-muted">
                      {t.artist} · {t.license.label} · {formatDuration(t.duration)}
                    </span>
                  </span>
                  <a href={t.pageUrl} target="_blank" rel="noreferrer" className="grid h-7 w-7 flex-none place-items-center rounded-md text-muted hover:text-white" aria-label={`Ver «${t.title}» en Jamendo`}>
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                  {props.canEdit && (
                    <button type="button" disabled={adding != null} onClick={() => void add(t)} className="rounded-md border border-white/15 px-2 py-1 text-[11px] font-semibold text-white transition hover:border-accent hover:bg-accent/15 disabled:opacity-50">
                      {adding === t.id ? "Agregando…" : "Usar"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
