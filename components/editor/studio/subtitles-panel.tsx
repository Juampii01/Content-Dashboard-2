"use client";

import { useEffect, useRef, useState } from "react";
import { Captions, ChevronDown, Eye, Loader2, SpellCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isCaptionStyle } from "@/lib/video/caption-styles";
import { USER_CAPTION_HIDE } from "@/lib/video/captions";
import { CAPTION_PICKER_ORDER, CAPTION_PRESETS } from "@/lib/video/captions";
import { formatNumber } from "@/lib/format";
import { CaptionPicker } from "../caption-picker";
import type { StudioApi } from "./types";

/** Tamaños de los subtítulos (escala sobre el diseño del estilo). */
const SIZES = [
  { label: "Chico", scale: 0.7 },
  { label: "Mediano", scale: 0.85 },
  { label: "Grande", scale: 1 },
] as const;

const stamp = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/**
 * Pestaña «Subtítulos» del Estudio: el estilo (con su vista animada) y los subtítulos tal como salen en el video, en
 * bloques con su minuto. Toca un bloque para ir a ese momento; toca una palabra para corregirla o quítala con ×.
 * Nada de esto corta el video.
 */
export function SubtitlesPanel({ api, proofreading, onProofread }: { api: StudioApi; proofreading: boolean; onProofread: () => void }) {
  const { props, state } = api;
  const canEdit = props.canEdit;
  const on = state.preset !== "ninguno";
  const fallback = props.captionDefault && props.captionDefault !== "ninguno" ? props.captionDefault : "caja";
  const captionStyle = props.style?.captions ?? null;
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const activeIndex = api.captions.findIndex((b) => api.time >= b.start && api.time < b.end);
  const [showText, setShowText] = useState(false);
  const scale = state.captionPlace.transform?.scale ?? 1;
  const directorHides = state.captionHide.filter((h) => h.why !== USER_CAPTION_HIDE).length;
  const composHides = state.compositions.filter((c) => c.captions === "hide").length;

  function setScale(next: number) {
    api.update((st) => {
      const t = st.captionPlace.transform ?? { x: 0, y: 0, scale: 1 };
      const nt = { ...t, scale: next };
      return { ...st, captionPlace: { ...st.captionPlace, transform: nt.x || nt.y || nt.scale !== 1 ? nt : undefined } };
    });
  }

  // La lista sigue al video: el bloque que suena queda a la vista (solo se mueve la lista, no la página).
  useEffect(() => {
    const root = list.current?.closest("[role=tabpanel]");
    const el = list.current?.querySelector<HTMLElement>(`[data-block="${activeIndex}"]`);
    if (!root || !el) return;
    const box = root.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < box.top + 8) root.scrollTop += r.top - box.top - 8;
    else if (r.bottom > box.bottom - 8) root.scrollTop += r.bottom - box.bottom + 8;
  }, [activeIndex]);

  function saveEdit() {
    if (!editing) return;
    const original = props.words[editing.id]?.text ?? "";
    const text = editing.text.trim().slice(0, 60);
    api.update((st) => {
      const next = { ...st.corrections };
      if (text && text !== original) next[String(editing.id)] = text;
      else delete next[String(editing.id)];
      return { ...st, corrections: next };
    });
    setEditing(null);
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      <section className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-card px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-xl bg-white/5 text-white">
            <Captions className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Subtítulos</p>
            <p className="text-xs text-muted">{on ? `${CAPTION_PRESETS[state.preset].label} · ${formatNumber(api.captions.length)} bloques` : "Apagados: el video sale sin subtítulos."}</p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Subtítulos en el video"
          disabled={!canEdit}
          onClick={() => api.update((st) => ({ ...st, preset: st.preset === "ninguno" ? fallback : "ninguno" }))}
          className={cn("relative h-6 w-11 flex-none rounded-full transition disabled:opacity-50", on ? "bg-white" : "bg-white/15")}
        >
          <span className={cn("absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-paper shadow transition-transform", on && "translate-x-5")} />
        </button>
      </section>

      <section aria-labelledby="subs-style" className="flex flex-col gap-2.5">
        <h3 id="subs-style" className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">
          Estilo
        </h3>
        <CaptionPicker
          value={state.preset}
          onChange={(preset) => canEdit && api.update((st) => ({ ...st, preset }))}
          options={CAPTION_PICKER_ORDER.filter((k) => k !== "ninguno" && (k !== "estilo" || Boolean(captionStyle)))}
          accent={props.accent}
          brandFont={props.graphicLook.font}
          emoji={state.emoji}
          captionStyle={captionStyle}
          disabled={!canEdit}
          className="![grid-template-columns:repeat(auto-fill,minmax(112px,1fr))] !gap-1.5 [&_button]:!p-1 [&_button]:text-[11px]"
        />
        {on && isCaptionStyle(state.preset) && (
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5">
            <span className="flex flex-col">
              <span className="text-sm text-text">Emojis en las palabras clave</span>
              <span className="text-xs text-muted">Uno por frase, solo donde encaja.</span>
            </span>
            <input type="checkbox" className="h-4 w-4 flex-none accent-[var(--color-accent)]" checked={state.emoji} disabled={!canEdit} onChange={(e) => api.update((st) => ({ ...st, emoji: e.target.checked }))} />
          </label>
        )}
      </section>

      {on && (
        <section aria-labelledby="subs-size" className="flex flex-col gap-2">
          <h3 id="subs-size" className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">
            Tamaño
          </h3>
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-labelledby="subs-size">
            {SIZES.map((o) => {
              const active = Math.abs(scale - o.scale) < 0.03;
              return (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={!canEdit}
                  onClick={() => setScale(o.scale)}
                  className={cn("rounded-xl border px-2 py-1.5 text-xs font-semibold transition disabled:opacity-50", active ? "border-white bg-white text-paper" : "border-white/10 text-text hover:border-white/30")}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          <p className="px-1 text-xs text-muted">Para moverlos, arrástralos sobre el video.</p>
        </section>
      )}

      {on && (directorHides > 0 || composHides > 0) && (
        <section aria-labelledby="subs-hidden" className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-card p-3">
          <h3 id="subs-hidden" className="text-sm font-semibold text-white">
            Partes sin subtítulos
          </h3>
          <p className="text-xs text-muted">Las rayas de la pista Subtítulos son los tramos donde no salen. Puedes mostrarlos ahí también.</p>
          <div className="flex flex-col gap-1.5">
            {directorHides > 0 && (
              <div className="flex items-center justify-between gap-2 text-xs text-text">
                <span>
                  {formatNumber(directorHides)} {directorHides === 1 ? "tramo que ocultó la IA" : "tramos que ocultó la IA"}
                </span>
                {canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => api.update((st) => ({ ...st, captionHide: st.captionHide.filter((h) => h.why === USER_CAPTION_HIDE) }))}>
                    Mostrar
                  </Button>
                )}
              </div>
            )}
            {composHides > 0 && (
              <div className="flex items-center justify-between gap-2 text-xs text-text">
                <span>
                  {formatNumber(composHides)} {composHides === 1 ? "animación los tapa" : "animaciones los tapan"}
                  <span className="block text-muted">Si la animación tiene texto, pueden pisarse.</span>
                </span>
                {canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => api.update((st) => ({ ...st, compositions: st.compositions.map((c) => (c.captions === "hide" ? { ...c, captions: "show" as const } : c)) }))}>
                    Mostrar
                  </Button>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {on && (
        <button
          type="button"
          onClick={() => setShowText((v) => !v)}
          aria-expanded={showText}
          className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 text-left text-sm text-text transition hover:border-white/30"
        >
          <span>
            Corregir palabras
            <span className="block text-xs text-muted">Arreglar una palabra o sacarla de los subtítulos sin tocar el audio.</span>
          </span>
          <ChevronDown className={cn("h-4 w-4 flex-none text-muted transition-transform", showText && "rotate-180")} aria-hidden />
        </button>
      )}

      {on && showText && (
        <section aria-labelledby="subs-text" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <h3 id="subs-text" className="text-xs font-semibold tracking-wide text-muted uppercase">
              Texto
            </h3>
            <div className="flex flex-wrap gap-1">
              {api.subsHidden.size > 0 && canEdit && (
                <Button size="sm" variant="subtle" className="!px-2" icon={<Eye className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.setSubsHidden([...api.subsHidden], false)}>
                  Mostrar {formatNumber(api.subsHidden.size)} ocultas
                </Button>
              )}
              {canEdit && (
                <Button size="sm" variant="subtle" className="!px-2" onClick={onProofread} disabled={proofreading} icon={proofreading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <SpellCheck className="h-3.5 w-3.5" aria-hidden />}>
                  {proofreading ? "Revisando…" : "Ortografía con IA"}
                </Button>
              )}
            </div>
          </div>
          <p className="px-1 text-xs text-muted">Toca un bloque para verlo en el video. Toca una palabra para corregirla; con × la sacas de los subtítulos (el audio queda igual).</p>
          <ol ref={list} className="flex flex-col gap-1.5">
            {api.captions.map((b, i) => {
              const active = i === activeIndex;
              return (
                <li
                  key={`${b.start}-${b.words[0]?.id ?? i}`}
                  data-block={i}
                  className={cn("group flex gap-2.5 rounded-xl border px-2.5 py-2 transition-colors", active ? "border-accent/40 bg-accent/[0.06]" : "border-white/10 bg-card hover:border-white/20")}
                >
                  <button type="button" onClick={() => api.actions.seek(b.start)} className="mt-0.5 h-fit flex-none rounded-md px-1 font-mono text-[11px] leading-5 text-placeholder tabular-nums transition hover:bg-white/[0.06] hover:text-text" aria-label={`Ir al ${stamp(b.start)}`}>
                    {stamp(b.start)}
                  </button>
                  <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1 text-[14px] leading-6">
                    {b.words.map((w) =>
                      editing?.id === w.id ? (
                        <input
                          key={w.id}
                          autoFocus
                          aria-label="Corregir la palabra"
                          value={editing.text}
                          maxLength={60}
                          onChange={(e) => setEditing({ id: w.id, text: e.target.value })}
                          onBlur={saveEdit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEdit();
                            else if (e.key === "Escape") setEditing(null);
                          }}
                          className="w-28 rounded-md border border-accent bg-card px-1.5 text-[14px] leading-6 text-white outline-none"
                        />
                      ) : (
                        <span key={w.id} className="inline-flex items-center rounded-md">
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() => {
                              api.actions.seek(w.start);
                              setEditing({ id: w.id, text: w.text });
                            }}
                            title={props.words[w.id] && props.words[w.id]!.text !== w.text ? `Transcrito como «${props.words[w.id]!.text}»` : "Corregir"}
                            className={cn("rounded-md px-0.5 transition hover:bg-white/[0.08]", w.emphasis ? "font-semibold text-white" : "text-text", props.words[w.id] && props.words[w.id]!.text !== w.text && "underline decoration-accent-hi decoration-dotted underline-offset-4")}
                          >
                            {w.text}
                          </button>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => api.actions.setSubsHidden([w.id], true)}
                              className="hidden h-4 w-4 place-items-center rounded text-placeholder hover:bg-danger/10 hover:text-danger group-hover:grid"
                              aria-label={`Sacar «${w.text}» de los subtítulos`}
                              title="Sacar de los subtítulos"
                            >
                              <X className="h-3 w-3" aria-hidden />
                            </button>
                          )}
                        </span>
                      ),
                    )}
                  </p>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
