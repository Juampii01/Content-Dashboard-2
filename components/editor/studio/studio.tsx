"use client";

import { cleanGrade, gradeCurve, gradeMatrix, presetGrade } from "@/lib/video/grade";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, AudioLines, BarChart3, Bot, Captions, Film, Flag, Sparkles, WandSparkles, ZoomIn, Clapperboard, Keyboard, Library, Loader2, Maximize2, Minimize2, Minus, PanelLeftClose, PanelLeftOpen, Pause, Play, Plus, Redo2, Scissors, SpellCheck, SplitSquareHorizontal, Trash2, Type, Undo2, Wand2 } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { formatDuration, formatNumber } from "@/lib/format";
import { isDefaultEdit, resolveEdit, type BrollEdit } from "@/lib/video/broll-edit";
import { withLibraryStart } from "@/lib/video/library-ficha";
import { captionLook, isCaptionStyle } from "@/lib/video/caption-styles";
import { captionBlocks, dropWords, hideDuring, USER_CAPTION_HIDE, userHiddenWords } from "@/lib/video/captions";
import { protectedZones } from "@/lib/video/director/protect";
import { brollSegments, computeZooms, directorZooms, graphicEntries, graphicHidesCaptions } from "@/lib/video/effects";
import { FX_INFO, type FxKind } from "@/lib/video/fx/catalog";
import { compileFx, faceAnchor, fxBrandFromLook, fxCaptionHides, fxSegments, sourceFramesOf, sourceRangesOf } from "@/lib/video/fx/compile";
import { FX_MASK_CHUNK } from "@/lib/video/fx/masks";
import { defaultFx, newFxId, type FxItem } from "@/lib/video/fx/schema";
import { defaultGraphic, type GraphicTemplate } from "@/lib/video/graphics";
import { clearFaceBands, compileComposition, composCaptionHides, composSegments, composSounds, type Composition } from "@/lib/video/compos/schema";
import { WholeVideoDialog } from "../compos/whole-video-dialog";
import { isActive, requestStage, useComposRequests, type ComposRequest, type LiveRequest } from "../compos/use-compos-work";
import { placeMyEffectAction } from "../my-effects-actions";
import { wholeFromChatAction } from "../compos-actions";
import { humanize as humanizeText } from "@/lib/video/human-text";
import { brollGraphicOption, graphicKindLabel, motionTheme, type BrollGraphic } from "@/lib/video/motion-graphics";
import { isTextPreset, TEXT_PRESETS, TEXT_SECONDS, textOption, updateTextOption, type TextPresetKey, type TextSpecInput } from "@/lib/video/text-presets";
import { rangesFromIds, MAX_BROLL } from "@/lib/video/plan";
import { fillRhythm, rhythmScore, themeOfPlan, RHYTHM_TAG, type Density } from "@/lib/video/rhythm";
import { cueClip, fitCueClip, hookEnd, MIN_CUE_LENGTH, newSoundCueId, SFX_FILES, sfxCues, soundCueTimes, SOUND_GAIN } from "@/lib/video/sfx";
import { isSfxName, SFX_LIBRARY, type SfxName } from "@/lib/video/sfx-library";
import { compileTransition, cutPoints, freeAnchor, isFreeTransition, isTransitionKind, newTransitionId, TRANSITION_INFO, TRANSITION_SOUND_GAIN, transitionSegments, transitionSounds, type TransitionItem } from "@/lib/video/fx/transitions";
import { musicGenLabel } from "@/lib/video/music-gen/catalog";
import { MUSIC_STYLE_INFO } from "@/lib/video/music-gen/spec";
import { useGeneratedMusic } from "../sound/use-sound";
import { useMusicBuffer, peaksOfBuffer, useStudioMix } from "./use-studio-mix";
import { useVoicePeaks } from "./use-voice-peaks";
import { useTimelineView, useTrackSize } from "./use-track-size";
import { MiniWave, useSfxPeaks } from "./waveform";
import { TrackToggles } from "./mixer";
import { audible, fadeGainAt, fitMusicFade, MUSIC_FADE } from "@/lib/video/audio-mix";
import { plainColumns, waveColumns } from "@/lib/video/peaks";
import { anchorAt, MAX_MARKERS, newMarkerId, placeMarkers } from "@/lib/video/markers";
import { stepFrame, timecode } from "@/lib/video/timecode";
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
import { AudioBlock, FramingAndZooms, StudioInspector } from "./studio-inspector";
import { AiTab } from "./ai-tab";
import { HANDLE_CLASS, usePanelWidth } from "./panel-width";
import { movePart } from "@/lib/video/sequence";
import { aiItems, AiPanel, LibraryPanel } from "./studio-panels";
import { EditPanel, PartsTool } from "./edit-panel";
import { SubtitlesPanel } from "./subtitles-panel";
import { SUBS_AFTER_KEY, SubtitleBar } from "./subtitle-bar";
import type { RefImage } from "@/lib/video/compos/schema";
import { suggestTrimAction } from "../edit-actions";
import { StudioTimeline, type DropPreview, type LibraryDrop, type StudioSelection, type TimelineBlock, type TrackKey, type WaveTrack } from "./studio-timeline";
import { USER_TAG, type StudioApi, type StudioProps } from "./types";
import { studioPacing, studioTimelineInput, toReview, useStudioState, withCut, withPause, type StudioState } from "./use-studio-state";
import { FEATURES } from "@/lib/features";

let brollCounter = 0;
const newBrollId = () => `u${Date.now().toString(36)}${(brollCounter++).toString(36)}`;
const stripTag = (why: string | undefined) => (why ?? "").replace(RHYTHM_TAG, "").replace(USER_TAG, "").trim();
type LeftTab = "ia" | "edicion" | "subtitulos" | "texto" | "audio" | "biblioteca";
/** Panel de herramientas: arranca en la mitad de la pantalla (el video, la otra mitad) y se arrastra su borde. */
const TOOLS_W = { min: 380, max: 1200, default: 640, fraction: 0.5 };
/** Edición solo con IA: chat y video, sin línea de tiempo ni paneles manuales. */
const AI_ONLY = FEATURES.aiOnly;

const LEFT_TABS = [
  { v: "ia", label: "Editor IA", Icon: Bot },
  { v: "edicion", label: "Edición", Icon: Scissors },
  { v: "subtitulos", label: "Subtítulos", Icon: Captions },
  { v: "texto", label: "Transcripción", Icon: Type },
  { v: "audio", label: "Audio y música", Icon: AudioLines },
  { v: "biblioteca", label: "Biblioteca", Icon: Library },
] as const;

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
  const [leftTab, setLeftTab] = useState<LeftTab>("ia");
  const [leftOpen, setLeftOpen] = useState(true);
  // Anchos de los paneles (se arrastra su borde; se recuerdan en este navegador).
  const { width: leftW, handle: leftHandle } = usePanelWidth("studio.toolsW", TOOLS_W, "left");
  const [timelineView, setTimelineView] = useTimelineView();
  // Alto de la línea de tiempo (se arrastra su borde de arriba): con las pistas de audio, más alta que antes.
  const { width: timelineH, handle: timelineHandle } = usePanelWidth("studio.timelineH", { min: 200, max: 640, default: 380 }, "bottom");
  // Pantalla completa de la vista previa: solo el video (Esc o F para salir).
  const [full, setFull] = useState(false);
  const center = useRef<HTMLDivElement>(null);
  function toggleFull() {
    const el = center.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else if (el.requestFullscreen) void el.requestFullscreen().catch(() => toast.error("Tu navegador no dejó abrir la pantalla completa."));
  }
  // Varios bloques elegidos juntos (rectángulo en la línea de tiempo) y el menú «Agregar aquí».
  const [multi, setMulti] = useState<string[]>([]);
  const [addMenu, setAddMenu] = useState<{ t: number; x: number; y: number } | null>(null);
  // Lo usa el teclado (definido antes que los bloques de la línea de tiempo).
  const removeManyRef = useRef<(keys: string[]) => void>(() => {});
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
  // Lo elegido se abre en el panel de herramientas, salvo lo que se elige escribiendo en la transcripción.
  const panelSel = (Boolean(selection) && !(leftTab === "texto" && ["range", "pause", "cut", "caption"].includes(selection!.kind))) || multi.length > 1;

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

  const { removed: sRemoved, selectedHook: sHook, corrections: sCorrections, preset: sPreset, emphasis: sEmphasis, pacing: sPacing, pauses: sPauses, moves: sMoves, sequence: sSequence } = s;
  const timeline = useMemo(
    () => buildTimeline(words, studioTimelineInput(plan, { removed: sRemoved, selectedHook: sHook, corrections: sCorrections, preset: sPreset, emphasis: sEmphasis, pacing: sPacing, pauses: sPauses, moves: sMoves, sequence: sSequence }), duration),
    [words, plan, sRemoved, sHook, sCorrections, sPreset, sEmphasis, sPacing, sPauses, sMoves, sSequence, duration],
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
        manual: soundCueTimes(timeline, s.soundCues).map(({ cue, hitAt }) => ({ name: cue.name, hitAt, gain: cue.gain, trim_in: cue.trim_in, trim_out: cue.trim_out, fade_in: cue.fade_in, fade_out: cue.fade_out })),
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
        kind: sg.option.kind,
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
  useEffect(() => {
    canvasStep.current = `canvas:${canvasSelected ?? ""}`;
  }, [canvasSelected]);
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

  /** ¿Entra otro b-roll, gráfico o texto? (el plan admite MAX_BROLL; más no se podría guardar). Si no, avisa. */
  function roomForBroll(): boolean {
    if (s.broll.length < MAX_BROLL) return true;
    toast.error(`Llegaste al máximo de ${MAX_BROLL} b-roll, gráficos y textos en un video.`, { description: "Quita alguno que ya no uses para agregar otro." });
    return false;
  }

  function addBroll(range: WordSpan, ask = false, prompt?: string) {
    if (!roomForBroll()) return;
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

  /**
   * Un video que subió la persona (ya en su biblioteca) en un tramo: si el tramo dura más que el clip, se acorta a lo
   * que dura el clip (desde su inicio).
   */
  function addClipBroll(rawRange: WordSpan, option: SignedOption) {
    if (!roomForBroll()) return;
    let range = rawRange;
    const r0 = outputRange(timeline, range.from, range.to);
    if (r0 && option.duration > 0 && r0.end - r0.start > option.duration + 0.2) {
      const short = snapToWords(timeline, r0.start, r0.start + option.duration);
      if (short) range = { from: short.from, to: short.to };
    }
    const plain: BrollOption = { ...option };
    delete (plain as Partial<SignedOption>).thumbUrl;
    delete (plain as Partial<SignedOption>).previewUrl;
    setSigned((prev) => ({ ...prev, [optionKey(option)]: option }));
    const r = outputRange(timeline, range.from, range.to);
    // Un clip de la biblioteca con su momento se ve desde ese segundo.
    const item: BrollItem = withLibraryStart({ id: newBrollId(), from_word: range.from, to_word: range.to, query_en: (option.title ?? "clip").slice(0, 100), keywords: [], why: "Tu video, donde lo pediste.", choice: plain, options: [plain] }, r ? r.end - r.start : 0);
    const top = r ? layerOnTop(r.start, r.end) : { layer: undefined, under: [] };
    if (top.layer != null) item.layer = top.layer;
    update((st) => ({ ...st, broll: [...st.broll, item].sort((a, b) => a.from_word - b.from_word) }));
    notifyOnTop(top.under);
    setSelection({ kind: "broll", id: item.id });
    if (r) seek(r.start);
    toast.success("Listo: tu video quedó en ese momento. Ajusta el encuadre o el largo en la pista B-roll.");
  }

  /** Un gráfico de plantilla en un tramo (se abre el estudio de gráficos para ajustarlo). */
  function addGraphic(range: WordSpan, template: GraphicTemplate) {
    if (!roomForBroll()) return;
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

  /** Un texto a mano en un tramo: el estilo con su texto de muestra, elegido para escribir el tuyo en el panel. */
  function addText(range: WordSpan, preset: TextPresetKey, text?: string) {
    if (!roomForBroll()) return;
    const p = TEXT_PRESETS[preset];
    const own = text?.trim();
    const option = textOption({ preset, text: own || p.sample, ...(p.sub && !own ? { sub: p.sub } : {}) }, graphicLook, { format: s.format });
    const item: BrollItem = { id: newBrollId(), from_word: range.from, to_word: range.to, query_en: "", keywords: [], choice: option, options: [option] };
    const r = outputRange(timeline, range.from, range.to);
    const top = r ? layerOnTop(r.start, r.end) : { layer: undefined, under: [] };
    if (top.layer != null) item.layer = top.layer;
    update((st) => ({ ...st, broll: [...st.broll, item].sort((a, b) => a.from_word - b.from_word) }));
    notifyOnTop(top.under);
    setSelection({ kind: "broll", id: item.id });
    if (r) seek(r.start);
  }

  /** Cambia un texto a mano (texto, estilo, color, tamaño o lugar): se vuelve a armar su escena. */
  function setText(id: string, patch: Partial<TextSpecInput>) {
    update(
      (st) => ({
        ...st,
        broll: st.broll.map((b) => {
          if (b.id !== id || !b.choice) return b;
          const next = updateTextOption(b.choice, patch, graphicLook, st.format);
          return next ? { ...b, choice: next, options: [next] } : b;
        }),
      }),
      { coalesce: `txt:${id}` },
    );
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
        // Un clip de la biblioteca con su momento (de la ficha) se ve desde ese segundo.
        const r = outputRange(timeline, b.from_word, b.to_word);
        return withLibraryStart({ ...b, choice: plain, options: b.options.some((o) => optionKey(o) === optionKey(plain)) ? b.options : [plain, ...b.options].slice(0, 12) }, r ? r.end - r.start : 0);
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
      ...(s.sequence ? { sequence: s.sequence } : {}),
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
    else if (sel.kind === "marker") update((st) => ({ ...st, markers: st.markers.filter((m) => m.id !== sel.id) }));
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

  /** «Agregar aquí» (doble clic o clic derecho en la línea de tiempo): lo que se pone en ese segundo. */
  function addHere(kind: "animacion" | "grafico" | "broll" | "efecto" | "zoom" | "sonido", t: number) {
    setAddMenu(null);
    const span = spanAround(timeline, t, kind === "zoom" ? 1.5 : 3);
    if (!span) return void toast.info("Ahí no hay video. Elige otro lugar.");
    const range = { from: span.from, to: span.to };
    setLeftOpen(true);
    if (kind === "animacion") animationAt(range);
    else if (kind === "grafico") addBroll(range, true);
    else if (kind === "broll") addBroll(range);
    else if (kind === "efecto") setGallery({ range, replace: null });
    else if (kind === "zoom") addZoom(range);
    else {
      seek(t);
      setSelection(null);
      setLeftTab("biblioteca");
      toast.info("Arrastra un sonido de la Biblioteca a la pista Sonido.");
    }
  }

  /**
   * Divide el video en el cabezal: la parte nueva empieza en la palabra que suena. Solo el video (subtítulos, b-roll y
   * animaciones quedan igual); después se puede elegir una parte y quitarla con Supr.
   */
  function splitVideo() {
    if (!canEdit) return;
    const t = outRef.current + 0.01;
    const here = wordAt(timeline, t);
    if (!here) return void toast.info("Pon la línea de reproducción donde quieres cortar el video.");
    // El video se corta entre palabras: se usa el borde más cercano a la línea (si la palabra que suena ya va por la
    // mitad, el corte cae después de ella, no al comienzo).
    const idx = timeline.words.indexOf(here);
    const after = timeline.words[idx + 1];
    const w = after && t > (here.start + here.end) / 2 ? after : here;
    const clip = timeline.clips.find((c) => w.id >= c.firstWord && w.id <= c.lastWord);
    const first = timeline.words.find((x) => clip && x.id >= clip.firstWord && x.id <= clip.lastWord);
    if (!clip || first?.id === w.id || s.splits.includes(w.id)) return void toast.info("Ahí ya hay un corte. Mueve la línea a otro lugar.");
    update((st) => ({ ...st, splits: [...st.splits, w.id].sort((a, b) => a - b) }));
    // El cabezal va justo al corte, así se ve dónde quedó.
    seek(w.start);
    toast.success("Video cortado aquí.", { description: "El corte cae en el espacio entre dos palabras. Toca una parte en la pista Video y bórrala con Supr si no la quieres." });
  }

  /** La parte del video elegida (un tramo de la pista Video o de la transcripción), en palabras del original. */
  function chosenPart(): { from: number; to: number } | null {
    if (selection?.kind === "range") return { from: selection.from, to: selection.to };
    if (selection?.kind === "clip") {
      const c = timeline.clips[selection.index];
      return c ? { from: c.firstWord, to: c.lastWord } : null;
    }
    return null;
  }

  /** Mueve la parte elegida un lugar antes o después (a mano: la IA nunca cambia el orden). Se deshace con Ctrl+Z. */
  function moveChosen(dir: -1 | 1) {
    if (!canEdit) return;
    const part = chosenPart();
    if (!part) return void toast.info("Elige una parte en la pista Video (divide con C) y después muévela.");
    const r = movePart({ wordCount: words.length, sequence: s.sequence, splits: s.splits, removed: removedSet, part, dir });
    if (!r.ok) return void toast.info(r.error);
    // Los bordes de la parte quedan como divisiones, así se puede seguir moviendo la misma parte.
    const edges = [part.from, part.to + 1].filter((id) => id > 0 && id < words.length);
    update((st) => ({ ...st, sequence: r.sequence, splits: [...new Set([...st.splits, ...edges])].sort((a, b) => a - b) }));
    toast.success(dir < 0 ? "Parte movida antes." : "Parte movida después.", { description: "Se deshace con Ctrl+Z." });
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
      if (!item || !parts) return void toast.error("Pon la línea de reproducción dentro del bloque, después de su primera palabra.");
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
      if (!item || !parts) return void toast.error("Pon la línea de reproducción dentro del efecto, después de su primera palabra.");
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
      if (!m || !parts) return void toast.error("Pon la línea de reproducción dentro del zoom, después de su primera palabra.");
      const next = [...s.zoomMoments.filter((_, i) => i !== sel.index), { ...m, to_word: parts[0].to }, { ...m, from_word: parts[1].from }].sort((x, y) => x.from_word - y.from_word);
      update((st) => ({ ...st, rhythmTouched: true, zoomMoments: next }));
      setSelection({ kind: "zoom", index: next.findIndex((z) => z.from_word === parts[1].from) });
    }
  }

  /**
   * Duplica lo elegido (b-roll, texto, gráfico, efecto o zoom) justo después, con el mismo largo y la misma edición, como
   * Ctrl+D en un editor. Si después no hay palabras suficientes, avisa. Se deshace con Ctrl+Z.
   */
  function duplicate() {
    const sel = selection;
    if (!canEdit || !sel) return;
    const after = (from: number, to: number) => {
      const r = outputRange(timeline, from, to);
      if (!r) return null;
      const len = Math.max(0.6, r.end - r.start);
      const span = snapToWords(timeline, r.end + 0.02, Math.min(timeline.duration, r.end + 0.02 + len));
      return span && span.from > to ? span : null;
    };
    const full = () => toast.error("Después de esto no queda lugar en el video para la copia. Mueve la línea de reproducción o acorta el bloque.");
    if (sel.kind === "broll") {
      const item = s.broll.find((b) => b.id === sel.id);
      if (!item) return;
      if (!roomForBroll()) return;
      const span = after(item.from_word, item.to_word);
      if (!span) return full();
      const copy: BrollItem = { ...item, id: newBrollId(), from_word: span.from, to_word: span.to };
      const r = outputRange(timeline, span.from, span.to);
      const top = r ? layerOnTop(r.start, r.end) : { layer: undefined, under: [] };
      if (top.layer != null) copy.layer = top.layer;
      else delete copy.layer;
      update((st) => ({ ...st, broll: [...st.broll, copy].sort((a, b) => a.from_word - b.from_word) }));
      setSelection({ kind: "broll", id: copy.id });
      if (r) seek(r.start);
    } else if (sel.kind === "fx") {
      const item = s.effects.find((e) => e.id === sel.id);
      if (!item) return;
      const span = after(item.from_word, item.to_word);
      if (!span) return full();
      const shift = span.from - item.from_word;
      const copy: FxItem = { ...item, id: newFxId(), from_word: span.from, to_word: span.to, words: item.words?.map((w) => w + shift).filter((w) => w <= span.to), source: "user" };
      update((st) => ({ ...st, effects: [...st.effects, copy].sort((a, b) => a.from_word - b.from_word) }));
      setSelection({ kind: "fx", id: copy.id });
      const r = outputRange(timeline, span.from, span.to);
      if (r) seek(r.start);
    } else if (sel.kind === "zoom") {
      const m = s.zoomMoments[sel.index];
      if (!m) return;
      const span = after(m.from_word, m.to_word);
      if (!span) return full();
      const next = [...s.zoomMoments, { ...m, from_word: span.from, to_word: span.to }].sort((a, b) => a.from_word - b.from_word);
      update((st) => ({ ...st, rhythmTouched: true, zoomMoments: next }));
      setSelection({ kind: "zoom", index: next.findIndex((z) => z.from_word === span.from) });
    } else {
      return void toast.info("Duplicar funciona con b-roll, textos, gráficos, efectos y zooms.");
    }
    toast.success("Duplicado justo después.", { description: "Muévelo o cambia su largo en la línea de tiempo. Ctrl+Z lo deshace." });
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
  // Pistas de audio: la música (un bloque a lo largo del video, con sus fundidos) y la forma de onda de cada sonido.
  const musicTrack = s.musicGen ? null : (tracks.find((t) => t.id === s.music.trackId) ?? null);
  const musicLabel = s.musicGen ? `Música · ${musicGenLabel(s.musicGen)}` : musicTrack ? `Música · ${musicTrack.title}` : null;
  const sfxPeaks = useSfxPeaks(s.soundCues.map((c) => c.name));
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
      // El archivo empieza en `at`; suena su tramo recortado (lo que se ve del bloque).
      const at = Math.max(0, hitAt - file.hit);
      const clip = cueClip(cue);
      const start = at + clip.from;
      out.push({
        key: `sound:${cue.id}`,
        track: "audio",
        start,
        end: Math.min(timeline.duration, start + Math.max(MIN_CUE_LENGTH, clip.length)),
        label: SFX_LIBRARY[cue.name].label,
        tone: "border-warning/70 bg-warning/30 text-[#5b3b00]",
        ai: cue.source === "director",
        editable: true,
        // Se mueve en segundos (sin imán a las palabras) y sus bordes lo recortan dentro del archivo.
        free: true,
        min: MIN_CUE_LENGTH,
        max: file.duration,
        fades: { in: cue.fade_in ?? 0, out: cue.fade_out ?? 0, max: clip.length },
        wave: <MiniWave peaks={sfxPeaks[cue.name]} from={clip.from} length={clip.length} fadeIn={cue.fade_in} fadeOut={cue.fade_out} className="h-full w-full text-[#8a5a00]/45" />,
        dim: !audible(s.mix, "sfx"),
        // Varios sonidos a la vez suenan juntos: los carriles son solo para verlos.
        z: -s.soundCues.indexOf(cue),
        selection: { kind: "sound", id: cue.id },
      });
    }
    if (musicLabel) {
      const fade = fitMusicFade(s.musicFade, timeline.duration);
      out.push({
        key: "music",
        track: "music",
        start: 0,
        end: timeline.duration,
        label: musicLabel,
        tone: "border-[#c98500]/45 bg-[#c98500]/[0.07] text-[#6b4700]",
        fades: { in: fade.in, out: fade.out, max: Math.min(MUSIC_FADE.max, timeline.duration / 2) },
        dim: !audible(s.mix, "music"),
        selection: { kind: "audio" },
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
  }, [timeline, captions, s.broll, s.zoomMoments, segments, fxSegs, composSegs, styleZooms, zooms, textOf, signedOf, trSegs, s.soundCues, stackOrder, maskMissing, masks?.pending, s.splits, sfxPeaks, s.mix, s.musicFade, musicLabel]);

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
    // En la vista por capas todo lo que se superpone comparte pistas (V2, V3…): el carril se cuenta entre todos.
    const kinds: LayerKind[] = timelineView === "capas" ? ["broll", "fx", "compos", "transition"] : kind === "broll" ? ["broll"] : kind === "compos" ? ["compos"] : ["fx", "transition"];
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
      const file = SFX_FILES[cue.name];
      const clip = cueClip(cue);
      const at = block.start - clip.from;
      if (mode === "move") {
        placeSound(cue.id, cue.name, span.start - clip.from + file.hit, cue.gain);
        return;
      }
      // Recortar: el archivo queda donde estaba; cambia qué parte suena.
      const trimIn = mode === "start" ? Math.max(0, span.start - at) : (cue.trim_in ?? 0);
      const trimOut = mode === "end" ? Math.max(0, at + file.duration - span.end) : (cue.trim_out ?? 0);
      update((st) => ({ ...st, soundCues: st.soundCues.map((c) => (c.id === cue.id ? fitCueClip({ ...c, trim_in: trimIn, trim_out: trimOut, source: "user" as const }) : c)) }));
      setSelection({ kind: "sound", id: cue.id });
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
    // Mover conserva el recorte y los fundidos del sonido; cambiarlo por otro los ajusta al archivo nuevo.
    update((st) => {
      const prev = st.soundCues.find((c) => c.id === cueId);
      const next = fitCueClip({ ...(prev ?? {}), id: cueId, name, at_word: w.id, offset, gain, source: "user" as const });
      return { ...st, soundCues: [...st.soundCues.filter((c) => c.id !== cueId), next].slice(-40) };
    });
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
    if (item.type === "clip") {
      const span = spanAround(timeline, t, clipSpanSeconds(item.option));
      return span ? { track: "broll", start: span.start, end: span.end, label: item.option.title ?? "Tu clip" } : null;
    }
    if (item.type === "text") {
      if (!isTextPreset(item.preset)) return null;
      const span = spanAround(timeline, t, TEXT_SECONDS);
      return span ? { track: "broll", start: span.start, end: span.end, label: TEXT_PRESETS[item.preset].label } : null;
    }
    if (item.type === "mine") {
      const span = mineSpan(item, t);
      const seg = span ? composSegments(timeline, [{ id: "drop", from_word: span.from, to_word: span.to, name: item.name, code: "x", params: [], source: "user" }])[0] : null;
      return seg ? { track: "anim", start: seg.start, end: seg.end, label: item.name } : null;
    }
    return null;
  };

  /** Cuánto ocupa un clip de la biblioteca soltado en la línea de tiempo: su largo (hasta 6 s); una imagen, 3 s. */
  function clipSpanSeconds(option: SignedOption) {
    if (option.kind === "image") return 3;
    return Math.max(1, Math.min(6, option.duration || 3));
  }

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
    } else if (item.type === "clip") {
      const span = spanAround(timeline, t, clipSpanSeconds(item.option));
      if (!span) return noWords();
      addClipBroll(span, item.option);
    } else if (item.type === "text") {
      if (!isTextPreset(item.preset)) return;
      const span = spanAround(timeline, t, TEXT_SECONDS);
      if (!span) return noWords();
      addText(span, item.preset);
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
  // Versión que se guarda sí o sí antes del próximo guardado (un cambio grande, como reemplazar una animación).
  const checkpoint = useRef<string | null>(null);
  useEffect(() => {
    if (!canEdit || reviewKey === savedKey) return;
    const timer = setTimeout(async () => {
      if (sending.current) return;
      setSaving("saving");
      const acks = acksApi.current?.take() ?? [];
      const label = checkpoint.current;
      checkpoint.current = null;
      const result = await saveReviewAction(projectId, review, s.format, label ? { checkpoint: label } : {});
      acksApi.current?.confirm(acks, result.ok);
      if (!result.ok && label && !checkpoint.current) checkpoint.current = label;
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

  // Marcadores (tecla M): numerados por su orden en el video final.
  const placedMarkers = useMemo(() => placeMarkers(timeline, s.markers, timeline.duration), [timeline, s.markers]);
  function addMarker() {
    if (!canEdit) return;
    const t = outRef.current;
    const near = placedMarkers.find((m) => Math.abs(m.at - t) < 0.1);
    if (near) return void select({ kind: "marker", id: near.marker.id }, { seek: false });
    if (s.markers.length >= MAX_MARKERS) return void toast.info(`Ya hay ${MAX_MARKERS} marcadores: quita alguno para poner otro.`);
    const anchor = anchorAt(timeline, t);
    if (!anchor) return void toast.info("Ahí no hay video. Mueve la línea de reproducción a otro lugar.");
    const id = newMarkerId();
    update((st) => ({ ...st, markers: [...st.markers, { id, ...anchor, note: "" }] }));
    setLeftOpen(true);
    select({ kind: "marker", id }, { seek: false });
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
      if (mod && (key === "d" || key === "D")) {
        if (typing(e.target)) return;
        e.preventDefault();
        duplicate();
        return;
      }
      if (mod && (key === "y" || key === "Y")) {
        if (typing(e.target)) return;
        e.preventDefault();
        redo();
        return;
      }
      if (mod || typing(e.target)) return;
      // Mayús + Alt + flechas: mueve la parte del video elegida un lugar antes o después.
      if (e.altKey && e.shiftKey && (key === "ArrowLeft" || key === "ArrowRight") && (selection?.kind === "range" || selection?.kind === "clip")) {
        e.preventDefault();
        moveChosen(key === "ArrowRight" ? 1 : -1);
        return;
      }
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
          } else seek(stepFrame(outRef.current, dir, timeline.duration));
          return;
        }
        case "m":
        case "M":
          e.preventDefault();
          addMarker();
          return;
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
          if (multi.length > 1) {
            e.preventDefault();
            removeManyRef.current(multi);
            return;
          }
          if (!selection) return;
          e.preventDefault();
          removeSelection();
          return;
        case "Escape":
          setSelection(null);
          setMulti([]);
          setAddMenu(null);
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
        case "f":
        case "F":
          e.preventDefault();
          toggleFull();
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
  // En pantalla completa no hay línea de abajo, pero sí la barra del reproductor (~44 px).
  const previewW = box && box.h > 200 ? Math.max(180, Math.min(box.w - 16, (box.h - (full ? 60 : 52)) * ratio)) : null;

  // Pantalla completa: solo el video, con su barra de reproducción. F o el botón; Esc o F para salir.
  useEffect(() => {
    const on = () => setFull(Boolean(document.fullscreenElement) && document.fullscreenElement === center.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

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
  // Sonidos y música también en la vista previa (los mismos archivos, el mismo generador y la misma mezcla que el
  // render): voz, música y efectos con su volumen, silenciar y solo, fundidos y la música bajando cuando hablas.
  const genMusic = useGeneratedMusic(s.musicGen, timeline.duration);
  const trackBuffer = useMusicBuffer(musicTrack?.url ?? null, musicTrack?.id ?? null);
  const musicBuffer = s.musicGen ? genMusic.buffer : trackBuffer;
  const voicePeaks = useVoicePeaks(projectId, Boolean(proxyUrl));
  const mixer = useStudioMix({
    playing,
    time: outTime,
    duration: timeline.duration,
    timeline,
    cues: sfxMarks,
    music: s.musicGen ? { kind: "buffer", buffer: genMusic.buffer } : trackBuffer ? { kind: "buffer", buffer: trackBuffer } : musicTrack?.url ? { kind: "url", url: musicTrack.url } : null,
    musicDb: s.music.db,
    musicFade: s.musicFade,
    voiceDb: s.voiceDb,
    mix: s.mix,
    target: plan.audio.target_lufs,
    voicePeaks,
    video: videoEl,
  });
  // Formas de onda de la voz (los tramos que quedan del original, con sus cortes) y de la música (en bucle, con sus
  // fundidos y su volumen), para la línea de tiempo.
  const musicPeaks = useMemo(() => peaksOfBuffer(musicBuffer), [musicBuffer]);
  const waves = useMemo(() => {
    const out: Partial<Record<TrackKey, WaveTrack>> = {};
    const clipsKey = timeline.clips.map((c) => `${c.startFrame}-${c.endFrame}`).join(",");
    if (voicePeaks) {
      let acc = 0;
      const marks = timeline.clips.slice(0, -1).map((c) => (acc += (c.endFrame - c.startFrame) / FPS));
      // Se dibuja a escala de lo que hay (los teléfonos graban bajo): lo más fuerte llega casi arriba.
      const scale = 0.92 / Math.max(0.04, loudestPeak(voicePeaks.peak));
      out.voice = { columns: (t0, t1, n) => waveColumns(voicePeaks, timeline, t0, t1, n).map((v) => Math.min(1, v * scale)), version: `${clipsKey}|${voicePeaks.peak.length}`, color: audible(s.mix, "voice") ? "rgba(36,87,245,.55)" : "rgba(106,110,117,.35)", marks };
    }
    if (musicPeaks && musicLabel) {
      const fade = fitMusicFade(s.musicFade, timeline.duration);
      const level = Math.min(1, 10 ** ((s.music.db + 16) / 40));
      out.music = {
        columns: (t0, t1, n) => {
          const cols = plainColumns(musicPeaks, 0, t0, t1, n, true);
          const step = (t1 - t0) / Math.max(1, n);
          for (let i = 0; i < cols.length; i++) cols[i] = cols[i]! * level * fadeGainAt(t0 + (i + 0.5) * step, 0, timeline.duration, fade.in, fade.out);
          return cols;
        },
        version: `${musicPeaks.peak.length}|${fade.in}|${fade.out}|${s.music.db}|${timeline.duration}`,
        color: audible(s.mix, "music") ? "rgba(201,133,0,.6)" : "rgba(106,110,117,.35)",
      };
    }
    return out;
  }, [voicePeaks, musicPeaks, musicLabel, timeline, s.mix, s.musicFade, s.music.db]);

  // Alto de las pistas (se recuerda en este navegador).
  const [trackSize, setTrackSize] = useTrackSize();

  // Un fundido estirado con su manija en la línea de tiempo.
  function fadeBlock(block: TimelineBlock, which: "in" | "out", seconds: number) {
    const sel = block.selection;
    if (sel.kind === "sound") {
      update((st) => ({ ...st, soundCues: st.soundCues.map((c) => (c.id === sel.id ? fitCueClip({ ...c, [which === "in" ? "fade_in" : "fade_out"]: seconds, source: "user" as const }) : c)) }));
      setSelection(sel);
    } else if (sel.kind === "audio") {
      update((st) => ({ ...st, musicFade: { ...st.musicFade, [which]: Math.round(seconds * 10) / 10 } }));
    }
  }

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
      // Un reemplazo (el del chat o «Pídele un cambio») guarda antes una versión propia: se puede volver a la animación de antes.
      if (req.request?.replaceId) checkpoint.current = `Antes de cambiar una animación (pedido: «${req.request.instruction.replace(/\s+/g, " ").slice(0, 90)}»)`;
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
            // El pedido completo es largo: en la pista se ve qué es y cómo va (el pedido entero, al tocarlo).
            label: "Nueva animación",
            detail: requestStage(r),
            tone: "border-[#a78bfa]/80",
            pending: true,
            // Abajo de todo al acomodar los carriles: lo que se está creando no corre de lugar a lo que ya está.
            z: -100_000 - i,
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

  /** Quita de una vez todo lo elegido junto (b-roll, gráficos, efectos, animaciones, zooms, transiciones y sonidos). */
  function removeMany(keys: string[]) {
    if (!canEdit || !keys.length) return;
    const sels = keys.map((k) => allBlocks.find((b) => b.key === k)?.selection).filter((x): x is StudioSelection => Boolean(x));
    const ids = (kind: string) => new Set(sels.flatMap((x) => (x.kind === kind && "id" in x && x.id ? [x.id] : [])));
    const broll = ids("broll");
    const fx = ids("fx");
    const compos = ids("compos");
    const sounds = ids("sound");
    const trans = ids("transition");
    const zooms = new Set(sels.flatMap((x) => (x.kind === "zoom" && x.index >= 0 ? [x.index] : [])));
    update((st) => ({
      ...st,
      broll: st.broll.filter((b) => !broll.has(b.id)),
      effects: st.effects.filter((e) => !fx.has(e.id)),
      compositions: st.compositions.filter((c) => !compos.has(c.id)),
      soundCues: st.soundCues.filter((c) => !sounds.has(c.id)),
      transitions: st.transitions.filter((t) => !trans.has(t.id)),
      ...(zooms.size ? { rhythmTouched: true, zoomMoments: st.zoomMoments.filter((_, i) => !zooms.has(i)) } : {}),
    }));
    setMulti([]);
    setSelection(null);
    toast.success(`Se ${sels.length === 1 ? "quitó 1 elemento" : `quitaron ${sels.length} elementos`}.`, { description: "Se deshace con Ctrl+Z." });
  }

  useEffect(() => {
    removeManyRef.current = removeMany;
  });

  /** Mueve juntos los bloques elegidos `delta` segundos (cada uno se acomoda a sus palabras). */
  function moveMany(keys: string[], delta: number) {
    if (!canEdit) return;
    for (const k of keys) {
      const b = allBlocks.find((x) => x.key === k);
      if (!b || !b.editable) continue;
      const start = Math.max(0, Math.min(timeline.duration - (b.end - b.start), b.start + delta));
      const span = b.free ? { from: 0, to: 0, start, end: start + (b.end - b.start) } : snap(start, start + (b.end - b.start), b);
      if (span) commitBlock(b, span, "move");
    }
    setSelection(null);
  }

  useEffect(() => {
    acksApi.current = { take: composWork.takeAcks, confirm: composWork.confirmAcks };
  }, [composWork.takeAcks, composWork.confirmAcks]);
  async function requestAnimation(req: ComposRequest): Promise<boolean> {
    const ok = await composWork.request(req);
    if (ok) toast.success("Creando la animación: aparece sola cuando termina. Puedes pedir otras mientras tanto.", { duration: 3000 });
    return ok;
  }

  // «Transcribir y subtitular»: el video volvió con su transcripción nueva, así que se encienden los subtítulos.
  useEffect(() => {
    const key = SUBS_AFTER_KEY(props.projectId);
    try {
      if (localStorage.getItem(key) !== "1" || !props.words.length) return;
    } catch {
      return;
    }
    const preset = props.captionDefault && props.captionDefault !== "ninguno" ? props.captionDefault : "caja";
    const t = setTimeout(() => {
      try {
        localStorage.removeItem(key);
      } catch {
        // Nada que limpiar.
      }
      update((st) => (st.preset === "ninguno" ? { ...st, preset } : st));
      setLeftTab("texto");
    }, 0);
    return () => clearTimeout(t);
    // Solo al abrir la revisión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Las herramientas de la pestaña Edición, también para el chat con la IA.
  function animationAt(range: WordSpan, prompt?: string, refs?: RefImage[], opts?: { fromChat?: boolean; clips?: string[] }) {
    if (prompt) {
      void requestAnimation({ from_word: range.from, to_word: range.to, instruction: prompt, replace: null, ...(refs?.length ? { refs } : {}), ...(opts?.clips?.length ? { clips: opts.clips } : {}), ...(opts?.fromChat ? { fromChat: true } : {}) });
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
  }
  function applyTrim(ids: number[]) {
    update((st) => ({ ...st, removed: [...new Set([...st.removed, ...ids])].sort((a, b) => a - b), pauses: { keep: [], all: false } }));
    setSelection(null);
  }
  /** Lleva al Chat con la IA (panel derecho) y deja el cursor para escribir. */
  function openChat() {
    setSelection(null);
    setLeftOpen(true);
    setLeftTab("ia");
    setTimeout(() => document.getElementById("video-chat-msg")?.focus(), 120);
  }
  function openWholeVideo(notes?: string) {
    setWholeNotes((notes ?? "").slice(0, 800));
    setWholeOpen(true);
  }
  const tools: StudioApi["tools"] = {
    animationAt: (range, prompt, refs, opts) => animationAt(range, prompt, refs, opts),
    wholeFromChat: async (prompt, layout, clips) => {
      const r = await wholeFromChatAction(projectId, { layout, prompt, ...(clips?.length ? { clips } : {}) });
      if (!r.ok || r.error) {
        toast.error(r.ok ? (r.error ?? "") : r.error);
        return false;
      }
      toast.success(r.replaced ? "Rehaciendo la animación de todo el video con lo que hablaron." : "Creando la animación de todo el video con lo que hablaron.", { description: "Tarda de 10 a 20 minutos: aparece sola en la pista Animaciones y puedes cerrar el Estudio y volver." });
      void composWork.refresh();
      return true;
    },
    graphicAt: (range, prompt) => addBroll(range, true, prompt),
    textAt: (range, preset, text) => addText(range, preset, text),
    lookPreset: (id) => {
      update((st) => ({ ...st, grade: cleanGrade(presetGrade(id)) }));
      toast.success(id === "natural" ? "Tu video volvió a su color original." : "Listo: le cambié el color a tu video.", { description: "Ajústalo en Edición → Color y filtros. Ctrl+Z lo deshace." });
    },
    clipAt: (range, option) => addClipBroll(range, option),
    wholeVideo: openWholeVideo,
    subtitle: () => {
      const preset = props.captionDefault && props.captionDefault !== "ninguno" ? props.captionDefault : "caja";
      update((st) => (st.preset === "ninguno" ? { ...st, preset } : st));
    },
    trim: async () => {
      const r = await suggestTrimAction(projectId);
      if (!r.ok) return r;
      applyTrim(r.removed);
      return { ok: true, removed: r.removed.length };
    },
    timeOfWord: (word) => timeline.words.find((w) => w.id >= word)?.start ?? null,
    transitionAt: (kind, t) => dropTransition(kind, Math.max(0, Math.min(timeline.duration, t))),
    soundAt: (name, t, gain) => placeSound(null, name, Math.max(0, Math.min(timeline.duration, t)), gain == null ? undefined : Math.max(SOUND_GAIN.min, Math.min(SOUND_GAIN.max, gain))),
    music: (style, db) =>
      update((st) => {
        let next = st;
        if (style === "quitar") next = { ...next, musicGen: null, music: { ...next.music, trackId: null } };
        else if (style) {
          const [lo, hi] = MUSIC_STYLE_INFO[style].bpm;
          // Semilla fija por video y estilo: el mismo pedido da la misma pista.
          let seed = 7;
          for (const ch of `${projectId}:${style}`) seed = (seed * 31 + ch.charCodeAt(0)) % 2147483647;
          next = { ...next, musicGen: { style, seed, bpm: Math.round((lo + hi) / 2) }, music: { ...next.music, trackId: null } };
        }
        if (db != null) next = { ...next, music: { ...next.music, db: Math.max(-40, Math.min(-6, db)) } };
        return next;
      }),
    voice: (db) => update((st) => ({ ...st, voiceDb: Math.max(-12, Math.min(6, db)) })),
    captions: (style, size) =>
      update((st) => {
        let next = st;
        if (style) next = { ...next, preset: style };
        else if (st.preset === "ninguno" && size) next = { ...next, preset: props.captionDefault && props.captionDefault !== "ninguno" ? props.captionDefault : "caja" };
        if (size) {
          const scale = size === "chico" ? 0.7 : size === "mediano" ? 0.85 : 1;
          const t = next.captionPlace.transform ?? { x: 0, y: 0, scale: 1 };
          const nt = { ...t, scale };
          next = { ...next, captionPlace: { ...next.captionPlace, transform: nt.x || nt.y || nt.scale !== 1 ? nt : undefined } };
        }
        return next;
      }),
    removeIn: (range, what) => {
      const a = range ? (timeline.words.find((w) => w.id >= range.from)?.start ?? 0) : 0;
      const b = range ? ([...timeline.words].reverse().find((w) => w.id <= range.to)?.end ?? a) : timeline.duration;
      const hits = (s0: number, s1: number) => s0 < b - 0.05 && s1 > a + 0.05;
      const want = (k: Exclude<typeof what, "todo">) => what === "todo" || what === k;
      const compos = new Set(want("animaciones") ? composSegs.filter((c) => hits(c.start, c.end)).map((c) => c.id) : []);
      const broll = new Set(
        segments
          .filter((g) => hits(g.start, g.end))
          .filter((g) => (g.option.text ? want("textos") : g.option.source === "graphic" ? want("graficos") : want("broll")))
          .map((g) => g.id),
      );
      const fx = new Set(want("efectos") ? fxSegs.filter((f) => hits(f.start, f.end)).map((f) => f.id) : []);
      const tr = want("transiciones") ? trSegs.filter((t) => hits(t.start, t.end)).map((t) => t.item) : [];
      const sounds = new Set(want("sonidos") ? soundCueTimes(timeline, s.soundCues).filter(({ hitAt }) => hits(hitAt - 0.1, hitAt + 0.1)).map(({ cue }) => cue.id) : []);
      const zoomIdx = new Set<number>();
      if (want("zooms"))
        s.zoomMoments.forEach((z, i) => {
          const z0 = timeline.words.find((w) => w.id >= z.from_word)?.start;
          const z1 = [...timeline.words].reverse().find((w) => w.id <= z.to_word)?.end;
          if (z0 != null && z1 != null && hits(z0, z1)) zoomIdx.add(i);
        });
      // En todo el video también va lo que hoy no se ve (por ejemplo, una animación sobre una parte cortada).
      if (!range) {
        if (want("animaciones")) for (const c of s.compositions) compos.add(c.id);
        if (want("efectos")) for (const e of s.effects) fx.add(e.id);
        if (want("sonidos")) for (const c of s.soundCues) sounds.add(c.id);
        if (want("zooms")) s.zoomMoments.forEach((_, i) => zoomIdx.add(i));
        if (want("transiciones")) for (const t of s.transitions) if (!tr.some((r) => (r.id ? r.id === t.id : !t.id && t.at_word === r.at_word))) tr.push(t);
        for (const b of s.broll) {
          if (!b.choice) continue;
          const k = b.choice.text ? "textos" : b.choice.source === "graphic" ? "graficos" : "broll";
          if (want(k)) broll.add(b.id);
        }
      }
      const n = compos.size + broll.size + fx.size + tr.length + sounds.size + zoomIdx.size;
      if (!n) return 0;
      update((st) => ({
        ...st,
        compositions: st.compositions.filter((c) => !compos.has(c.id)),
        broll: st.broll.filter((x) => !broll.has(x.id)),
        effects: st.effects.filter((e) => !fx.has(e.id)),
        transitions: st.transitions.filter((t) => !tr.some((r) => (r.id ? r.id === t.id : !t.id && t.at_word === r.at_word))),
        soundCues: st.soundCues.filter((c) => !sounds.has(c.id)),
        zoomMoments: st.zoomMoments.filter((_, i) => !zoomIdx.has(i)),
        rhythmTouched: zoomIdx.size ? true : st.rhythmTouched,
      }));
      setSelection(null);
      return n;
    },
    undo: (steps = 1) => {
      for (let i = 0; i < Math.max(1, Math.min(20, steps)); i++) undo();
    },
  };

  const api: StudioApi = {
    props,
    tools,
    state: s,
    update,
    removedSet,
    selection,
    select: (sel) => select(sel),
    timeline,
    segments,
    fxSegs,
    composSegs,
    compos: { requests: composWork.requests, legacy: composWork.legacy, sending: composWork.sending, error: composWork.error, request: requestAnimation, cancel: composWork.cancel, dismiss: composWork.dismiss, refresh: composWork.refresh, imageUrls: composImageUrls },
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
      movePart: moveChosen,
      setSubsHidden,
      accept: acceptSel,
      setBrollEdit,
      applyLookToAll,
      setGraphic,
      setText,
      changeDensity,
      pickOption,
      setTransition,
      placeSound,
      setPause,
      restoreAll,
      restorePauses,
      backToProposal,
      restack: restackSel,
      addMarker,
    },
    mixer: { read: mixer.read, voiceReady: Boolean(voicePeaks) },
    markers: placedMarkers,
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
      <span className="flex flex-col leading-tight font-mono tabular-nums" aria-live="off" title="Código de tiempo: horas, minutos, segundos y cuadro (30 por segundo). ← → avanzan un cuadro." data-testid="studio-timecode">
        <span className="text-xs text-text">{timecode(outTime)}</span>
        <span className="text-[10px] text-muted">de {timecode(timeline.duration)}</span>
      </span>
      {canEdit && (
        <>
          <span className="mx-1 h-5 w-px bg-white/10" aria-hidden />
          <Button size="sm" variant="subtle" className="!h-8 !px-2" icon={<Flag className="h-3.5 w-3.5" aria-hidden />} onClick={addMarker} title="Poner un marcador donde está la línea (M)">
            <span className="hidden xl:inline">Marcador</span>
          </Button>
          <Button size="sm" variant="subtle" className="!h-8 !px-2" icon={<SplitSquareHorizontal className="h-3.5 w-3.5" aria-hidden />} onClick={splitVideo} title="Cortar el video donde está la línea (C)">
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
      <p className="ml-2 hidden min-w-0 flex-1 truncate text-[11px] text-placeholder lg:block">{canEdit ? "Para cortar: pon la línea donde quieres y toca Dividir (C). Después elige la parte que sobra y bórrala con Supr." : "Solo lectura: tu usuario no puede editar."}</p>
      <div className="ml-auto flex items-center gap-1">
        <div role="radiogroup" aria-label="Vista de la línea de tiempo" className="mr-1 hidden items-center rounded-lg border border-white/10 p-0.5 text-[11px] font-semibold md:flex">
          {(["tipo", "capas"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={timelineView === v}
              onClick={() => setTimelineView(v)}
              title={v === "tipo" ? "Una pista por tipo: gráficos y b-roll, efectos, animaciones" : "Una pista por capa (V2, V3…): arriba lo que se ve encima"}
              className={cn("h-6 rounded-md px-2 text-muted outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-accent-hi", timelineView === v && "bg-white text-paper hover:text-paper")}
            >
              {v === "tipo" ? "Por tipo" : "Capas"}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Alto de las pistas" className="mr-1 hidden items-center rounded-lg border border-white/10 p-0.5 md:flex">
          {(["s", "m", "l"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={trackSize === v}
              onClick={() => setTrackSize(v)}
              title={v === "s" ? "Pistas bajas" : v === "m" ? "Pistas normales" : "Pistas altas"}
              className={cn("grid h-6 w-6 place-items-center rounded-md text-muted outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-accent-hi", trackSize === v && "bg-white text-paper hover:text-paper")}
            >
              <span aria-hidden className="block w-3 rounded-[1px] bg-current" style={{ height: v === "s" ? 4 : v === "m" ? 7 : 10 }} />
              <span className="sr-only">{v === "s" ? "Bajas" : v === "m" ? "Normales" : "Altas"}</span>
            </button>
          ))}
        </div>
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
            <button type="button" className={cn("btn-ghost hidden !h-9 !w-9 !p-0", !AI_ONLY && "sm:inline-flex")} onClick={() => setHelp(true)} aria-label="Atajos de teclado (?)" title="Atajos de teclado (?)">
              <Keyboard className="h-4 w-4" aria-hidden />
            </button>
            {props.menu}
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
              "flex flex-col lg:grid lg:h-full lg:grid-rows-[minmax(0,1fr)_var(--tl)] lg:grid-cols-[var(--left)_minmax(0,1fr)]",
            )}
            style={{ "--left": leftOpen ? `${leftW}px` : "52px", "--tl": `${timelineH}px` } as React.CSSProperties}
          >
            {/* Izquierda: todas las herramientas (y lo elegido en la línea de tiempo) */}
            <aside className="relative order-4 flex min-h-0 min-w-0 flex-col border-white/10 bg-card/40 lg:order-none lg:border-r" aria-label="Herramientas">
              {leftOpen && (
                // Borde para arrastrar: agranda o achica el panel (doble clic vuelve al ancho de siempre).
<div {...leftHandle} aria-label="Ancho del panel izquierdo" className={cn(HANDLE_CLASS, "-right-1.5")} />
              )}
              {AI_ONLY ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden" role="region" aria-label="Edición con IA">
                  <AiTab api={api} simple tools={null} />
                </div>
              ) : leftOpen ? (
                <>
                  <div className="flex flex-none items-center gap-1 border-b border-white/10 px-2 py-1.5">
                    <div role="tablist" aria-label="Herramientas" className="grid min-w-0 flex-1 grid-cols-6 gap-1">
                      {LEFT_TABS.map((t) => (
                        <button
                          key={t.v}
                          type="button"
                          role="tab"
                          aria-selected={leftTab === t.v}
                          onClick={() => (setLeftTab(t.v), panelSel && setSelection(null))}
                          title={t.label}
                          className={cn("flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold transition", leftTab === t.v && !panelSel ? "bg-white text-paper" : "text-muted hover:bg-white/[0.06] hover:text-white")}
                        >
                          <t.Icon className="h-[18px] w-[18px]" aria-hidden />
                          <span className="max-w-full truncate">{t.label}</span>
                        </button>
                      ))}
                    </div>
                    <button type="button" className="hidden h-8 w-8 flex-none place-items-center rounded-lg text-muted hover:bg-white/[0.06] hover:text-white lg:grid" onClick={() => setLeftOpen(false)} aria-label="Ocultar el panel" title="Ocultar el panel">
                      <PanelLeftClose className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  {multi.length > 1 && (
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-width:thin]">
                      <button type="button" onClick={() => setMulti([])} className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-white">
                        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Volver a {LEFT_TABS.find((t) => t.v === leftTab)?.label ?? "las herramientas"}
                      </button>
                      <p className="eyebrow">Elegidos juntos</p>
                      <h2 className="mt-0.5 text-base font-semibold text-white">{formatNumber(multi.length)} elementos</h2>
                      <p className="mt-1 text-xs text-muted">Arrastra cualquiera de ellos en la línea de tiempo y se mueven todos juntos. Supr los quita a todos.</p>
                      <ul className="mt-3 flex flex-col divide-y divide-white/[0.06] rounded-xl border border-white/10">
                        {multi.map((k) => {
                          const b = allBlocks.find((x) => x.key === k);
                          if (!b) return null;
                          return (
                            <li key={k}>
                              <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-white/[0.03]" onClick={() => (setMulti([]), select(b.selection))}>
                                <span className="w-12 flex-none font-mono text-[11px] text-muted tabular-nums">{formatDuration(b.start)}</span>
                                <span className="min-w-0 flex-1 truncate font-semibold text-white">{b.label}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      {canEdit && (
                        <Button size="sm" className="mt-3" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => removeMany(multi)}>
                          Quitar los {formatNumber(multi.length)}
                        </Button>
                      )}
                    </div>
                  )}
                  {panelSel && multi.length <= 1 && (
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
                      <button type="button" onClick={() => setSelection(null)} className="flex w-full items-center gap-1.5 border-b border-white/10 px-4 py-2 text-left text-xs font-semibold text-muted hover:text-white">
                        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Volver a {LEFT_TABS.find((t) => t.v === leftTab)?.label ?? "las herramientas"}
                      </button>
                      <StudioInspector api={api} />
                    </div>
                  )}
                  <div key={leftTab} className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]", panelSel && "hidden", leftTab === "ia" && "flex flex-col overflow-hidden")} role="tabpanel">
                    {leftTab === "ia" && <AiTab api={api} tools={<AiPanel api={api} dirty={dirty} onAcceptAll={acceptAll} />} />}
                    {leftTab === "audio" && (
                      <div className="p-4">
                        <AudioBlock api={api} />
                      </div>
                    )}
                    {leftTab === "texto" && (
                      <div className="flex flex-col gap-3 p-3">
                        <SubtitleBar api={api} onOpenStyle={() => setLeftTab("subtitulos")} />
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
                        {(FEATURES.clone || (phrase.fixes?.length ?? 0) > 0) && <PhraseFixPanel
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
                        />}
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
                    {leftTab === "subtitulos" && <SubtitlesPanel api={api} proofreading={proofreading} onProofread={proofread} />}
                    {leftTab === "edicion" && (
                      <EditPanel
                        framing={<FramingAndZooms api={api} />}
                        api={api}
                        onRestoreAll={restoreAll}
                        onTrim={applyTrim}
                        onTrimPauses={() => update((st) => ({ ...st, pauses: { keep: [], all: false } }))}
                        onAnimationAt={(range) => animationAt(range)}
                        onGraphicAt={(range) => addBroll(range, true)}
                        onBrollAt={(range) => addBroll(range)}
                        onEffectAt={(range) => setGallery({ range, replace: null })}
                        onOpenChat={openChat}
                        parts={
                          <PartsTool
                            chosen={chosenPart() ? textOf(chosenPart()!.from, chosenPart()!.to, 60) : null}
                            reordered={Boolean(s.sequence)}
                            onSplit={splitVideo}
                            onMove={moveChosen}
                            onRemove={removeSelection}
                            onReset={() => update((st) => ({ ...st, sequence: null }))}
                          />
                        }
                        rangeHere={() => {
                          if (selection?.kind === "range") return { range: { from: selection.from, to: selection.to }, from: "seleccion" };
                          const span = spanAround(timeline, outTime, 4);
                          return span ? { range: { from: span.from, to: span.to }, from: "cabezal" } : null;
                        }}
                      />
                    )}
                    {leftTab === "biblioteca" && <LibraryPanel api={api} onAdd={(item) => addFromLibrary(item)} />}
                  </div>
                </>
              ) : (
                <div className="hidden flex-col items-center gap-1 py-2 lg:flex">
                  <button type="button" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-white/[0.06] hover:text-white" onClick={() => setLeftOpen(true)} aria-label="Mostrar el panel" title="Mostrar el panel">
                    <PanelLeftOpen className="h-4 w-4" aria-hidden />
                  </button>
                  {LEFT_TABS.map((t) => (
                    <button key={t.v} type="button" className="grid h-10 w-10 place-items-center rounded-lg text-muted hover:bg-white/[0.06] hover:text-white" onClick={() => (setLeftTab(t.v), setLeftOpen(true))} aria-label={t.label} title={t.label}>
                      <t.Icon className="h-[18px] w-[18px]" aria-hidden />
                    </button>
                  ))}
                </div>
              )}
            </aside>

            {/* Centro: la vista previa, lo más grande posible */}
            <main ref={center} className={cn("group/stage relative order-1 flex min-h-0 min-w-0 flex-col items-center justify-center p-3 lg:order-none", full && "theme-dark bg-black")} aria-label="Vista previa">
              <button
                type="button"
                onClick={toggleFull}
                className={cn(
                  "absolute top-3 right-3 z-30 inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition",
                  full ? "border-white/20 bg-black/60 text-paper hover:bg-black/80" : "border-white/10 bg-card/90 text-muted opacity-70 hover:text-white hover:opacity-100 focus-visible:opacity-100 group-hover/stage:opacity-100",
                )}
                aria-label={full ? "Salir de la pantalla completa (F)" : "Ver en pantalla completa (F)"}
                title={full ? "Salir de la pantalla completa (F o Esc)" : "Pantalla completa (F)"}
              >
                {full ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
                <span className="hidden xl:inline">{full ? "Salir" : "Pantalla completa"}</span>
              </button>
              <div
                ref={stage}
                // En pantallas grandes, la barra propia del reproductor se oculta: la línea de tiempo de abajo ya tiene
                // reproducir, el tiempo y el cabezal (así el cuadro del video queda más grande).
                className={cn("relative w-full max-w-[360px] lg:max-w-none [&_div[style*='aspect-ratio']]:!max-w-none", !full && "lg:[&>div>div:has(>input[aria-label^='Posici'])]:hidden")}
                style={previewW ? { width: previewW } : undefined}
                data-testid="studio-stage"
              >
                <PreviewPlayer
                  ref={preview}
                  src={proxyUrl}
                  poster={posterUrl}
                  clips={timeline.clips}
                  duration={timeline.duration}
                  blocks={capLook ? clearFaceBands(canvasEdits.placeBlocks(captions), composSegs, capLook.y) : canvasEdits.placeBlocks(captions)}
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
                  grade={gradeMatrix(s.grade, graphicLook.theme.accent)}
                  gradeCurve={gradeCurve(s.grade)}
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
                {!AI_ONLY && props.stageOverlay && (
                  <div className="pointer-events-none absolute inset-x-0 top-0 z-10 [&>*]:pointer-events-auto" style={{ aspectRatio: s.format === "9:16" ? "9 / 16" : "16 / 9" }} data-testid="studio-stage-overlay">
                    {props.stageOverlay}
                  </div>
                )}
              </div>
              <div className={cn("mt-1 flex h-8 items-center justify-center", (full || AI_ONLY) && "hidden")}>
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

            {/* Abajo: la línea de tiempo */}
            <section className="relative order-2 h-[320px] min-h-0 border-t border-white/10 bg-card lg:order-none lg:col-span-2 lg:h-auto" aria-label="Línea de tiempo">
              <div {...timelineHandle} aria-label="Alto de la línea de tiempo" className="absolute inset-x-0 -top-1.5 z-40 hidden h-3 cursor-row-resize touch-none lg:block after:absolute after:inset-x-0 after:top-1/2 after:h-0.5 after:-translate-y-1/2 after:bg-transparent after:transition hover:after:bg-accent/60 focus-visible:outline-none focus-visible:after:bg-accent" />
              <StudioTimeline
                duration={timeline.duration}
                time={outTime}
                playing={playing}
                zoom={zoom}
                onZoom={setZoom}
                blocks={allBlocks}
                cuts={cuts}
                sfx={sfxMarks}
                heads={{ voice: <TrackToggles api={api} track="voice" />, music: <TrackToggles api={api} track="music" />, audio: <TrackToggles api={api} track="sfx" /> }}
                waves={waves}
                trackSize={trackSize}
                markers={placedMarkers.map((m) => ({ id: m.marker.id, number: m.number, at: m.at, note: m.marker.note }))}
                onFade={fadeBlock}
                layerView={timelineView === "capas"}
                hiddenCaptions={captionGaps}
                captionHides={canEdit ? captionHides : []}
                onShowCaptions={(index) => update((st) => ({ ...st, captionHide: st.captionHide.filter((_, i) => i !== index) }))}
                selection={selection}
                range={rangeSel}
                obstacles={obstacles}
                snap={snap}
                canEdit={canEdit}
                notes={AI_ONLY ? { layers: "Pídele a la IA animaciones, gráficos o textos: aparecen aquí", zoom: "Pídele un zoom a la IA", fx: "Pídele una transición a la IA", broll: "Adjunta un video en el chat para usarlo de b-roll", audio: s.sfx === "off" && !s.soundCues.length ? "Pídele efectos de sonido a la IA" : undefined, voice: proxyUrl ? "Preparando la forma de onda de tu voz…" : undefined, music: musicLabel ? "Leyendo la música…" : "Pídele música a la IA" } : { layers: "Arrastra gráficos, efectos o animaciones desde la Biblioteca: van encima del video", zoom: styleZooms ? "Automáticos del estilo" : "Sin zooms", fx: "Arrastra un efecto o una transición desde la Biblioteca", broll: "Elige un tramo en la pista de video para poner b-roll", audio: s.sfx === "off" && !s.soundCues.length ? "Arrastra sonidos desde la Biblioteca" : undefined, voice: proxyUrl ? "Preparando la forma de onda de tu voz…" : undefined, music: musicLabel ? "Leyendo la música…" : "Elige música en la Biblioteca o en Audio y música" }}
                onSeek={(t) => seek(t, Boolean(videoEl() && !videoEl()!.paused))}
                onSelect={(sel) => (setMulti([]), select(sel))}
                multi={multi}
                onMarquee={(keys) => {
                  if (keys.length === 1) {
                    const b = allBlocks.find((x) => x.key === keys[0]);
                    setMulti([]);
                    if (b) select(b.selection);
                    return;
                  }
                  setSelection(null);
                  setMulti(keys);
                  if (keys.length) setLeftOpen(true);
                }}
                onGroupMove={moveMany}
                onAddAt={AI_ONLY ? undefined : (t, at) => (seek(t), setAddMenu({ t, x: at.x, y: at.y }))}
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
      {addMenu && canEdit && (
        <>
          <button type="button" aria-label="Cerrar el menú" className="fixed inset-0 z-[60] cursor-default" onClick={() => setAddMenu(null)} />
          <div
            role="menu"
            aria-label={`Agregar en ${timeLabel(addMenu.t)}`}
            className="fixed z-[61] w-56 rounded-2xl border border-white/10 bg-card p-1.5 shadow-2xl"
            style={{ left: Math.min(addMenu.x, (typeof window !== "undefined" ? window.innerWidth : 1280) - 236), top: Math.max(8, addMenu.y - 260) }}
          >
            <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold text-muted">Agregar en {timeLabel(addMenu.t)}</p>
            {(
              [
                ["animacion", "Animación", WandSparkles],
                ["grafico", "Gráfico", BarChart3],
                ["broll", "B-roll o tu video", Film],
                ["efecto", "Efecto", Sparkles],
                ["zoom", "Zoom", ZoomIn],
                ["sonido", "Sonido", AudioLines],
              ] as const
            ).map(([k, label, Icon]) => (
              <button key={k} type="button" role="menuitem" className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm text-text hover:bg-white/[0.06] hover:text-white" onClick={() => addHere(k, addMenu.t)}>
                <Icon className="h-4 w-4 text-accent" aria-hidden /> {label}
              </button>
            ))}
          </div>
        </>
      )}
      {canEdit && <WholeVideoDialog projectId={projectId} open={wholeOpen} initialNotes={wholeNotes} audioOnly={props.audioOnly} onOpenChange={(o) => (setWholeOpen(o), o || setWholeNotes(""))} onStarted={() => void composWork.refresh()} />}
    </HumanizeProvider>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Espacio", "Reproducir o pausar"],
  ["J · K · L", "Atrás 2 s · pausar · reproducir (otra vez L: más rápido)"],
  ["← →", "Un cuadro atrás o adelante"],
  ["Mayús + ← →", "Palabra anterior o siguiente"],
  ["M", "Poner un marcador con nota donde está la línea (la IA los lee)"],
  ["C", "Cortar el video donde está la línea"],
  ["S", "Dividir lo elegido (b-roll, efecto o zoom) donde está la línea"],
  ["Alt + ← →", "Mover lo elegido una palabra"],
  ["Mayús + Alt + ← →", "Mover la parte del video elegida antes o después"],
  ["Ctrl + D", "Duplicar lo elegido justo después (b-roll, texto, gráfico, efecto o zoom)"],
  ["Supr", "Quitar lo elegido (en un tramo de video: cortarlo)"],
  ["Esc", "Soltar la selección"],
  ["+ −", "Acercar o alejar la línea de tiempo (también Ctrl + rueda)"],
  ["Ctrl + Z", "Deshacer"],
  ["Mayús + Ctrl + Z", "Rehacer"],
  ["F", "Pantalla completa (solo el video)"],
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

/** El pico «más fuerte» de una voz sin contar golpes sueltos (percentil 99). */
function loudestPeak(peak: Float32Array): number {
  if (!peak.length) return 1;
  const sorted = Float32Array.from(peak).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]!;
}
