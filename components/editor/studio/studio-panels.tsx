"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Bot, Check, Clapperboard, Headphones, Library, Music, Sparkles, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { usePrefersReducedMotion } from "@/components/ui/hooks";
import { SegmentedControl } from "@/components/ui/tabs";
import { formatDuration, formatNumber } from "@/lib/format";
import { FX_GALLERY_ORDER, FX_INFO, type FxKind } from "@/lib/video/fx/catalog";
import { GRAPHIC_TEMPLATES, GRAPHIC_TEMPLATE_KEYS } from "@/lib/video/graphics";
import { cn } from "@/lib/utils";
import { DecisionsPanel } from "../director/decisions-panel";
import { EditRequestCard } from "../director/edit-request";
import { UnderstandingPanel } from "../director/understanding-panel";
import { VariantsPanel } from "../director/variants-panel";
import { Badges, FxSample, useInView, useLoop } from "../fx/fx-panel";
import { LIBRARY_MIME, type LibraryDrop, type StudioSelection } from "./studio-timeline";
import { USER_TAG, type StudioApi } from "./types";

type AiItem = { key: string; sel: StudioSelection; label: string; text: string; at: number | null };

/** Lo que puso la IA y todavía no aceptaste (b-roll, gráficos, efectos y zooms). */
export function aiItems(api: StudioApi): AiItem[] {
  const out: AiItem[] = [];
  const { state } = api;
  for (const b of state.broll) {
    if (b.id.startsWith("u")) continue;
    out.push({ key: `b${b.id}`, sel: { kind: "broll", id: b.id }, label: b.choice?.source === "graphic" ? "Gráfico" : "B-roll", text: api.textOf(b.from_word, b.to_word, 50), at: api.segments.find((s) => s.id === b.id)?.start ?? null });
  }
  for (const e of state.effects) {
    if (e.source === "user") continue;
    out.push({ key: `f${e.id}`, sel: { kind: "fx", id: e.id }, label: FX_INFO[e.kind].label, text: api.textOf(e.from_word, e.to_word, 50), at: api.fxSegs.find((s) => s.id === e.id)?.start ?? null });
  }
  if (!api.styleZooms)
    state.zoomMoments.forEach((z, i) => {
      if (z.why.startsWith(USER_TAG)) return;
      out.push({ key: `z${i}`, sel: { kind: "zoom", index: i }, label: "Zoom", text: api.textOf(z.from_word, z.to_word, 50), at: api.timeline.words.find((w) => w.id >= z.from_word && w.id <= z.to_word)?.start ?? null });
    });
  return out.sort((a, b) => (a.at ?? 1e9) - (b.at ?? 1e9));
}

/** Pestaña IA: lo que entendió el director, sus decisiones con su porqué, ganchos, "Edítalo así" y versiones. */
export function AiPanel({ api, dirty, onAcceptAll }: { api: StudioApi; dirty: boolean; onAcceptAll: () => void }) {
  const { props, state } = api;
  const { plan, words } = props;
  const items = useMemo(() => aiItems(api), [api]);
  const [all, setAll] = useState(false);
  return (
    <div className="flex flex-col gap-5 p-4">
      {props.notice}
      {plan.planned_by === "auto" && (
        <Notice tone="warning" title="Plan armado sin IA">
          {plan.warning || "La IA no respondió: se cortaron solo las tomas repetidas, arranques en falso y muletillas más claras. Revisa los cortes con más atención."}
        </Notice>
      )}
      {plan.planned_by === "ai" && plan.warning && <Notice tone="warning">{api.humanize(plan.warning)}</Notice>}
      {plan.summary && plan.planned_by === "ai" && (
        <div className="card flex gap-3 p-3">
          <Sparkles className="mt-0.5 h-4 w-4 flex-none text-accent-hi" aria-hidden />
          <p className="text-sm text-text/90">{api.humanize(plan.summary)}</p>
        </div>
      )}

      <section aria-labelledby="ai-items-title" className="flex flex-col gap-2">
        <div className="flex items-end justify-between gap-2">
          <div>
            <h2 id="ai-items-title" className="flex items-center gap-2 text-sm font-semibold text-white">
              <Bot className="h-4 w-4 text-accent-hi" aria-hidden /> Lo que puso la IA
            </h2>
            <p className="text-xs text-muted">{items.length ? "Llevan la marca IA en la línea de tiempo. Revísalos y acéptalos o quítalos uno por uno." : "Revisaste todo lo que puso la IA."}</p>
          </div>
          {props.canEdit && items.length > 1 && (
            <Button size="sm" variant="ghost" icon={<Check className="h-3.5 w-3.5" aria-hidden />} onClick={onAcceptAll}>
              Aceptar todo
            </Button>
          )}
        </div>
        {items.length > 0 && (
          <ul className="flex flex-col divide-y divide-white/[0.06] rounded-xl border border-white/10">
            {(all ? items : items.slice(0, 6)).map((it) => (
              <li key={it.key}>
                <button type="button" onClick={() => api.select(it.sel)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-white/[0.03]">
                  <span className="w-12 flex-none font-mono text-[11px] text-muted tabular-nums">{it.at != null ? formatDuration(it.at) : "—"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-white">{it.label}</span> <span className="text-muted">· “{it.text}”</span>
                  </span>
                </button>
              </li>
            ))}
            {items.length > 6 && (
              <li>
                <button type="button" className="w-full px-3 py-2 text-left text-xs font-semibold text-accent-hi hover:underline" onClick={() => setAll((a) => !a)}>
                  {all ? "Ver menos" : `Ver los ${formatNumber(items.length)}`}
                </button>
              </li>
            )}
          </ul>
        )}
      </section>

      <section aria-labelledby="hooks-title" className="flex flex-col gap-2">
        <div>
          <h2 id="hooks-title" className="text-sm font-semibold text-white">
            Gancho
          </h2>
          <p className="text-xs text-muted">Pasa al principio del video. Los primeros 3 segundos deciden si siguen mirando.</p>
        </div>
        <div role="radiogroup" aria-label="Gancho" className="flex flex-col gap-1.5">
          {plan.hook_candidates.map((h, i) => {
            const text = api.textOf(h.from_word, h.to_word, 140);
            const secs = (words[h.to_word]?.end ?? 0) - (words[h.from_word]?.start ?? 0);
            const active = state.selectedHook === i;
            return (
              <div key={`${h.from_word}-${h.to_word}`} className={cn("flex items-start gap-2 rounded-xl border p-2.5 transition", active ? "border-accent bg-accent/12" : "border-white/10 hover:border-white/25")}>
                <button type="button" role="radio" aria-checked={active} disabled={!props.canEdit} onClick={() => api.update((s) => ({ ...s, selectedHook: i }))} className="flex min-w-0 flex-1 flex-col gap-1 text-left">
                  <span className="flex items-center gap-2">
                    <span className="eyebrow">Gancho {i + 1}</span>
                    <span className="font-mono text-[11px] text-muted">{secs.toFixed(1).replace(".", ",")} s</span>
                  </span>
                  <span className="line-clamp-3 text-sm font-semibold text-white">“{text}”</span>
                  <span className="line-clamp-2 text-xs text-muted">{api.humanize(h.why)}</span>
                </button>
                <Button size="sm" variant="subtle" className="!h-8 !w-8 flex-none !px-0" icon={<Headphones className="h-3.5 w-3.5" aria-hidden />} aria-label={`Escuchar el gancho ${i + 1}`} title="Escuchar" onClick={() => api.actions.listenHook(i)} />
              </div>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={state.selectedHook == null}
            disabled={!props.canEdit}
            onClick={() => api.update((s) => ({ ...s, selectedHook: null }))}
            className={cn("flex flex-col gap-0.5 rounded-xl border p-2.5 text-left transition", state.selectedHook == null ? "border-accent bg-accent/12" : "border-white/10 hover:border-white/25")}
          >
            <span className="text-sm font-semibold text-white">Sin gancho</span>
            <span className="text-xs text-muted">El video empieza como lo grabaste.</span>
          </button>
          {plan.hook_candidates.length === 0 && <p className="text-xs text-muted">No encontramos frases de 3 a 8 segundos que funcionen solas como gancho.</p>}
        </div>
      </section>

      {props.canEdit && (
        <EditRequestCard
          projectId={props.projectId}
          canEdit={props.canEdit}
          estimate={props.director?.editEstimate ?? 0}
          spent={props.director?.cost.totalUsd ?? 0}
          cap={props.director?.budgetUsd ?? 5}
          edits={props.director?.state.edits ?? []}
          dirty={dirty}
        />
      )}

      {props.director && <VariantsPanel projectId={props.projectId} variants={props.director.state.variants} current={api.timeline.duration} canEdit={props.canEdit} dirty={dirty} />}

      <DecisionsPanel
        plan={plan}
        words={words}
        corrections={state.corrections}
        removed={api.removedSet}
        moves={state.moves}
        onMoves={(moves) => api.update((s) => ({ ...s, moves }))}
        onListen={api.actions.listenFrom}
        onRestore={(range) => api.actions.cut(Array.from({ length: range.to - range.from + 1 }, (_, k) => range.from + k), false)}
        canEdit={props.canEdit}
      />

      {props.director && (
        <UnderstandingPanel
          projectId={props.projectId}
          view={props.director}
          words={words}
          corrections={state.corrections}
          removed={api.removedSet}
          coveredBy={(from, to) => state.broll.some((b) => b.choice && b.from_word <= from && b.to_word >= to)}
          onListen={api.actions.listenFrom}
          canEdit={props.canEdit}
          sourceWidth={props.sourceWidth}
          sourceHeight={props.sourceHeight}
          defaultOpen={false}
        />
      )}
    </div>
  );
}

type LibTab = "efectos" | "graficos" | "broll" | "musica";

function dragProps(item: LibraryDrop, enabled: boolean) {
  if (!enabled) return {};
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(LIBRARY_MIME, JSON.stringify(item));
      e.dataTransfer.effectAllowed = "copy";
    },
  };
}

/**
 * Pestaña Biblioteca: los 17 efectos, las plantillas de gráfico, el b-roll y la música. Tocar agrega en el cabezal;
 * también se arrastran a la línea de tiempo.
 */
export function LibraryPanel({ api, onAdd }: { api: StudioApi; onAdd: (item: LibraryDrop) => void }) {
  const [tab, setTab] = useState<LibTab>("efectos");
  const reduced = usePrefersReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>();
  const clock = useLoop(tab === "efectos" && inView, reduced);
  const { props, state } = api;
  const edit = props.canEdit;
  return (
    <div className="flex flex-col gap-3 p-4">
      <SegmentedControl
        label="Qué agregar"
        size="sm"
        className="max-w-full self-start overflow-x-auto"
        value={tab}
        onValueChange={setTab}
        options={[
          { value: "efectos", label: "Efectos" },
          { value: "graficos", label: "Gráficos" },
          { value: "broll", label: "B-roll" },
          { value: "musica", label: "Música" },
        ]}
      />
      <p className="text-xs text-muted">{edit ? "Toca para agregarlo donde está el cabezal, o arrástralo a la línea de tiempo." : "Solo lectura: tu usuario no puede editar."}</p>

      {tab === "efectos" && (
        <div ref={ref} role="list" aria-label="Efectos" className="grid grid-cols-2 gap-2">
          {FX_GALLERY_ORDER.map((kind: FxKind) => {
            const info = FX_INFO[kind];
            return (
              <button
                key={kind}
                type="button"
                role="listitem"
                disabled={!edit}
                onClick={() => onAdd({ type: "fx", kind })}
                {...dragProps({ type: "fx", kind }, edit)}
                className="flex flex-col gap-1.5 rounded-xl border border-white/10 p-1.5 text-left transition hover:border-white/30 focus-visible:outline-2 focus-visible:outline-accent-hi disabled:cursor-default"
                aria-label={`Agregar «${info.label}» en el cabezal`}
                title={info.description}
              >
                <FxSample kind={kind} brand={api.fxBrand} clock={clock} reduced={reduced} />
                <span className="px-0.5 text-xs font-semibold text-white">{info.label}</span>
                <span className="px-0.5 pb-0.5">
                  <Badges kind={kind} />
                </span>
              </button>
            );
          })}
        </div>
      )}

      {tab === "graficos" && (
        <div className="flex flex-col gap-2">
          {edit && (
            <Button size="sm" icon={<WandSparkles className="h-3.5 w-3.5" aria-hidden />} onClick={() => onAdd({ type: "graphic" })} {...dragProps({ type: "graphic" }, edit)}>
              Pide un gráfico en el cabezal
            </Button>
          )}
          <ul className="flex flex-col gap-1.5" aria-label="Plantillas de gráfico">
            {GRAPHIC_TEMPLATE_KEYS.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  disabled={!edit}
                  onClick={() => onAdd({ type: "graphic", template: t })}
                  {...dragProps({ type: "graphic", template: t }, edit)}
                  className="flex w-full items-start gap-2.5 rounded-xl border border-white/10 p-2.5 text-left transition hover:border-white/30"
                >
                  <span className="tile-icon h-8 w-8 flex-none">
                    <Sparkles className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-white">{GRAPHIC_TEMPLATES[t].label}</span>
                    <span className="block text-xs text-muted">{GRAPHIC_TEMPLATES[t].hint}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">Se arman con los colores y la fuente de tu marca, y con lo que dices en ese tramo.</p>
        </div>
      )}

      {tab === "broll" && (
        <div className="flex flex-col gap-2">
          {edit && (
            <Button size="sm" icon={<Clapperboard className="h-3.5 w-3.5" aria-hidden />} onClick={() => onAdd({ type: "broll" })} {...dragProps({ type: "broll" }, edit)}>
              Poner b-roll en el cabezal
            </Button>
          )}
          <p className="text-xs text-muted">Elige entre las sugerencias, tu biblioteca o una búsqueda en Pexels y Pixabay.</p>
          <Link href="/editor/biblioteca" className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-hi hover:underline">
            <Library className="h-3.5 w-3.5" aria-hidden /> Subir clips a tu biblioteca
          </Link>
        </div>
      )}

      {tab === "musica" && (
        <div className="flex flex-col gap-2">
          {(props.tracks ?? []).length === 0 ? (
            <p className="rounded-xl border border-white/10 p-3 text-sm text-muted">Todavía no subiste música. Súbela en Editor → Biblioteca y vuelve aquí.</p>
          ) : (
            <div role="radiogroup" aria-label="Música de fondo" className="flex flex-col gap-1.5">
              {[{ id: null as string | null, title: "Sin música", duration: 0 }, ...(props.tracks ?? [])].map((t) => {
                const active = state.music.trackId === t.id;
                return (
                  <button
                    key={t.id ?? "none"}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={!edit}
                    onClick={() => api.update((s) => ({ ...s, music: { ...s.music, trackId: t.id } }))}
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
          <p className="text-xs text-muted">El volumen y el audio de estudio se ajustan en «Audio y música» (inspector, sin nada elegido).</p>
          <Link href="/editor/biblioteca" className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-hi hover:underline">
            <Library className="h-3.5 w-3.5" aria-hidden /> Administrar tu música
          </Link>
        </div>
      )}
    </div>
  );
}
