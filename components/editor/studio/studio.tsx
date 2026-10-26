"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bot, Clapperboard, Copy, Keyboard, Library, Loader2, Minus, PanelLeftClose, PanelLeftOpen, Pause, Play, Plus, Redo2, Scissors, SpellCheck, SplitSquareHorizontal, Trash2, Type, Undo2, Wand2, WandSparkles } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { formatDuration, formatNumber } from "@/lib/format";
import { isDefaultEdit, resolveEdit, type BrollEdit } from "@/lib/video/broll-edit";
import { captionLook, isCaptionStyle } from "@/lib/video/caption-styles";
import { captionBlocks, dropWords, hideDuring, USER_CAPTION_HIDE, userHiddenWords } from "@/lib/video/captions";
import { protectedZones } from "@/lib/video/director/protect";
import { brollSegments, computeZooms, directorZooms, graphicEntries, graphicHidesCaptions } from "@/lib/video/effects";
import { FX_INFO, type FxKind } from "@/lib/video/fx/catalog";
import { compileFx, faceAnchor, fxBrandFromLook, fxCaptionHides, fxSegments, sourceFramesOf, sourceRangesOf } from "@/lib/video/fx/compile";
import { FX_MASK_CHUNK } from "@/lib/video/fx/masks";
import { defaultFx, newFxId, type FxItem } from "@/lib/video/fx/schema";
import { defaultGraphic, type GraphicTemplate } from "@/lib/video/graphics";
import { compileComposition, composCaptionHides, composSegments, composSounds, type Composition } from "@/lib/video/compos/schema";
import { WholeVideoDialog } from "../compos/whole-video-dialog";
import { isActive, requestStage, useComposRequests, type ComposRequest, type LiveRequest } from "../compos/use-compos-work";
import { placeMyEffectAction } from "../my-effects-actions";
import { humanize as humanizeText } from "@/lib/video/human-text";
import { brollGraphicOption, graphicKindLabel, motionTheme, type BrollGraphic } from "@/lib/video/motion-graphics";
import { rangesFromIds } from "@/lib/video/plan";
import { fillRhythm, rhythmScore, themeOfPlan, RHYTHM_TAG, type Density } from "@/lib/video/rhythm";
import { hookEnd, newSoundCueId, SFX_FILES, sfxCues, soundCueTimes, SOUND_GAIN } from "@/lib/video/sfx";
import { isSfxName, SFX_LIBRARY, type SfxName } from "@/lib/video/sfx-library";
import { compileTransition, cutPoints, freeAnchor, isFreeTransition, isTransitionKind, newTransitionId, TRANSITION_INFO, TRANSITION_SOUND_GAIN, transitionSegments, transitionSounds, type TransitionItem } from "@/lib/video/fx/transitions";
import { musicGenLabel } from "@/lib/video/music-gen/catalog";
import { useGeneratedMusic, useStudioSound } from "../sound/use-sound";
import { clipOffsets, cutMarks, replacedLabel, snapToWords, spanAround, splitSpan, timeLabel, wordAt, type SnappedSpan, type WordSpan } from "@/lib/video/studio";
import { layerKey, layerOf, nextLayer, restack, stackIndex, stackSort, type LayerKind } from "@/lib/video/layers";
import { buildTimeline, longPauses, outputRange } from "@/lib/video/timeline";
import { FPS, type BrollItem, type BrollOption, type EditPlan, type RemovalReason, type ZoomMoment } from "@/lib/video/types";
import { cn } from "@/lib/utils";
import { renderAction, saveReviewAction } from "../actions";
import { BrollPicker, optionKey, type PickerTab, type SignedOption } from "../broll-panel";
import { useImages } from "../fx/fx-canvas";
import { FxGallery } from "../fx/fx-panel";
import { fxMasksAction } from "../fx-actions";
import { PhraseFixDialog, PhraseFixPanel, usePhraseFixes } from "../phrase-fix";
import { captionCorrections } from "@/lib/video/phrase-fix";
import { PreviewPlayer, type PreviewHandle } from "../preview-player";
import { proofreadAction } from "../subtitle-actions";
import { TranscriptEditor, type BrollMark } from "../transcript-editor";
import { useCanvasEdits } from "../canvas/use-canvas-edits";
import type { CaptionPlacement } from "@/lib/video/canvas/captions";
import { HumanizeProvider } from "./humanize";
import { StudioInspector } from "./studio-inspector";
import { aiItems, AiPanel, LibraryPanel } from "./studio-panels";
import { EditPanel } from "./edit-panel";
import { StudioTimeline, type DropPreview, type LibraryDrop, type StudioSelection, type TimelineBlock, type TrackKey } from "./studio-timeline";
import { USER_TAG, type StudioApi, type StudioProps } from "./types";
import { studioPacing, studioTimelineInput, toReview, useStudioState, withCut, withPause, type StudioState } from "./use-studio-state";

let brollCounter = 0;
const newBrollId = () => `u${Date.now().toString(36)}${(brollCounter++).toString(36)}`;
const stripTag = (why: string | undefined) => (why ?? "").replace(RHYTHM_TAG, "").replace(USER_TAG, "").trim();
type LeftTab = "edicion" | "texto" | "ia" | "biblioteca";

/** ¿El foco está en un campo donde se escribe? (ahí los atajos no se disparan). */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !["checkbox", "radio", "range", "button"].includes((target as HTMLInputElement).type);
  return false;
}

/**
 * El Estudio: la revisión del Editor de video como un editor de verdad. Vista previa grande al centro, línea de tiempo
 * editable abajo (pistas de video, subtítulos, gráficos y b-roll, efectos, zooms y sonido), inspector de lo elegido a
 * la derecha y, a la izquierda, la transcripción, la IA y la biblioteca. Todo el estado vive en `useStudioState` (con
 * deshacer y rehacer) y se guarda solo, con la misma forma de revisión de siempre.
 */
export function Studio(props: StudioProps) {
  const { projectId, plan, words, duration, sourceWidth, sourceHeight, proxyUrl, posterUrl, accent, canEdit, signedBroll = {}, style = null, graphicLook, tracks = [], director = null, fxContext = null, rhythmFx = [] } = props;
  const router = useRouter();
  const preview = useRef<PreviewHandle>(null);
  const stage = useRef<HTMLDivElement>(null);
  const { state: s, removedSet, update, undo, redo, canUndo, canRedo } = useStudioState(plan, words.length);
  const [signed, setSigned] = useState<Record<string, SignedOption>>(signedBroll);
  const [rawSelection, setSelection] = useState<StudioSelection | null>(null);
  const [outTime, setOutTime] = useState(0);
  const outRef = useRef(0);
  const [activeTime, setActiveTime] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [leftTab, setLeftTab] = useState<LeftTab>("edicion");
  const [leftOpen, setLeftOpen] = useState(true);
  const [picking, setPicking] = useState<{ id: string; tab?: PickerTab; ask?: boolean; prompt?: string } | null>(null);
  const [gallery, setGallery] = useState<{ range: WordSpan | null; replace: string | null } | null>(null);
  const [fixRange, setFixRange] = useState<WordSpan | null>(null);
  const [help, setHelp] = useState(false);
  const [wholeOpen, setWholeOpen] = useState(false);
  const [wholeNotes, setWholeNotes] = useState("");
  const [rendering, startRender] = useTransition();
  const [proofreading, startProofread] = useTransition();
  const phrase = usePhraseFixes(projectId);
  const captionStyle = style?.captions ?? null;
  const trackIds = useMemo(() => tracks.map((t) => t.id), [tracks]);
  // Al aceptar un b-roll de la IA su id cambia (queda como tuyo); deshacer lo vuelve atrás: la selección lo sigue.
  const selection = useMemo<StudioSelection | null>(() => {
    if (rawSelection?.kind !== "broll" || s.broll.some((b) => b.id === rawSelection.id)) return rawSelection;
    const alt = s.broll.find((b) => b.id === `u${rawSelection.id}`.slice(0, 40) || `u${b.id}`.slice(0, 40) === rawSelection.id);
    return alt ? { kind: "broll", id: alt.id } : rawSelection;
  }, [rawSelection, s.broll]);

  useEffect(() => {
    outRef.current = outTime;
  }, [outTime]);

  // La pantalla del Estudio ocupa toda la ventana: la página de atrás no se desplaza mientras está abierto.
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = prev;
    };
  }, []);

  // ─── Lo que se calcula del estado (lo mismo que arma el render) ───
  const proposed = useMemo(() => {
    const set = new Set<number>();
    for (const r of plan.proposed_removals) for (let id = r.from_word; id <= r.to_word; id++) set.add(id);
    return set;
  }, [plan.proposed_removals]);
  const reasons = useMemo(() => {
    const map = new Map<number, RemovalReason>();
    for (const r of [...plan.proposed_removals, ...plan.removals]) for (let id = r.from_word; id <= r.to_word; id++) if (!map.has(id) || r.source === "user") map.set(id, r.reason);
    return map;
  }, [plan.proposed_removals, plan.removals]);
  const offScript = useMemo(() => new Set(plan.off_script), [plan.off_script]);

  const review = useMemo(() => toReview(s, { plan, hasStyle: Boolean(style), trackIds }), [s, plan, style, trackIds]);

  const { removed: sRemoved, selectedHook: sHook, corrections: sCorrections, preset: sPreset, emphasis: sEmphasis, pacing: sPacing, pauses: sPauses, moves: sMoves } = s;
  const timeline = useMemo(
    () => buildTimeline(words, studioTimelineInput(plan, { removed: sRemoved, selectedHook: sHook, corrections: sCorrections, preset: sPreset, emphasis: sEmphasis, pacing: sPacing, pauses: sPauses, moves: sMoves }), duration),
    [words, plan, sRemoved, sHook, sCorrections, sPreset, sEmphasis, sPacing, sPauses, sMoves, duration],
  );
  // Pausas largas entre palabras que quedan: las que se recortan y las que dejaste completas.
  const pauseList = useMemo(() => longPauses(words, { removals: rangesFromIds(sRemoved, plan.removals), pacing: studioPacing({ pacing: sPacing, pauses: sPauses }) }), [words, sRemoved, plan.removals, sPacing, sPauses]);
  const trimmedPauses = useMemo(() => pauseList.filter((p) => p.trimmed), [pauseList]);
  const fxSegs = useMemo(() => fxSegments(timeline, s.effects), [timeline, s.effects]);
  // Animaciones a medida: en su tramo mandan sobre los efectos y el b-roll (igual que en el render).
  const composSegs = useMemo(() => composSegments(timeline, s.compositions), [timeline, s.compositions]);
  // Tramos sin subtítulos (quitados por la persona o por el director), con su índice para poder volver a mostrarlos.
  const captionHides = useMemo(
    () =>
      s.captionHide
        .map((h, index) => {
          const r = outputRange(timeline, h.from_word, h.to_word);
          return r ? { ...r, index } : null;
        })
        .filter((r): r is { start: number; end: number; index: number } => Boolean(r)),
    [s.captionHide, timeline],
  );
  const hiddenCaptions = useMemo(() => captionHides.map(({ start, end }) => ({ start, end })), [captionHides]);
  // Lo que quitó la persona sale palabra por palabra (el bloque sigue en su lugar); lo que ocultó el director, por tramos.
  const subsHidden = useMemo(() => userHiddenWords(s.captionHide), [s.captionHide]);
  const directorHidden = useMemo(() => captionHides.filter((h) => s.captionHide[h.index]?.why !== USER_CAPTION_HIDE).map(({ start, end }) => ({ start, end })), [captionHides, s.captionHide]);
  // Sin subtítulos donde el director los ocultó ni durante los efectos que llevan los suyos, igual que en el render.
  const captions = useMemo(
    () => (s.preset === "ninguno" ? [] : hideDuring(dropWords(captionBlocks(timeline.words, s.preset, captionStyle), subsHidden), [...directorHidden, ...fxCaptionHides(fxSegs), ...composCaptionHides(composSegs)])),
    [timeline, s.preset, captionStyle, subsHidden, directorHidden, fxSegs, composSegs],
  );
  /** Quita palabras de los subtítulos (o las vuelve a mostrar) sin cortar el video. */
  const setSubsHidden = useCallback(
    (ids: number[], hidden: boolean) =>
      update((st) => {
        const set = userHiddenWords(st.captionHide);
        for (const id of ids) {
          if (hidden) set.add(id);
          else set.delete(id);
        }
        // Tramos seguidos, como los guarda el plan (los del director quedan igual).
        const sorted = [...set].sort((a, b) => a - b);
        const runs: { from_word: number; to_word: number; why: string }[] = [];
        for (const id of sorted) {
          const last = runs[runs.length - 1];
          if (last && id === last.to_word + 1) last.to_word = id;
          else runs.push({ from_word: id, to_word: id, why: USER_CAPTION_HIDE });
        }
        return { ...st, captionHide: [...st.captionHide.filter((h) => h.why !== USER_CAPTION_HIDE), ...runs] };
      }),
    [update],
  );
  const capLook = useMemo(() => (isCaptionStyle(s.preset) ? captionLook(s.preset, { format: s.format, accent, brandFont: graphicLook.font, emoji: s.emoji }) : null), [s.preset, s.format, accent, graphicLook.font, s.emoji]);
  const segments = useMemo(() => brollSegments(timeline, s.broll), [timeline, s.broll]);
  // Transiciones: cada una en su instante y en su capa, encima de lo que haya (lib/video/layers.ts).
  const trSegs = useMemo(() => transitionSegments(timeline, s.transitions), [timeline, s.transitions]);
  // Todo lo visual que se superpone, con su capa: el orden de dibujo es el mismo en la vista previa y en el render.
  const visualStack = useMemo(
    () => [
      ...segments.map((b) => ({ key: layerKey("broll", b.id), kind: "broll" as const, layer: b.layer, start: b.start, end: b.end, label: b.option.source === "graphic" ? (b.option.title ?? "Gráfico") : b.option.source === "library" ? (b.option.title ?? "Tu clip") : "B-roll" })),
      ...fxSegs.map((f) => ({ key: layerKey("fx", f.id), kind: "fx" as const, layer: f.layer, start: f.start, end: f.end, label: FX_INFO[f.item.kind].label })),
      ...composSegs.map((c) => ({ key: layerKey("compos", c.id), kind: "compos" as const, layer: c.layer, start: c.start, end: c.end, label: c.item.name })),
      ...trSegs.map((t) => ({ key: layerKey("transition", t.item.id), kind: "transition" as const, layer: t.layer, start: t.start, end: t.end, label: TRANSITION_INFO[t.item.kind].label })),
    ],
    [segments, fxSegs, composSegs, trSegs],
  );
  const stackOrder = useMemo(() => stackIndex(visualStack), [visualStack]);
  const previewOrder = useMemo(() => Object.fromEntries(stackOrder), [stackOrder]);
  const cutList = useMemo(() => cutPoints(timeline), [timeline]);
  const styleZooms = Boolean(style && style.zoom.enabled && s.zoomsOn);
  const zooms = useMemo(() => {
    const avoid = [...segments, ...fxSegs, ...trSegs, ...composSegs];
    return style && style.zoom.enabled && s.zoomsOn ? computeZooms(timeline, style.zoom, { emphasis: s.emphasis, avoid }) : directorZooms(timeline, s.zoomMoments, avoid);
  }, [style, s.zoomsOn, timeline, s.emphasis, s.zoomMoments, segments, fxSegs, trSegs, composSegs]);
  const entries = useMemo(() => graphicEntries(segments), [segments]);
  const rhythm = useMemo(() => rhythmScore({ timeline, broll: segments, zooms, effects: fxSegs.map((f) => ({ start: f.start, end: f.end, kind: f.item.kind })), entries, density: s.density }), [timeline, segments, zooms, fxSegs, entries, s.density]);
  const sfxMarks = useMemo(
    () =>
      sfxCues({
        level: s.sfx,
        duration: timeline.duration,
        broll: segments,
        hookEnd: hookEnd(timeline),
        entries: [...entries, ...fxSegs.map((f) => f.start)],
        punches: zooms.filter((z) => z.kind === "punch").map((z) => z.start),
        dense: s.density === "reels",
        // Igual que el render: los de la pista de Sonido, siempre; los de transiciones y animaciones, con techo.
        manual: soundCueTimes(timeline, s.soundCues).map(({ cue, hitAt }) => ({ name: cue.name, hitAt, gain: cue.gain })),
        extras: [
          ...transitionSounds(trSegs).filter((x) => isSfxName(x.name)).map((x) => ({ name: x.name as SfxName, hitAt: x.hitAt, gain: TRANSITION_SOUND_GAIN })),
          ...composSounds(composSegs).map((x) => ({ name: x.name, hitAt: x.hitAt, gain: x.gain })),
        ],
        volumeDb: s.sfxDb,
        speech: timeline.words.map((w) => ({ start: w.start, end: w.end })),
      }),
    [s.sfx, timeline, segments, entries, fxSegs, zooms, s.density, s.soundCues, trSegs, composSegs, s.sfxDb],
  );
  const fxBrand = useMemo(() => fxBrandFromLook(graphicLook), [graphicLook]);
  const thumbs = useMemo(() => fxContext?.thumbs ?? [], [fxContext]);
  const fxSpecs = useMemo(
    () =>
      fxSegs.map((segment) => {
        const face = faceAnchor(fxContext?.faces ?? [], sourceRangesOf(timeline, segment.start, segment.end), sourceWidth, sourceHeight, s.format, s.offsetX);
        return compileFx({ segment, timeline, format: s.format, brand: fxBrand, face, thumbs: thumbs.length, cards: thumbs.map((t) => t.title) });
      }),
    [fxSegs, fxContext, timeline, sourceWidth, sourceHeight, s.format, s.offsetX, fxBrand, thumbs],
  );
  const composSpecs = useMemo(
    () =>
      composSegs.map((seg) => {
        const face = faceAnchor(fxContext?.faces ?? [], sourceRangesOf(timeline, seg.start, seg.end), sourceWidth, sourceHeight, s.format, s.offsetX);
        return compileComposition({ item: seg.item, start: seg.start, end: seg.end, timeline, format: s.format, brand: fxBrand, face, captionsVisible: s.preset !== "ninguno", thumbs });
      }),
    [composSegs, fxContext, timeline, sourceWidth, sourceHeight, s.format, s.offsetX, fxBrand, s.preset, thumbs],
  );
  // Las transiciones se dibujan con el mismo motor que los efectos (la vista previa toma el spec del instante). Las
  // animaciones van primero: en su tramo mandan (la vista previa dibuja la primera que coincide).
  // El recorte de la persona para la vista previa: lo calcula el worker por segundos; lo que falta se pide y se consulta.
  const [masks, setMasks] = useState(fxContext?.masks ?? null);
  const maskMissing = useMemo(() => {
    const ready = new Set(Object.keys(masks?.urls ?? {}).map(Number));
    const out = new Set<string>();
    // Los efectos con recorte y las animaciones que dibujan a la persona (detrás, su silueta o "salir del marco").
    for (const spec of [...fxSpecs, ...composSpecs]) {
      if (!spec.mask) continue;
      const frames = sourceFramesOf(timeline, spec.start, Math.max(1, Math.round(spec.duration * 30)));
      if (frames.some((f) => !ready.has(Math.floor(f / FX_MASK_CHUNK)))) out.add(spec.id);
    }
    return out;
  }, [fxSpecs, composSpecs, masks, timeline]);
  const previewSpecs = useMemo(() => {
    const tr = trSegs.map((segment) => compileTransition({ segment, format: s.format, brand: fxBrand, face: faceAnchor(fxContext?.faces ?? [], sourceRangesOf(timeline, segment.start, segment.end), sourceWidth, sourceHeight, s.format, s.offsetX) }));
    // Una animación sin su recorte todavía lo sabe (env.mask.ready) y dibuja su respaldo; cuando llega, se vuelve a dibujar.
    const comps = composSpecs.map((sp) => (sp.mask && maskMissing.has(sp.id) && sp.compos ? { ...sp, compos: { ...sp.compos, env: { ...sp.compos.env, maskReady: false } } } : sp));
    return [...comps, ...[...fxSpecs, ...tr].sort((a, b) => a.start - b.start)];
  }, [composSpecs, fxSpecs, trSegs, s.format, fxBrand, fxContext, timeline, sourceWidth, sourceHeight, s.offsetX, maskMissing]);
  // Imágenes generadas de las animaciones (las del plan y las que llegan de un pedido).
  const [composImageUrls, setComposImageUrls] = useState<Record<string, string>>(() => fxContext?.composImages ?? {});
  const fxImages = useImages(useMemo(() => ({ ...Object.fromEntries(thumbs.map((t, i) => [`t${i}`, t.url])), ...composImageUrls }), [thumbs, composImageUrls]));
  const stripImgs = useImages(useMemo(() => Object.fromEntries(Object.entries(masks?.urls ?? {})), [masks]));
  const fxStrips = useMemo(() => Object.fromEntries(Object.entries(stripImgs).map(([k, v]) => [Number(k), v])) as Record<number, HTMLImageElement | undefined>, [stripImgs]);
  const signedOf = useCallback((o: BrollItem["choice"]) => (o ? (signed[optionKey(o)] ?? { ...o, thumbUrl: o.thumb ?? null, previewUrl: o.preview ?? null }) : null), [signed]);
  const previewBroll = useMemo(
    () =>
      segments.map((sg) => ({
        id: sg.id,
        start: sg.start,
        end: sg.end,
        previewUrl: signedOf(sg.option)?.previewUrl ?? null,
        thumbUrl: signedOf(sg.option)?.thumbUrl ?? null,
        graphic: sg.option.graphic ?? null,
        edit: sg.edit,
        width: sg.option.width,
        height: sg.option.height,
      })),
    [segments, signedOf],
  );
  const brollMarks = useMemo<BrollMark[]>(() => s.broll.map((b) => ({ id: b.id, from: b.from_word, to: b.to_word, thumbUrl: signedOf(b.choice)?.thumbUrl ?? null, empty: !b.choice, graphic: b.choice?.source === "graphic" })), [s.broll, signedOf]);
  const landscape = sourceWidth > sourceHeight * 1.02;
  const showFraming = s.format === "9:16" && landscape;
  const textOf = useCallback((from: number, to: number, max = 80) => {
    const t = words
      .slice(Math.max(0, from), Math.min(words.length, to + 1))
      .map((w) => s.corrections[String(w.id)] ?? w.text)
      .join(" ");
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
  }, [words, s.corrections]);
  const humanize = useCallback(
    (text: string | null | undefined) => humanizeText(text, { words, corrections: s.corrections, timed: timeline.words, broll: s.broll, shots: director?.state.map?.shots }),
    [words, s.corrections, timeline.words, s.broll, director],
  );

  // ─── Reproducción ───
  const videoEl = useCallback(() => preview.current?.video() ?? null, []);
  useEffect(() => {
    const v = videoEl();
    if (!v) return;
    const on = () => setPlaying(true);
    const off = () => {
      setPlaying(false);
      v.playbackRate = 1;
    };
    v.addEventListener("play", on);
    v.addEventListener("pause", off);
    return () => {
      v.removeEventListener("play", on);
      v.removeEventListener("pause", off);
    };
  }, [videoEl, proxyUrl]);
  const seek = useCallback((t: number, play = false) => {
    const clamped = Math.max(0, Math.min(t, Math.max(0, timeline.duration - 0.02)));
    preview.current?.seekOutput(clamped, play);
    setOutTime(clamped);
  }, [timeline.duration]);
  const togglePlay = useCallback(() => {
    const v = videoEl();
    if (!v) return;
    if (v.paused) seek(outRef.current >= timeline.duration - 0.05 ? 0 : outRef.current, true);
    else v.pause();
  }, [videoEl, seek, timeline.duration]);
  const listenFrom = useCallback((id: number) => {
    const w = timeline.words.find((x) => x.id >= id);
    seek(w ? w.start : 0, true);
  }, [timeline.words, seek]);

  // "Escuchar" un gancho: primero se elige (pasa al principio) y, cuando el timeline cambia, se reproduce desde 0.
  const listenAfterChange = useRef(false);
  useEffect(() => {
    if (!listenAfterChange.current) return;
    listenAfterChange.current = false;
    preview.current?.seekOutput(0, true);
  }, [timeline]);
  function listenHook(i: number) {
    if (canEdit && s.selectedHook !== i) {
      listenAfterChange.current = true;
      update((st) => ({ ...st, selectedHook: i }));
    } else seek(0, true);
  }

  // ─── Lienzo (components/editor/canvas): mover, agrandar, animar y editar textos sobre la vista previa ───
  // Sus cambios pasan por el mismo estado con historial: un arrastre seguido cuenta como un solo paso de deshacer.
  const canvasStep = useRef("canvas");
  const setCanvasBroll = useCallback((a: SetStateAction<BrollItem[]>) => update((st) => ({ ...st, broll: typeof a === "function" ? a(st.broll) : a }), { coalesce: canvasStep.current }), [update]);
  const setCanvasFx = useCallback((a: SetStateAction<FxItem[]>) => update((st) => ({ ...st, effects: typeof a === "function" ? a(st.effects) : a }), { coalesce: canvasStep.current }), [update]);
  const setCanvasCorrections = useCallback((a: SetStateAction<Record<string, string>>) => update((st) => ({ ...st, corrections: typeof a === "function" ? a(st.corrections) : a }), { coalesce: canvasStep.current }), [update]);
  const setCanvasPlace = useCallback((a: SetStateAction<CaptionPlacement>) => update((st) => ({ ...st, captionPlace: typeof a === "function" ? a(st.captionPlace) : a }), { coalesce: canvasStep.current }), [update]);
  // Selección unificada: lo elegido en la línea de tiempo es lo elegido en el lienzo, y al revés.
  const canvasSelected = useMemo(() => {
    if (selection?.kind === "broll") return s.broll.find((b) => b.id === selection.id)?.choice?.source === "graphic" ? `graphic:${selection.id}` : null;
    if (selection?.kind === "fx") return `effect:${selection.id}`;
    if (selection?.kind === "caption") {
      const first = captions[selection.index]?.words[0];
      return first ? `caption:${first.id}` : null;
    }
    return null;
  }, [selection, s.broll, captions]);
  const captionsRef = useRef(captions);
  useEffect(() => {
    captionsRef.current = captions;
  }, [captions]);
  const onCanvasSelected = useCallback((id: string | null) => {
    if (!id) return setSelection(null);
    const [kind, key] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
    if (kind === "graphic") setSelection({ kind: "broll", id: key });
    else if (kind === "effect") setSelection({ kind: "fx", id: key });
    else if (kind === "caption") {
      const index = captionsRef.current.findIndex((b) => String(b.words[0]?.id) === key);
      if (index >= 0) setSelection({ kind: "caption", index });
    }
  }, []);
  canvasStep.current = `canvas:${canvasSelected ?? ""}`;
  const canvasEdits = useCanvasEdits({
    canEdit,
    captions: plan.captions,
    brollItems: s.broll,
    setBrollItems: setCanvasBroll,
    fxItems: s.effects,
    setFxItems: setCanvasFx,
    setCorrections: setCanvasCorrections,
    wordCount: words.length,
    place: s.captionPlace,
    onPlace: setCanvasPlace,
    selected: canvasSelected,
    onSelected: onCanvasSelected,
  });

  // ─── Selección ───
  const select = useCallback(
    (sel: StudioSelection | null, opts: { seek?: boolean } = {}) => {
      setSelection(sel);
      if (!sel || opts.seek === false) return;
      const v = videoEl();
      const playingNow = v ? !v.paused : false;
      let at: number | null = null;
      if (sel.kind === "broll") at = segments.find((x) => x.id === sel.id)?.start ?? null;
      else if (sel.kind === "fx") at = fxSegs.find((x) => x.id === sel.id)?.start ?? null;
      else if (sel.kind === "compos") at = composSegs.find((x) => x.id === sel.id)?.start ?? null;
      else if (sel.kind === "caption") at = captions[sel.index]?.start ?? null;
      else if (sel.kind === "zoom" && sel.index >= 0) {
        const m = s.zoomMoments[sel.index];
        at = m ? (outputRange(timeline, m.from_word, m.to_word)?.start ?? null) : null;
      } else if (sel.kind === "range") at = outputRange(timeline, sel.from, sel.to)?.start ?? null;
      else if (sel.kind === "transition") {
        // Un poco antes del corte (o del instante de una libre), para verla entrar.
        const seg = sel.id ? trSegs.find((x) => x.item.id === sel.id) : null;
        const c = seg ? { at: seg.cut } : cutList.find((x) => x.word === sel.word);
        at = c ? Math.max(0, c.at - 0.8) : null;
      } else if (sel.kind === "sound") {
        const cue = s.soundCues.find((x) => x.id === sel.id);
        const hit = cue ? soundCueTimes(timeline, [cue])[0]?.hitAt : undefined;
        at = hit != null ? Math.max(0, hit - 0.6) : null;
      }
      // Tocar un subtítulo lleva siempre a su segundo (si se estaba reproduciendo, sigue desde ahí).
      if (at != null && (!playingNow || sel.kind === "caption")) seek(at, playingNow);
    },
    [videoEl, segments, fxSegs, composSegs, captions, s.zoomMoments, timeline, seek, cutList, s.soundCues, trSegs],
  );

  // ─── Acciones ───
  const cut = useCallback((ids: number[], on: boolean) => update((st) => withCut(st, ids, on)), [update]);
  const pauseWords = useMemo(() => pauseList.map((p) => p.word), [pauseList]);
  /** Deja completa (o vuelve a acortar) la pausa que va antes de la palabra `word`. */
  const setPause = useCallback((word: number, keep: boolean) => update((st) => withPause(st, word, keep, pauseWords)), [update, pauseWords]);
  /** "Sin recortes automáticos": el video como se grabó (todas las palabras y las pausas completas). */
  const restoreAll = useCallback(() => {
    update((st) => ({ ...st, removed: [], pauses: { keep: [], all: true } }));
    setSelection(null);
    toast.success("Sin recortes: el video queda como lo grabaste.", { description: "Vuelve a la propuesta o deshaz (Ctrl+Z) cuando quieras." });
  }, [update]);
  /** Todas las pausas completas (las palabras cortadas siguen cortadas). */
  const restorePauses = useCallback(() => update((st) => ({ ...st, pauses: { keep: [], all: true } })), [update]);
  /** Vuelve a la propuesta: los cortes que armó el editor y las pausas recortadas. */
  const backToProposal = useCallback(() => {
    update((st) => ({ ...st, removed: [...proposed].sort((a, b) => a - b), pauses: { keep: [], all: false } }));
    setSelection(null);
  }, [update, proposed]);

  function cutSpan(span: WordSpan) {
    const ids = Array.from({ length: span.to - span.from + 1 }, (_, k) => span.from + k);
    update((st) => withCut(st, ids, true));
    setSelection(null);
    toast.success("Tramo cortado.", { description: "Deshazlo con Ctrl+Z o restáuralo tocando la marca roja en la pista de video." });
  }

  // ─── Capas: lo nuevo se dibuja encima de lo que ya había; nada se recorta ni se quita solo ───

  /** Capa para algo nuevo en [start, end] del video final: una más que lo más alto que se le superpone. */
  function layerOnTop(start: number, end: number, exceptKey?: string): { layer: number | undefined; under: string[] } {
    const hit = visualStack.filter((v) => v.key !== exceptKey && v.start < end - 0.01 && start < v.end - 0.01);
    if (!hit.length) return { layer: undefined, under: [] };
    return { layer: Math.min(999, Math.max(...hit.map(layerOf)) + 1), under: hit.map((h) => h.label) };
  }

  /** Aviso breve y neutro cuando lo nuevo quedó encima de otra cosa (las dos se ven, en capas). */
  function notifyOnTop(under: string[]) {
    if (!under.length) return;
    toast.info(`Agregado encima de ${replacedLabel(under)}`, { duration: 2500 });
  }

  function addBroll(range: WordSpan, ask = false, prompt?: string) {
    const query = words
      .slice(range.from, range.to + 1)
      .map((w) => w.text.replace(/[^\p{L}\p{N}]+/gu, ""))
      .filter((w) => w.length > 3)
      .slice(0, 4);
    const item: BrollItem = { id: newBrollId(), from_word: range.from, to_word: range.to, query_en: query.join(" ").slice(0, 100) || "b-roll", keywords: query.map((w) => w.toLowerCase()), choice: null, options: [] };
    const r = outputRange(timeline, range.from, range.to);
    const top = r ? layerOnTop(r.start, r.end) : { layer: undefined, under: [] };
    if (top.layer != null) item.layer = top.layer;
    update((st) => ({ ...st, broll: [...st.broll, item].sort((a, b) => a.from_word - b.from_word) }));
    notifyOnTop(top.under);
    setSelection({ kind: "broll", id: item.id });
    setPicking({ id: item.id, tab: ask ? "grafico" : undefined, ask, ...(prompt ? { prompt } : {}) });
  }

  /** Un gráfico de plantilla en un tramo (se abre el estudio de gráficos para ajustarlo). */
  function addGraphic(range: WordSpan, template: GraphicTemplate) {
    const option = brollGraphicOption(defaultGraphic(textOf(range.from, range.to, 400), graphicLook, template));
    const item: BrollItem = { id: newBrollId(), from_word: range.from, to_word: range.to, query_en: "", keywords: [], choice: option, options: [option] };
    const r = outputRange(timeline, range.from, range.to);
    const top = r ? layerOnTop(r.start, r.end) : { layer: undefined, under: [] };
    if (top.layer != null) item.layer = top.layer;
    update((st) => ({ ...st, broll: [...st.broll, item].sort((a, b) => a.from_word - b.from_word) }));
    notifyOnTop(top.under);
    setSelection({ kind: "broll", id: item.id });
    if (r) seek(r.start);
    // Se abre el estudio de gráficos con la plantilla para poner los textos (las cifras salen de lo que dices).
    setPicking({ id: item.id, tab: "grafico" });
  }

  /** Un tramo para un efecto: si pasa de lo que puede durar, se acorta a su máximo (en vez de rechazarlo). */
  function fitFxSpan(kind: FxKind, range: WordSpan): WordSpan {
    const r = outputRange(timeline, range.from, range.to);
    const max = FX_INFO[kind].duration.max;
    if (!r || r.end - r.start <= max + 0.25) return range;
    const short = snapToWords(timeline, r.start, r.start + max);
    return short ? { from: short.from, to: short.to } : range;
  }

  function addFx(kind: FxKind, rawRange: WordSpan, replace: string | null) {
    const range = fitFxSpan(kind, rawRange);
    const spoken = words.slice(range.from, range.to + 1).map((w) => ({ id: w.id, text: s.corrections[String(w.id)] ?? w.text }));
    const old = replace ? s.effects.find((e) => e.id === replace) : undefined;
    const item: FxItem = { id: replace ?? newFxId(), kind, from_word: range.from, to_word: range.to, ...defaultFx(kind, spoken), source: "user" };
    // "Cambiar de efecto" deja el nuevo en la misma capa; uno nuevo va encima de lo que se le superpone.
    const seg = fxSegments(timeline, [item])[0];
    const top = old ? { layer: old.layer, under: [] } : seg ? layerOnTop(seg.start, seg.end) : { layer: undefined, under: [] };
    if (top.layer != null) item.layer = top.layer;
    update((st) => ({ ...st, effects: [...st.effects.filter((e) => e.id !== replace), item].sort((a, b) => a.from_word - b.from_word) }));
    notifyOnTop(top.under);
    setSelection({ kind: "fx", id: item.id });
    if (seg) seek(seg.start, true);
  }

  /** Capa de un zoom nuevo: encima de los zooms que se le superponen (con zooms superpuestos manda el de arriba). */
  function zoomLayerOnTop(range: WordSpan, list: ZoomMoment[]): number | undefined {
    const over = list.filter((z) => range.from <= z.to_word && z.from_word <= range.to);
    return over.length ? Math.min(999, Math.max(...over.map(layerOf)) + 1) : undefined;
  }

  function addZoom(range: WordSpan) {
    const layer = zoomLayerOnTop(range, s.zoomMoments);
    const moment: ZoomMoment = { from_word: range.from, to_word: range.to, scale: 1.15, why: `${USER_TAG} lo agregaste en la línea de tiempo.`, ...(layer != null ? { layer } : {}) };
    const next = [...s.zoomMoments, moment].sort((a, b) => a.from_word - b.from_word);
    // Los zooms automáticos del estilo y los tuyos no van juntos: al poner uno tuyo, los del estilo se apagan (Deshacer los vuelve).
    update((st) => ({ ...st, rhythmTouched: true, zoomMoments: next, zoomsOn: styleZooms ? false : st.zoomsOn }));
    if (styleZooms) toast.info("Apagamos los zooms automáticos del estilo para poner el tuyo.", { duration: 6000, action: { label: "Deshacer", onClick: undo } });
    setSelection({ kind: "zoom", index: next.indexOf(moment) });
  }

  function setBrollEdit(id: string, edit: BrollEdit) {
    update(
      (st) => ({
        ...st,
        broll: st.broll.map((b) => {
          if (b.id !== id) return b;
          const next = { ...b };
          if (isDefaultEdit(edit)) delete next.edit;
          else next.edit = edit;
          return next;
        }),
      }),
      { coalesce: `broll-edit:${id}` },
    );
  }

  /** "Aplicar este look a todos": copia filtro, intensidad, opacidad y ajustes a los demás b-roll de video. */
  function applyLookToAll(id: string) {
    const source = s.broll.find((b) => b.id === id);
    if (!source) return;
    const look = resolveEdit(source.edit).look;
    const count = s.broll.filter((b) => b.id !== id && b.choice && b.choice.source !== "graphic").length;
    update((st) => ({
      ...st,
      broll: st.broll.map((b) => {
        if (b.id === id || !b.choice || b.choice.source === "graphic") return b;
        const edit = { ...resolveEdit(b.edit), look };
        const next = { ...b };
        if (isDefaultEdit(edit)) delete next.edit;
        else next.edit = edit;
        return next;
      }),
    }));
    toast.success(count === 1 ? "Look aplicado al otro b-roll." : `Look aplicado a los otros ${formatNumber(count)} b-roll.`);
  }

  function setGraphic(id: string, graphic: BrollGraphic) {
    const option = brollGraphicOption(graphic);
    update((st) => ({ ...st, broll: st.broll.map((b) => (b.id === id ? { ...b, choice: option, options: [option, ...b.options.filter((o) => o.source !== "graphic")].slice(0, 12) } : b)) }), { coalesce: `gfx:${id}` });
  }

  function pickOption(id: string, option: SignedOption | BrollOption) {
    // Al plan va la alternativa sin las URLs firmadas (vencen); esas quedan solo para la vista previa.
    const plain: BrollOption = { ...option };
    delete (plain as Partial<SignedOption>).thumbUrl;
    delete (plain as Partial<SignedOption>).previewUrl;
    if (plain.source !== "graphic" && "previewUrl" in option) setSigned((prev) => ({ ...prev, [optionKey(option)]: option as SignedOption }));
    update((st) => ({
      ...st,
      broll: st.broll.map((b) => {
        if (b.id !== id) return b;
        // Un gráfico editado reemplaza al anterior en las alternativas (queda uno solo por tramo).
        if (plain.source === "graphic") return { ...b, choice: plain, options: [plain, ...b.options.filter((o) => o.source !== "graphic")].slice(0, 12) };
        return { ...b, choice: plain, options: b.options.some((o) => optionKey(o) === optionKey(plain)) ? b.options : [plain, ...b.options].slice(0, 12) };
      }),
    }));
    setSelection({ kind: "broll", id });
  }

  /** Cambia la densidad: lo que agregó el ritmo antes se quita y se vuelve a calcular (punch-ins, gráficos, pausas). */
  function changeDensity(next: Density) {
    if (next === s.density) return;
    const current: EditPlan = {
      ...plan,
      format: s.format,
      removals: rangesFromIds(s.removed, plan.removals),
      selected_hook: s.selectedHook,
      corrections: s.corrections,
      broll: s.broll,
      effects: s.effects,
      zoom_moments: s.zoomMoments,
      ...(studioPacing(s) ? { pacing: studioPacing(s) } : {}),
      captions: { ...plan.captions, preset: s.preset, emphasis_words: s.emphasis },
      moves: s.moves,
      rhythm: { density: s.density, added: s.rhythmLog },
    };
    const theme = themeOfPlan(current) ?? motionTheme(graphicLook);
    const { plan: filled } = fillRhythm(current, { words, duration, density: next, format: s.format, forbidden: protectedZones(director?.state.map ?? null, words).zones, theme, fxAllowed: rhythmFx, replace: true });
    const removed = new Set<number>();
    for (const r of filled.removals) for (let id = r.from_word; id <= r.to_word; id++) removed.add(id);
    update((st) => ({
      ...st,
      density: next,
      broll: filled.broll,
      effects: filled.effects ?? [],
      zoomMoments: filled.zoom_moments ?? [],
      // Las pausas completas van aparte (en `pauses`): aquí solo la tolerancia del ritmo.
      pacing: filled.pacing ? { long_pause: filled.pacing.long_pause } : undefined,
      emphasis: filled.captions.emphasis_words,
      rhythmLog: filled.rhythm?.added ?? [],
      removed: [...removed].sort((a, b) => a - b),
      rhythmTouched: true,
    }));
    setSelection(null);
  }

  /** Acepta lo que puso la IA: queda como tuyo (el ritmo ya no lo recalcula y el director no lo quita). */
  function acceptSel(sel: StudioSelection) {
    update((st) => acceptIn(st, sel));
    toast.success("Listo: queda como lo dejó la IA.");
  }
  function acceptIn(st: StudioState, sel: StudioSelection): StudioState {
    if (sel.kind === "broll") return { ...st, broll: st.broll.map((b) => (b.id === sel.id && !b.id.startsWith("u") ? { ...b, id: `u${b.id}`.slice(0, 40), why: stripTag(b.why) || undefined } : b)) };
    if (sel.kind === "fx") return { ...st, effects: st.effects.map((e) => (e.id === sel.id ? { ...e, source: "user" as const, why: stripTag(e.why) || undefined } : e)) };
    if (sel.kind === "zoom") return { ...st, rhythmTouched: true, zoomMoments: st.zoomMoments.map((z, i) => (i === sel.index ? { ...z, why: `${USER_TAG} ${stripTag(z.why)}`.slice(0, 300) } : z)) };
    if (sel.kind === "transition") return { ...st, transitions: st.transitions.map((t) => ((sel.id ? t.id === sel.id : t.at_word === sel.word && !isFreeTransition(t)) ? { ...t, source: "user" as const } : t)) };
    if (sel.kind === "sound") return { ...st, soundCues: st.soundCues.map((c) => (c.id === sel.id ? { ...c, source: "user" as const } : c)) };
    if (sel.kind === "compos") return { ...st, compositions: st.compositions.map((c) => (c.id === sel.id ? { ...c, source: "user" as const } : c)) };
    return st;
  }
  function acceptAll() {
    const items = aiItems(api);
    if (!items.length) return;
    update((st) => items.reduce((acc, it) => acceptIn(acc, it.sel), st));
    toast.success(items.length === 1 ? "Aceptaste 1 cosa de la IA." : `Aceptaste ${formatNumber(items.length)} cosas de la IA.`);
  }

  function removeSelection() {
    const sel = selection;
    if (!sel || !canEdit) return;
    if (sel.kind === "broll") update((st) => ({ ...st, broll: st.broll.filter((b) => b.id !== sel.id) }));
    else if (sel.kind === "fx") update((st) => ({ ...st, effects: st.effects.filter((e) => e.id !== sel.id) }));
    else if (sel.kind === "compos") update((st) => ({ ...st, compositions: st.compositions.filter((c) => c.id !== sel.id) }));
    else if (sel.kind === "zoom" && sel.index >= 0) update((st) => ({ ...st, rhythmTouched: true, zoomMoments: st.zoomMoments.filter((_, i) => i !== sel.index) }));
    else if (sel.kind === "transition") update((st) => ({ ...st, transitions: st.transitions.filter((t) => !(sel.id ? t.id === sel.id : t.at_word === sel.word && !isFreeTransition(t))) }));
    else if (sel.kind === "sound") update((st) => ({ ...st, soundCues: st.soundCues.filter((c) => c.id !== sel.id) }));
    else if (sel.kind === "caption") {
      const block = captions[sel.index];
      const first = block?.words[0];
      const last = block?.words[block.words.length - 1];
      if (!first || !last) return;
      update((st) => ({ ...st, captionHide: [...st.captionHide, { from_word: first.id, to_word: last.id, why: "Lo quitaste tú." }] }));
      toast.success("Subtítulo quitado. Para volver a mostrarlo, toca el tramo rayado en la pista de subtítulos o deshaz (Cmd+Z).");
    }
    else if (sel.kind === "range") return cutSpan(sel);
    else if (sel.kind === "clip") {
      const clip = timeline.clips[sel.index];
      if (clip) cut(timeline.words.filter((w) => w.id >= clip.firstWord && w.id <= clip.lastWord).map((w) => w.id), true);
    } else return;
    setSelection(null);
  }

  /**
   * Divide el video en el cabezal: la parte nueva empieza en la palabra que suena. Solo el video (subtítulos, b-roll y
   * animaciones quedan igual); después se puede elegir una parte y quitarla con Supr.
   */
  function splitVideo() {
    if (!canEdit) return;
    const t = outRef.current + 0.01;
    const w = wordAt(timeline, t);
    if (!w) return void toast.info("Pon el cabezal sobre el video, donde quieres dividirlo.");
    const clip = timeline.clips.find((c) => w.id >= c.firstWord && w.id <= c.lastWord);
    const first = timeline.words.find((x) => clip && x.id >= clip.firstWord && x.id <= clip.lastWord);
    if (!clip || first?.id === w.id || s.splits.includes(w.id)) return void toast.info("Ahí ya hay un corte. Mueve el cabezal a otra palabra.");
    update((st) => ({ ...st, splits: [...st.splits, w.id].sort((a, b) => a - b) }));
    toast.success("Video dividido.", { description: "Toca una parte en la pista de video y bórrala con Supr si no la quieres." });
  }

  /** Divide lo elegido en el cabezal (la segunda parte empieza en la palabra que suena). */
  function split() {
    const sel = selection;
    if (!canEdit) return;
    if (!sel || !["broll", "fx", "zoom"].includes(sel.kind)) return splitVideo();
    const w = wordAt(timeline, outRef.current + 0.01);
    if (!w) return;
    if (sel.kind === "broll") {
      const item = s.broll.find((b) => b.id === sel.id);
      const parts = item ? splitSpan({ from: item.from_word, to: item.to_word }, w.id) : null;
      if (!item || !parts) return void toast.error("Pon el cabezal dentro del bloque, después de su primera palabra.");
      const edit = resolveEdit(item.edit);
      const a: BrollItem = { ...item, to_word: parts[0].to, edit: isDefaultEdit({ ...edit, end_delta: 0 }) ? undefined : { ...edit, end_delta: 0 } };
      const b: BrollItem = { ...item, id: newBrollId(), from_word: parts[1].from, edit: isDefaultEdit({ ...edit, start_delta: 0 }) ? undefined : { ...edit, start_delta: 0 } };
      if (!a.edit) delete a.edit;
      if (!b.edit) delete b.edit;
      update((st) => ({ ...st, broll: [...st.broll.filter((x) => x.id !== item.id), a, b].sort((x, y) => x.from_word - y.from_word) }));
      setSelection({ kind: "broll", id: b.id });
    } else if (sel.kind === "fx") {
      const item = s.effects.find((e) => e.id === sel.id);
      const parts = item ? splitSpan({ from: item.from_word, to: item.to_word }, w.id) : null;
      if (!item || !parts) return void toast.error("Pon el cabezal dentro del efecto, después de su primera palabra.");
      const min = FX_INFO[item.kind].duration.min;
      const short = parts.some((p) => {
        const r = outputRange(timeline, p.from, p.to);
        return !r || r.end - r.start < min - 0.2;
      });
      if (short) return void toast.error(`«${FX_INFO[item.kind].label}» dura al menos ${String(min).replace(".", ",")} s: cada parte quedaría muy corta.`);
      const a: FxItem = { ...item, to_word: parts[0].to, words: item.words?.filter((x) => x <= parts[0].to) };
      const b: FxItem = { ...item, id: newFxId(), from_word: parts[1].from, words: item.words?.filter((x) => x >= parts[1].from), source: "user" };
      update((st) => ({ ...st, effects: [...st.effects.filter((x) => x.id !== item.id), a, b].sort((x, y) => x.from_word - y.from_word) }));
      setSelection({ kind: "fx", id: b.id });
    } else if (sel.kind === "zoom") {
      const m = s.zoomMoments[sel.index];
      const parts = m ? splitSpan({ from: m.from_word, to: m.to_word }, w.id) : null;
      if (!m || !parts) return void toast.error("Pon el cabezal dentro del zoom, después de su primera palabra.");
      const next = [...s.zoomMoments.filter((_, i) => i !== sel.index), { ...m, to_word: parts[0].to }, { ...m, from_word: parts[1].from }].sort((x, y) => x.from_word - y.from_word);
      update((st) => ({ ...st, rhythmTouched: true, zoomMoments: next }));
      setSelection({ kind: "zoom", index: next.findIndex((z) => z.from_word === parts[1].from) });
    }
  }

  /** Corre lo elegido (b-roll, efecto o zoom) una palabra hacia un lado. */
  function nudge(dir: 1 | -1) {
    const sel = selection;
    if (!canEdit || !sel) return;
    const item = sel.kind === "broll" ? s.broll.find((b) => b.id === sel.id) : sel.kind === "fx" ? s.effects.find((e) => e.id === sel.id) : sel.kind === "zoom" && sel.index >= 0 ? s.zoomMoments[sel.index] : undefined;
    if (!item) return;
    const list = timeline.words;
    const i = list.findIndex((w) => w.id >= item.from_word && w.id <= item.to_word);
    let j = i;
    while (j + 1 < list.length && list[j + 1]!.id <= item.to_word && list[j + 1]!.id > list[j]!.id) j++;
    if (i < 0 || i + dir < 0 || j + dir >= list.length) return;
    const span = snapToWords(timeline, list[i + dir]!.start, list[j + dir]!.end);
    if (span && moveTo(sel, { from: span.from, to: span.to }, "move")) seek(span.start);
  }

  // ─── Línea de tiempo ───
  const blocks = useMemo<TimelineBlock[]>(() => {
    const out: TimelineBlock[] = [];
    const offsets = clipOffsets(timeline);
    const splitSet = new Set(s.splits);
    timeline.clips.forEach((c, i) => {
      const start = offsets[i]!;
      const kept = timeline.words.filter((w) => w.id >= c.firstWord && w.id <= c.lastWord);
      const text = kept.map((w) => w.text).join(" ");
      const clipEnd = start + (c.endFrame - c.startFrame) / FPS;
      // Un tramo dividido («Dividir» o C) se muestra en partes: cada una se elige y se quita por separado.
      const cuts = kept.filter((w, k) => k > 0 && splitSet.has(w.id));
      if (cuts.length) {
        const heads = [kept[0]!, ...cuts];
        heads.forEach((h, k) => {
          const next = heads[k + 1];
          const words = kept.filter((w) => w.id >= h.id && (!next || w.id < next.id));
          const last = words[words.length - 1] ?? h;
          out.push({
            key: `clip${i}:${h.id}`,
            track: "video",
            start: k === 0 ? start : h.start,
            end: next ? next.start : clipEnd,
            label: (c.role === "hook" && k === 0 ? "Gancho · " : "") + (words.map((w) => w.text).join(" ") || "Parte"),
            tone: c.role === "hook" ? "border-accent-hi/60 bg-accent/40 font-normal" : "border-white/15 bg-accent/10 font-normal",
            selection: { kind: "range", from: h.id, to: last.id },
          });
        });
        return;
      }
      out.push({
        key: `clip${i}`,
        track: "video",
        start,
        end: start + (c.endFrame - c.startFrame) / FPS,
        label: c.role === "hook" ? `Gancho · ${text}` : text || "Tramo",
        tone: c.role === "hook" ? "border-accent-hi/60 bg-accent/40 font-normal" : "border-white/15 bg-accent/10 font-normal",
        selection: { kind: "clip", index: i },
      });
    });
    captions.forEach((b, i) =>
      out.push({ key: `cap${i}`, track: "captions", start: b.start, end: b.end, label: b.words.map((w) => w.text).join(" "), tone: "border-white/10 bg-white/[0.09] font-normal text-text", selection: { kind: "caption", index: i } }),
    );
    for (const item of s.broll) {
      const seg = segments.find((x) => x.id === item.id);
      const choice = item.choice;
      const r = seg ?? (!choice ? outputRange(timeline, item.from_word, item.to_word) : null);
      if (!r) continue;
      const graphic = choice?.source === "graphic" && choice.graphic ? choice.graphic : null;
      out.push({
        key: `broll:${item.id}`,
        track: "broll",
        start: r.start,
        end: r.end,
        label: graphic ? (choice?.title ?? graphicKindLabel(graphic)) : choice ? (choice.source === "library" ? (choice.title ?? "Tu clip") : "B-roll") : "Sin clip",
        detail: textOf(item.from_word, item.to_word, 40),
        tone: graphic ? "border-accent/70 bg-accent/50" : "border-[#199e70]/70 bg-[#199e70]/50",
        ai: !item.id.startsWith("u"),
        editable: true,
        min: 0.5,
        empty: !choice,
        z: stackOrder.get(layerKey("broll", item.id)) ?? -1,
        selection: { kind: "broll", id: item.id },
        thumb: graphic ? null : (signedOf(choice)?.thumbUrl ?? null),
      });
    }
    for (const seg of composSegs) {
      out.push({
        key: `compos:${seg.id}`,
        track: "anim",
        start: seg.start,
        end: seg.end,
        label: seg.item.name,
        detail: maskMissing.has(seg.id) ? (masks?.pending ? "Recortándote…" : "Sin recorte todavía") : seg.item.match ? `${seg.item.match.score} % parecido` : undefined,
        tone: "border-[#8b5cf6]/70 bg-[#8b5cf6]/50",
        ai: seg.item.source !== "user",
        editable: true,
        min: 0.8,
        max: 12,
        z: stackOrder.get(layerKey("compos", seg.id)) ?? 0,
        selection: { kind: "compos", id: seg.id },
      });
    }
    for (const seg of fxSegs) {
      const info = FX_INFO[seg.item.kind];
      out.push({
        key: `fx:${seg.id}`,
        track: "fx",
        start: seg.start,
        end: seg.end,
        label: info.label,
        detail: seg.item.text || undefined,
        tone: "border-[#d55181]/70 bg-[#d55181]/50",
        ai: seg.item.source !== "user",
        editable: true,
        min: info.duration.min,
        max: info.duration.max,
        z: stackOrder.get(layerKey("fx", seg.id)) ?? 0,
        selection: { kind: "fx", id: seg.id },
      });
    }
    for (const seg of trSegs) {
      const info = TRANSITION_INFO[seg.item.kind];
      const free = isFreeTransition(seg.item);
      out.push({
        key: `tr:${seg.item.id}`,
        track: "fx",
        start: seg.start,
        end: seg.end,
        label: info.label,
        detail: free ? "Transición sobre el plano" : "Transición",
        tone: "border-[#f0a23a]/80 bg-[#f0a23a]/45",
        ai: seg.item.source === "director",
        // Se arrastra a cualquier punto (sin imán a las palabras); cerca de un corte, se pega al corte.
        editable: true,
        free: true,
        min: seg.end - seg.start,
        max: seg.end - seg.start,
        z: stackOrder.get(layerKey("transition", seg.item.id)) ?? 0,
        selection: { kind: "transition", word: seg.item.at_word, id: seg.item.id },
      });
    }
    for (const { cue, hitAt } of soundCueTimes(timeline, s.soundCues)) {
      const file = SFX_FILES[cue.name];
      const start = Math.max(0, hitAt - file.hit);
      out.push({
        key: `sound:${cue.id}`,
        track: "audio",
        start,
        end: Math.min(timeline.duration, start + Math.max(0.12, file.duration)),
        label: SFX_LIBRARY[cue.name].label,
        tone: "border-warning/70 bg-warning/35",
        ai: cue.source === "director",
        editable: true,
        min: Math.max(0.12, file.duration),
        max: Math.max(0.12, file.duration),
        // Varios sonidos a la vez suenan juntos: los carriles son solo para verlos.
        z: -s.soundCues.indexOf(cue),
        selection: { kind: "sound", id: cue.id },
      });
    }
    if (styleZooms)
      zooms.forEach((z, i) =>
        out.push({ key: `sz${i}`, track: "zoom", start: z.start, end: z.end, label: `${z.scale.toFixed(2).replace(".", ",")}×`, tone: "border-accent-hi/40 bg-accent-hi/25 font-normal", selection: { kind: "zoom", index: -1 - i } }),
      );
    else
      s.zoomMoments.forEach((m, i) => {
        const r = outputRange(timeline, m.from_word, m.to_word);
        if (!r) return;
        out.push({
          key: `zoom:${i}:${m.from_word}`,
          track: "zoom",
          start: r.start,
          end: r.end,
          label: `${m.scale.toFixed(2).replace(".", ",")}×`,
          tone: "border-accent-hi/60 bg-accent-hi/40",
          ai: !m.why.startsWith(USER_TAG),
          editable: true,
          min: 0.2,
          max: 3.5,
          // Con zooms superpuestos manda el de arriba (capa más alta).
          z: layerOf(m) * 1000 + i,
          selection: { kind: "zoom", index: i },
        });
      });
    return out;
  }, [timeline, captions, s.broll, s.zoomMoments, segments, fxSegs, composSegs, styleZooms, zooms, textOf, signedOf, trSegs, s.soundCues, stackOrder, maskMissing, masks?.pending, s.splits]);

  // Cortes sin transición donde se puede poner una con un toque (va encima de lo que haya).
  const transitionSlots = useMemo(() => {
    const taken = new Set(s.transitions.filter((t) => !isFreeTransition(t)).map((t) => t.at_word));
    return cutList.filter((c) => !taken.has(c.word)).map((c) => ({ at: c.at, word: c.word }));
  }, [cutList, s.transitions]);

  /**
   * Pone, cambia o quita (patch null) una transición: la de un corte (por su palabra) o una libre (por su id). Al
   * ponerla o moverla queda encima de lo que haya en ese instante (no quita nada).
   */
  function setTransition(word: number, patch: Partial<TransitionItem> | null, id?: string) {
    if (!canEdit) return;
    const cur = id ? s.transitions.find((t) => t.id === id) : s.transitions.find((t) => t.at_word === word && !isFreeTransition(t));
    if (!patch) {
      if (cur) update((st) => ({ ...st, transitions: st.transitions.filter((t) => t.id !== cur.id) }));
      setSelection(null);
      return;
    }
    const next: TransitionItem = cur ? { ...cur, ...patch, source: "user" } : { id: newTransitionId(), kind: patch.kind ?? "tr_whip", at_word: word, source: "user", ...patch };
    if (next.offset === undefined) delete next.offset;
    const moved = !cur || cur.at_word !== next.at_word || cur.offset !== next.offset;
    let under: string[] = [];
    if (moved) {
      const seg = transitionSegments(timeline, [next])[0];
      const top = seg ? layerOnTop(seg.start, seg.end, layerKey("transition", next.id)) : { layer: undefined, under: [] };
      if (top.layer != null) next.layer = top.layer;
      under = top.under;
    }
    update((st) => ({ ...st, transitions: [...st.transitions.filter((t) => t.id !== next.id), next].sort((a, b) => a.at_word - b.at_word) }), { coalesce: `tr:${next.id}` });
    notifyOnTop(under);
    setSelection({ kind: "transition", word: next.at_word, id: next.id });
  }

  /** Pone una transición en el segundo `t`: en el corte si cae justo ahí, o libre sobre el plano. */
  function dropTransition(kind: TransitionItem["kind"], t: number, id?: string) {
    const cutNear = [...cutList].sort((a, b) => Math.abs(a.at - t) - Math.abs(b.at - t))[0];
    // Imán al corte: 0,15 s, así un rombo se acierta fácil.
    if (cutNear && Math.abs(cutNear.at - t) <= 0.15) {
      if (id) setTransition(cutNear.word, { kind, at_word: cutNear.word, offset: undefined }, id);
      else setTransition(cutNear.word, { kind });
      return;
    }
    const anchor = freeAnchor(timeline, t);
    if (!anchor) return void toast.error("Este video todavía no tiene palabras donde ponerla.");
    setTransition(anchor.at_word, { kind, ...anchor }, id ?? newTransitionId());
  }

  const obstacles = useMemo<Partial<Record<TrackKey, { start: number; end: number; label: string }[]>>>(
    () => ({
      broll: fxSegs.map((f) => ({ start: f.start, end: f.end, label: `Efecto «${FX_INFO[f.item.kind].label}»` })),
      fx: segments.map((b) => ({ start: b.start, end: b.end, label: b.option.source === "graphic" ? "Gráfico" : "B-roll" })),
    }),
    [fxSegs, segments],
  );

  const snap = useCallback(
    (t0: number, t1: number, block: TimelineBlock | null): SnappedSpan | null => {
      let span = snapToWords(timeline, t0, t1);
      if (!span || !block) return span;
      if (block.max && span.end - span.start > block.max + 0.25) span = snapToWords(timeline, span.start, span.start + block.max) ?? span;
      return span;
    },
    [timeline],
  );

  /**
   * Orden de capas al soltar un bloque visual en una pista: queda en el carril `lane` (0 = arriba = encima) entre los
   * bloques de esa pista que se le superponen en [start, end]. Sin carril, arriba de todo. Devuelve las capas nuevas
   * (enteros desde 0) de todo lo visual, o null si no se superpone con nada de su pista.
   */
  function laneOrder(key: string, kind: LayerKind, start: number, end: number, lane: number | null): Map<string, number> | null {
    const kinds: LayerKind[] = kind === "broll" ? ["broll"] : kind === "compos" ? ["compos"] : ["fx", "transition"];
    const me = visualStack.find((v) => v.key === key) ?? { key, kind, layer: 0, start, end, label: "" };
    const others = visualStack.filter((v) => v.key !== key && kinds.includes(v.kind) && v.start < end - 0.01 && start < v.end - 0.01).sort((a, b) => (stackOrder.get(b.key) ?? 0) - (stackOrder.get(a.key) ?? 0));
    if (!others.length) return null;
    const L = Math.max(0, Math.min(others.length, lane ?? 0));
    const all = [...visualStack.filter((v) => v.key !== key), { ...me, start }];
    let below: string | null;
    if (L < others.length) below = others[L]!.key;
    else {
      // Abajo de todos los de su pista: justo debajo del más bajo.
      const order = stackSort(all).filter((x) => x.key !== key);
      const at = order.findIndex((x) => x.key === others[others.length - 1]!.key);
      below = at > 0 ? order[at - 1]!.key : null;
    }
    return restack(all, key, below);
  }

  /** Aplica capas nuevas (de `laneOrder` o `restack`) al b-roll, los efectos, las animaciones y las transiciones. */
  function withLayers(st: StudioState, layers: Map<string, number> | null): StudioState {
    if (!layers) return st;
    const set = <T extends { id: string; layer?: number }>(kind: LayerKind, list: T[]) => list.map((x) => (layers.has(layerKey(kind, x.id)) ? { ...x, layer: Math.min(999, layers.get(layerKey(kind, x.id))!) } : x));
    return { ...st, broll: set("broll", st.broll), effects: set("fx", st.effects), compositions: set("compos", st.compositions), transitions: set("transition", st.transitions) };
  }

  const selKeyOf = (sel: StudioSelection) => (sel.kind === "broll" ? layerKey("broll", sel.id) : sel.kind === "fx" ? layerKey("fx", sel.id) : sel.kind === "compos" ? layerKey("compos", sel.id) : sel.kind === "transition" && sel.id ? layerKey("transition", sel.id) : null);
  /** Lo visual que se superpone con lo elegido. */
  const overlapsOf = (key: string | null) => {
    const me = key ? visualStack.find((v) => v.key === key) : null;
    return me ? visualStack.filter((v) => v.key !== key && v.start < me.end - 0.01 && me.start < v.end - 0.01) : [];
  };
  /** Lleva lo elegido al frente (encima de todo lo que se le superpone) o atrás (debajo). */
  function restackSel(sel: StudioSelection, where: "front" | "back") {
    const key = selKeyOf(sel);
    if (!key) return;
    const over = overlapsOf(key);
    if (!over.length) return void toast.info("No hay nada superpuesto con esto.");
    const order = stackSort(visualStack).filter((x) => x.key !== key);
    const idx = over.map((o) => order.findIndex((x) => x.key === o.key));
    const below = where === "front" ? order[Math.max(...idx)]!.key : Math.min(...idx) > 0 ? order[Math.min(...idx) - 1]!.key : null;
    update((st) => withLayers(st, restack(visualStack, key, below)));
  }

  /** Capas de los zooms al soltar uno en un carril (0 = arriba = el que manda) entre los que se le superponen. */
  function zoomLanes(list: ZoomMoment[], moved: ZoomMoment, lane: number | null): ZoomMoment[] {
    const over = (z: ZoomMoment) => z !== moved && moved.from_word <= z.to_word && z.from_word <= moved.to_word;
    const rank = (z: ZoomMoment) => layerOf(z) * 1000 + list.indexOf(z);
    const others = list.filter(over).sort((a, b) => rank(b) - rank(a));
    if (!others.length) return list;
    const L = Math.max(0, Math.min(others.length, lane ?? 0));
    const order = list.filter((z) => z !== moved).sort((a, b) => rank(a) - rank(b));
    const at = L < others.length ? order.indexOf(others[L]!) + 1 : order.indexOf(others[others.length - 1]!);
    order.splice(Math.max(0, at), 0, moved);
    return list.map((z) => ({ ...z, layer: Math.min(999, order.indexOf(z)) }));
  }

  /**
   * Mueve o estira un b-roll, un efecto o un zoom a otro rango de palabras. Si ahí hay otra cosa, conviven: el que se
   * mueve queda en el carril donde se soltó (sin carril, encima). Nada se recorta ni se quita.
   */
  function moveTo(sel: StudioSelection, rawRange: WordSpan, mode: "move" | "start" | "end", lane: number | null = null): boolean {
    if (sel.kind === "broll") {
      const item = s.broll.find((b) => b.id === sel.id);
      if (!item) return false;
      const range = rawRange;
      const r = outputRange(timeline, range.from, range.to);
      const layers = r && item.choice ? laneOrder(layerKey("broll", item.id), "broll", r.start, r.end, lane) : null;
      update((st) =>
        withLayers(
          {
            ...st,
            broll: st.broll
              .map((b) => {
                if (b.id !== sel.id) return b;
                const edit = resolveEdit(b.edit);
                // Al estirar un borde, ese borde queda en la palabra (sin el corrimiento de "Entra"/"Sale").
                const nextEdit = mode === "start" ? { ...edit, start_delta: 0 } : mode === "end" ? { ...edit, end_delta: 0 } : edit;
                const next: BrollItem = { ...b, from_word: range.from, to_word: range.to };
                if (isDefaultEdit(nextEdit)) delete next.edit;
                else next.edit = nextEdit;
                return next;
              })
              .sort((a, b) => a.from_word - b.from_word),
          },
          layers,
        ),
      );
      setSelection(sel);
      return true;
    }
    if (sel.kind === "fx") {
      const item = s.effects.find((e) => e.id === sel.id);
      if (!item) return false;
      const range = fitFxSpan(item.kind, rawRange);
      const moved: FxItem = { ...item, from_word: range.from, to_word: range.to, words: item.words?.filter((w) => w >= range.from && w <= range.to) };
      const seg = fxSegments(timeline, [moved])[0];
      const layers = seg ? laneOrder(layerKey("fx", item.id), "fx", seg.start, seg.end, lane) : null;
      update((st) => withLayers({ ...st, effects: st.effects.map((e) => (e.id === sel.id ? moved : e)).sort((a, b) => a.from_word - b.from_word) }, layers));
      setSelection(sel);
      return true;
    }
    if (sel.kind === "compos") {
      const item = s.compositions.find((c) => c.id === sel.id);
      if (!item) return false;
      const moved: Composition = { ...item, from_word: rawRange.from, to_word: rawRange.to };
      const seg = composSegments(timeline, [moved])[0];
      const layers = seg ? laneOrder(layerKey("compos", item.id), "compos", seg.start, seg.end, lane) : null;
      update((st) => withLayers({ ...st, compositions: st.compositions.map((c) => (c.id === sel.id ? moved : c)).sort((a, b) => a.from_word - b.from_word) }, layers));
      setSelection(sel);
      return true;
    }
    if (sel.kind === "zoom" && sel.index >= 0) {
      const current = s.zoomMoments[sel.index];
      if (!current) return false;
      const moved = { ...current, from_word: rawRange.from, to_word: rawRange.to };
      const list = zoomLanes(s.zoomMoments.map((z, i) => (i === sel.index ? moved : z)), moved, lane);
      const movedNow = list[sel.index]!;
      const next = [...list].sort((a, b) => a.from_word - b.from_word);
      update((st) => ({ ...st, rhythmTouched: true, zoomMoments: next }));
      setSelection({ kind: "zoom", index: next.indexOf(movedNow) });
      return true;
    }
    return false;
  }

  function commitBlock(block: TimelineBlock, span: SnappedSpan, mode: "move" | "start" | "end", lane: number | null = null) {
    const sel = block.selection;
    if (sel.kind === "sound") {
      // Un sonido se ancla a la palabra donde cae su punto fuerte (sobrevive a los cortes); varios suenan a la vez.
      const cue = s.soundCues.find((c) => c.id === sel.id);
      if (!cue) return;
      const hit = span.start + SFX_FILES[cue.name].hit;
      placeSound(cue.id, cue.name, hit, cue.gain);
      return;
    }
    if (sel.kind === "transition") {
      // Una transición se suelta en cualquier punto: en un corte (si cae justo ahí) o sobre el plano, en su carril.
      const item = s.transitions.find((t) => t.id === sel.id) ?? s.transitions.find((t) => t.at_word === sel.word && !isFreeTransition(t));
      if (!item) return;
      const t = (span.start + span.end) / 2;
      const layers = laneOrder(layerKey("transition", item.id), "transition", span.start, span.end, lane);
      dropTransition(item.kind, t, item.id);
      if (layers) update((st) => withLayers(st, layers), { coalesce: `tr:${item.id}` });
      return;
    }
    if (moveTo(sel, { from: span.from, to: span.to }, mode, lane)) seek(span.start);
  }

  /** Pone (o mueve) un sonido para que su punto fuerte caiga en `hit` (segundos del video final). */
  function placeSound(id: string | null, name: SfxName, hit: number, gain: number = SOUND_GAIN.default) {
    const w = timeline.words.reduce<(typeof timeline.words)[number] | null>((best, x) => (!best || Math.abs(x.start - hit) < Math.abs(best.start - hit) ? x : best), null);
    if (!w) return;
    const offset = Math.max(-2, Math.min(2, Math.round((hit - w.start) * 1000) / 1000));
    const cueId = id ?? newSoundCueId();
    update((st) => ({ ...st, soundCues: [...st.soundCues.filter((c) => c.id !== cueId), { id: cueId, name, at_word: w.id, offset, gain, source: "user" as const }].slice(-40) }));
    setSelection({ kind: "sound", id: cueId });
  }

  /**
   * Sombra de lo que se arrastra desde la Biblioteca: el mismo tramo que va a ocupar al soltarlo en `t` (las mismas
   * cuentas que `addFromLibrary`), con su nombre.
   */
  const dropPreview = (item: LibraryDrop, t: number): DropPreview | null => {
    if (item.type === "fx") {
      const info = FX_INFO[item.kind as FxKind];
      if (!info) return null;
      const target = Math.min(info.duration.max, Math.max(info.duration.min, (info.duration.min + info.duration.max) / 2.5));
      const span = spanAround(timeline, t, target);
      if (!span) return null;
      const range = fitFxSpan(item.kind as FxKind, span);
      const seg = fxSegments(timeline, [{ id: "drop", kind: item.kind as FxKind, from_word: range.from, to_word: range.to }])[0];
      return seg ? { track: "fx", start: seg.start, end: seg.end, label: info.label } : null;
    }
    if (item.type === "graphic" || item.type === "broll") {
      const span = spanAround(timeline, t, 2.5);
      return span ? { track: "broll", start: span.start, end: span.end, label: item.type === "graphic" ? "Gráfico" : "B-roll" } : null;
    }
    if (item.type === "zoom") {
      const span = spanAround(timeline, t, 1.2);
      return span ? { track: "zoom", start: span.start, end: span.end, label: "Zoom" } : null;
    }
    if (item.type === "transition") {
      if (!isTransitionKind(item.kind)) return null;
      const cutNear = [...cutList].sort((a, b) => Math.abs(a.at - t) - Math.abs(b.at - t))[0];
      const at = cutNear && Math.abs(cutNear.at - t) <= 0.15 ? cutNear.at : t;
      const d = TRANSITION_INFO[item.kind].duration;
      const start = Math.max(0, Math.min(timeline.duration - d, at - d / 2));
      return { track: "fx", start, end: start + d, label: TRANSITION_INFO[item.kind].label };
    }
    if (item.type === "sound") {
      if (!isSfxName(item.name)) return null;
      const file = SFX_FILES[item.name];
      const start = Math.max(0, t - file.hit);
      return { track: "audio", start, end: Math.min(timeline.duration, start + Math.max(0.12, file.duration)), label: SFX_LIBRARY[item.name].label };
    }
    if (item.type === "mine") {
      const span = mineSpan(item, t);
      const seg = span ? composSegments(timeline, [{ id: "drop", from_word: span.from, to_word: span.to, name: item.name, code: "x", params: [], source: "user" }])[0] : null;
      return seg ? { track: "anim", start: seg.start, end: seg.end, label: item.name } : null;
    }
    return null;
  };

  /** Tramo de palabras para un efecto de Mis efectos soltado en `t`: lo más parecido a su duración típica. */
  function mineSpan(item: { duration: number }, t: number) {
    return spanAround(timeline, t, Math.max(0.8, Math.min(12, item.duration)));
  }

  /**
   * Pone un efecto de Mis efectos en el tramo: el servidor adapta sus textos a lo que se dice ahí y vuelve a validar su
   * código. Queda encima de lo que haya (en capas) y se puede deshacer.
   */
  async function addMine(item: { id: string; name: string; duration: number }, t: number) {
    const span = mineSpan(item, t);
    if (!span) return void toast.error("Este video todavía no tiene palabras donde ponerlo.");
    const tid = toast.info(`Poniendo «${item.name}» y adaptando sus textos…`, { duration: 20000 });
    const res = await placeMyEffectAction(projectId, item.id, { from_word: span.from, to_word: span.to });
    toast.dismiss(tid);
    if (!res.ok) return void toast.error(res.error);
    const { comp, images } = res.data;
    if (Object.keys(images).length) setComposImageUrls((prev) => ({ ...prev, ...images }));
    const seg = composSegments(timeline, [comp])[0];
    const top = seg ? layerOnTop(seg.start, seg.end, layerKey("compos", comp.id)) : { layer: undefined, under: [] };
    const placed: Composition = { ...comp, ...(top.layer != null ? { layer: top.layer } : {}) };
    update((st) => ({ ...st, compositions: [...st.compositions, placed].sort((a, b) => a.from_word - b.from_word) }));
    setSelection({ kind: "compos", id: placed.id });
    toast.success(`«${item.name}» ya está en tu video.`, { description: "Sus textos se adaptaron a lo que dices ahí: cámbialos en el panel de la derecha." });
    notifyOnTop(top.under);
  }

  /** Agrega algo de la Biblioteca en el segundo `at` (o en el cabezal). Si ahí ya hay algo, lo nuevo va encima (en capas). */
  function addFromLibrary(item: LibraryDrop, at?: number) {
    if (!canEdit) return;
    const t = at ?? outRef.current;
    const noWords = () => toast.error("Este video todavía no tiene palabras donde ponerlo.");
    if (item.type === "fx") {
      const info = FX_INFO[item.kind as FxKind];
      if (!info) return;
      const target = Math.min(info.duration.max, Math.max(info.duration.min, (info.duration.min + info.duration.max) / 2.5));
      const span = spanAround(timeline, t, target);
      if (!span) return noWords();
      addFx(item.kind as FxKind, span, null);
    } else if (item.type === "graphic" || item.type === "broll") {
      const span = spanAround(timeline, t, 2.5);
      if (!span) return noWords();
      if (item.type === "graphic" && item.template) addGraphic(span, item.template as GraphicTemplate);
      else addBroll(span, item.type === "graphic");
    } else if (item.type === "zoom") {
      const span = spanAround(timeline, t, 1.2);
      if (!span) return noWords();
      addZoom(span);
    } else if (item.type === "transition") {
      if (!isTransitionKind(item.kind)) return;
      dropTransition(item.kind, t);
      seek(Math.max(0, t - 0.8));
    } else if (item.type === "sound") {
      if (!isSfxName(item.name)) return;
      placeSound(null, item.name, t);
    } else if (item.type === "mine") {
      void addMine(item, t);
    }
  }

  // ─── Recorte para la vista previa: mientras falten segundos, se consulta (y se pide al worker) cada 5 s ───
  useEffect(() => {
    if (!canEdit || maskMissing.size === 0) return;
    let alive = true;
    const poll = async () => {
      const result = await fxMasksAction(projectId);
      if (alive && result.ok && result.data) setMasks(result.data);
    };
    const first = setTimeout(poll, 2500);
    const timer = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [canEdit, maskMissing.size, projectId]);

  // ─── Guardado automático (1,2 s después del último cambio) ───
  const reviewKey = useMemo(() => JSON.stringify([review, s.format]), [review, s.format]);
  const [savedKey, setSavedKey] = useState(reviewKey);
  const [saving, setSaving] = useState<"idle" | "saving" | "error">("idle");
  const sending = useRef(false);
  // Pedidos de animaciones entregados: se marcan en el servidor después del primer guardado que ya los incluye.
  const acksApi = useRef<{ take: () => string[]; confirm: (ids: string[], ok: boolean) => void } | null>(null);
  useEffect(() => {
    if (!canEdit || reviewKey === savedKey) return;
    const timer = setTimeout(async () => {
      if (sending.current) return;
      setSaving("saving");
      const acks = acksApi.current?.take() ?? [];
      const result = await saveReviewAction(projectId, review, s.format);
      acksApi.current?.confirm(acks, result.ok);
      if (result.ok) {
        setSavedKey(reviewKey);
        setSaving("idle");
      } else {
        setSaving("error");
        toast.error(result.error);
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [reviewKey, savedKey, review, s.format, projectId, canEdit]);
  const saveState = saving === "error" ? "error" : saving === "saving" || reviewKey !== savedKey ? "saving" : "saved";

  function render() {
    sending.current = true;
    startRender(async () => {
      // Con lo que se ve en la vista previa (tramos y gancho): el servidor no exporta si su timeline da otra cosa.
      const hook = s.selectedHook != null ? plan.hook_candidates[s.selectedHook] : undefined;
      const preview = { clips: timeline.clips.map((c) => [c.startFrame, c.endFrame] as [number, number]), hook: hook ? { from_word: hook.from_word, to_word: hook.to_word } : null };
      const result = await renderAction(projectId, { ...review, preview }, s.format);
      if (!result.ok) {
        sending.current = false;
        toast.error(result.error);
      } else router.refresh();
    });
  }

  function proofread() {
    startProofread(async () => {
      const res = await proofreadAction(projectId);
      if (!res.ok) return void toast.error(res.error);
      const fresh = Object.entries(res.fixes).filter(([id]) => !(id in s.corrections));
      if (!fresh.length) return void toast.success("No encontramos palabras mal escritas en los subtítulos.");
      update((st) => ({ ...st, corrections: { ...Object.fromEntries(fresh), ...st.corrections } }));
      const sample = fresh
        .slice(0, 3)
        .map(([id, text]) => `«${words[Number(id)]?.text}» → «${text}»`)
        .join(", ");
      toast.success(fresh.length === 1 ? "Corregimos 1 palabra en los subtítulos." : `Corregimos ${fresh.length} palabras en los subtítulos.`, { description: `${sample}. Están subrayadas con puntos azules; doble clic para cambiarlas.` });
    });
  }

  // ─── Atajos de teclado ───
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keys.current = (e: KeyboardEvent) => {
      // Lo que ya atendió el lienzo (flechas, + y −, Esc, Enter sobre un elemento del video) no se repite aquí.
      if (e.defaultPrevented || document.querySelector("dialog[open]")) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;
      if (mod && (key === "z" || key === "Z")) {
        if (typing(e.target)) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && (key === "y" || key === "Y")) {
        if (typing(e.target)) return;
        e.preventDefault();
        redo();
        return;
      }
      if (mod || typing(e.target)) return;
      // Alt + flechas: mueve lo elegido una palabra (sin mouse).
      if (e.altKey && (key === "ArrowLeft" || key === "ArrowRight")) {
        e.preventDefault();
        nudge(key === "ArrowRight" ? 1 : -1);
        return;
      }
      if (e.altKey) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      const inTranscript = Boolean(el?.closest('[aria-label="Transcripción editable"]'));
      const inRoving = Boolean(el?.closest('[role="radiogroup"],[role="tablist"],[role="listbox"]')) || (el?.getAttribute("role") === "slider" && el.dataset.testid !== "studio-ruler");
      const v = videoEl();
      switch (key) {
        case " ":
          if (inTranscript) return;
          e.preventDefault();
          togglePlay();
          return;
        case "k":
        case "K":
          e.preventDefault();
          v?.pause();
          return;
        case "l":
        case "L":
          e.preventDefault();
          if (v && !v.paused) v.playbackRate = Math.min(2, v.playbackRate + 0.5);
          else seek(outRef.current >= timeline.duration - 0.05 ? 0 : outRef.current, true);
          return;
        case "j":
        case "J":
          e.preventDefault();
          seek(outRef.current - 2, Boolean(v && !v.paused));
          return;
        case "ArrowLeft":
        case "ArrowRight": {
          if (inTranscript || inRoving) return;
          e.preventDefault();
          const dir = key === "ArrowRight" ? 1 : -1;
          if (e.shiftKey) {
            const list = timeline.words;
            const t = outRef.current;
            const w = dir > 0 ? list.find((x) => x.start > t + 0.02) : [...list].reverse().find((x) => x.start < t - 0.05);
            seek(w ? w.start : dir > 0 ? timeline.duration : 0);
          } else seek(outRef.current + dir / FPS);
          return;
        }
        case "s":
        case "S":
          e.preventDefault();
          split();
          return;
        case "c":
        case "C":
          e.preventDefault();
          splitVideo();
          return;
        case "Delete":
        case "Backspace":
          if (!selection) return;
          e.preventDefault();
          removeSelection();
          return;
        case "Escape":
          setSelection(null);
          return;
        case "+":
        case "=":
          e.preventDefault();
          setZoom((z) => Math.min(40, z * 1.5));
          return;
        case "-":
        case "_":
          e.preventDefault();
          setZoom((z) => Math.max(1, z / 1.5));
          return;
        case "?":
          e.preventDefault();
          setHelp(true);
          return;
      }
    };
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ─── Tamaño de la vista previa: lo más grande que entre en el centro ───
  const center = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = center.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const ratio = s.format === "9:16" ? 9 / 16 : 16 / 9;
  // Debajo del cuadro va la línea de "en pantalla" (~36 px); la barra del reproductor se oculta en pantallas grandes.
  const previewW = box && box.h > 200 ? Math.max(180, Math.min(box.w - 16, (box.h - 52) * ratio)) : null;

  const rangeSel = selection?.kind === "range" ? outputRange(timeline, selection.from, selection.to) : null;
  const dirty = reviewKey !== savedKey;
  const changedFromProposal = removedSet.size !== proposed.size || s.removed.some((id) => !proposed.has(id)) || s.pauses.all || s.pauses.keep.length > 0;
  const nothingTrimmed = removedSet.size === 0 && trimmedPauses.length === 0;
  const cuts = useMemo(() => cutMarks(timeline, removedSet), [timeline, removedSet]);
  // En la pista de subtítulos: dónde no se ven (los ocultó el director, un efecto lleva los suyos o un gráfico los tapa).
  const captionGaps = useMemo(
    () => [...hiddenCaptions, ...fxCaptionHides(fxSegs), ...composCaptionHides(composSegs), ...segments.filter((sg) => sg.option.source === "graphic" && graphicHidesCaptions(sg.option.graphic)).map((sg) => ({ start: sg.start, end: sg.end }))],
    [hiddenCaptions, fxSegs, composSegs, segments],
  );
  const musicTrack = s.musicGen ? null : (tracks.find((t) => t.id === s.music.trackId) ?? null);
  // Sonidos y música también en la vista previa (los mismos archivos y el mismo generador que el render).
  const genMusic = useGeneratedMusic(s.musicGen, timeline.duration);
  useStudioSound({
    enabled: true,
    playing,
    time: outTime,
    cues: sfxMarks.map((c) => ({ name: c.name, at: c.at, gain: c.gain })),
    music: s.musicGen ? { kind: "buffer", buffer: genMusic.buffer } : musicTrack?.url ? { kind: "url", url: musicTrack.url } : null,
    musicDb: s.music.db,
    duration: timeline.duration,
  });

  // Pedidos de animaciones (Estudio), varios a la vez: cada uno aparece como un bloque fantasma en la pista Animaciones
  // y, cuando termina, entra sobre lo que la persona tenga en ese momento (con deshacer), en su propia capa: encima de
  // todo lo que se le superpone, también de las otras animaciones que acaban de llegar. Nunca reemplaza nada.
  const deliver = useCallback(
    (req: LiveRequest, images: Record<string, string>) => {
      if (Object.keys(images).length) setComposImageUrls((prev) => ({ ...prev, ...images }));
      const made = req.made;
      if (!made.length) return;
      const fixed = visualStack.filter((v) => v.kind !== "compos");
      const firstSeg = composSegments(timeline, [made[0]!])[0];
      const under = firstSeg ? visualStack.filter((v) => v.key !== layerKey("compos", made[0]!.id) && v.start < firstSeg.end - 0.01 && firstSeg.start < v.end - 0.01).map((v) => v.label) : [];
      update((st) => {
        const list = [...st.compositions];
        const replaceId = req.request?.replaceId ?? null;
        for (const [i, m] of made.entries()) {
          // "Pídele un cambio": la primera animación que llega reemplaza a la que se pidió cambiar (aunque el servidor
          // le haya dado otro id), en su mismo lugar y capa. Si la original ya no está, entra como nueva.
          const target = i === 0 && replaceId ? list.findIndex((c) => c.id === replaceId) : -1;
          if (target >= 0) {
            list[target] = { ...m, id: replaceId!, layer: list[target]!.layer };
            if (list[target]!.layer == null) delete list[target]!.layer;
            continue;
          }
          const at = list.findIndex((c) => c.id === m.id);
          if (at >= 0) {
            // "Pídele un cambio": la misma animación, en su misma capa.
            if (list[at]!.code !== m.code || list[at]!.request !== m.request) list[at] = { ...m, layer: list[at]!.layer };
            continue;
          }
          const seg = composSegments(timeline, [m])[0];
          const layer = seg ? nextLayer([...fixed, ...composSegments(timeline, list)], seg) : undefined;
          const out: Composition = { ...m };
          if (layer != null) out.layer = layer;
          else delete out.layer;
          list.push(out);
        }
        return { ...st, compositions: list.sort((a, b) => a.from_word - b.from_word) };
      });
      const first = made[0]!;
      const r = outputRange(timeline, first.from_word, first.to_word);
      const task = req.tasks[0];
      toast.success(req.request?.replaceId ? `Listo: cambiamos «${first.name}».` : `Listo: «${first.name}» ya está en tu video.`, {
        description: [task?.note].filter(Boolean).join(" ") || undefined,
        action: {
          label: "Ver",
          onClick: () => {
            setSelection({ kind: "compos", id: req.request?.replaceId ?? first.id });
            if (r) seek(r.start);
          },
        },
      });
      notifyOnTop(under);
    },
    [visualStack, update, timeline, seek],
  );
  const failed = useCallback((req: LiveRequest) => {
    toast.error(`No pudimos hacer «${(req.request?.instruction ?? "la animación").slice(0, 60)}»`, { description: req.error ?? req.tasks[0]?.error ?? "Prueba de nuevo con otras palabras." });
  }, []);
  const composWork = useComposRequests(projectId, deliver, failed);
  // Bloques fantasma: cada pedido en curso, en su tramo de la pista Animaciones, con su progreso (encima de todo, cada
  // uno en su carril si se pisan). Al terminar se reemplazan por la animación real.
  const ghostBlocks = useMemo<TimelineBlock[]>(
    () =>
      composWork.requests.flatMap((r, i) => {
        if (!isActive(r) || !r.request) return [];
        // Un cambio sobre una animación que sigue en el video se muestra sobre ese mismo bloque, no como uno nuevo.
        if (r.request.replaceId && s.compositions.some((c) => c.id === r.request!.replaceId)) return [];
        // Una pieza larga («Animar todo») ocupa todo su tramo, no los 12 s de una animación suelta.
        const long = r.tasks.some((t) => t.long);
        const seg = composSegments(timeline, [{ id: r.id, from_word: r.request.from_word, to_word: r.request.to_word, name: "x", code: "x", params: [], source: "user", ...(long ? { long: true } : {}) }])[0];
        if (!seg) return [];
        return [
          {
            key: `req:${r.id}`,
            track: "anim" as const,
            start: seg.start,
            end: seg.end,
            label: r.request.instruction,
            detail: requestStage(r),
            tone: "border-[#a78bfa]/80",
            pending: true,
            z: 100_000 + i,
            selection: { kind: "request" as const, id: r.id },
          },
        ];
      }),
    [composWork.requests, timeline, s.compositions],
  );
  // Animaciones con un cambio en curso: el mismo bloque, punteado y con el avance del pedido.
  const changing = useMemo(() => {
    const out = new Map<string, string>();
    for (const r of composWork.requests) if (isActive(r) && r.request?.replaceId) out.set(r.request.replaceId, requestStage(r));
    return out;
  }, [composWork.requests]);
  const allBlocks = useMemo(() => {
    const base = changing.size
      ? blocks.map((b) => {
          const id = b.key.startsWith("compos:") ? b.key.slice(7) : null;
          const stage = id ? changing.get(id) : undefined;
          return stage == null ? b : { ...b, pending: true, detail: `Cambiando · ${stage}` };
        })
      : blocks;
    return ghostBlocks.length ? [...base, ...ghostBlocks] : base;
  }, [blocks, ghostBlocks, changing]);
  useEffect(() => {
    acksApi.current = { take: composWork.takeAcks, confirm: composWork.confirmAcks };
  }, [composWork.takeAcks, composWork.confirmAcks]);
  async function requestAnimation(req: ComposRequest): Promise<boolean> {
    const ok = await composWork.request(req);
    if (ok) toast.success("Creando la animación: aparece sola cuando termina. Puedes pedir otras mientras tanto.", { duration: 3000 });
    return ok;
  }

  const api: StudioApi = {
    props,
    state: s,
    update,
    removedSet,
    selection,
    select: (sel) => select(sel),
    timeline,
    segments,
    fxSegs,
    composSegs,
    compos: { requests: composWork.requests, legacy: composWork.legacy, sending: composWork.sending, error: composWork.error, request: requestAnimation, cancel: composWork.cancel, dismiss: composWork.dismiss, imageUrls: composImageUrls },
    trSegs,
    cutList,
    zooms,
    captions,
    subsHidden,
    rhythm,
    fxBrand,
    thumbsCount: thumbs.length,
    maskMissing,
    masks: { pending: Boolean(masks?.pending), failed: Boolean(masks?.failed) },
    reasons,
    pauses: pauseList,
    overlaps: (sel) => overlapsOf(selKeyOf(sel)).length > 0,
    changedFromProposal,
    styleZooms,
    showFraming,
    time: outTime,
    textOf,
    humanize,
    signedOf,
    transformControls: (sel) => canvasEdits.controls ?? props.transformControls?.(sel) ?? null,
    actions: {
      seek,
      listenFrom,
      listenHook,
      cut,
      cutSpan,
      addBroll,
      openPicker: (id, tab) => setPicking({ id, tab }),
      openGallery: (range, replace) => setGallery({ range, replace }),
      addFx,
      addZoom,
      openPhraseFix: (span) => setFixRange(span),
      removeSelection,
      split,
      splitVideo,
      setSubsHidden,
      accept: acceptSel,
      setBrollEdit,
      applyLookToAll,
      setGraphic,
      changeDensity,
      pickOption,
      setTransition,
      placeSound,
      setPause,
      restoreAll,
      restorePauses,
      backToProposal,
      restack: restackSel,
    },
  };

  // Lo que se ve ahora en la vista previa (para elegirlo con un toque).
  const composNow = composSegs.find((sg) => outTime >= sg.start && outTime < sg.end) ?? null;
  const fxNow = composNow ? null : (fxSegs.find((sg) => outTime >= sg.start && outTime < sg.end) ?? null);
  const brNow = fxNow ? null : (segments.find((sg) => outTime >= sg.start && outTime < sg.end) ?? null);
  const pickedItem = picking ? s.broll.find((b) => b.id === picking.id) ?? null : null;

  const toolbar = (
    <div className="flex h-10 flex-none items-center gap-1.5 border-b border-white/10 px-2 sm:px-3">
      <button type="button" className="btn-ghost !h-8 !w-8 !p-0" onClick={togglePlay} disabled={!proxyUrl} aria-label={playing ? "Pausar (Espacio)" : "Reproducir (Espacio)"} title={playing ? "Pausar (Espacio)" : "Reproducir (Espacio)"}>
        {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
      </button>
      <span className="w-[7.5rem] font-mono text-xs text-text tabular-nums" aria-live="off">
        {timeLabel(outTime)} <span className="text-muted">/ {formatDuration(timeline.duration)}</span>
      </span>
      {canEdit && (
        <>
          <span className="mx-1 h-5 w-px bg-white/10" aria-hidden />
          <Button size="sm" variant="subtle" className="!h-8 !px-2" icon={<SplitSquareHorizontal className="h-3.5 w-3.5" aria-hidden />} onClick={splitVideo} title="Dividir el video en el cabezal (C)">
            <span className="hidden xl:inline">Dividir</span>
          </Button>
          <Button size="sm" variant="subtle" className="!h-8 !px-2" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={removeSelection} disabled={!selection || selection.kind === "cut" || selection.kind === "pause" || selection.kind === "audio"} title="Quitar lo elegido (Supr)">
            <span className="hidden xl:inline">Quitar</span>
          </Button>
          {selection?.kind === "range" && (
            <Button size="sm" variant="ghost" className="!h-8 !px-2.5" icon={<Scissors className="h-3.5 w-3.5" aria-hidden />} onClick={() => cutSpan(selection)}>
              Cortar tramo
            </Button>
          )}
        </>
      )}
      <p className="ml-2 hidden min-w-0 flex-1 truncate text-[11px] text-placeholder lg:block">{canEdit ? "Pon el cabezal y toca Dividir (C) para cortar el video; elige la parte que sobra y bórrala con Supr." : "Solo lectura: tu usuario no puede editar."}</p>
      <div className="ml-auto flex items-center gap-1">
        <button type="button" className="btn-ghost !h-8 !w-8 !p-0" onClick={() => setZoom((z) => Math.max(1, z / 1.5))} disabled={zoom <= 1} aria-label="Alejar la línea de tiempo (−)" title="Alejar (−)">
          <Minus className="h-3.5 w-3.5" aria-hidden />
        </button>
        <input type="range" className="range hidden w-24 sm:block" min={0} max={Math.log(40)} step={0.01} value={Math.log(zoom)} onChange={(e) => setZoom(Math.exp(Number(e.target.value)))} aria-label="Zoom de la línea de tiempo" style={{ ["--pct" as string]: `${(Math.log(zoom) / Math.log(40)) * 100}%` }} />
        <button type="button" className="btn-ghost !h-8 !w-8 !p-0" onClick={() => setZoom((z) => Math.min(40, z * 1.5))} aria-label="Acercar la línea de tiempo (+)" title="Acercar (+)">
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );

  return (
    <HumanizeProvider value={humanize}>
      <div className="fixed inset-0 z-40 flex flex-col bg-bg text-text" data-testid="studio">
        {/* Barra superior */}
        <header className="flex h-14 flex-none items-center gap-2 border-b border-white/10 bg-card px-2 sm:px-3">
          <ButtonLink href="/editor" variant="subtle" size="sm" className="!px-2" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} aria-label="Volver al Editor">
            <span className="hidden md:inline">Editor</span>
          </ButtonLink>
          <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[16rem] xl:max-w-[22rem]">
            <h1 className="truncate text-sm font-semibold text-white">{props.title ?? "Revisión"}</h1>
            <p className="truncate text-[11px] text-muted" aria-live="polite">
              {saveState === "saving" ? "Guardando…" : saveState === "error" ? "No se pudo guardar" : "Guardado"} · {formatDuration(duration)} → <span className="text-white">{formatDuration(timeline.duration)}</span> · {formatNumber(Math.max(0, timeline.clips.length - 1))} cortes
            </p>
          </div>
          {canEdit && (
            <div className="flex items-center gap-0.5">
              <button type="button" className="btn-ghost !h-9 !w-9 !p-0" onClick={undo} disabled={!canUndo} aria-label="Deshacer (Ctrl+Z)" title="Deshacer (Ctrl+Z)">
                <Undo2 className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" className="btn-ghost !h-9 !w-9 !p-0" onClick={redo} disabled={!canRedo} aria-label="Rehacer (Mayús+Ctrl+Z)" title="Rehacer (Mayús+Ctrl+Z)">
                <Redo2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <SegmentedControl
              label="Formato"
              size="sm"
              className="hidden md:inline-flex"
              value={s.format}
              onValueChange={(v) => canEdit && update((st) => ({ ...st, format: v }))}
              options={[
                { value: "9:16", label: "9:16" },
                { value: "16:9", label: "16:9" },
              ]}
            />
            <button type="button" className="btn-ghost hidden !h-9 !w-9 !p-0 sm:inline-flex" onClick={() => setHelp(true)} aria-label="Atajos de teclado (?)" title="Atajos de teclado (?)">
              <Keyboard className="h-4 w-4" aria-hidden />
            </button>
            {props.menu}
            {canEdit && (
              <Button variant="ghost" className="!px-3 !py-2" icon={<WandSparkles className="h-4 w-4" aria-hidden />} onClick={() => setWholeOpen(true)} title="La IA anima todo el video, momento por momento">
                <span className="hidden lg:inline">Animar todo</span>
              </Button>
            )}
            {canEdit && (
              <Button variant="ghost" className="!px-3 !py-2" icon={<Copy className="h-4 w-4" aria-hidden />} onClick={() => (setLeftTab("ia"), setLeftOpen(true))} title="Haz la misma edición que un video de referencia">
                <span className="hidden lg:inline">Copiar edición</span>
              </Button>
            )}
            {canEdit && (
              <Button onClick={render} disabled={rendering || timeline.clips.length === 0} className="!px-3 !py-2" icon={rendering ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Clapperboard className="h-4 w-4" aria-hidden />}>
                {rendering ? "Enviando…" : <span>Renderizar</span>}
              </Button>
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
          <div
            className={cn(
              "flex flex-col lg:grid lg:h-full lg:grid-rows-[minmax(0,1fr)_252px]",
              leftOpen ? "lg:grid-cols-[300px_minmax(0,1fr)_320px] xl:grid-cols-[340px_minmax(0,1fr)_360px]" : "lg:grid-cols-[44px_minmax(0,1fr)_320px] xl:grid-cols-[44px_minmax(0,1fr)_360px]",
            )}
          >
            {/* Izquierda: transcripción, IA y biblioteca */}
            <aside className="order-4 flex min-h-0 flex-col border-white/10 lg:order-none lg:border-r" aria-label="Transcripción, IA y biblioteca">
              {leftOpen ? (
                <>
                  <div className="flex flex-none items-center gap-1 border-b border-white/10 px-2 py-1.5">
                    <div role="tablist" aria-label="Paneles" className="flex flex-1 gap-1">
                      {(
                        [
                          { v: "edicion", label: "Edición", icon: <Scissors className="h-3.5 w-3.5" aria-hidden /> },
                          { v: "texto", label: "Transcripción", icon: <Type className="h-3.5 w-3.5" aria-hidden /> },
                          { v: "ia", label: "IA", icon: <Bot className="h-3.5 w-3.5" aria-hidden /> },
                          { v: "biblioteca", label: "Biblioteca", icon: <Library className="h-3.5 w-3.5" aria-hidden /> },
                        ] as const
                      ).map((t) => (
                        <button
                          key={t.v}
                          type="button"
                          role="tab"
                          aria-selected={leftTab === t.v}
                          onClick={() => setLeftTab(t.v)}
                          className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition", leftTab === t.v ? "bg-white/10 text-white" : "text-muted hover:text-white")}
                        >
                          {t.icon}
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <button type="button" className="hidden h-8 w-8 place-items-center rounded-lg text-muted hover:bg-white/[0.06] hover:text-white lg:grid" onClick={() => setLeftOpen(false)} aria-label="Ocultar el panel" title="Ocultar el panel">
                      <PanelLeftClose className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  <div key={leftTab} className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]" role="tabpanel">
                    {leftTab === "texto" && (
                      <div className="flex flex-col gap-3 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-muted" data-testid="trim-summary">
                            {formatNumber(removedSet.size)} {removedSet.size === 1 ? "palabra cortada" : "palabras cortadas"} de {formatNumber(words.length)}
                            {pauseList.length > 0 && ` · ${formatNumber(trimmedPauses.length)} ${trimmedPauses.length === 1 ? "pausa acortada" : "pausas acortadas"}`}.
                          </p>
                          {canEdit && (
                            <div className="flex flex-wrap gap-1">
                              {changedFromProposal && (
                                <Button size="sm" variant="subtle" className="!px-2" icon={<Wand2 className="h-3.5 w-3.5" aria-hidden />} onClick={backToProposal}>
                                  Volver a la propuesta
                                </Button>
                              )}
                              <Button size="sm" variant="subtle" className="!px-2" icon={proofreading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <SpellCheck className="h-3.5 w-3.5" aria-hidden />} onClick={proofread} disabled={proofreading}>
                                {proofreading ? "Revisando…" : "Ortografía con IA"}
                              </Button>
                              <Button size="sm" variant="subtle" className="!px-2" icon={<Undo2 className="h-3.5 w-3.5" aria-hidden />} onClick={restoreAll} disabled={nothingTrimmed} title="Todas las palabras y las pausas completas, como lo grabaste">
                                Sin recortes
                              </Button>
                            </div>
                          )}
                        </div>
                        <PhraseFixPanel
                          projectId={projectId}
                          fixes={phrase.fixes}
                          canEdit={canEdit}
                          onUpsert={phrase.upsert}
                          onCoverChanged={(fix) => {
                            // Con labios o sin cambios ya no hace falta el b-roll vacío que se puso para tapar la frase.
                            if (fix.cover !== "broll") update((st) => ({ ...st, broll: st.broll.filter((b) => b.choice || b.to_word < fix.fromWord || b.from_word > fix.toWord) }));
                          }}
                          onRemove={(fix) => {
                            phrase.remove(fix.id);
                            // Los subtítulos vuelven a la frase original (solo los que puso la corrección).
                            const ours = captionCorrections(fix.fromWord, fix.toWord, fix.newText);
                            update((st) => {
                              const next = { ...st.corrections };
                              for (const [id, text] of Object.entries(ours)) if (next[id] === text) delete next[id];
                              return { ...st, corrections: next };
                            });
                          }}
                          onCoverWithBroll={(fix) => addBroll({ from: fix.fromWord, to: fix.toWord })}
                          onListen={listenFrom}
                          hasBrollAt={(from, to) => s.broll.some((b) => b.choice && b.from_word <= to && from <= b.to_word)}
                        />
                        <TranscriptEditor
                          words={words}
                          removed={removedSet}
                          reasons={reasons}
                          hook={s.selectedHook != null && plan.hook_candidates[s.selectedHook] ? { from: plan.hook_candidates[s.selectedHook]!.from_word, to: plan.hook_candidates[s.selectedHook]!.to_word } : null}
                          offScript={offScript}
                          corrections={s.corrections}
                          activeTime={activeTime}
                          canEdit={canEdit}
                          onSetCut={cut}
                          subsHidden={subsHidden}
                          pauses={pauseList}
                          onPause={canEdit ? setPause : undefined}
                          onCorrect={(id, text) =>
                            update((st) => {
                              const next = { ...st.corrections };
                              if (text) next[String(id)] = text;
                              else delete next[String(id)];
                              return { ...st, corrections: next };
                            })
                          }
                          onListen={listenFrom}
                          onJump={(id) => {
                            // Lleva el cabezal a esa palabra (o a la siguiente que queda, si está cortada) sin cortar la reproducción.
                            const w = timeline.words.find((x) => x.id >= id);
                            const v = videoEl();
                            if (w) seek(w.start, Boolean(v && !v.paused));
                          }}
                          brollMarks={brollMarks}
                          activeBroll={selection?.kind === "broll" ? selection.id : null}
                          onBrollClick={(id) => select({ kind: "broll", id })}
                          extraActions={
                            canEdit
                              ? (range, clear) => (
                                  <>
                                    <Button
                                      size="sm"
                                      onClick={() => {
                                        // El pedido se escribe en el inspector del tramo (a la derecha), con el cuadro ya enfocado.
                                        setSelection({ kind: "range", from: range.from, to: range.to });
                                        clear();
                                        setTimeout(() => {
                                          const box = document.getElementById("ask-animation");
                                          box?.scrollIntoView({ block: "center", behavior: "smooth" });
                                          box?.focus({ preventScroll: true });
                                        }, 120);
                                      }}
                                    >
                                      Pide una animación aquí
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => (addBroll(range), clear())}>
                                      Poner b-roll aquí
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => (addBroll(range, true), clear())}>
                                      Pide un gráfico aquí
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => (setGallery({ range, replace: null }), clear())}>
                                      Poner un efecto aquí
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => (addZoom(range), clear())}>
                                      Zoom aquí
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => (setFixRange(range), clear())}>
                                      Corregir esta frase
                                    </Button>
                                    {selection?.kind === "fx" && s.effects.some((e) => e.id === selection.id) && (
                                      <Button size="sm" variant="ghost" onClick={() => (moveTo(selection, range, "move"), clear())}>
                                        Mover el efecto elegido aquí
                                      </Button>
                                    )}
                                    {selection?.kind === "broll" && s.broll.some((b) => b.id === selection.id) && (
                                      <Button size="sm" variant="ghost" onClick={() => (moveTo(selection, range, "move"), clear())}>
                                        Mover el b-roll elegido aquí
                                      </Button>
                                    )}
                                  </>
                                )
                              : undefined
                          }
                        />
                        {offScript.size > 0 && <p className="text-xs text-muted">Lo subrayado con puntos amarillos no está en el guion (no se corta solo).</p>}
                      </div>
                    )}
                    {leftTab === "edicion" && (
                      <EditPanel
                        api={api}
                        dirty={dirty}
                        proofreading={proofreading}
                        onProofread={proofread}
                        onRestoreAll={restoreAll}
                        onTrim={(ids) => {
                          update((st) => ({ ...st, removed: [...new Set([...st.removed, ...ids])].sort((a, b) => a - b), pauses: { keep: [], all: false } }));
                          setSelection(null);
                        }}
                        onTrimPauses={() => update((st) => ({ ...st, pauses: { keep: [], all: false } }))}
                        onWholeVideo={(notes) => {
                          setWholeNotes((notes ?? "").slice(0, 800));
                          setWholeOpen(true);
                        }}
                        onAnimationAt={(range, prompt) => {
                          if (prompt) {
                            void requestAnimation({ from_word: range.from, to_word: range.to, instruction: prompt, replace: null });
                            return;
                          }
                          setSelection({ kind: "range", from: range.from, to: range.to });
                          const w = timeline.words.find((x) => x.id >= range.from);
                          if (w) seek(w.start);
                          setTimeout(() => {
                            const box = document.getElementById("ask-animation");
                            box?.scrollIntoView({ block: "center", behavior: "smooth" });
                            box?.focus({ preventScroll: true });
                          }, 120);
                        }}
                        onGraphicAt={(range, prompt) => addBroll(range, true, prompt)}
                        rangeHere={() => {
                          if (selection?.kind === "range") return { range: { from: selection.from, to: selection.to }, from: "seleccion" };
                          const span = spanAround(timeline, outTime, 4);
                          return span ? { range: { from: span.from, to: span.to }, from: "cabezal" } : null;
                        }}
                      />
                    )}
                    {leftTab === "ia" && <AiPanel api={api} dirty={dirty} onAcceptAll={acceptAll} />}
                    {leftTab === "biblioteca" && <LibraryPanel api={api} onAdd={(item) => addFromLibrary(item)} />}
                  </div>
                </>
              ) : (
                <div className="hidden flex-col items-center gap-1 py-2 lg:flex">
                  <button type="button" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-white/[0.06] hover:text-white" onClick={() => setLeftOpen(true)} aria-label="Mostrar el panel" title="Mostrar el panel">
                    <PanelLeftOpen className="h-4 w-4" aria-hidden />
                  </button>
                  {(
                    [
                      { v: "edicion", label: "Edición", icon: <Scissors className="h-4 w-4" aria-hidden /> },
                      { v: "texto", label: "Transcripción", icon: <Type className="h-4 w-4" aria-hidden /> },
                      { v: "ia", label: "IA", icon: <Bot className="h-4 w-4" aria-hidden /> },
                      { v: "biblioteca", label: "Biblioteca", icon: <Library className="h-4 w-4" aria-hidden /> },
                    ] as const
                  ).map((t) => (
                    <button key={t.v} type="button" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-white/[0.06] hover:text-white" onClick={() => (setLeftTab(t.v), setLeftOpen(true))} aria-label={t.label} title={t.label}>
                      {t.icon}
                    </button>
                  ))}
                </div>
              )}
            </aside>

            {/* Centro: la vista previa, lo más grande posible */}
            <main ref={center} className="order-1 flex min-h-0 min-w-0 flex-col items-center justify-center p-3 lg:order-none" aria-label="Vista previa">
              <div
                ref={stage}
                // En pantallas grandes, la barra propia del reproductor se oculta: la línea de tiempo de abajo ya tiene
                // reproducir, el tiempo y el cabezal (así el cuadro del video queda más grande).
                className="relative w-full max-w-[360px] lg:max-w-none [&_div[style*='aspect-ratio']]:!max-w-none lg:[&>div>div:has(>input[aria-label^='Posici'])]:hidden"
                style={previewW ? { width: previewW } : undefined}
                data-testid="studio-stage"
              >
                <PreviewPlayer
                  ref={preview}
                  src={proxyUrl}
                  poster={posterUrl}
                  clips={timeline.clips}
                  duration={timeline.duration}
                  blocks={canvasEdits.placeBlocks(captions)}
                  preset={s.preset}
                  format={s.format}
                  accent={accent}
                  sourceWidth={sourceWidth}
                  sourceHeight={sourceHeight}
                  offsetX={showFraming ? s.offsetX : 0}
                  onSourceTime={setActiveTime}
                  onOutputTime={setOutTime}
                  captionStyle={s.preset === "estilo" ? captionStyle : null}
                  captionLook={capLook}
                  broll={previewBroll}
                  zooms={zooms}
                  focusY={style?.focusY ?? 0.42}
                  brandAccent={graphicLook.theme.accent}
                  brandGround={graphicLook.theme.bg}
                  effects={previewSpecs}
                  order={previewOrder}
                  fxStrips={fxStrips}
                  fxMaskFps={masks?.fps ?? 10}
                  fxImages={fxImages}
                  canvas={canvasEdits.canvas}
                />
                {/*
                  Capa del lienzo: aquí va el overlay para mover, escalar y animar lo elegido sobre el video (lo agrega el
                  agente del lienzo con `stageOverlay`). Cubre exactamente el cuadro del video, arriba de la vista previa.
                */}
                {props.stageOverlay && (
                  <div className="pointer-events-none absolute inset-x-0 top-0 z-10 [&>*]:pointer-events-auto" style={{ aspectRatio: s.format === "9:16" ? "9 / 16" : "16 / 9" }} data-testid="studio-stage-overlay">
                    {props.stageOverlay}
                  </div>
                )}
              </div>
              <div className="mt-1 flex h-8 items-center justify-center">
                {composNow && (
                  <button
                    type="button"
                    onClick={() => select({ kind: "compos", id: composNow.id }, { seek: false })}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-muted transition hover:border-white/25 hover:text-white"
                  >
                    En pantalla: <span className="font-semibold text-white">Animación «{composNow.item.name}»</span>
                    {canEdit && <span className="text-accent-hi">Editar</span>}
                  </button>
                )}
                {!composNow && (fxNow || brNow) && (
                  <button
                    type="button"
                    onClick={() => (fxNow ? select({ kind: "fx", id: fxNow.id }, { seek: false }) : brNow && select({ kind: "broll", id: brNow.id }, { seek: false }))}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-muted transition hover:border-white/25 hover:text-white"
                  >
                    En pantalla: <span className="font-semibold text-white">{fxNow ? FX_INFO[fxNow.item.kind].label : brNow?.option.source === "graphic" ? "Gráfico" : "B-roll"}</span>
                    {canEdit && <span className="text-accent-hi">Editar</span>}
                  </button>
                )}
              </div>
            </main>

            {/* Derecha: inspector */}
            <aside className="order-3 min-h-0 overflow-y-auto overscroll-contain border-white/10 [scrollbar-width:thin] lg:order-none lg:border-l" aria-label="Inspector">
              <StudioInspector api={api} />
            </aside>

            {/* Abajo: la línea de tiempo */}
            <section className="order-2 h-[260px] min-h-0 border-t border-white/10 bg-card lg:order-none lg:col-span-3 lg:h-auto" aria-label="Línea de tiempo">
              <StudioTimeline
                duration={timeline.duration}
                time={outTime}
                playing={playing}
                zoom={zoom}
                onZoom={setZoom}
                blocks={allBlocks}
                cuts={cuts}
                sfx={sfxMarks}
                music={s.musicGen ? { label: `Música · ${musicGenLabel(s.musicGen)}` } : musicTrack ? { label: `Música · ${musicTrack.title}` } : null}
                hiddenCaptions={captionGaps}
                captionHides={canEdit ? captionHides : []}
                onShowCaptions={(index) => update((st) => ({ ...st, captionHide: st.captionHide.filter((_, i) => i !== index) }))}
                selection={selection}
                range={rangeSel}
                obstacles={obstacles}
                snap={snap}
                canEdit={canEdit}
                notes={{ zoom: styleZooms ? "Automáticos del estilo" : "Sin zooms", fx: "Arrastra un efecto o una transición desde la Biblioteca", broll: "Elige un tramo en la pista de video para poner b-roll", audio: s.sfx === "off" && !s.soundCues.length ? "Arrastra sonidos o elige música en la Biblioteca" : undefined }}
                onSeek={(t) => seek(t, Boolean(videoEl() && !videoEl()!.paused))}
                onSelect={(sel) => select(sel)}
                onCommit={commitBlock}
                onRange={(span) => {
                  setSelection({ kind: "range", from: span.from, to: span.to });
                  seek(span.start);
                }}
                onDrop={(item, t) => addFromLibrary(item, t)}
                toolbar={toolbar}
                transitionSlots={transitionSlots}
                dropPreview={canEdit ? dropPreview : undefined}
              />
            </section>
          </div>
        </div>
      </div>

      {/* Ventanas que siguen siendo grandes: elegir clip, el estudio de gráficos, la galería de efectos y la frase con tu voz */}
      <BrollPicker
        key={picking ? `${picking.id}-${picking.tab ?? ""}` : "none"}
        item={pickedItem}
        signed={signed}
        look={graphicLook}
        initialTab={picking?.tab}
        projectId={projectId}
        focusRequest={Boolean(picking?.ask)}
        initialRequest={picking?.prompt}
        spokenText={pickedItem ? textOf(pickedItem.from_word, pickedItem.to_word, 2000) : ""}
        format={s.format}
        minDuration={pickedItem ? Math.max(0, (words[pickedItem.to_word]?.end ?? 0) - (words[pickedItem.from_word]?.start ?? 0)) : 0}
        onClose={() => setPicking(null)}
        onPick={(option) => {
          if (picking) pickOption(picking.id, option);
          setPicking(null);
        }}
      />
      {gallery && (
        <FxGallery
          open
          onClose={() => setGallery(null)}
          brand={fxBrand}
          current={gallery.replace ? (s.effects.find((e) => e.id === gallery.replace)?.kind ?? null) : null}
          rangeText={gallery.range ? textOf(gallery.range.from, gallery.range.to, 120) : null}
          onPick={
            gallery.range && canEdit
              ? (kind) => {
                  addFx(kind, gallery.range!, gallery.replace);
                  setGallery(null);
                }
              : null
          }
        />
      )}
      <PhraseFixDialog
        key={fixRange ? `frase-${fixRange.from}-${fixRange.to}` : "frase-cerrada"}
        projectId={projectId}
        range={fixRange}
        words={words}
        corrections={s.corrections}
        duration={duration}
        onClose={() => setFixRange(null)}
        onCreated={(fix) => {
          phrase.upsert(fix);
          update((st) => ({ ...st, corrections: { ...st.corrections, ...captionCorrections(fix.fromWord, fix.toWord, fix.newText) } }));
          if (fix.cover === "broll") addBroll({ from: fix.fromWord, to: fix.toWord });
        }}
      />
      <ShortcutsHelp open={help} onClose={() => setHelp(false)} />
      {canEdit && <WholeVideoDialog projectId={projectId} open={wholeOpen} initialNotes={wholeNotes} onOpenChange={(o) => (setWholeOpen(o), o || setWholeNotes(""))} onStarted={() => void composWork.refresh()} />}
    </HumanizeProvider>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Espacio", "Reproducir o pausar"],
  ["J · K · L", "Atrás 2 s · pausar · reproducir (otra vez L: más rápido)"],
  ["← →", "Un cuadro atrás o adelante"],
  ["Mayús + ← →", "Palabra anterior o siguiente"],
  ["C", "Dividir el video en el cabezal"],
  ["S", "Dividir lo elegido (b-roll, efecto o zoom) en el cabezal"],
  ["Alt + ← →", "Mover lo elegido una palabra"],
  ["Supr", "Quitar lo elegido (en un tramo de video: cortarlo)"],
  ["Esc", "Soltar la selección"],
  ["+ −", "Acercar o alejar la línea de tiempo (también Ctrl + rueda)"],
  ["Ctrl + Z", "Deshacer"],
  ["Mayús + Ctrl + Z", "Rehacer"],
  ["?", "Ver estos atajos"],
];

function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Atajos de teclado" description="Funcionan cuando no estás escribiendo en un campo. En Mac, Ctrl es ⌘.">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} className="contents">
            <dt>
              <kbd className="rounded-md border border-white/15 bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-white">{k}</kbd>
            </dt>
            <dd className="text-text">{v}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
