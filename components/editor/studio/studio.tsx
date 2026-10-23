"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bot, Clapperboard, Keyboard, Library, Loader2, Minus, PanelLeftClose, PanelLeftOpen, Pause, Play, Plus, Redo2, Scissors, SpellCheck, SplitSquareHorizontal, Trash2, Type, Undo2, Wand2 } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { formatDuration, formatNumber } from "@/lib/format";
import { isDefaultEdit, resolveEdit, type BrollEdit } from "@/lib/video/broll-edit";
import { captionLook, isCaptionStyle } from "@/lib/video/caption-styles";
import { captionBlocks, hideDuring } from "@/lib/video/captions";
import { protectedZones } from "@/lib/video/director/protect";
import { brollSegments, computeZooms, directorZooms, graphicEntries, graphicHidesCaptions } from "@/lib/video/effects";
import { FX_INFO, type FxKind } from "@/lib/video/fx/catalog";
import { compileFx, faceAnchor, fxBrandFromLook, fxCaptionHides, fxSegments, sourceFramesOf, sourceRangesOf } from "@/lib/video/fx/compile";
import { FX_MASK_CHUNK } from "@/lib/video/fx/masks";
import { defaultFx, newFxId, type FxItem } from "@/lib/video/fx/schema";
import { defaultGraphic, type GraphicTemplate } from "@/lib/video/graphics";
import { humanize as humanizeText } from "@/lib/video/human-text";
import { brollGraphicOption, graphicKindLabel, motionTheme, type BrollGraphic } from "@/lib/video/motion-graphics";
import { rangesFromIds } from "@/lib/video/plan";
import { fillRhythm, rhythmScore, themeOfPlan, RHYTHM_TAG, type Density } from "@/lib/video/rhythm";
import { hookEnd, sfxCues } from "@/lib/video/sfx";
import { clipOffsets, cutMarks, fitSpan, snapToWords, splitSpan, timeLabel, wordAt, type SnappedSpan, type WordSpan } from "@/lib/video/studio";
import { buildTimeline, outputRange } from "@/lib/video/timeline";
import { FPS, type BrollItem, type BrollOption, type EditPlan, type RemovalReason } from "@/lib/video/types";
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
import { HumanizeProvider } from "./humanize";
import { StudioInspector } from "./studio-inspector";
import { aiItems, AiPanel, LibraryPanel } from "./studio-panels";
import { StudioTimeline, type LibraryDrop, type StudioSelection, type TimelineBlock, type TrackKey } from "./studio-timeline";
import { USER_TAG, type StudioApi, type StudioProps } from "./types";
import { toReview, useStudioState, withCut, type StudioState } from "./use-studio-state";

let brollCounter = 0;
const newBrollId = () => `u${Date.now().toString(36)}${(brollCounter++).toString(36)}`;
const stripTag = (why: string | undefined) => (why ?? "").replace(RHYTHM_TAG, "").replace(USER_TAG, "").trim();
type LeftTab = "texto" | "ia" | "biblioteca";

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
  const { state: s, removedSet, update, undo, redo, canUndo, canRedo } = useStudioState(plan);
  const [signed, setSigned] = useState<Record<string, SignedOption>>(signedBroll);
  const [rawSelection, setSelection] = useState<StudioSelection | null>(null);
  const [outTime, setOutTime] = useState(0);
  const outRef = useRef(0);
  const [activeTime, setActiveTime] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [leftTab, setLeftTab] = useState<LeftTab>("texto");
  const [leftOpen, setLeftOpen] = useState(true);
  const [picking, setPicking] = useState<{ id: string; tab?: PickerTab; ask?: boolean } | null>(null);
  const [gallery, setGallery] = useState<{ range: WordSpan | null; replace: string | null } | null>(null);
  const [fixRange, setFixRange] = useState<WordSpan | null>(null);
  const [help, setHelp] = useState(false);
  const [masks, setMasks] = useState(fxContext?.masks ?? null);
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

  const timeline = useMemo(
    () =>
      buildTimeline(
        words,
        {
          removals: rangesFromIds(s.removed, plan.removals),
          hook_candidates: plan.hook_candidates,
          selected_hook: s.selectedHook,
          corrections: s.corrections,
          captions: { preset: s.preset, emphasis_words: s.emphasis },
          pacing: s.pacing,
          moves: s.moves,
        },
        duration,
      ),
    [words, s.removed, plan.removals, plan.hook_candidates, s.selectedHook, s.corrections, s.preset, s.emphasis, s.pacing, s.moves, duration],
  );
  const fxSegs = useMemo(() => fxSegments(timeline, s.effects), [timeline, s.effects]);
  const hiddenCaptions = useMemo(() => (plan.captions.hide ?? []).map((h) => outputRange(timeline, h.from_word, h.to_word)).filter((r): r is { start: number; end: number } => Boolean(r)), [plan.captions.hide, timeline]);
  // Sin subtítulos donde el director los ocultó ni durante los efectos que llevan los suyos, igual que en el render.
  const captions = useMemo(() => (s.preset === "ninguno" ? [] : hideDuring(captionBlocks(timeline.words, s.preset, captionStyle), [...hiddenCaptions, ...fxCaptionHides(fxSegs)])), [timeline, s.preset, captionStyle, hiddenCaptions, fxSegs]);
  const capLook = useMemo(() => (isCaptionStyle(s.preset) ? captionLook(s.preset, { format: s.format, accent, brandFont: graphicLook.font, emoji: s.emoji }) : null), [s.preset, s.format, accent, graphicLook.font, s.emoji]);
  const segments = useMemo(() => brollSegments(timeline, s.broll), [timeline, s.broll]);
  const styleZooms = Boolean(style && style.zoom.enabled && s.zoomsOn);
  const zooms = useMemo(() => {
    const avoid = [...segments, ...fxSegs];
    return style && style.zoom.enabled && s.zoomsOn ? computeZooms(timeline, style.zoom, { emphasis: s.emphasis, avoid }) : directorZooms(timeline, s.zoomMoments, avoid);
  }, [style, s.zoomsOn, timeline, s.emphasis, s.zoomMoments, segments, fxSegs]);
  const entries = useMemo(() => graphicEntries(segments), [segments]);
  const rhythm = useMemo(() => rhythmScore({ timeline, broll: segments, zooms, effects: fxSegs.map((f) => ({ start: f.start, end: f.end, kind: f.item.kind })), entries, density: s.density }), [timeline, segments, zooms, fxSegs, entries, s.density]);
  const sfxMarks = useMemo(
    () => sfxCues({ level: s.sfx, duration: timeline.duration, broll: segments, hookEnd: hookEnd(timeline), entries: [...entries, ...fxSegs.map((f) => f.start)], punches: zooms.filter((z) => z.kind === "punch").map((z) => z.start), dense: s.density === "reels" }),
    [s.sfx, timeline, segments, entries, fxSegs, zooms, s.density],
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
  const fxImages = useImages(useMemo(() => Object.fromEntries(thumbs.map((t, i) => [`t${i}`, t.url])), [thumbs]));
  const stripImgs = useImages(useMemo(() => Object.fromEntries(Object.entries(masks?.urls ?? {})), [masks]));
  const fxStrips = useMemo(() => Object.fromEntries(Object.entries(stripImgs).map(([k, v]) => [Number(k), v])) as Record<number, HTMLImageElement | undefined>, [stripImgs]);
  const maskMissing = useMemo(() => {
    const ready = new Set(Object.keys(masks?.urls ?? {}).map(Number));
    const out = new Set<string>();
    for (const spec of fxSpecs) {
      if (!spec.mask) continue;
      const frames = sourceFramesOf(timeline, spec.start, Math.max(1, Math.round(spec.duration * 30)));
      if (frames.some((f) => !ready.has(Math.floor(f / FX_MASK_CHUNK)))) out.add(spec.id);
    }
    return out;
  }, [fxSpecs, masks, timeline]);
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
  const videoEl = useCallback(() => stage.current?.querySelector<HTMLVideoElement>('video[aria-label="Vista previa del video editado"]') ?? null, []);
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
      else if (sel.kind === "caption") at = captions[sel.index]?.start ?? null;
      else if (sel.kind === "zoom" && sel.index >= 0) {
        const m = s.zoomMoments[sel.index];
        at = m ? (outputRange(timeline, m.from_word, m.to_word)?.start ?? null) : null;
      } else if (sel.kind === "range") at = outputRange(timeline, sel.from, sel.to)?.start ?? null;
      if (at != null && !playingNow) seek(at, false);
    },
    [videoEl, segments, fxSegs, captions, s.zoomMoments, timeline, seek],
  );

  // ─── Acciones ───
  const cut = useCallback((ids: number[], on: boolean) => update((st) => withCut(st, ids, on)), [update]);

  function cutSpan(span: WordSpan) {
    const ids = Array.from({ length: span.to - span.from + 1 }, (_, k) => span.from + k);
    update((st) => withCut(st, ids, true));
    setSelection(null);
    toast.success("Tramo cortado.", { description: "Deshazlo con Ctrl+Z o restáuralo tocando la marca roja en la pista de video." });
  }

  function addBroll(range: WordSpan, ask = false) {
    const query = words
      .slice(range.from, range.to + 1)
      .map((w) => w.text.replace(/[^\p{L}\p{N}]+/gu, ""))
      .filter((w) => w.length > 3)
      .slice(0, 4);
    const item: BrollItem = { id: newBrollId(), from_word: range.from, to_word: range.to, query_en: query.join(" ").slice(0, 100) || "b-roll", keywords: query.map((w) => w.toLowerCase()), choice: null, options: [] };
    const hitsFx = s.effects.some((e) => range.from <= e.to_word && e.from_word <= range.to);
    update((st) => ({
      ...st,
      broll: [...st.broll.filter((b) => !(range.from <= b.to_word && b.from_word <= range.to)), item].sort((a, b) => a.from_word - b.from_word),
      effects: st.effects.filter((e) => !(range.from <= e.to_word && e.from_word <= range.to)),
    }));
    if (hitsFx) toast.info("Quitamos el efecto que estaba en esas palabras: un tramo lleva b-roll o un efecto, no los dos.");
    setSelection({ kind: "broll", id: item.id });
    setPicking({ id: item.id, tab: ask ? "grafico" : undefined, ask });
  }

  /** Un gráfico de plantilla en un tramo (se abre el estudio de gráficos para ajustarlo). */
  function addGraphic(range: WordSpan, template: GraphicTemplate) {
    if (s.effects.some((e) => range.from <= e.to_word && e.from_word <= range.to)) {
      toast.error("Ahí ya hay un efecto. Mueve el cabezal a otro lugar: un tramo lleva b-roll o efecto, no los dos.");
      return;
    }
    if (s.broll.some((b) => range.from <= b.to_word && b.from_word <= range.to)) {
      toast.error("Ahí ya hay un b-roll o un gráfico. Mueve el cabezal a un lugar libre.");
      return;
    }
    const option = brollGraphicOption(defaultGraphic(textOf(range.from, range.to, 400), graphicLook, template));
    const item: BrollItem = { id: newBrollId(), from_word: range.from, to_word: range.to, query_en: "", keywords: [], choice: option, options: [option] };
    update((st) => ({ ...st, broll: [...st.broll, item].sort((a, b) => a.from_word - b.from_word) }));
    setSelection({ kind: "broll", id: item.id });
    const r = outputRange(timeline, range.from, range.to);
    if (r) seek(r.start);
    // Se abre el estudio de gráficos con la plantilla para poner los textos (las cifras salen de lo que dices).
    setPicking({ id: item.id, tab: "grafico" });
  }

  function addFx(kind: FxKind, range: WordSpan, replace: string | null) {
    if (s.broll.some((b) => b.choice && range.from <= b.to_word && b.from_word <= range.to)) {
      toast.error("Ese tramo ya tiene b-roll. Quita el b-roll o elige otras palabras para el efecto.");
      return;
    }
    const spoken = words.slice(range.from, range.to + 1).map((w) => ({ id: w.id, text: s.corrections[String(w.id)] ?? w.text }));
    const item: FxItem = { id: replace ?? newFxId(), kind, from_word: range.from, to_word: range.to, ...defaultFx(kind, spoken), source: "user" };
    update((st) => ({ ...st, effects: [...st.effects.filter((e) => e.id !== replace && !(range.from <= e.to_word && e.from_word <= range.to)), item].sort((a, b) => a.from_word - b.from_word) }));
    setSelection({ kind: "fx", id: item.id });
    const seg = fxSegments(timeline, [item])[0];
    if (seg) seek(seg.start, true);
  }

  function addZoom(range: WordSpan) {
    if (styleZooms) {
      toast.info("Tu estilo pone los zooms solo. Apágalos en «Zooms del estilo» para poner los tuyos.");
      return;
    }
    if (s.zoomMoments.some((z) => range.from <= z.to_word && z.from_word <= range.to)) {
      toast.error("Ahí ya hay un zoom. Elígelo en la línea de tiempo para cambiarlo.");
      return;
    }
    const moment = { from_word: range.from, to_word: range.to, scale: 1.15, why: `${USER_TAG} lo agregaste en la línea de tiempo.` };
    const next = [...s.zoomMoments, moment].sort((a, b) => a.from_word - b.from_word);
    update((st) => ({ ...st, rhythmTouched: true, zoomMoments: next }));
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
      ...(s.pacing ? { pacing: s.pacing } : {}),
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
      pacing: filled.pacing,
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
    else if (sel.kind === "zoom" && sel.index >= 0) update((st) => ({ ...st, rhythmTouched: true, zoomMoments: st.zoomMoments.filter((_, i) => i !== sel.index) }));
    else if (sel.kind === "range") return cutSpan(sel);
    else if (sel.kind === "clip") {
      const clip = timeline.clips[sel.index];
      if (clip) cut(timeline.words.filter((w) => w.id >= clip.firstWord && w.id <= clip.lastWord).map((w) => w.id), true);
    } else return;
    setSelection(null);
  }

  /** Divide lo elegido en el cabezal (la segunda parte empieza en la palabra que suena). */
  function split() {
    const sel = selection;
    if (!canEdit) return;
    if (!sel || !["broll", "fx", "zoom"].includes(sel.kind)) {
      toast.info("Elige un b-roll, un efecto o un zoom en la línea de tiempo y pon el cabezal donde quieres dividirlo.");
      return;
    }
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

  // ─── Línea de tiempo ───
  const blocks = useMemo<TimelineBlock[]>(() => {
    const out: TimelineBlock[] = [];
    const offsets = clipOffsets(timeline);
    timeline.clips.forEach((c, i) => {
      const start = offsets[i]!;
      const kept = timeline.words.filter((w) => w.id >= c.firstWord && w.id <= c.lastWord);
      const text = kept.map((w) => w.text).join(" ");
      out.push({
        key: `clip${i}`,
        track: "video",
        start,
        end: start + (c.endFrame - c.startFrame) / FPS,
        label: c.role === "hook" ? `Gancho · ${text}` : text || "Tramo",
        tone: c.role === "hook" ? "border-accent-hi/60 bg-accent/40 font-normal" : "border-white/15 bg-[#12306e] font-normal",
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
        label: graphic ? graphicKindLabel(graphic) : choice ? (choice.source === "library" ? (choice.title ?? "Tu clip") : "B-roll") : "Sin clip",
        detail: textOf(item.from_word, item.to_word, 40),
        tone: graphic ? "border-accent/70 bg-accent/50" : "border-[#199e70]/70 bg-[#199e70]/50",
        ai: !item.id.startsWith("u"),
        editable: true,
        min: 0.5,
        empty: !choice,
        selection: { kind: "broll", id: item.id },
        thumb: graphic ? null : (signedOf(choice)?.thumbUrl ?? null),
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
        selection: { kind: "fx", id: seg.id },
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
          selection: { kind: "zoom", index: i },
        });
      });
    return out;
  }, [timeline, captions, s.broll, s.zoomMoments, segments, fxSegs, styleZooms, zooms, textOf, signedOf]);

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

  /** Mueve o estira un b-roll, un efecto o un zoom a otro rango de palabras (con las reglas de cada pista). */
  function moveTo(sel: StudioSelection, range: WordSpan, mode: "move" | "start" | "end"): boolean {
    const over = (x: { from_word: number; to_word: number }) => range.from <= x.to_word && x.from_word <= range.to;
    if (sel.kind === "broll") {
      if (s.broll.some((b) => b.id !== sel.id && over(b))) {
        toast.error("Ahí ya hay otro b-roll o gráfico.");
        return false;
      }
      if (s.broll.find((b) => b.id === sel.id)?.choice && s.effects.some(over)) {
        toast.error("Ahí hay un efecto: un tramo lleva b-roll o efecto, no los dos.");
        return false;
      }
      update((st) => ({
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
      }));
      setSelection(sel);
      return true;
    }
    if (sel.kind === "fx") {
      if (s.effects.some((e) => e.id !== sel.id && over(e))) {
        toast.error("Ahí ya hay otro efecto.");
        return false;
      }
      if (s.broll.some((b) => b.choice && over(b))) {
        toast.error("Ahí hay b-roll: un tramo lleva b-roll o efecto, no los dos.");
        return false;
      }
      update((st) => ({ ...st, effects: st.effects.map((e) => (e.id === sel.id ? { ...e, from_word: range.from, to_word: range.to, words: e.words?.filter((w) => w >= range.from && w <= range.to) } : e)).sort((a, b) => a.from_word - b.from_word) }));
      setSelection(sel);
      return true;
    }
    if (sel.kind === "zoom" && sel.index >= 0) {
      if (s.zoomMoments.some((z, i) => i !== sel.index && over(z))) {
        toast.error("Ahí ya hay otro zoom.");
        return false;
      }
      const moved = { ...s.zoomMoments[sel.index]!, from_word: range.from, to_word: range.to };
      const next = s.zoomMoments.map((z, i) => (i === sel.index ? moved : z)).sort((a, b) => a.from_word - b.from_word);
      update((st) => ({ ...st, rhythmTouched: true, zoomMoments: next }));
      setSelection({ kind: "zoom", index: next.indexOf(moved) });
      return true;
    }
    return false;
  }

  function commitBlock(block: TimelineBlock, span: SnappedSpan, mode: "move" | "start" | "end") {
    if (moveTo(block.selection, { from: span.from, to: span.to }, mode)) seek(span.start);
  }

  function addFromLibrary(item: LibraryDrop, at?: number) {
    if (!canEdit) return;
    const t = at ?? outRef.current;
    const busy = "Ahí ya hay algo en esa pista. Mueve el cabezal a un lugar libre (o elige lo que hay para cambiarlo).";
    if (item.type === "fx") {
      const info = FX_INFO[item.kind as FxKind];
      if (!info) return;
      const target = Math.min(info.duration.max, Math.max(info.duration.min, (info.duration.min + info.duration.max) / 2.5));
      const span = fitSpan(timeline, t, target, info.duration.min, [...s.effects, ...s.broll.filter((b) => b.choice)]);
      if (!span) return void toast.error(busy, { description: "Un tramo lleva b-roll o efecto, no los dos." });
      addFx(item.kind as FxKind, span, null);
    } else if (item.type === "graphic" || item.type === "broll") {
      const span = fitSpan(timeline, t, 2.5, 0.8, [...s.broll, ...s.effects]);
      if (!span) return void toast.error(busy, { description: "Un tramo lleva b-roll o efecto, no los dos." });
      if (item.type === "graphic" && item.template) addGraphic(span, item.template as GraphicTemplate);
      else addBroll(span, item.type === "graphic");
    } else if (item.type === "zoom") {
      const span = fitSpan(timeline, t, 1.2, 0.3, s.zoomMoments);
      if (!span) return void toast.error(busy);
      addZoom(span);
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
  useEffect(() => {
    if (!canEdit || reviewKey === savedKey) return;
    const timer = setTimeout(async () => {
      if (sending.current) return;
      setSaving("saving");
      const result = await saveReviewAction(projectId, review, s.format);
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
      const result = await renderAction(projectId, review, s.format);
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
      if (document.querySelector("dialog[open]")) return;
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
      if (mod || e.altKey || typing(e.target)) return;
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
  const changedFromProposal = removedSet.size !== proposed.size || s.removed.some((id) => !proposed.has(id));
  const cuts = useMemo(() => cutMarks(timeline, removedSet), [timeline, removedSet]);
  // En la pista de subtítulos: dónde no se ven (los ocultó el director, un efecto lleva los suyos o un gráfico los tapa).
  const captionGaps = useMemo(
    () => [...hiddenCaptions, ...fxCaptionHides(fxSegs), ...segments.filter((sg) => sg.option.source === "graphic" && graphicHidesCaptions(sg.option.graphic)).map((sg) => ({ start: sg.start, end: sg.end }))],
    [hiddenCaptions, fxSegs, segments],
  );
  const musicTrack = tracks.find((t) => t.id === s.music.trackId) ?? null;

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
    zooms,
    captions,
    rhythm,
    fxBrand,
    thumbsCount: thumbs.length,
    maskMissing,
    masks: { pending: Boolean(masks?.pending), failed: Boolean(masks?.failed) },
    reasons,
    styleZooms,
    showFraming,
    time: outTime,
    textOf,
    humanize,
    signedOf,
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
      accept: acceptSel,
      setBrollEdit,
      applyLookToAll,
      setGraphic,
      changeDensity,
      pickOption,
    },
  };

  // Lo que se ve ahora en la vista previa (para elegirlo con un toque).
  const fxNow = fxSegs.find((sg) => outTime >= sg.start && outTime < sg.end) ?? null;
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
          <Button size="sm" variant="subtle" className="!h-8 !px-2" icon={<SplitSquareHorizontal className="h-3.5 w-3.5" aria-hidden />} onClick={split} title="Dividir lo elegido en el cabezal (S)">
            <span className="hidden xl:inline">Dividir</span>
          </Button>
          <Button size="sm" variant="subtle" className="!h-8 !px-2" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={removeSelection} disabled={!selection || selection.kind === "caption" || selection.kind === "cut" || selection.kind === "audio"} title="Quitar lo elegido (Supr)">
            <span className="hidden xl:inline">Quitar</span>
          </Button>
          {selection?.kind === "range" && (
            <Button size="sm" variant="ghost" className="!h-8 !px-2.5" icon={<Scissors className="h-3.5 w-3.5" aria-hidden />} onClick={() => cutSpan(selection)}>
              Cortar tramo
            </Button>
          )}
        </>
      )}
      <p className="ml-2 hidden min-w-0 flex-1 truncate text-[11px] text-placeholder lg:block">{canEdit ? "Arrastra sobre la pista de video para elegir un tramo. Arrastra los bloques para moverlos y sus bordes para estirarlos." : "Solo lectura: tu usuario no puede editar."}</p>
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
        <header className="flex h-14 flex-none items-center gap-2 border-b border-white/10 bg-[#030a22] px-2 sm:px-3">
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
                          className={cn("inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition", leftTab === t.v ? "bg-white/10 text-white" : "text-muted hover:text-white")}
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
                          <p className="text-xs text-muted">
                            {formatNumber(removedSet.size)} {removedSet.size === 1 ? "palabra cortada" : "palabras cortadas"} de {formatNumber(words.length)}.
                          </p>
                          {canEdit && (
                            <div className="flex flex-wrap gap-1">
                              {changedFromProposal && proposed.size > 0 && (
                                <Button size="sm" variant="subtle" className="!px-2" icon={<Wand2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => update((st) => ({ ...st, removed: [...proposed].sort((a, b) => a - b) }))}>
                                  Volver a la propuesta
                                </Button>
                              )}
                              <Button size="sm" variant="subtle" className="!px-2" icon={proofreading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <SpellCheck className="h-3.5 w-3.5" aria-hidden />} onClick={proofread} disabled={proofreading}>
                                {proofreading ? "Revisando…" : "Ortografía con IA"}
                              </Button>
                              <Button size="sm" variant="subtle" className="!px-2" icon={<Undo2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => update((st) => ({ ...st, removed: [] }))} disabled={removedSet.size === 0}>
                                Restaurar todo
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
                          onCorrect={(id, text) =>
                            update((st) => {
                              const next = { ...st.corrections };
                              if (text) next[String(id)] = text;
                              else delete next[String(id)];
                              return { ...st, corrections: next };
                            })
                          }
                          onListen={listenFrom}
                          brollMarks={brollMarks}
                          activeBroll={selection?.kind === "broll" ? selection.id : null}
                          onBrollClick={(id) => select({ kind: "broll", id })}
                          extraActions={
                            canEdit
                              ? (range, clear) => (
                                  <>
                                    <Button size="sm" variant="ghost" onClick={() => (addBroll(range), clear())}>
                                      Poner b-roll aquí
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => (addBroll(range, true), clear())}>
                                      Pide un gráfico aquí
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => (setGallery({ range, replace: null }), clear())}>
                                      Poner un efecto aquí
                                    </Button>
                                    {!styleZooms && (
                                      <Button size="sm" variant="ghost" onClick={() => (addZoom(range), clear())}>
                                        Zoom aquí
                                      </Button>
                                    )}
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
                  blocks={captions}
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
                  effects={fxSpecs}
                  fxStrips={fxStrips}
                  fxMaskFps={masks?.fps ?? 10}
                  fxImages={fxImages}
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
                {(fxNow || brNow) && (
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
            <section className="order-2 h-[260px] min-h-0 border-t border-white/10 bg-[#030a22] lg:order-none lg:col-span-3 lg:h-auto" aria-label="Línea de tiempo">
              <StudioTimeline
                duration={timeline.duration}
                time={outTime}
                playing={playing}
                zoom={zoom}
                onZoom={setZoom}
                blocks={blocks}
                cuts={cuts}
                sfx={sfxMarks}
                music={musicTrack ? { label: `Música · ${musicTrack.title}` } : null}
                hiddenCaptions={captionGaps}
                selection={selection}
                range={rangeSel}
                obstacles={obstacles}
                snap={snap}
                canEdit={canEdit}
                notes={{ zoom: styleZooms ? "Automáticos del estilo" : "Sin zooms", fx: "Arrastra un efecto desde la Biblioteca", broll: "Elige un tramo en la pista de video para poner b-roll", audio: s.sfx === "off" ? "Sin música ni efectos de sonido" : undefined }}
                onSeek={(t) => seek(t, Boolean(videoEl() && !videoEl()!.paused))}
                onSelect={(sel) => select(sel)}
                onCommit={commitBlock}
                onRange={(span) => {
                  setSelection({ kind: "range", from: span.from, to: span.to });
                  seek(span.start);
                }}
                onDrop={(item, t) => addFromLibrary(item, t)}
                toolbar={toolbar}
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
    </HumanizeProvider>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Espacio", "Reproducir o pausar"],
  ["J · K · L", "Atrás 2 s · pausar · reproducir (otra vez L: más rápido)"],
  ["← →", "Un cuadro atrás o adelante"],
  ["Mayús + ← →", "Palabra anterior o siguiente"],
  ["S", "Dividir lo elegido en el cabezal"],
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
