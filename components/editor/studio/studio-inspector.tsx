"use client";

import { useState, type ReactNode } from "react";
import { AudioLines, Bot, Check, ChevronDown, Clapperboard, Headphones, Mic, Palette, PenLine, RefreshCcw, RotateCcw, Scissors, Sparkles, SplitSquareHorizontal, Trash2, Undo2, Wand2, WandSparkles, X, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { SegmentedControl } from "@/components/ui/tabs";
import { formatNumber } from "@/lib/format";
import { isCaptionStyle } from "@/lib/video/caption-styles";
import { CAPTION_PICKER_ORDER, CAPTION_PRESETS } from "@/lib/video/captions";
import { resolveEdit } from "@/lib/video/broll-edit";
import { FX_INFO } from "@/lib/video/fx/catalog";
import { graphicKindLabel, isMotionScene, sceneFields, setSceneField, unsupportedGraphicNumbers, unsupportedSceneNumbers } from "@/lib/video/motion-graphics";
import { outputRange } from "@/lib/video/timeline";
import { secondsLabel, timeLabel } from "@/lib/video/studio";
import { cn } from "@/lib/utils";
import { AudioPanel } from "../audio-panel";
import { BrollEditBody } from "../broll-edit-panel";
import { SourceLine } from "../broll-panel";
import { CaptionPicker } from "../caption-picker";
import { FxEditorBody } from "../fx/fx-panel";
import { reasonLabel } from "../labels";
import { RhythmPanel } from "../rhythm-panel";
import type { StudioSelection } from "./studio-timeline";
import { USER_TAG, type StudioApi } from "./types";

/** Panel derecho del Estudio: lo elegido con todos sus controles, o los ajustes del video si no hay nada elegido. */
export function StudioInspector({ api }: { api: StudioApi }) {
  const sel = api.selection;
  return (
    <div className="flex min-h-full flex-col" data-testid="studio-inspector">
      {!sel ? <GlobalInspector api={api} /> : <SelectionInspector api={api} sel={sel} />}
    </div>
  );
}

function Header({ eyebrow, title, onClose, children }: { eyebrow: string; title: ReactNode; onClose?: () => void; children?: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-white/10 bg-[#040d2c]/95 px-4 py-3 backdrop-blur">
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="mt-0.5 truncate text-base font-semibold text-white">{title}</h2>
        {children}
      </div>
      {onClose && (
        <button type="button" onClick={onClose} className="-mr-1 grid h-8 w-8 flex-none place-items-center rounded-lg text-muted transition hover:bg-white/[0.07] hover:text-white" aria-label="Cerrar y ver los ajustes del video" title="Cerrar (Esc)">
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

function Group({ title, icon, children, defaultOpen = true }: { title: string; icon?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-white/[0.06]">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold text-white hover:bg-white/[0.02]">
        <span className="flex items-center gap-2">
          {icon && <span className="text-accent-hi">{icon}</span>}
          {title}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted transition motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open && <div className="flex flex-col gap-3 px-4 pb-4">{children}</div>}
    </section>
  );
}

/** Aviso de "lo puso la IA" con su porqué y las dos salidas: dejarlo tal cual o quitarlo. */
function AiNote({ api, why, sel }: { api: StudioApi; why?: string | null; sel: StudioSelection }) {
  const text = api.humanize(why?.replace(USER_TAG, ""));
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-accent/30 bg-accent/[0.08] p-3 text-xs">
      <p className="flex items-start gap-2 text-text">
        <Bot className="mt-0.5 h-3.5 w-3.5 flex-none text-accent-hi" aria-hidden />
        <span>
          <span className="font-semibold text-white">Lo puso la IA.</span> {text || "Revísalo: puedes dejarlo, cambiarlo o quitarlo."}
        </span>
      </p>
      {api.props.canEdit && (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" icon={<Check className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.accept(sel)}>
            Aceptar
          </Button>
          <Button size="sm" variant="subtle" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={api.actions.removeSelection}>
            Quitar
          </Button>
        </div>
      )}
    </div>
  );
}

function Spoken({ text, start, end }: { text: string; start?: number; end?: number }) {
  return (
    <div className="rounded-xl bg-white/[0.04] px-3 py-2 text-sm">
      <p className="text-text/90">“{text}”</p>
      {start != null && end != null && (
        <p className="mt-1 font-mono text-[11px] text-muted tabular-nums">
          {timeLabel(start)} – {timeLabel(end)} · {secondsLabel(end - start)}
        </p>
      )}
    </div>
  );
}

/** Lugar para los controles de posición y animación (los agrega el lienzo con `transformControls`). */
function TransformSlot({ api, sel }: { api: StudioApi; sel: StudioSelection }) {
  const node = api.props.transformControls?.(sel);
  if (!node) return null;
  return (
    <Group title="Posición y animación" icon={<Sparkles className="h-4 w-4" aria-hidden />}>
      {node}
    </Group>
  );
}

function SelectionInspector({ api, sel }: { api: StudioApi; sel: StudioSelection }) {
  const close = () => api.select(null);
  switch (sel.kind) {
    case "broll":
      return <BrollInspector api={api} id={sel.id} onClose={close} />;
    case "fx":
      return <FxInspector api={api} id={sel.id} onClose={close} />;
    case "zoom":
      return <ZoomInspector api={api} index={sel.index} onClose={close} />;
    case "caption":
      return <CaptionInspector api={api} index={sel.index} onClose={close} />;
    case "clip":
      return <ClipInspector api={api} index={sel.index} onClose={close} />;
    case "cut":
      return <CutInspector api={api} from={sel.from} to={sel.to} onClose={close} />;
    case "range":
      return <RangeInspector api={api} from={sel.from} to={sel.to} onClose={close} />;
    case "audio":
      return (
        <>
          <Header eyebrow="Sonido" title="Audio y música" onClose={close} />
          <div className="p-4">
            <AudioBlock api={api} />
          </div>
        </>
      );
  }
}

function Gone({ onClose }: { onClose: () => void }) {
  return (
    <>
      <Header eyebrow="Nada elegido" title="Ya no está" onClose={onClose} />
      <p className="p-4 text-sm text-muted">Lo que tenías elegido se quitó o se deshizo. Elige otra cosa en la línea de tiempo.</p>
    </>
  );
}

function BrollInspector({ api, id, onClose }: { api: StudioApi; id: string; onClose: () => void }) {
  const { props, state } = api;
  const item = state.broll.find((b) => b.id === id);
  if (!item) return <Gone onClose={onClose} />;
  const choice = api.signedOf(item.choice);
  const seg = api.segments.find((s) => s.id === id) ?? null;
  const graphic = choice?.graphic ?? null;
  const spoken = api.textOf(item.from_word, item.to_word, 200);
  const ai = !item.id.startsWith("u");
  const others = state.broll.filter((b) => b.id !== id && b.choice && b.choice.source !== "graphic").length;
  const sel: StudioSelection = { kind: "broll", id };
  const fields = graphic && isMotionScene(graphic) ? sceneFields(graphic) : [];
  const missing = graphic ? (isMotionScene(graphic) ? unsupportedSceneNumbers(graphic, spoken) : unsupportedGraphicNumbers(graphic, spoken)) : [];
  return (
    <>
      <Header eyebrow={graphic ? "Gráfico" : "B-roll"} title={graphic ? graphicKindLabel(graphic) : choice ? (choice.title ?? "Toma de apoyo") : "B-roll sin clip"} onClose={onClose} />
      <div className="flex flex-col gap-3 p-4">
        <Spoken text={spoken} start={seg?.start} end={seg?.end} />
        {!seg && choice && <p className="text-xs text-warning">Cae sobre palabras cortadas: no se ve en el video.</p>}
        {choice ? <SourceLine option={choice} /> : <p className="text-sm text-warning">Todavía no tiene clip: elige uno o quítalo.</p>}
        {missing.length > 0 && fields.length === 0 && (
          <Notice tone="warning">
            {missing.length === 1 ? "Esta cifra no aparece" : "Estas cifras no aparecen"} en lo que dices en este tramo ({missing.map((n) => formatNumber(n)).join(", ")}). Cámbiala en «Editar gráfico» para no mostrar un dato que no dijiste.
          </Notice>
        )}
        {ai && <AiNote api={api} why={item.why} sel={sel} />}
        {!ai && item.why && <p className="text-xs text-muted">{api.humanize(item.why)}</p>}
        {props.canEdit && (
          <div className="flex flex-wrap gap-2">
            {graphic ? (
              <Button size="sm" icon={<PenLine className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.openPicker(id, "grafico")}>
                Editar gráfico
              </Button>
            ) : (
              <Button size="sm" icon={<RefreshCcw className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.openPicker(id)}>
                {choice ? "Cambiar clip" : "Elegir clip"}
              </Button>
            )}
            {graphic && (
              <Button size="sm" variant="ghost" icon={<RefreshCcw className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.openPicker(id, "sugeridos")}>
                Cambiar por un clip
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<SplitSquareHorizontal className="h-3.5 w-3.5" aria-hidden />} onClick={api.actions.split} title="Dividir en el cabezal (S)">
              Dividir
            </Button>
            <Button size="sm" variant="subtle" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={api.actions.removeSelection} title="Quitar (Supr)">
              Quitar
            </Button>
          </div>
        )}
      </div>
      {fields.length > 0 && props.canEdit && (
        <Group title="Textos del gráfico" icon={<PenLine className="h-4 w-4" aria-hidden />}>
          {fields.map((f) => (
            <label key={f.id} className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">
                {f.group} · {f.label}
              </span>
              <Input
                value={String(f.value)}
                inputMode={f.kind === "number" ? "decimal" : undefined}
                className="!py-2 !text-sm"
                onChange={(e) => {
                  if (!graphic || !isMotionScene(graphic)) return;
                  api.actions.setGraphic(id, setSceneField(graphic, f.id, f.kind === "number" ? Number(e.target.value || 0) : e.target.value));
                }}
                aria-label={`${f.group}: ${f.label}`}
              />
            </label>
          ))}
          {missing.length > 0 && (
            <Notice tone="warning">
              {missing.length === 1 ? "Esta cifra no aparece" : "Estas cifras no aparecen"} en lo que dices en este tramo ({missing.map((n) => formatNumber(n)).join(", ")}). Revísala para no mostrar un dato que no dijiste.
            </Notice>
          )}
          <p className="text-xs text-muted">Para cambiar el diseño o pedirle otro a la IA, toca «Editar gráfico».</p>
        </Group>
      )}
      <TransformSlot api={api} sel={sel} />
      {choice && (
        <Group title={graphic ? "Tiempo" : "Ubicación, encuadre, look y tiempo"} icon={<Clapperboard className="h-4 w-4" aria-hidden />}>
          <BrollEditBody
            key={id}
            inline
            edit={resolveEdit(item.edit)}
            onChange={(edit) => api.actions.setBrollEdit(id, edit)}
            onApplyLookToAll={() => api.actions.applyLookToAll(id)}
            otherVideos={others}
            format={state.format}
            media={{ previewUrl: choice.previewUrl, thumbUrl: choice.thumbUrl, width: choice.width, height: choice.height }}
            poster={props.posterUrl}
            accent={props.graphicLook.theme.accent}
            ground={props.graphicLook.theme.bg}
            focusY={props.style?.focusY ?? 0.42}
            span={seg ? { start: seg.start, end: seg.end } : null}
            clipDuration={choice.duration}
            isGraphic={choice.source === "graphic"}
            graphic={graphic}
            posterFit={state.format === "16:9" && props.sourceHeight > props.sourceWidth * 1.02 ? "contain" : "cover"}
            posterX={api.showFraming ? state.offsetX : 0}
            title={spoken.slice(0, 70)}
          />
        </Group>
      )}
    </>
  );
}

function FxInspector({ api, id, onClose }: { api: StudioApi; id: string; onClose: () => void }) {
  const { props, state } = api;
  const item = state.effects.find((e) => e.id === id);
  if (!item) return <Gone onClose={onClose} />;
  const info = FX_INFO[item.kind];
  const seg = api.fxSegs.find((s) => s.id === id) ?? null;
  const sel: StudioSelection = { kind: "fx", id };
  const ai = item.source !== "user";
  const maskNote = !info.mask
    ? null
    : api.maskMissing.has(id)
      ? api.masks.pending
        ? "Este efecto va detrás tuyo. Estamos recortándote del fondo para la vista previa; mientras tanto se ve más tenue. En el video final siempre quedas adelante."
        : api.masks.failed
          ? "No pudimos recortarte para la vista previa. Al renderizar se vuelve a intentar; en el video final siempre quedas adelante."
          : "Este efecto va detrás tuyo. Mientras preparamos tu recorte, la vista previa lo muestra más tenue; en el video final siempre quedas adelante."
      : "Este efecto va detrás tuyo: la vista previa ya usa tu recorte (el mismo del video final).";
  return (
    <>
      <Header eyebrow="Efecto" title={info.label} onClose={onClose}>
        <p className="mt-0.5 text-xs text-muted">{info.description}</p>
      </Header>
      <div className="flex flex-col gap-3 p-4">
        {seg ? (
          <p className="font-mono text-[11px] text-muted tabular-nums">
            {timeLabel(seg.start)} – {timeLabel(seg.end)} · {secondsLabel(seg.end - seg.start)} <span className="font-sans">(dura entre {secondsLabel(info.duration.min)} y {secondsLabel(info.duration.max)})</span>
          </p>
        ) : (
          <p className="text-xs text-warning">Cae sobre palabras cortadas: no se ve en el video.</p>
        )}
        {ai && <AiNote api={api} why={item.why} sel={sel} />}
        {props.canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" icon={<Wand2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.openGallery({ from: item.from_word, to: item.to_word }, id)}>
              Cambiar de efecto
            </Button>
            <Button size="sm" variant="ghost" icon={<SplitSquareHorizontal className="h-3.5 w-3.5" aria-hidden />} onClick={api.actions.split} title="Dividir en el cabezal (S)">
              Dividir
            </Button>
            <Button size="sm" variant="subtle" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={api.actions.removeSelection} title="Quitar (Supr)">
              Quitar
            </Button>
          </div>
        )}
        {info.thumbs && api.thumbsCount === 0 && <p className="text-xs text-muted">No encontramos miniaturas de tus reels en Métricas: este efecto usa tarjetas con tu marca. Conecta Instagram o TikTok para que salgan tus reels.</p>}
      </div>
      <Group title="Textos y detalles" icon={<PenLine className="h-4 w-4" aria-hidden />}>
        <fieldset disabled={!props.canEdit} className="contents">
          <FxEditorBody
            key={id}
            idPrefix={`fx-${id}`}
            item={item}
            words={props.words}
            corrections={state.corrections}
            maskNote={maskNote}
            onChange={(next) => api.update((s) => ({ ...s, effects: s.effects.map((e) => (e.id === next.id ? next : e)) }), { coalesce: `fx:${id}` })}
          />
        </fieldset>
      </Group>
      <TransformSlot api={api} sel={sel} />
    </>
  );
}

function ZoomInspector({ api, index, onClose }: { api: StudioApi; index: number; onClose: () => void }) {
  const { state, props } = api;
  if (index < 0 || api.styleZooms) {
    return (
      <>
        <Header eyebrow="Zoom" title="Zooms del estilo" onClose={onClose} />
        <div className="flex flex-col gap-3 p-4 text-sm text-muted">
          <p>Tu estilo «{props.style?.name}» pone los zooms solo, al ritmo de los cortes y de las palabras resaltadas. Se recalculan cuando cambias el video.</p>
          {props.canEdit && (
            <Button size="sm" variant="ghost" className="self-start" onClick={() => api.update((s) => ({ ...s, zoomsOn: false }))}>
              Apagar los zooms del estilo
            </Button>
          )}
        </div>
      </>
    );
  }
  const m = state.zoomMoments[index];
  if (!m) return <Gone onClose={onClose} />;
  const range = outputRange(api.timeline, m.from_word, m.to_word);
  const ai = !m.why.startsWith(USER_TAG);
  const sel: StudioSelection = { kind: "zoom", index };
  const pct = ((m.scale - 1.04) / (1.32 - 1.04)) * 100;
  return (
    <>
      <Header eyebrow="Zoom" title={m.scale >= 1.12 ? "Punch-in" : "Zoom suave"} onClose={onClose} />
      <div className="flex flex-col gap-3 p-4">
        <Spoken text={api.textOf(m.from_word, m.to_word, 160)} start={range?.start} end={range?.end} />
        {ai && <AiNote api={api} why={m.why} sel={sel} />}
        <label className="flex flex-col gap-2">
          <span className="flex items-center justify-between text-sm font-semibold text-white">
            Escala
            <span className="font-mono text-xs font-medium text-muted tabular-nums">{m.scale.toFixed(2).replace(".", ",")}×</span>
          </span>
          <input
            type="range"
            className="range"
            min={1.04}
            max={1.32}
            step={0.02}
            value={m.scale}
            disabled={!props.canEdit}
            style={{ ["--pct" as string]: `${pct}%` }}
            onChange={(e) => {
              const scale = Number(e.target.value);
              api.update((s) => ({ ...s, rhythmTouched: true, zoomMoments: s.zoomMoments.map((z, i) => (i === index ? { ...z, scale } : z)) }), { coalesce: `zoom:${index}` });
            }}
            aria-valuetext={`${m.scale.toFixed(2).replace(".", ",")} veces`}
          />
          <span className="text-xs text-muted">Hasta 1,12× se siente como un acercamiento suave; desde ahí, como un corte de cámara.</span>
        </label>
        {props.canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" icon={<SplitSquareHorizontal className="h-3.5 w-3.5" aria-hidden />} onClick={api.actions.split}>
              Dividir
            </Button>
            <Button size="sm" variant="subtle" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={api.actions.removeSelection}>
              Quitar
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

function CaptionInspector({ api, index, onClose }: { api: StudioApi; index: number; onClose: () => void }) {
  const { state, props } = api;
  const block = api.captions[index];
  if (!block) return <Gone onClose={onClose} />;
  const sel: StudioSelection = { kind: "caption", index };
  const emphasis = new Set(state.emphasis);
  return (
    <>
      <Header eyebrow="Subtítulo" title={`${timeLabel(block.start)} – ${timeLabel(block.end)}`} onClose={onClose} />
      <div className="flex flex-col gap-3 p-4">
        <p className="text-xs text-muted">Cambia cómo se escribe cada palabra en los subtítulos (el audio queda igual). La estrella la resalta con el color de tu marca.</p>
        <ul className="flex flex-col gap-2">
          {block.words.map((w) => {
            const original = props.words[w.id]?.text ?? w.text;
            const value = state.corrections[String(w.id)] ?? original;
            const on = emphasis.has(w.id);
            return (
              <li key={w.id} className="flex items-center gap-2">
                <Input
                  value={value}
                  maxLength={60}
                  disabled={!props.canEdit}
                  className="!py-1.5 !text-sm"
                  aria-label={`Texto de la palabra «${original}»`}
                  onChange={(e) => {
                    const text = e.target.value;
                    api.update(
                      (s) => {
                        const next = { ...s.corrections };
                        if (text.trim() && text !== original) next[String(w.id)] = text;
                        else delete next[String(w.id)];
                        return { ...s, corrections: next };
                      },
                      { coalesce: `cap:${w.id}` },
                    );
                  }}
                />
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={!props.canEdit}
                  onClick={() => api.update((s) => ({ ...s, rhythmTouched: true, emphasis: on ? s.emphasis.filter((x) => x !== w.id) : [...s.emphasis, w.id].sort((a, b) => a - b) }))}
                  className={cn("grid h-9 w-9 flex-none place-items-center rounded-lg border text-sm transition", on ? "border-accent bg-accent/25 text-white" : "border-white/10 text-muted hover:border-white/30 hover:text-white")}
                  aria-label={on ? `Quitar el resaltado de «${value}»` : `Resaltar «${value}»`}
                  title={on ? "Resaltada" : "Resaltar"}
                >
                  ★
                </button>
              </li>
            );
          })}
        </ul>
        <Button size="sm" variant="ghost" className="self-start" icon={<Headphones className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.seek(block.start, true)}>
          Escuchar
        </Button>
        <p className="text-xs text-muted">Para corregir una palabra en todas las veces que aparece, haz doble clic sobre ella en Transcripción.</p>
      </div>
      <TransformSlot api={api} sel={sel} />
    </>
  );
}

function ClipInspector({ api, index, onClose }: { api: StudioApi; index: number; onClose: () => void }) {
  const clip = api.timeline.clips[index];
  if (!clip) return <Gone onClose={onClose} />;
  const kept = api.timeline.words.filter((w) => w.id >= clip.firstWord && w.id <= clip.lastWord);
  const start = kept[0]?.start ?? 0;
  const end = kept[kept.length - 1]?.end ?? 0;
  return (
    <>
      <Header eyebrow="Tramo de video" title={clip.role === "hook" ? "Gancho (va al principio)" : `Tramo ${index + 1} de ${api.timeline.clips.length}`} onClose={onClose} />
      <div className="flex flex-col gap-3 p-4">
        <Spoken text={kept.map((w) => w.text).join(" ")} start={start} end={end} />
        <p className="text-xs text-muted">Para cortar solo una parte, arrastra sobre la pista de video y elige el tramo; o toca palabras en Transcripción.</p>
        <div className="flex flex-wrap gap-2">
          {api.props.canEdit && (
            <Button size="sm" variant="ghost" icon={<Scissors className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.cut(kept.map((w) => w.id), true)}>
              Cortar este tramo
            </Button>
          )}
          <Button size="sm" variant="subtle" icon={<Headphones className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.seek(start, true)}>
            Escuchar
          </Button>
        </div>
      </div>
    </>
  );
}

function CutInspector({ api, from, to, onClose }: { api: StudioApi; from: number; to: number; onClose: () => void }) {
  const ids: number[] = [];
  for (let id = from; id <= to; id++) if (api.removedSet.has(id)) ids.push(id);
  if (!ids.length) return <Gone onClose={onClose} />;
  const reason = api.reasons.get(from) ?? "manual";
  return (
    <>
      <Header eyebrow="Corte" title={reasonLabel[reason]} onClose={onClose} />
      <div className="flex flex-col gap-3 p-4">
        <p className="rounded-xl bg-white/[0.04] px-3 py-2 text-sm text-text/80 line-through decoration-danger/60">“{api.textOf(from, to, 240)}”</p>
        <p className="text-xs text-muted">
          {formatNumber(ids.length)} {ids.length === 1 ? "palabra cortada" : "palabras cortadas"}. No sale en el video.
        </p>
        <div className="flex flex-wrap gap-2">
          {api.props.canEdit && (
            <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => (api.actions.cut(ids, false), api.select(null))}>
              Restaurar
            </Button>
          )}
          <Button size="sm" variant="subtle" icon={<Headphones className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.listenFrom(Math.max(0, from - 3))}>
            Escuchar cómo queda
          </Button>
        </div>
      </div>
    </>
  );
}

function RangeInspector({ api, from, to, onClose }: { api: StudioApi; from: number; to: number; onClose: () => void }) {
  const range = outputRange(api.timeline, from, to);
  const span = { from, to };
  const edit = api.props.canEdit;
  return (
    <>
      <Header eyebrow="Tramo elegido" title={range ? `${timeLabel(range.start)} – ${timeLabel(range.end)}` : "Tramo"} onClose={onClose} />
      <div className="flex flex-col gap-3 p-4">
        <Spoken text={api.textOf(from, to, 240)} start={range?.start} end={range?.end} />
        <div className="grid grid-cols-1 gap-2">
          {edit && (
            <Button size="sm" icon={<Scissors className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.cutSpan(span)}>
              Cortar este tramo
            </Button>
          )}
          {edit && (
            <Button size="sm" variant="ghost" icon={<Clapperboard className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.addBroll(span)}>
              Poner b-roll aquí
            </Button>
          )}
          {edit && (
            <Button size="sm" variant="ghost" icon={<WandSparkles className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.addBroll(span, true)}>
              Pide un gráfico aquí
            </Button>
          )}
          {edit && (
            <Button size="sm" variant="ghost" icon={<Sparkles className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.openGallery(span, null)}>
              Poner un efecto aquí
            </Button>
          )}
          {edit && !api.styleZooms && (
            <Button size="sm" variant="ghost" icon={<ZoomIn className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.addZoom(span)}>
              Poner un zoom aquí
            </Button>
          )}
          {edit && (
            <Button size="sm" variant="ghost" icon={<Mic className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.openPhraseFix(span)}>
              Corregir esta frase con tu voz
            </Button>
          )}
          <Button size="sm" variant="subtle" icon={<Headphones className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.listenFrom(from)}>
            Escuchar desde aquí
          </Button>
        </div>
      </div>
    </>
  );
}

function AudioBlock({ api }: { api: StudioApi }) {
  const { state, props } = api;
  return (
    <AudioPanel
      studio={state.studio}
      onStudio={(studio) => api.update((s) => ({ ...s, studio }))}
      audioPreview={props.audioPreview ?? null}
      sfx={state.sfx}
      onSfx={(sfx) => api.update((s) => ({ ...s, sfx }))}
      musicId={state.music.trackId}
      musicDb={state.music.db}
      onMusic={(music) => api.update((s) => ({ ...s, music }), { coalesce: "music" })}
      tracks={props.tracks ?? []}
      canEdit={props.canEdit}
    />
  );
}

/** Sin nada elegido: los ajustes de todo el video (formato, subtítulos, ritmo, zooms y sonido). */
function GlobalInspector({ api }: { api: StudioApi }) {
  const { state, props } = api;
  const captionStyle = props.style?.captions ?? null;
  return (
    <>
      <Header eyebrow="Ajustes del video" title="Todo el video">
        <p className="mt-0.5 text-xs text-muted">Elige algo en la línea de tiempo para editarlo. Aquí ajustas lo que vale para todo el video.</p>
      </Header>
      <Group title="Formato y encuadre" icon={<RotateCcw className="h-4 w-4" aria-hidden />}>
        <SegmentedControl
          label="Formato"
          size="sm"
          value={state.format}
          onValueChange={(v) => props.canEdit && api.update((s) => ({ ...s, format: v }))}
          options={[
            { value: "9:16", label: "Vertical 9:16" },
            { value: "16:9", label: "Horizontal 16:9" },
          ]}
        />
        {api.showFraming && (
          <div className="flex flex-col gap-2">
            <label htmlFor="studio-framing" className="flex items-center justify-between text-sm font-semibold text-white">
              Encuadre
              {state.offsetX !== 0 && props.canEdit && (
                <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-accent-hi" onClick={() => api.update((s) => ({ ...s, offsetX: 0 }))}>
                  <RotateCcw className="h-3 w-3" aria-hidden /> Centrar
                </button>
              )}
            </label>
            <input
              id="studio-framing"
              type="range"
              className="range"
              min={-1}
              max={1}
              step={0.05}
              value={state.offsetX}
              disabled={!props.canEdit}
              onChange={(e) => {
                const offsetX = Number(e.target.value);
                api.update((s) => ({ ...s, offsetX }), { coalesce: "framing" });
              }}
              style={{ ["--pct" as string]: `${((state.offsetX + 1) / 2) * 100}%` }}
              aria-valuetext={state.offsetX === 0 ? "Centrado" : state.offsetX < 0 ? "Hacia la izquierda" : "Hacia la derecha"}
            />
            <p className="text-xs text-muted">Tu video es horizontal: mueve el recorte para que tu cara quede al centro.</p>
          </div>
        )}
      </Group>
      <Group title="Subtítulos" icon={<PenLine className="h-4 w-4" aria-hidden />}>
        <CaptionPicker
          value={state.preset}
          onChange={(preset) => props.canEdit && api.update((s) => ({ ...s, preset }))}
          options={CAPTION_PICKER_ORDER.filter((k) => k !== "estilo" || Boolean(captionStyle))}
          accent={props.accent}
          brandFont={props.graphicLook.font}
          emoji={state.emoji}
          captionStyle={captionStyle}
          disabled={!props.canEdit}
        />
        <p className="text-xs text-muted" aria-live="polite">
          <span className="font-semibold text-text">{CAPTION_PRESETS[state.preset].label}:</span> {CAPTION_PRESETS[state.preset].description}
        </p>
        {isCaptionStyle(state.preset) && (
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5">
            <span className="flex flex-col">
              <span className="text-sm text-text">Emojis en las palabras clave</span>
              <span className="text-xs text-muted">Uno por frase, solo donde encaja (dinero, tiempo, idea…).</span>
            </span>
            <input type="checkbox" className="h-4 w-4 flex-none accent-[#0070f8]" checked={state.emoji} disabled={!props.canEdit} onChange={(e) => api.update((s) => ({ ...s, emoji: e.target.checked }))} />
          </label>
        )}
      </Group>
      <Group title="Ritmo" icon={<Sparkles className="h-4 w-4" aria-hidden />}>
        <RhythmPanel score={api.rhythm} cuts={[]} sfx={[]} entries={[]} time={api.time} density={state.density} onDensity={api.actions.changeDensity} onSeek={(t) => api.actions.seek(t)} canEdit={props.canEdit} showBar={false} />
      </Group>
      {props.style && (
        <Group title="Zooms del estilo" icon={<Palette className="h-4 w-4" aria-hidden />} defaultOpen={false}>
          <p className="text-sm text-text">
            Estilo: <span className="font-semibold text-white">{props.style.name}</span>
          </p>
          {props.style.zoom.enabled ? (
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5">
              <span className="flex items-center gap-2 text-sm text-text">
                <ZoomIn className="h-4 w-4 text-accent-hi" aria-hidden />
                Zooms del estilo {state.zoomsOn ? `(${formatNumber(api.zooms.length)})` : ""}
              </span>
              <input type="checkbox" className="h-4 w-4 accent-[#0070f8]" checked={state.zoomsOn} disabled={!props.canEdit} onChange={(e) => api.update((s) => ({ ...s, zoomsOn: e.target.checked }))} />
            </label>
          ) : (
            <p className="text-xs text-muted">La referencia no usa zooms.</p>
          )}
          <p className="text-xs text-muted">Con los zooms del estilo apagados, puedes poner los tuyos en la línea de tiempo.</p>
        </Group>
      )}
      <Group title="Audio y música" icon={<AudioLines className="h-4 w-4" aria-hidden />} defaultOpen={false}>
        <AudioBlock api={api} />
      </Group>
    </>
  );
}
