"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Bot, Check, Clapperboard, Headphones, Library, Sparkles, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { formatDuration, formatNumber } from "@/lib/format";
import { FX_INFO } from "@/lib/video/fx/catalog";
import { searchTransitions } from "@/lib/video/fx/transitions";
import { GRAPHIC_TEMPLATES, GRAPHIC_TEMPLATE_KEYS } from "@/lib/video/graphics";
import { cn } from "@/lib/utils";
import { DecisionsPanel } from "../director/decisions-panel";
import { EditRequestCard } from "../director/edit-request";
import { CopyEditCard } from "../compos/copy-edit-card";
import { RequestsPanel } from "../compos/compos-inspector";
import type { CopyReport } from "@/lib/video/compos/flows";
import { UnderstandingPanel } from "../director/understanding-panel";
import { VariantsPanel } from "../director/variants-panel";
import { FxLibraryGrid, SearchBox, TransitionTile } from "../fx/fx-library";
import { LibraryMusic } from "./library-music";
import { LibrarySounds } from "./library-sounds";
import { MyEffectsSection } from "./library-mine";
import { startLibraryDrag, type LibraryDrop, type StudioSelection } from "./studio-timeline";
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
  for (const c of state.compositions) {
    if (c.source === "user") continue;
    out.push({ key: `c${c.id}`, sel: { kind: "compos", id: c.id }, label: `Animación «${c.name}»`, text: api.textOf(c.from_word, c.to_word, 50), at: api.composSegs.find((s) => s.id === c.id)?.start ?? null });
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
      {/* Las animaciones que se están creando (varias a la vez), con cancelar. */}
      <RequestsPanel api={api} />
      {/* Arriba de todo: es lo primero que se busca en esta pestaña. */}
      <CopyEditCard
        projectId={props.projectId}
        canEdit={props.canEdit}
        dirty={dirty}
        spent={props.director?.cost.totalUsd ?? 0}
        cap={props.director?.budgetUsd ?? 8}
        report={((props.director?.state as { copy?: { report?: CopyReport | null } } | undefined)?.copy?.report) ?? null}
      />

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
          estimate={props.director?.editEstimate ?? null}
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

function dragProps(item: LibraryDrop, enabled: boolean) {
  if (!enabled) return {};
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      startLibraryDrag(e, item);
    },
  };
}

type LibTab = "efectos" | "transiciones" | "graficos" | "broll" | "musica" | "sonidos";

/**
 * Pestaña Biblioteca: 100 efectos en categorías con buscador, 20 transiciones, gráficos, b-roll, música (generada, tuya
 * y de catálogo) y los sonidos de la biblioteca. Tocar agrega en el cabezal (si ahí hay algo, lo nuevo va encima, en capas); también se
 * arrastran a la línea de tiempo.
 */
export function LibraryPanel({ api, onAdd }: { api: StudioApi; onAdd: (item: LibraryDrop) => void }) {
  const [tab, setTab] = useState<LibTab>("efectos");
  const [trQ, setTrQ] = useState("");
  const { props } = api;
  const edit = props.canEdit;
  const transitions = useMemo(() => searchTransitions(trQ), [trQ]);
  return (
    <div className="flex flex-col gap-3 p-4">
      <div role="tablist" aria-label="Qué agregar" className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-1">
        {(
          [
            ["efectos", "Efectos"],
            ["transiciones", "Transiciones"],
            ["graficos", "Gráficos"],
            ["broll", "B-roll"],
            ["musica", "Música"],
            ["sonidos", "Sonidos"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={tab === v}
            onClick={() => setTab(v)}
            className={cn("rounded-lg px-2 py-1.5 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-accent-hi", tab === v ? "bg-accent text-paper" : "text-muted hover:bg-white/[0.06] hover:text-paper")}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">{edit ? (tab === "transiciones" ? "Toca una para ponerla donde está el cabezal, o arrástrala a cualquier punto de la línea de tiempo. Si la sueltas sobre un rombo, va en ese corte." : tab === "musica" ? "Elige la música de fondo: va debajo de tu voz y baja sola cuando hablas." : "Toca para agregarlo donde está el cabezal, o arrástralo a la línea de tiempo.") : "Solo lectura: tu usuario no puede editar."}</p>

      {tab === "efectos" && <MyEffectsSection canEdit={edit} onAdd={onAdd} />}
      {tab === "efectos" && <FxLibraryGrid brand={api.fxBrand} onPick={edit ? (kind) => onAdd({ type: "fx", kind }) : null} dragData={edit ? (kind) => JSON.stringify({ type: "fx", kind } satisfies LibraryDrop) : undefined} />}

      {tab === "transiciones" && (
        <div className="flex flex-col gap-2.5">
          <SearchBox value={trQ} onChange={setTrQ} label="Buscar transiciones" placeholder="Buscar en 20 transiciones…" />
          {transitions.length === 0 ? (
            <p className="rounded-xl border border-white/10 p-3 text-sm text-muted">Ninguna transición coincide con «{trQ}».</p>
          ) : (
            <div aria-label="Transiciones" className="grid grid-cols-3 gap-1.5">
              {transitions.map((kind) => (
                <TransitionTile
                  key={kind}
                  kind={kind}
                  brand={api.fxBrand}
                  onPick={edit ? () => onAdd({ type: "transition", kind }) : undefined}
                  draggable={edit}
                  onDragStart={(e) => {
                    startLibraryDrag(e, { type: "transition", kind });
                  }}
                />
              ))}
            </div>
          )}
          <p className="text-xs text-muted">Las transiciones tapan un corte o marcan un cambio en medio de un plano, con movimiento, luz o color: tu voz no se corre ni se pisa. Cada una trae su sonido (lo puedes apagar).</p>
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

      {tab === "musica" && <LibraryMusic api={api} />}

      {tab === "sonidos" && <LibrarySounds canEdit={edit} onAdd={onAdd} />}
    </div>
  );
}
