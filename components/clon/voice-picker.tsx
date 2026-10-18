"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Pause, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import { listVoicesAction, type VoiceOption } from "./actions";

type Source = "private" | "public";

// HeyGen devuelve el idioma en inglés ("Spanish"); se muestra en español.
const languageLabel: Record<string, string> = { Spanish: "Español", English: "Inglés", Portuguese: "Portugués", French: "Francés", Italian: "Italiano", German: "Alemán" };
type PageState = { items: VoiceOption[]; nextToken: string | null; error: string | null; loadingMore: boolean };

/** Lista de voces (las propias o las públicas de HeyGen en español) con preview de audio. */
export function VoicePicker({ selectedId, onSelect }: { selectedId: string | null; onSelect: (voice: VoiceOption) => void }) {
  const [source, setSource] = useState<Source>("private");
  const [pages, setPages] = useState<Partial<Record<Source, PageState>>>({});
  const [reloadKey, setReloadKey] = useState(0);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const current = pages[source];

  useEffect(() => {
    if (pages[source] && !pages[source]!.error) return;
    let cancelled = false;
    listVoicesAction({ type: source, language: source === "public" ? "Spanish" : undefined }).then((res) => {
      if (cancelled) return;
      setPages((prev) => ({
        ...prev,
        [source]: res.ok
          ? { items: res.data.items, nextToken: res.data.nextToken, error: null, loadingMore: false }
          : { items: [], nextToken: null, error: res.error, loadingMore: false },
      }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, reloadKey]);

  useEffect(() => () => audio.current?.pause(), []);

  const toggle = (voice: VoiceOption) => {
    if (!voice.previewAudio) return;
    if (playing === voice.id) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const el = new Audio(voice.previewAudio);
    el.onended = () => setPlaying(null);
    el.onerror = () => setPlaying(null);
    audio.current = el;
    setPlaying(voice.id);
    el.play().catch(() => setPlaying(null));
  };

  const loadMore = async () => {
    if (!current?.nextToken) return;
    setPages((prev) => ({ ...prev, [source]: { ...current, loadingMore: true } }));
    const res = await listVoicesAction({ type: source, language: source === "public" ? "Spanish" : undefined, token: current.nextToken });
    setPages((prev) => ({
      ...prev,
      [source]: res.ok
        ? { items: [...current.items, ...res.data.items], nextToken: res.data.nextToken, error: null, loadingMore: false }
        : { ...current, error: res.error, loadingMore: false },
    }));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="segmented self-start" role="radiogroup" aria-label="Qué voces mostrar">
        {(
          [
            ["private", "Mis voces"],
            ["public", "Voces de HeyGen en español"],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={source === value} className="segmented-item" onClick={() => setSource(value)}>
            {label}
          </button>
        ))}
      </div>

      {current?.error && (
        <Notice tone="danger">
          <p>{current.error}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
            onClick={() => {
              setPages((prev) => ({ ...prev, [source]: undefined }));
              setReloadKey((k) => k + 1);
            }}
          >
            Reintentar
          </Button>
        </Notice>
      )}

      {!current ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Cargando voces">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton h-14" />
          ))}
        </div>
      ) : current.items.length === 0 && !current.error ? (
        <p className="rounded-2xl border border-dashed border-white/15 p-5 text-center text-sm text-muted">
          {source === "private" ? "Tu cuenta de HeyGen no tiene voces propias todavía." : "HeyGen no devolvió voces públicas en español."}
        </p>
      ) : (
        <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1" role="radiogroup" aria-label="Voces">
          {current.items.map((voice) => {
            const selected = voice.id === selectedId;
            return (
              <li key={voice.id} className={cn("flex items-center gap-2 rounded-xl border p-2 transition", selected ? "border-accent-hi bg-accent/15" : "border-white/10 bg-white/[0.02]")}>
                <button
                  type="button"
                  onClick={() => toggle(voice)}
                  disabled={!voice.previewAudio}
                  aria-label={playing === voice.id ? `Detener muestra de ${voice.name}` : `Escuchar muestra de ${voice.name}`}
                  className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-white/[0.06] text-accent-hi transition hover:bg-white/10 disabled:opacity-40"
                >
                  {playing === voice.id ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                </button>
                <button type="button" role="radio" aria-checked={selected} onClick={() => onSelect(voice)} className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-2 py-1 text-left">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-white">{voice.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {[languageLabel[voice.language] ?? voice.language, voice.gender === "female" ? "Femenina" : voice.gender === "male" ? "Masculina" : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {selected && <Check className="h-4 w-4 flex-none text-accent-hi" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {current?.nextToken && (
        <Button variant="ghost" size="sm" className="self-center" onClick={loadMore} disabled={current.loadingMore} icon={current.loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : undefined}>
          {current.loadingMore ? "Cargando…" : "Ver más voces"}
        </Button>
      )}
    </div>
  );
}
