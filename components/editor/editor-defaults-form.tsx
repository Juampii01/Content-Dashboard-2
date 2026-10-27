"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Activity, Clapperboard, Ban, Feather, Gauge, Monitor, Save, Smartphone, Wand2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { CAPTION_PICKER_ORDER, CAPTION_PRESETS } from "@/lib/video/captions";
import { isCaptionStyle } from "@/lib/video/caption-styles";
import { DEFAULT_CAPTION_OPTIONS, summarizeDefaults, type DefaultCaptionKey, type EditorDefaults } from "@/lib/video/defaults";
import type { CaptionPresetKey } from "@/lib/video/types";
import { AudioPanel } from "./audio-panel";
import { CaptionPicker } from "./caption-picker";
import { saveEditorDefaultsAction } from "./defaults-actions";
import type { TrackItem } from "./music-manager";
import { SegmentedControl } from "@/components/ui/tabs";
import { FX_CATEGORIES, FX_CATEGORY_LABELS, FX_FREQUENCIES, FX_FREQUENCY_LABELS, FX_GALLERY_ORDER, FX_INFO, fxByCategory, type FxFrequency } from "@/lib/video/fx/catalog";
import { DENSITY_AUTO_LABEL, DENSITY_LABELS, type DensitySetting } from "@/lib/video/rhythm";

const DENSITY_CHOICES: { value: DensitySetting; icon: typeof Gauge; label: string; hint: string }[] = [
  { value: "auto", icon: Gauge, label: DENSITY_AUTO_LABEL.label, hint: DENSITY_AUTO_LABEL.description },
  { value: "sobria", icon: Feather, label: DENSITY_LABELS.sobria.label, hint: DENSITY_LABELS.sobria.description },
  { value: "normal", icon: Activity, label: DENSITY_LABELS.normal.label, hint: DENSITY_LABELS.normal.description },
  { value: "reels", icon: Zap, label: DENSITY_LABELS.reels.label, hint: DENSITY_LABELS.reels.description },
];

const CAPTION_OPTIONS = CAPTION_PICKER_ORDER.filter((k): k is DefaultCaptionKey => (DEFAULT_CAPTION_OPTIONS as readonly string[]).includes(k));

/**
 * Valores por defecto del Editor de video (en Mi marca): formato, subtítulos, b-roll, audio de estudio, efectos y
 * música. Los usa "Hazlo por mí" y cada proyecto nuevo arranca con ellos; en la revisión se cambian por video.
 */
export function EditorDefaultsForm({
  initial,
  tracks,
  accent,
  brandFont,
  canEdit,
}: {
  initial: EditorDefaults;
  tracks: TrackItem[];
  accent: string;
  brandFont: "montserrat" | "inter";
  canEdit: boolean;
}) {
  const [d, setD] = useState<EditorDefaults>(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  const set = (patch: Partial<EditorDefaults>) => setD((cur) => ({ ...cur, ...patch }));
  const track = tracks.find((t) => t.id === d.music.trackId) ?? null;

  function save() {
    start(async () => {
      const result = await saveEditorDefaultsAction(d);
      if (!result.ok) return void toast.error(result.error);
      setSaved(d);
      toast.success("Listo: tus próximos videos salen con estos valores.");
    });
  }

  return (
    <section id="editor" className="section-shell scroll-mt-6" aria-labelledby="editor-defaults-title">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <p className="eyebrow mb-1.5">Editor de video</p>
          <h2 id="editor-defaults-title" className="text-lg font-semibold">
            Cómo salen tus videos
          </h2>
          <p className="mt-1 text-sm text-muted">
            Los valores con que arranca cada video nuevo y los que usa «Hazlo por mí» para exportar sin pasar por la revisión. En cada video puedes cambiarlos.
          </p>
        </div>
        {canEdit && (
          <Button onClick={save} disabled={!dirty || pending} icon={<Save className="h-4 w-4" aria-hidden />}>
            {pending ? "Guardando…" : dirty ? "Guardar" : "Guardado"}
          </Button>
        )}
      </header>

      <div className="flex flex-col gap-7">
        <div className="grid gap-5 lg:grid-cols-2">
          <fieldset className="flex flex-col gap-2" disabled={!canEdit}>
            <legend className="mb-2 text-sm font-semibold text-white">Formato</legend>
            <div role="radiogroup" aria-label="Formato" className="grid gap-3 sm:grid-cols-2">
              {[
                { value: "9:16" as const, label: "Vertical 9:16", hint: "Reels, TikTok y Shorts", icon: Smartphone },
                { value: "16:9" as const, label: "Horizontal 16:9", hint: "YouTube", icon: Monitor },
              ].map((f) => (
                <Choice key={f.value} checked={d.format === f.value} onClick={() => set({ format: f.value })} icon={<f.icon className="h-5 w-5" aria-hidden />} label={f.label} hint={f.hint} />
              ))}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-2" disabled={!canEdit}>
            <legend className="mb-2 text-sm font-semibold text-white">B-roll</legend>
            <div role="radiogroup" aria-label="B-roll" className="grid gap-3 sm:grid-cols-2">
              <Choice checked={d.broll === "auto"} onClick={() => set({ broll: "auto" })} icon={<Clapperboard className="h-5 w-5" aria-hidden />} label="Con b-roll" hint="Gráficos con tu marca y tomas de apoyo" />
              <Choice checked={d.broll === "off"} onClick={() => set({ broll: "off" })} icon={<Ban className="h-5 w-5" aria-hidden />} label="Sin b-roll" hint="Solo tú en cámara" />
            </div>
          </fieldset>
        </div>

        <fieldset className="flex flex-col gap-2" disabled={!canEdit}>
          <legend className="text-sm font-semibold text-white">Ritmo de la edición</legend>
          <p className="-mt-0.5 mb-1 text-xs text-muted">Cuántas cosas pasan en pantalla: zooms, gráficos, b-roll y efectos, siempre en la palabra que dices.</p>
          <div role="radiogroup" aria-label="Ritmo de la edición" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {DENSITY_CHOICES.map((c) => (
              <Choice key={c.value} checked={d.density === c.value} onClick={() => set({ density: c.value })} icon={<c.icon className="h-5 w-5" aria-hidden />} label={c.label} hint={c.hint} />
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">Subtítulos</h3>
              <p className="mt-0.5 text-xs text-muted">
                <span className="font-semibold text-text">{CAPTION_PRESETS[d.captions].label}:</span> {CAPTION_PRESETS[d.captions].description}
              </p>
            </div>
            {isCaptionStyle(d.captions) && (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text">
                <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={d.emoji} disabled={!canEdit} onChange={(e) => set({ emoji: e.target.checked })} />
                Emojis en las palabras clave
              </label>
            )}
          </div>
          <CaptionPicker
            value={d.captions}
            onChange={(k: CaptionPresetKey) => set({ captions: k as DefaultCaptionKey })}
            options={CAPTION_OPTIONS}
            accent={accent}
            brandFont={brandFont}
            emoji={d.emoji && isCaptionStyle(d.captions)}
            disabled={!canEdit}
            className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
          />
        </div>

        <div className="max-w-xl">
          <h3 className="mb-3 text-sm font-semibold text-white">Sonido</h3>
          <AudioPanel
            studio={d.studio}
            onStudio={(studio) => set({ studio })}
            audioPreview={null}
            showStudioPreview={false}
            sfx={d.sfx}
            onSfx={(sfx) => set({ sfx })}
            musicId={d.music.trackId}
            musicDb={d.music.db}
            onMusic={(music) => set({ music })}
            tracks={tracks}
            canEdit={canEdit}
          />
          {!track && tracks.length > 0 && d.music.trackId == null && (
            <p className="mt-2 text-xs text-muted">
              Si eliges una pista, «Hazlo por mí» la pone debajo de tu voz. Súbelas en{" "}
              <Link href="/editor/biblioteca#musica" className="font-medium text-accent-hi hover:underline">
                Biblioteca → Música
              </Link>
              .
            </p>
          )}
        </div>

        <fieldset className="flex flex-col gap-3" disabled={!canEdit}>
          <legend className="text-sm font-semibold text-white">Efectos</legend>
          <p className="-mt-1 text-xs text-muted">Cuáles puede elegir el director para tus videos y con qué frecuencia. En el Estudio puedes agregar cualquiera de los {FX_GALLERY_ORDER.length}.</p>
          <div className="max-w-xl">
            <SegmentedControl
              label="Frecuencia de los efectos"
              value={d.effects.frequency}
              onValueChange={(v) => set({ effects: { ...d.effects, frequency: v as FxFrequency } })}
              options={FX_FREQUENCIES.map((f) => ({ value: f, label: FX_FREQUENCY_LABELS[f].label }))}
            />
            <p className="mt-1.5 text-xs text-muted" aria-live="polite">
              {FX_FREQUENCY_LABELS[d.effects.frequency].description}
            </p>
          </div>
          {d.effects.frequency !== "ninguno" && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted">
                  {d.effects.allowed.length} de {FX_GALLERY_ORDER.length} permitidos ·
                </span>
                <button type="button" className="font-medium text-accent-hi hover:underline" onClick={() => set({ effects: { ...d.effects, allowed: [...FX_GALLERY_ORDER] } })}>
                  Todos
                </button>
                <button type="button" className="font-medium text-accent-hi hover:underline" onClick={() => set({ effects: { ...d.effects, allowed: [] } })}>
                  Ninguno
                </button>
              </div>
              <div className="flex flex-col gap-2" role="group" aria-label="Efectos que puede elegir el director">
                {FX_CATEGORIES.map((c) => {
                  const kinds = fxByCategory(c);
                  const count = kinds.filter((k) => d.effects.allowed.includes(k)).length;
                  const toggleAll = (on: boolean) => set({ effects: { ...d.effects, allowed: on ? [...new Set([...d.effects.allowed, ...kinds])] : d.effects.allowed.filter((x) => !kinds.includes(x)) } });
                  return (
                    <details key={c} className="group rounded-xl border border-white/10 open:bg-white/[0.02]">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-white">{FX_CATEGORY_LABELS[c].label}</span>
                          <span className="block text-xs text-muted">{FX_CATEGORY_LABELS[c].description}</span>
                        </span>
                        <span className="flex-none font-mono text-xs text-muted">
                          {count}/{kinds.length}
                        </span>
                      </summary>
                      <div className="flex flex-col gap-2 px-3 pb-3">
                        <div className="flex gap-3 text-xs">
                          <button type="button" className="font-medium text-accent-hi hover:underline" onClick={() => toggleAll(true)}>
                            Todos
                          </button>
                          <button type="button" className="font-medium text-accent-hi hover:underline" onClick={() => toggleAll(false)}>
                            Ninguno
                          </button>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {kinds.map((k) => {
                            const on = d.effects.allowed.includes(k);
                            return (
                              <label key={k} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition", on ? "border-accent/60 bg-accent/10" : "border-white/10 hover:border-white/25")}>
                                <input
                                  type="checkbox"
                                  className="mt-0.5 h-4 w-4 flex-none accent-[var(--color-accent)]"
                                  checked={on}
                                  onChange={(e) => set({ effects: { ...d.effects, allowed: e.target.checked ? [...d.effects.allowed, k] : d.effects.allowed.filter((x) => x !== k) } })}
                                />
                                <span className="min-w-0">
                                  <span className="block text-sm font-semibold text-white">{FX_INFO[k].label}</span>
                                  <span className="line-clamp-2 text-xs text-muted">{FX_INFO[k].description}</span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </details>
                  );
                })}
              </div>
            </>
          )}
        </fieldset>

        <p className="flex items-start gap-2 rounded-xl border border-line bg-white/[0.02] px-4 py-3 text-sm text-text" aria-live="polite">
          <Wand2 className="mt-0.5 h-4 w-4 flex-none text-accent-hi" aria-hidden />
          <span>{summarizeDefaults(d, track?.title ?? null)}</span>
        </p>
      </div>
    </section>
  );
}

function Choice({ checked, onClick, icon, label, hint }: { checked: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className={cn("flex items-start gap-3 rounded-2xl border p-3.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60", checked ? "border-accent bg-accent/15" : "border-white/10 hover:border-white/25")}
    >
      <span className="tile-icon h-10 w-10 flex-none">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-white">{label}</span>
        <span className="text-xs text-muted">{hint}</span>
      </span>
    </button>
  );
}
