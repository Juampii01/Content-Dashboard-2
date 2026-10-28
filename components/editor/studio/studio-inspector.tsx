"use client";

import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Bot, BringToFront, SendToBack, Check, ChevronDown, Clapperboard, Headphones, Mic, PenLine, RefreshCcw, RotateCcw, Scissors, Sparkles, SplitSquareHorizontal, Trash2, Undo2, Wand2, WandSparkles, X, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { formatNumber } from "@/lib/format";
import { resolveEdit } from "@/lib/video/broll-edit";
import { FX_INFO } from "@/lib/video/fx/catalog";
import { graphicKindLabel, isMotionScene, sceneFields, setSceneField, unsupportedGraphicNumbers, unsupportedSceneNumbers } from "@/lib/video/motion-graphics";
import { outputRange } from "@/lib/video/timeline";
import { defaultEmphasis, isTextOption, TEXT_COLOR_LABELS, TEXT_COLOR_SWATCHES, TEXT_MAX, TEXT_POSITION_LABELS, TEXT_POSITIONS, TEXT_PRESET_KEYS, TEXT_PRESETS, TEXT_SIZE_LABELS, TEXT_SIZES, type TextSpecInput } from "@/lib/video/text-presets";
import { secondsLabel, timeLabel } from "@/lib/video/studio";
import { cn } from "@/lib/utils";
import { TRANSITION_DURATION, TRANSITION_GALLERY_ORDER, TRANSITION_INFO } from "@/lib/video/fx/transitions";
import { cueClip, fitCueClip, soundCueTimes, SOUND_GAIN, type SoundCue } from "@/lib/video/sfx";
import { MARKER_NOTE_MAX } from "@/lib/video/markers";
import { timecode } from "@/lib/video/timecode";
import { Mixer } from "./mixer";
import { SFX_CATEGORIES, SFX_CATEGORY_LABELS, SFX_LIBRARY, SFX_NAMES, type SfxName } from "@/lib/video/sfx-library";
import { AudioPanel } from "../audio-panel";
import { TransitionTile } from "../fx/fx-library";
import { playSfx } from "../sound/use-sound";
import { BrollEditBody } from "../broll-edit-panel";
import { SourceLine } from "../broll-panel";
import { FxEditorBody } from "../fx/fx-panel";
import { reasonLabel } from "../labels";
import { AskAnimation, ComposInspectorBody, RequestsPanel } from "../compos/compos-inspector";
import type { StudioSelection } from "./studio-timeline";
import { USER_TAG, type StudioApi } from "./types";
import { FEATURES } from "@/lib/features";

/** Lo elegido en la línea de tiempo con todos sus controles (se abre en el panel de herramientas). */
export function StudioInspector({ api }: { api: StudioApi }) {
  const sel = api.selection;
  if (!sel) return null;
  return (
    <div className="flex min-h-full flex-col" data-testid="studio-inspector">
      <SelectionInspector api={api} sel={sel} />
    </div>
  );
}

/** Encuadre (video horizontal en formato vertical) y zooms del estilo: van en la pestaña Edición. */
export function FramingAndZooms({ api }: { api: StudioApi }) {
  const { state, props } = api;
  if (!api.showFraming && !props.style) return null;
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-card p-4">
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
      {props.style?.zoom.enabled && (
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5">
          <span className="flex items-center gap-2 text-sm text-text">
            <ZoomIn className="h-4 w-4 text-accent-hi" aria-hidden />
            Zooms del estilo «{props.style.name}» {state.zoomsOn ? `(${formatNumber(api.zooms.length)})` : ""}
          </span>
          <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={state.zoomsOn} disabled={!props.canEdit} onChange={(e) => api.update((s) => ({ ...s, zoomsOn: e.target.checked }))} />
        </label>
      )}
    </section>
  );
}

function Header({ eyebrow, title, onClose, children }: { eyebrow: string; title: ReactNode; onClose?: () => void; children?: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-white/10 bg-card/95 px-4 py-3 backdrop-blur">
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

/**
 * Orden de capas de lo elegido con lo que se le superpone: al frente (se dibuja encima) o atrás. Solo aparece si hay
 * algo superpuesto. En la línea de tiempo, el carril de arriba es el de adelante.
 */
function LayerButtons({ api, sel }: { api: StudioApi; sel: StudioSelection }) {
  if (!api.props.canEdit || !api.overlaps(sel)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-2" data-testid="layer-buttons">
      <span className="text-xs text-muted">Se superpone con otra cosa:</span>
      <Button size="sm" variant="subtle" icon={<BringToFront className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.restack(sel, "front")}>
        Traer al frente
      </Button>
      <Button size="sm" variant="subtle" icon={<SendToBack className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.restack(sel, "back")}>
        Enviar atrás
      </Button>
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
  const node = api.transformControls(sel);
  if (!node) return null;
  return (
    <Group title="Lugar y animación" icon={<Sparkles className="h-4 w-4" aria-hidden />}>
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
    case "request": {
      const req = api.compos.requests.find((r) => r.id === sel.id);
      return (
        <>
          <Header eyebrow="Animación en curso" title={req?.request?.instruction.slice(0, 80) ?? "Pedido de animación"} onClose={close} />
          <div className="flex flex-col gap-3 p-4">
            <RequestsPanel api={api} only={sel.id} />
            <p className="text-xs text-muted">Cuando termine, aparece sola en este lugar, encima de lo que haya, en su propia capa. Puedes seguir editando y pedir otras.</p>
          </div>
        </>
      );
    }
    case "compos": {
      const item = api.state.compositions.find((c) => c.id === sel.id);
      if (!item) return <Gone onClose={close} />;
      return (
        <>
          <Header eyebrow="Animación" title={item.name} onClose={close} />
          <LayerButtons api={api} sel={sel} />
          <ComposInspectorBody api={api} item={item} />
        </>
      );
    }
    case "zoom":
      return <ZoomInspector api={api} index={sel.index} onClose={close} />;
    case "caption":
      return <CaptionInspector api={api} index={sel.index} onClose={close} />;
    case "clip":
      return <ClipInspector api={api} index={sel.index} onClose={close} />;
    case "cut":
      return <CutInspector api={api} from={sel.from} to={sel.to} onClose={close} />;
    case "pause":
      return <PauseInspector api={api} word={sel.word} onClose={close} />;
    case "range":
      return <RangeInspector api={api} from={sel.from} to={sel.to} onClose={close} />;
    case "transition":
      return <TransitionInspector api={api} word={sel.word} id={sel.id} onClose={close} />;
    case "sound":
      return <SoundInspector api={api} id={sel.id} onClose={close} />;
    case "marker":
      return <MarkerInspector api={api} id={sel.id} onClose={close} />;
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
  if (choice && isTextOption(choice)) return <TextInspector api={api} id={id} onClose={onClose} />;
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
        <LayerButtons api={api} sel={sel} />
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
        <Group title={graphic ? "Tiempo" : choice.kind === "image" ? "Ubicación, movimiento, look y tiempo" : "Ubicación, encuadre, look y tiempo"} icon={<Clapperboard className="h-4 w-4" aria-hidden />}>
          <BrollEditBody
            key={id}
            inline
            edit={resolveEdit(item.edit)}
            onChange={(edit) => api.actions.setBrollEdit(id, edit)}
            onApplyLookToAll={() => api.actions.applyLookToAll(id)}
            otherVideos={others}
            format={state.format}
            media={{ previewUrl: choice.previewUrl, thumbUrl: choice.thumbUrl, width: choice.width, height: choice.height, kind: choice.kind }}
            seed={id}
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

/** Un chip de una opción (estilo, tamaño, lugar): negro cuando está elegido. */
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-accent-hi", on ? "border-white bg-white text-paper" : "border-white/10 text-text hover:border-white/30")}
    >
      {children}
    </button>
  );
}

/**
 * Texto a mano (Biblioteca → Textos): el texto, el estilo, el color (de la marca o uno propio), el tamaño y el lugar.
 * Cada cambio vuelve a armar la escena (lib/video/text-presets.ts); el lugar fino se ajusta arrastrando en el video.
 */
function TextInspector({ api, id, onClose }: { api: StudioApi; id: string; onClose: () => void }) {
  const { props, state } = api;
  // Borradores: un texto vacío no rearma la escena (es obligatorio), pero se puede borrar para escribir otro.
  const [draft, setDraft] = useState<{ id: string; text: string; sub: string; emphasis: string } | null>(null);
  const item = state.broll.find((b) => b.id === id);
  const spec = item?.choice?.text ?? null;
  if (!item?.choice || !spec) return <Gone onClose={onClose} />;
  const choice = item.choice;
  const seg = api.segments.find((s) => s.id === id) ?? null;
  const sel: StudioSelection = { kind: "broll", id };
  const preset = TEXT_PRESETS[spec.preset];
  const d = draft?.id === id ? draft : { id, text: spec.text, sub: spec.sub ?? "", emphasis: spec.emphasis ?? "" };
  const set = (patch: Partial<TextSpecInput>) => api.actions.setText(id, patch);
  const edit = props.canEdit;
  const position = spec.position ?? preset.position;
  const custom = spec.color.startsWith("#") ? spec.color : null;
  return (
    <>
      <Header eyebrow="Texto" title={preset.label} onClose={onClose} />
      <div className="flex flex-col gap-3 p-4">
        {seg ? (
          <p className="font-mono text-[11px] text-muted tabular-nums">
            {timeLabel(seg.start)} – {timeLabel(seg.end)} · {secondsLabel(seg.end - seg.start)}
          </p>
        ) : (
          <p className="text-xs text-warning">Cae sobre palabras cortadas: no se ve en el video.</p>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">Tu texto</span>
          <Textarea
            rows={2}
            maxLength={TEXT_MAX}
            disabled={!edit}
            value={d.text}
            className="!py-2 !text-sm"
            onChange={(e) => {
              setDraft({ ...d, text: e.target.value });
              if (e.target.value.trim()) set({ text: e.target.value });
            }}
            onBlur={() => setDraft(null)}
          />
        </label>
        {preset.subLabel && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted">{preset.subLabel}</span>
            <Input
              maxLength={40}
              disabled={!edit}
              value={d.sub}
              className="!py-2 !text-sm"
              onChange={(e) => {
                setDraft({ ...d, sub: e.target.value });
                set({ sub: e.target.value.trim() || undefined });
              }}
              onBlur={() => setDraft(null)}
            />
          </label>
        )}
        {preset.emphasis && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted">{spec.preset === "strike" ? "Palabras tachadas" : "Palabras resaltadas"}</span>
            <Input
              maxLength={80}
              disabled={!edit}
              value={d.emphasis}
              placeholder={spec.preset === "quote" ? "Ninguna" : `Si lo dejas vacío: «${defaultEmphasis(spec.text)}»`}
              className="!py-2 !text-sm"
              onChange={(e) => {
                setDraft({ ...d, emphasis: e.target.value });
                set({ emphasis: e.target.value.trim() || undefined });
              }}
              onBlur={() => setDraft(null)}
            />
          </label>
        )}
        <LayerButtons api={api} sel={sel} />
        {edit && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" icon={<SplitSquareHorizontal className="h-3.5 w-3.5" aria-hidden />} onClick={api.actions.split} title="Dividir en el cabezal (S)">
              Dividir
            </Button>
            <Button size="sm" variant="subtle" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={api.actions.removeSelection} title="Quitar (Supr)">
              Quitar
            </Button>
          </div>
        )}
      </div>
      {edit && (
        <Group title="Estilo, color, tamaño y lugar" icon={<PenLine className="h-4 w-4" aria-hidden />}>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Estilo del texto">
            {TEXT_PRESET_KEYS.map((k) => (
              <Chip key={k} on={spec.preset === k} onClick={() => set({ preset: k, ...(TEXT_PRESETS[k].subLabel && !spec.sub && TEXT_PRESETS[k].sub ? { sub: TEXT_PRESETS[k].sub } : {}) })}>
                {TEXT_PRESETS[k].label}
              </Chip>
            ))}
          </div>
          <p className="text-xs text-muted">{preset.hint}</p>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted">Color</span>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Color del texto">
              {TEXT_COLOR_SWATCHES.map((c) => (
                <Chip key={c} on={spec.color === c} onClick={() => set({ color: c })}>
                  <span className="flex items-center gap-1.5">
                    {c !== "auto" && <span aria-hidden className="h-3 w-3 rounded-full border border-white/20" style={{ background: c === "brand" ? props.graphicLook.theme.accent : c === "white" ? "#ffffff" : "#111111" }} />}
                    {TEXT_COLOR_LABELS[c]}
                  </span>
                </Chip>
              ))}
              <label className={cn("flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold", custom ? "border-white bg-white text-paper" : "border-white/10 text-text hover:border-white/30")}>
                <input type="color" value={custom ?? props.graphicLook.theme.accent} onChange={(e) => set({ color: e.target.value })} className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0" aria-label="Elegir un color propio" />
                Otro color
              </label>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted">Tamaño</span>
            <div className="flex gap-1.5" role="group" aria-label="Tamaño del texto">
              {TEXT_SIZES.map((sz) => (
                <Chip key={sz} on={spec.size === sz} onClick={() => set({ size: sz })}>
                  {TEXT_SIZE_LABELS[sz]}
                </Chip>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted">Lugar</span>
            <div className="flex gap-1.5" role="group" aria-label="Lugar del texto">
              {TEXT_POSITIONS.map((p) => (
                <Chip key={p} on={position === p} onClick={() => set({ position: p })}>
                  {TEXT_POSITION_LABELS[p]}
                </Chip>
              ))}
            </div>
            <p className="text-xs text-muted">Para dejarlo justo donde quieres, arrástralo en el video. Abajo, los subtítulos se ocultan mientras se ve.</p>
          </div>
        </Group>
      )}
      <TransformSlot api={api} sel={sel} />
      <Group title="Tiempo" icon={<Clapperboard className="h-4 w-4" aria-hidden />} defaultOpen={false}>
        <BrollEditBody
          key={id}
          inline
          edit={resolveEdit(item.edit)}
          onChange={(e) => api.actions.setBrollEdit(id, e)}
          onApplyLookToAll={() => api.actions.applyLookToAll(id)}
          otherVideos={0}
          format={state.format}
          media={{ previewUrl: null, thumbUrl: null, width: choice.width, height: choice.height }}
          poster={props.posterUrl}
          accent={props.graphicLook.theme.accent}
          ground={props.graphicLook.theme.bg}
          focusY={props.style?.focusY ?? 0.42}
          span={seg ? { start: seg.start, end: seg.end } : null}
          clipDuration={choice.duration}
          isGraphic
          graphic={choice.graphic ?? null}
          posterFit={state.format === "16:9" && props.sourceHeight > props.sourceWidth * 1.02 ? "contain" : "cover"}
          posterX={api.showFraming ? state.offsetX : 0}
          title={spec.text.slice(0, 70)}
        />
      </Group>
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
        <LayerButtons api={api} sel={sel} />
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
  // Palabras quitadas a mano entre el subtítulo anterior y este (o hasta el final, si es el último).
  const prevLast = api.captions[index - 1]?.words.at(-1)?.id ?? -1;
  const lastId = block.words.at(-1)?.id ?? 0;
  const nextFirst = api.captions[index + 1]?.words[0]?.id ?? Number.MAX_SAFE_INTEGER;
  const hidden = [...api.subsHidden].filter((id) => id > prevLast && id < nextFirst && (id <= lastId || index === api.captions.length - 1)).sort((a, b) => a - b);
  return (
    <>
      <Header eyebrow="Subtítulo" title={`${timeLabel(block.start)} – ${timeLabel(block.end)}`} onClose={onClose} />
      <div className="flex flex-col gap-3 p-4">
        <p className="text-xs text-muted">Cambia cómo se escribe cada palabra en los subtítulos (el audio queda igual). La estrella la resalta con el color de tu marca y la × la quita solo de los subtítulos: el video no se corta.</p>
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
                {props.canEdit && (
                  <button
                    type="button"
                    onClick={() => api.actions.setSubsHidden([w.id], true)}
                    className="grid h-9 w-9 flex-none place-items-center rounded-lg border border-white/10 text-muted transition hover:border-danger/50 hover:text-danger"
                    aria-label={`Quitar «${value}» de los subtítulos`}
                    title="Quitar de los subtítulos (el video no se corta)"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {hidden.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-muted">Quitadas de este subtítulo</p>
            <div className="flex flex-wrap gap-1.5">
              {hidden.map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={!props.canEdit}
                  onClick={() => api.actions.setSubsHidden([id], false)}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-muted line-through decoration-placeholder hover:border-white/30 hover:text-white hover:no-underline"
                  title="Volver a mostrar en los subtítulos"
                >
                  <Undo2 className="h-3 w-3" aria-hidden />
                  {state.corrections[String(id)] ?? props.words[id]?.text ?? ""}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={<Headphones className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.seek(block.start, true)}>
            Escuchar
          </Button>
          {props.canEdit && (
            <Button size="sm" variant="subtle" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={api.actions.removeSelection} title="Quitar este subtítulo (Supr)">
              Quitar este subtítulo
            </Button>
          )}
        </div>
        {props.canEdit && (
          <button
            type="button"
            className="self-start text-xs font-semibold text-muted underline-offset-4 hover:text-white hover:underline"
            onClick={() => {
              api.update((s) => ({ ...s, preset: "ninguno" }));
              api.select(null);
            }}
          >
            Quitar todos los subtítulos del video
          </button>
        )}
        <p className="text-xs text-muted">Para corregir una palabra en todas las veces que aparece, tócala en Transcripción. Un subtítulo quitado deja un tramo rayado en su pista: tócalo para volver a mostrarlo.</p>
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
        <p className="text-xs text-muted">Para cortar o mover solo una parte, pon el cabezal y toca Dividir (C): el tramo queda en partes.</p>
          {api.props.canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" icon={<ArrowLeft className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.movePart(-1)} title="Mayús + Alt + ←">
                Mover antes
              </Button>
              <Button size="sm" variant="ghost" icon={<ArrowRight className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.movePart(1)} title="Mayús + Alt + →">
                Mover después
              </Button>
            </div>
          )}
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

/** Una pausa larga: cuánto dura, si se acorta y el botón para dejarla completa (o volver a acortarla). */
function PauseInspector({ api, word, onClose }: { api: StudioApi; word: number; onClose: () => void }) {
  const pause = api.pauses.find((p) => p.word === word);
  if (!pause) return <Gone onClose={onClose} />;
  const edit = api.props.canEdit;
  const kept = api.timeline.words.find((w) => w.id === word);
  return (
    <>
      <Header eyebrow="Pausa" title={pause.trimmed ? "Pausa acortada" : "Pausa completa"} onClose={onClose}>
        <p className="mt-0.5 text-xs text-muted">Entre «{api.textOf(Math.max(0, word - 4), Math.max(0, word - 1), 40)}» y «{api.textOf(word, word + 3, 40)}».</p>
      </Header>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-text">
          En tu grabación dura <span className="font-semibold text-white">{secondsLabel(pause.gap)}</span>.{" "}
          {pause.trimmed ? "En el video final se acorta para que no quede un silencio largo." : "Queda completa en el video final."}
        </p>
        <div className="flex flex-wrap gap-2">
          {edit && (
            <Button size="sm" variant={pause.trimmed ? "primary" : "ghost"} icon={pause.trimmed ? <Undo2 className="h-3.5 w-3.5" aria-hidden /> : <Scissors className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.setPause(word, pause.trimmed)}>
              {pause.trimmed ? "Dejar la pausa completa" : "Volver a acortarla"}
            </Button>
          )}
          <Button size="sm" variant="subtle" icon={<Headphones className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.seek(Math.max(0, (kept?.start ?? 0) - 2), true)}>
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
  const after = api.timeline.words.find((w) => w.id > to);
  const part = api.state.splits.includes(from) || Boolean(after && api.state.splits.includes(after.id));
  return (
    <>
      <Header eyebrow={part ? "Parte del video" : "Tramo elegido"} title={range ? `${timeLabel(range.start)} – ${timeLabel(range.end)}` : "Tramo"} onClose={onClose} />
      <div className="flex flex-col gap-3 p-4">
        <Spoken text={api.textOf(from, to, 240)} start={range?.start} end={range?.end} />
          {api.props.canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" icon={<ArrowLeft className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.movePart(-1)} title="Mayús + Alt + ←">
                Mover antes
              </Button>
              <Button size="sm" variant="ghost" icon={<ArrowRight className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.movePart(1)} title="Mayús + Alt + →">
                Mover después
              </Button>
            </div>
          )}
        <div className="grid grid-cols-1 gap-2">
          {edit && (
            <Button size="sm" icon={<Scissors className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.cutSpan(span)}>
              {part ? "Quitar esta parte (Supr)" : "Cortar este tramo"}
            </Button>
          )}
          {edit && api.state.splits.includes(from) && (
            <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => (api.update((st) => ({ ...st, splits: st.splits.filter((id) => id !== from) })), api.select(null))}>
              Unir con la parte anterior
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
          {edit && (
            <Button size="sm" variant="ghost" icon={<ZoomIn className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.addZoom(span)}>
              Poner un zoom aquí
            </Button>
          )}
          {edit && FEATURES.clone && (
            <Button size="sm" variant="ghost" icon={<Mic className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.openPhraseFix(span)}>
              Corregir esta frase con tu voz
            </Button>
          )}
          <Button size="sm" variant="subtle" icon={<Headphones className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.listenFrom(from)}>
            Escuchar desde aquí
          </Button>
        </div>
        {edit && <AskAnimation api={api} from={from} to={to} />}
      </div>
    </>
  );
}

/**
 * Una transición: la de un corte (o el lugar para poner una) o una libre, sobre el plano en cualquier instante. Cuál es,
 * cuánto dura y si suena.
 */
function TransitionInspector({ api, word, id, onClose }: { api: StudioApi; word: number; id?: string; onClose: () => void }) {
  const item = (id ? api.state.transitions.find((t) => t.id === id) : api.state.transitions.find((t) => t.at_word === word && t.offset == null)) ?? null;
  const cut = api.cutList.find((c) => c.word === word);
  const seg = item ? api.trSegs.find((t) => t.item.id === item.id) : null;
  const free = Boolean(item && item.offset != null);
  if (id ? !item : !cut) return <Gone onClose={onClose} />;
  const at = seg?.cut ?? cut?.at ?? 0;
  const drawn = Boolean(seg);
  const edit = api.props.canEdit;
  const info = item ? TRANSITION_INFO[item.kind] : null;
  const dur = item?.duration ?? info?.duration ?? 0.5;
  const set = (patch: Parameters<StudioApi["actions"]["setTransition"]>[1]) => api.actions.setTransition(word, patch, item?.id);
  const selNow = { kind: "transition" as const, word, ...(free && item ? { id: item.id } : {}) };
  return (
    <>
      <Header eyebrow={free ? `Transición en ${timeLabel(at)}` : `Corte en ${timeLabel(at)}`} title={info ? info.label : "Sin transición"} onClose={onClose}>
        {free ? (
          <p className="mt-0.5 text-xs text-muted">Sobre el plano, con «{api.textOf(word, word + 3, 40)}».</p>
        ) : (
          <p className="mt-0.5 text-xs text-muted">Entre «{api.textOf(Math.max(0, word - 4), Math.max(0, word - 1), 40)}» y «{api.textOf(word, word + 3, 40)}».</p>
        )}
      </Header>
      <div className="flex flex-col gap-3 p-4">
        {item && item.source === "director" && <AiNote api={api} why={item.why} sel={selNow} />}
        {item && <LayerButtons api={api} sel={selNow} />}
        {item && !drawn && <Notice tone="warning">Esta transición no se ve ahora: arrástrala un poco o vuelve a elegirla para que reemplace lo que la tapa.</Notice>}
        <p className="text-xs text-muted">
          {free ? "Va centrada en ese instante, encima del plano: arrástrala en la pista de efectos para moverla a cualquier punto." : "La transición tapa el corte con imagen: tu voz no se corre ni se pisa."}
        </p>
        <div aria-label="Transiciones" className="grid grid-cols-3 gap-1.5">
          {TRANSITION_GALLERY_ORDER.map((k) => (
            <TransitionTile key={k} kind={k} brand={api.fxBrand} selected={item?.kind === k} onPick={edit ? () => set({ kind: k }) : undefined} />
          ))}
        </div>
        {item && (
          <>
            <label htmlFor="tr-dur" className="flex items-center justify-between text-sm font-semibold text-white">
              Duración <span className="font-mono text-xs text-muted">{secondsLabel(dur)}</span>
            </label>
            <input
              id="tr-dur"
              type="range"
              className="range"
              min={TRANSITION_DURATION.min}
              max={TRANSITION_DURATION.max}
              step={0.05}
              value={dur}
              disabled={!edit}
              onChange={(e) => set({ duration: Number(e.target.value) })}
              style={{ ["--pct" as string]: `${((dur - TRANSITION_DURATION.min) / (TRANSITION_DURATION.max - TRANSITION_DURATION.min)) * 100}%` }}
            />
            {info && info.sound !== "none" && (
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5">
                <span className="flex flex-col">
                  <span className="text-sm text-text">Con su sonido</span>
                  <span className="text-xs text-muted">{SFX_LIBRARY[info.sound as SfxName]?.label ?? "Sonido"} justo en el corte, bajo tu voz.</span>
                </span>
                <input type="checkbox" className="h-4 w-4 flex-none accent-[var(--color-accent)]" checked={item.sound !== false} disabled={!edit} onChange={(e) => set({ sound: e.target.checked })} />
              </label>
            )}
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="subtle" icon={<Headphones className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.seek(Math.max(0, at - 1), true)}>
            {free ? "Verla" : "Ver el corte"}
          </Button>
          {item && edit && (
            <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => set(null)}>
              Quitar la transición
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

/** Un sonido de la pista de Sonido: cuál es, su volumen y dónde cae. */
function SoundInspector({ api, id, onClose }: { api: StudioApi; id: string; onClose: () => void }) {
  const cue = api.state.soundCues.find((c) => c.id === id);
  if (!cue) return <Gone onClose={onClose} />;
  const at = soundCueTimes(api.timeline, [cue])[0]?.hitAt ?? null;
  const edit = api.props.canEdit;
  const lib = SFX_LIBRARY[cue.name];
  const set = (patch: Partial<typeof cue>) => api.update((st) => ({ ...st, soundCues: st.soundCues.map((c) => (c.id === id ? { ...c, ...patch, source: "user" as const } : c)) }), { coalesce: `sound:${id}` });
  return (
    <>
      <Header eyebrow="Sonido" title={lib.label} onClose={onClose}>
        <p className="mt-0.5 text-xs text-muted">{at == null ? "Su palabra se cortó: no suena." : `Suena en ${timeLabel(at)}, con «${api.textOf(cue.at_word, cue.at_word + 2, 30)}».`}</p>
      </Header>
      <div className="flex flex-col gap-3 p-4">
        {cue.source === "director" && <AiNote api={api} why={null} sel={{ kind: "sound", id }} />}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="snd-name" className="text-sm font-semibold text-white">
            Cuál
          </label>
          <select id="snd-name" className="field h-10 rounded-xl !py-0 text-sm" value={cue.name} disabled={!edit} onChange={(e) => set(fitCueClip({ ...cue, name: e.target.value as SfxName }))}>
            {SFX_CATEGORIES.map((c) => (
              <optgroup key={c} label={SFX_CATEGORY_LABELS[c]}>
                {SFX_NAMES.filter((n) => SFX_LIBRARY[n].category === c).map((n) => (
                  <option key={n} value={n}>
                    {SFX_LIBRARY[n].label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <label htmlFor="snd-gain" className="flex items-center justify-between text-sm font-semibold text-white">
          Volumen <span className="font-mono text-xs text-muted">{cue.gain} dB</span>
        </label>
        <input
          id="snd-gain"
          type="range"
          className="range"
          min={SOUND_GAIN.min}
          max={SOUND_GAIN.max}
          step={1}
          value={cue.gain}
          disabled={!edit}
          onChange={(e) => set({ gain: Number(e.target.value) })}
          style={{ ["--pct" as string]: `${((cue.gain - SOUND_GAIN.min) / (SOUND_GAIN.max - SOUND_GAIN.min)) * 100}%` }}
          aria-valuetext={`${cue.gain} decibeles`}
        />
        <p className="text-xs text-muted">Con -14 dB queda bajo tu voz; más alto se nota como golpe.</p>
        <SoundClip api={api} id={id} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="subtle" icon={<Headphones className="h-3.5 w-3.5" aria-hidden />} onClick={() => void playSfx(cue.name, cue.gain)}>
            Escuchar
          </Button>
          {edit && (
            <>
              <Button size="sm" variant="ghost" onClick={() => set({ offset: Math.max(-2, Math.round((cue.offset - 0.1) * 100) / 100) })} aria-label="Adelantar una décima">
                −0,1 s
              </Button>
              <Button size="sm" variant="ghost" onClick={() => set({ offset: Math.min(2, Math.round((cue.offset + 0.1) * 100) / 100) })} aria-label="Atrasar una décima">
                +0,1 s
              </Button>
              <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={api.actions.removeSelection}>
                Quitar
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export function AudioBlock({ api }: { api: StudioApi }) {
  const { state, props } = api;
  return (
    <div className="flex flex-col gap-5">
    <Mixer api={api} />
    <AudioPanel
      studio={state.studio}
      onStudio={(studio) => api.update((s) => ({ ...s, studio }))}
      audioPreview={props.audioPreview ?? null}
      sfx={state.sfx}
      onSfx={(sfx) => api.update((s) => ({ ...s, sfx }))}
      sfxDb={state.sfxDb}
      onSfxDb={(sfxDb) => api.update((s) => ({ ...s, sfxDb }), { coalesce: "sfxDb" })}
      musicId={state.musicGen ? null : state.music.trackId}
      musicDb={state.music.db}
      onMusic={(music) => api.update((s) => ({ ...s, music, musicGen: music.trackId ? null : s.musicGen }), { coalesce: "music" })}
      tracks={props.tracks ?? []}
      canEdit={props.canEdit}
    />
    </div>
  );
}

/** Un marcador: su nota (la lee Claude: «en el marcador 2 pon…»), dónde está y quitarlo. */
function MarkerInspector({ api, id, onClose }: { api: StudioApi; id: string; onClose: () => void }) {
  const placed = api.markers.find((m) => m.marker.id === id);
  const marker = api.state.markers.find((m) => m.id === id);
  if (!marker) return <Gone onClose={onClose} />;
  const edit = api.props.canEdit;
  const set = (note: string) => api.update((st) => ({ ...st, markers: st.markers.map((m) => (m.id === id ? { ...m, note: note.slice(0, MARKER_NOTE_MAX) } : m)) }), { coalesce: `marker:${id}` });
  return (
    <>
      <Header eyebrow="Marcador" title={placed ? `Marcador ${placed.number}` : "Marcador"} onClose={onClose}>
        <p className="mt-0.5 font-mono text-xs text-muted tabular-nums">{placed ? `${timecode(placed.at)} · con «${api.textOf(marker.at_word, marker.at_word + 3, 40)}»` : "Su palabra se cortó: no se ve en el video."}</p>
      </Header>
      <div className="flex flex-col gap-3 p-4">
        <label htmlFor="marker-note" className="text-sm font-semibold text-white">
          Nota
        </label>
        <textarea
          id="marker-note"
          className="field min-h-24 rounded-xl text-sm"
          value={marker.note}
          disabled={!edit}
          maxLength={MARKER_NOTE_MAX}
          placeholder="Por ejemplo: aquí va un gráfico con los 3 pasos."
          onChange={(e) => set(e.target.value)}
          autoFocus={edit && !marker.note}
        />
        <p className="text-xs text-muted">La IA lee tus marcadores: en el chat puedes decir «en el marcador {placed?.number ?? 1} pon una animación» y sabe dónde es.</p>
        <div className="flex flex-wrap gap-2">
          {placed && (
            <Button size="sm" variant="subtle" icon={<Headphones className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.actions.seek(placed.at, true)}>
              Reproducir desde aquí
            </Button>
          )}
          {edit && (
            <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={api.actions.removeSelection}>
              Quitar el marcador
            </Button>
          )}
        </div>
      </div>
    </>
  );
}


/** Recorte y fundidos de un sonido (también se cambian arrastrando sus bordes y sus manijas en la línea de tiempo). */
function SoundClip({ api, id }: { api: StudioApi; id: string }) {
  const cue = api.state.soundCues.find((c) => c.id === id);
  if (!cue) return null;
  const edit = api.props.canEdit;
  const dur = SFX_LIBRARY[cue.name].duration;
  const clip = cueClip(cue);
  const set = (patch: Partial<SoundCue>) => api.update((st) => ({ ...st, soundCues: st.soundCues.map((c) => (c.id === id ? fitCueClip({ ...c, ...patch, source: "user" as const }) : c)) }), { coalesce: `soundclip:${id}` });
  const field = (label: string, key: "fade_in" | "fade_out", max: number) => (
    <label className="flex flex-col gap-1 text-[11px] text-muted">
      {label}
      <span className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={Math.max(0, Math.round(max * 100) / 100)}
          step={0.05}
          className="field h-8 w-full rounded-lg !py-0 text-sm tabular-nums"
          value={cue[key] ?? 0}
          disabled={!edit}
          onChange={(e) => set({ [key]: Math.max(0, Number(e.target.value) || 0) })}
        />
        <span>s</span>
      </span>
    </label>
  );
  const trimmed = (cue.trim_in ?? 0) > 0 || (cue.trim_out ?? 0) > 0;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/10 p-3">
      <p className="flex items-center justify-between text-sm font-semibold text-white">
        Recorte y fundidos
        <span className="font-mono text-xs font-normal text-muted tabular-nums">
          suena {clip.length.toFixed(2).replace(".", ",")} de {dur.toFixed(2).replace(".", ",")} s
        </span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        {field("Fundido de entrada", "fade_in", clip.length)}
        {field("Fundido de salida", "fade_out", clip.length)}
      </div>
      <p className="text-[11px] text-muted">Arrastra los bordes del sonido en la línea de tiempo para recortarlo, y los puntos de arriba para los fundidos.</p>
      {edit && trimmed && (
        <Button size="sm" variant="ghost" className="self-start" onClick={() => set({ trim_in: 0, trim_out: 0 })}>
          Sin recorte
        </Button>
      )}
    </div>
  );
}
