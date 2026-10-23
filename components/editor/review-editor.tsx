"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Loader2, Mic, Palette, RotateCcw, Sparkles, Undo2, Wand2, WandSparkles, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { formatDuration, formatNumber } from "@/lib/format";
import { captionLook, isCaptionStyle } from "@/lib/video/caption-styles";
import { CAPTION_PICKER_ORDER, CAPTION_PRESETS, captionBlocks, hideDuring } from "@/lib/video/captions";
import { brollSegments, computeZooms, cutTimes, directorZooms, graphicEntries } from "@/lib/video/effects";
import { fillRhythm, planDensity, rhythmScore, themeOfPlan, type Density } from "@/lib/video/rhythm";
import { motionTheme } from "@/lib/video/motion-graphics";
import { protectedZones } from "@/lib/video/director/protect";
import { RhythmPanel } from "./rhythm-panel";
import { rangesFromIds } from "@/lib/video/plan";
import { hookEnd, sfxCues, sfxLevel, type SfxLevel } from "@/lib/video/sfx";
import { studioLevel, type AudioPreview, type StudioLevel } from "@/lib/video/studio-audio";
import type { CaptionStyle, StylePreset } from "@/lib/video/style";
import { buildTimeline, outputRange } from "@/lib/video/timeline";
import type { DirectorView } from "@/lib/dal/video";
import type { GraphicLook } from "@/lib/video/graphics";
import type { BrollItem, BrollOption, CaptionPresetKey, EditPlan, PlanMove, RemovalReason, VideoFormat, Word, ZoomMoment } from "@/lib/video/types";
import type { FxKind as RhythmFxKind } from "@/lib/video/fx/catalog";
import { cn } from "@/lib/utils";
import { isDefaultEdit, resolveEdit, type BrollEdit } from "@/lib/video/broll-edit";
import { renderAction, saveReviewAction } from "./actions";
import { AudioPanel } from "./audio-panel";
import { BrollEditPanel } from "./broll-edit-panel";
import { BrollPanel, BrollPicker, optionKey, type PickerTab, type SignedOption } from "./broll-panel";
import { CaptionPicker } from "./caption-picker";
import type { TrackItem } from "./music-manager";
import { PhraseFixDialog, PhraseFixPanel, usePhraseFixes } from "./phrase-fix";
import { captionCorrections } from "@/lib/video/phrase-fix";
import { PreviewPlayer, type PreviewHandle } from "./preview-player";
import { TranscriptEditor, type BrollMark } from "./transcript-editor";
import { DecisionsPanel } from "./director/decisions-panel";
import { EditRequestCard } from "./director/edit-request";
import { UnderstandingPanel } from "./director/understanding-panel";
import { VariantsPanel } from "./director/variants-panel";
import { FxEditor, FxGallery, FxPanel } from "./fx/fx-panel";
import { useImages } from "./fx/fx-canvas";
import { fxMasksAction } from "./fx-actions";
import type { FxContext } from "@/lib/dal/video-fx";
import { FX_INFO, type FxKind } from "@/lib/video/fx/catalog";
import { compileFx, faceAnchor, fxBrandFromLook, fxCaptionHides, fxSegments, sourceFramesOf, sourceRangesOf } from "@/lib/video/fx/compile";
import { FX_MASK_CHUNK } from "@/lib/video/fx/masks";
import { defaultFx, newFxId, type FxItem } from "@/lib/video/fx/schema";

let brollCounter = 0;
const newBrollId = () => `u${Date.now().toString(36)}${(brollCounter++).toString(36)}`;

function idsOf(plan: Pick<EditPlan, "removals">): Set<number> {
  const set = new Set<number>();
  for (const r of plan.removals) for (let id = r.from_word; id <= r.to_word; id++) set.add(id);
  return set;
}

export function ReviewEditor({
  projectId,
  plan,
  words,
  duration,
  sourceWidth,
  sourceHeight,
  proxyUrl,
  posterUrl,
  accent,
  canEdit,
  signedBroll = {},
  style = null,
  graphicLook,
  tracks = [],
  audioPreview = null,
  director = null,
  fxContext = null,
  rhythmFx = [],
}: {
  projectId: string;
  plan: EditPlan;
  words: Word[];
  duration: number;
  sourceWidth: number;
  sourceHeight: number;
  proxyUrl: string | null;
  posterUrl: string | null;
  accent: string;
  canEdit: boolean;
  /** URLs listas para el navegador de cada alternativa de b-roll (clave "fuente:id"). */
  signedBroll?: Record<string, SignedOption>;
  /** Estilo con el que se armó el plan (nombre, zooms y subtítulos), si hay. */
  style?: { id: string; name: string; zoom: StylePreset["zoom"]; captions: CaptionStyle | null; focusY: number } | null;
  /** Colores y fuente de Mi marca para los gráficos nuevos del b-roll. */
  graphicLook: GraphicLook;
  /** Pistas de música listas de la biblioteca. */
  tracks?: TrackItem[];
  /** Muestra de 10 s de "Audio de estudio" (antes y después), si ya está. */
  audioPreview?: AudioPreview | null;
  /** Director de edición: lo que entendió, la segunda mirada, el brief, los pedidos y las versiones. */
  director?: DirectorView | null;
  /** Efectos: la cara medida, las miniaturas de tus reels y el recorte de la persona para la vista previa. */
  fxContext?: FxContext | null;
  /** Efectos que permite Mi marca (el ritmo "Editor de reels" puede abrir con uno). */
  rhythmFx?: RhythmFxKind[];
}) {
  const router = useRouter();
  const preview = useRef<PreviewHandle>(null);
  const [removed, setRemoved] = useState<Set<number>>(() => idsOf(plan));
  const [selectedHook, setSelectedHook] = useState<number | null>(plan.selected_hook);
  const [preset, setPreset] = useState<CaptionPresetKey>(plan.captions.preset);
  const [format, setFormat] = useState<VideoFormat>(plan.format);
  const [offsetX, setOffsetX] = useState(plan.framing.offset_x);
  const [corrections, setCorrections] = useState<Record<string, string>>(plan.corrections);
  const [activeTime, setActiveTime] = useState<number | null>(null);
  const [rendering, startRender] = useTransition();
  const [brollItems, setBrollItems] = useState<BrollItem[]>(plan.broll ?? []);
  const [zoomsOn, setZoomsOn] = useState(plan.zooms_enabled !== false);
  const [signed, setSigned] = useState<Record<string, SignedOption>>(signedBroll);
  const [activeBroll, setActiveBroll] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [pickTab, setPickTab] = useState<PickerTab | undefined>(undefined);
  const [askFocus, setAskFocus] = useState(false);
  const [emoji, setEmoji] = useState(plan.captions.emoji === true);
  // Planes de antes de los efectos: sin efectos (así el video no cambia si se vuelve a renderizar).
  const [sfx, setSfx] = useState<SfxLevel>(sfxLevel(plan.audio.sfx));
  const [music, setMusic] = useState<{ trackId: string | null; db: number }>({ trackId: plan.audio.music_asset_id, db: plan.audio.music_db });
  // Planes de antes del audio de estudio: apagado (el audio sale como antes).
  const [studio, setStudio] = useState<StudioLevel>(studioLevel(plan.audio.studio));
  const [editing, setEditing] = useState<string | null>(null);
  // Bloques movidos por el director (la persona puede dejar alguno en su lugar).
  const [moves, setMoves] = useState<PlanMove[]>(plan.moves ?? []);
  // Frases corregidas con la voz clonada (components/editor/phrase-fix.tsx).
  const [fixRange, setFixRange] = useState<{ from: number; to: number } | null>(null);
  const phrase = usePhraseFixes(projectId);
  // Efectos de la biblioteca (lib/video/fx).
  const [fxItems, setFxItems] = useState<FxItem[]>(plan.effects ?? []);
  const [activeFx, setActiveFx] = useState<string | null>(null);
  const [editingFx, setEditingFx] = useState<string | null>(null);
  const [gallery, setGallery] = useState<{ range: { from: number; to: number } | null; replace: string | null } | null>(null);
  const [masks, setMasks] = useState(fxContext?.masks ?? null);
  const captionStyle = style?.captions ?? null;
  // Ritmo (lib/video/rhythm.ts): densidad, punch-ins, pausa máxima y palabras resaltadas (lo cambia el selector).
  const [density, setDensity] = useState<Density>(() => planDensity(plan));
  const [zoomMoments, setZoomMoments] = useState<ZoomMoment[]>(plan.zoom_moments ?? []);
  const [pacing, setPacing] = useState(plan.pacing);
  const [emphasis, setEmphasis] = useState<number[]>(plan.captions.emphasis_words);
  const [rhythmLog, setRhythmLog] = useState(plan.rhythm?.added ?? []);
  const [rhythmTouched, setRhythmTouched] = useState(false);

  const proposed = useMemo(() => idsOf({ removals: plan.proposed_removals }), [plan.proposed_removals]);
  const reasons = useMemo(() => {
    const map = new Map<number, RemovalReason>();
    for (const r of [...plan.proposed_removals, ...plan.removals]) for (let id = r.from_word; id <= r.to_word; id++) if (!map.has(id) || r.source === "user") map.set(id, r.reason);
    return map;
  }, [plan.proposed_removals, plan.removals]);
  const offScript = useMemo(() => new Set(plan.off_script), [plan.off_script]);

  const review = useMemo(
    () => ({
      removed: [...removed].sort((a, b) => a - b),
      selectedHook,
      preset,
      offsetX,
      corrections,
      broll: brollItems,
      ...(style ? { zooms: zoomsOn } : {}),
      emoji,
      sfx,
      studio,
      music: { trackId: music.trackId && tracks.some((t) => t.id === music.trackId) ? music.trackId : null, db: Math.max(-30, Math.min(-8, music.db)) },
      ...(plan.moves?.length ? { moves } : {}),
      effects: fxItems,
      ...(rhythmTouched ? { rhythm: { density, added: rhythmLog, zoomMoments, longPause: pacing?.long_pause ?? 0.5, emphasis } } : {}),
    }),
    [removed, selectedHook, preset, offsetX, corrections, brollItems, style, zoomsOn, emoji, sfx, studio, music, tracks, moves, plan.moves, fxItems, rhythmTouched, density, rhythmLog, zoomMoments, pacing, emphasis],
  );

  const timeline = useMemo(
    () =>
      buildTimeline(
        words,
        {
          removals: rangesFromIds(review.removed, plan.removals),
          hook_candidates: plan.hook_candidates,
          selected_hook: selectedHook,
          corrections,
          captions: { preset, emphasis_words: emphasis },
          pacing,
          moves,
        },
        duration,
      ),
    [words, review.removed, plan.removals, plan.hook_candidates, emphasis, pacing, selectedHook, corrections, preset, duration, moves],
  );
  const fxSegs = useMemo(() => fxSegments(timeline, fxItems), [timeline, fxItems]);
  // Sin subtítulos donde el director los ocultó (ya hay texto en pantalla en esa franja) ni durante los efectos que llevan
  // los suyos, igual que en el render.
  const blocks = useMemo(() => {
    if (preset === "ninguno") return [];
    const hidden = (plan.captions.hide ?? []).map((h) => outputRange(timeline, h.from_word, h.to_word)).filter((r): r is { start: number; end: number } => Boolean(r));
    return hideDuring(captionBlocks(timeline.words, preset, captionStyle), [...hidden, ...fxCaptionHides(fxSegs)]);
  }, [timeline, preset, captionStyle, plan.captions.hide, fxSegs]);
  // Diseño del estilo de la galería con la marca: el mismo que arma el render (lib/video/service.ts).
  const capLook = useMemo(() => (isCaptionStyle(preset) ? captionLook(preset, { format, accent, brandFont: graphicLook.font, emoji }) : null), [preset, format, accent, graphicLook.font, emoji]);
  const segments = useMemo(() => brollSegments(timeline, brollItems), [timeline, brollItems]);
  const zooms = useMemo(() => {
    const avoid = [...segments, ...fxSegs];
    return style && style.zoom.enabled && zoomsOn ? computeZooms(timeline, style.zoom, { emphasis, avoid }) : directorZooms(timeline, zoomMoments, avoid);
  }, [style, zoomsOn, timeline, emphasis, zoomMoments, segments, fxSegs]);
  // Ritmo medido sobre lo que se ve (los mismos cálculos que el render) y los sonidos en su lugar.
  const entries = useMemo(() => graphicEntries(segments), [segments]);
  const rhythm = useMemo(() => rhythmScore({ timeline, broll: segments, zooms, effects: fxSegs.map((f) => ({ start: f.start, end: f.end, kind: f.item.kind })), entries, density }), [timeline, segments, zooms, fxSegs, entries, density]);
  const sfxMarks = useMemo(
    () => sfxCues({ level: sfx, duration: timeline.duration, broll: segments, hookEnd: hookEnd(timeline), entries: [...entries, ...fxSegs.map((f) => f.start)], punches: zooms.filter((z) => z.kind === "punch").map((z) => z.start), dense: density === "reels" }),
    [sfx, timeline, segments, entries, fxSegs, zooms, density],
  );
  const [outTime, setOutTime] = useState<number | null>(null);

  /** Cambia la densidad: lo que agregó el ritmo antes se quita y se vuelve a calcular (punch-ins, gráficos, pausas). */
  function changeDensity(next: Density) {
    if (next === density) return;
    const current: EditPlan = {
      ...plan,
      format,
      removals: rangesFromIds(review.removed, plan.removals),
      selected_hook: selectedHook,
      corrections,
      broll: brollItems,
      effects: fxItems,
      zoom_moments: zoomMoments,
      ...(pacing ? { pacing } : {}),
      captions: { ...plan.captions, preset, emphasis_words: emphasis },
      moves,
      rhythm: { density, added: rhythmLog },
    };
    const theme = themeOfPlan(current) ?? motionTheme(graphicLook);
    const { plan: filled } = fillRhythm(current, { words, duration, density: next, format, forbidden: protectedZones(director?.state.map ?? null, words).zones, theme, fxAllowed: rhythmFx, replace: true });
    setDensity(next);
    setBrollItems(filled.broll);
    setFxItems(filled.effects ?? []);
    setZoomMoments(filled.zoom_moments ?? []);
    setPacing(filled.pacing);
    setEmphasis(filled.captions.emphasis_words);
    setRhythmLog(filled.rhythm?.added ?? []);
    setRemoved(idsOf(filled));
    setRhythmTouched(true);
  }
  // Efectos: el mismo spec que arma el render (lib/video/fx-service.ts), con la cara que midió el worker.
  const fxBrand = useMemo(() => fxBrandFromLook(graphicLook), [graphicLook]);
  const thumbs = useMemo(() => fxContext?.thumbs ?? [], [fxContext]);
  const fxSpecs = useMemo(
    () =>
      fxSegs.map((segment) => {
        const face = faceAnchor(fxContext?.faces ?? [], sourceRangesOf(timeline, segment.start, segment.end), sourceWidth, sourceHeight, format, offsetX);
        return compileFx({ segment, timeline, format, brand: fxBrand, face, thumbs: thumbs.length, cards: thumbs.map((t) => t.title) });
      }),
    [fxSegs, fxContext, timeline, sourceWidth, sourceHeight, format, offsetX, fxBrand, thumbs],
  );
  const fxImages = useImages(useMemo(() => Object.fromEntries(thumbs.map((t, i) => [`t${i}`, t.url])), [thumbs]));
  const stripUrls = useMemo(() => Object.fromEntries(Object.entries(masks?.urls ?? {}).map(([k, u]) => [k, u])), [masks]);
  const stripImgs = useImages(stripUrls);
  const fxStrips = useMemo(() => Object.fromEntries(Object.entries(stripImgs).map(([k, v]) => [Number(k), v])) as Record<number, HTMLImageElement | undefined>, [stripImgs]);
  // Efectos con recorte cuyos segundos todavía no tienen máscara (la vista previa los muestra sin recortarte).
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
  const signedOf = useCallback(
    (o: BrollItem["choice"]) => (o ? (signed[optionKey(o)] ?? { ...o, thumbUrl: o.thumb ?? null, previewUrl: o.preview ?? null }) : null),
    [signed],
  );
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
  const brollMarks = useMemo<BrollMark[]>(
    () => brollItems.map((b) => ({ id: b.id, from: b.from_word, to: b.to_word, thumbUrl: signedOf(b.choice)?.thumbUrl ?? null, empty: !b.choice, graphic: b.choice?.source === "graphic" })),
    [brollItems, signedOf],
  );

  function showBroll(id: string) {
    setActiveBroll(id);
    const seg = segments.find((sg) => sg.id === id);
    if (seg) preview.current?.seekOutput(seg.start, true);
  }

  function addBroll(range: { from: number; to: number }, ask = false) {
    const overlaps = (b: BrollItem) => range.from <= b.to_word && b.from_word <= range.to;
    const query = words
      .slice(range.from, range.to + 1)
      .map((w) => w.text.replace(/[^\p{L}\p{N}]+/gu, ""))
      .filter((w) => w.length > 3)
      .slice(0, 4);
    const item: BrollItem = { id: newBrollId(), from_word: range.from, to_word: range.to, query_en: query.join(" ").slice(0, 100) || "b-roll", keywords: query.map((w) => w.toLowerCase()), choice: null, options: [] };
    setBrollItems((prev) => [...prev.filter((b) => !overlaps(b)), item].sort((a, b) => a.from_word - b.from_word));
    if (fxItems.some((e) => range.from <= e.to_word && e.from_word <= range.to)) {
      setFxItems((prev) => prev.filter((e) => !(range.from <= e.to_word && e.from_word <= range.to)));
      toast.info("Quitamos el efecto que estaba en esas palabras: un tramo lleva b-roll o un efecto, no los dos.");
    }
    setActiveBroll(item.id);
    setPickTab(ask ? "grafico" : undefined);
    setAskFocus(ask);
    setPicking(item.id);
  }

  /** Guarda la edición de un b-roll (sin el campo si quedó como la de siempre, así el plan no crece de más). */
  function setBrollEdit(id: string, edit: BrollEdit) {
    setBrollItems((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        const next = { ...b };
        if (isDefaultEdit(edit)) delete next.edit;
        else next.edit = edit;
        return next;
      }),
    );
  }

  /** "Aplicar este look a todos": copia filtro, intensidad, opacidad y ajustes a los demás b-roll de video. */
  function applyLookToAll(id: string) {
    const source = brollItems.find((b) => b.id === id);
    if (!source) return;
    const look = resolveEdit(source.edit).look;
    const count = brollItems.filter((b) => b.id !== id && b.choice && b.choice.source !== "graphic").length;
    setBrollItems((prev) =>
      prev.map((b) => {
        if (b.id === id || !b.choice || b.choice.source === "graphic") return b;
        const edit = { ...resolveEdit(b.edit), look };
        const next = { ...b };
        if (isDefaultEdit(edit)) delete next.edit;
        else next.edit = edit;
        return next;
      }),
    );
    toast.success(count === 1 ? "Look aplicado al otro b-roll." : `Look aplicado a los otros ${formatNumber(count)} b-roll.`);
  }

  /** Agrega un efecto sobre un tramo (o cambia el efecto de uno existente), con sus textos por defecto. */
  function addFx(kind: FxKind, range: { from: number; to: number }, replace: string | null) {
    const hitsBroll = brollItems.some((b) => b.choice && range.from <= b.to_word && b.from_word <= range.to);
    if (hitsBroll) {
      toast.error("Ese tramo ya tiene b-roll. Quita el b-roll o elige otras palabras para el efecto.");
      return;
    }
    const spoken = words.slice(range.from, range.to + 1).map((w) => ({ id: w.id, text: corrections[String(w.id)] ?? w.text }));
    const item: FxItem = { id: replace ?? newFxId(), kind, from_word: range.from, to_word: range.to, ...defaultFx(kind, spoken), source: "user" };
    setFxItems((prev) => [...prev.filter((e) => e.id !== replace && !(range.from <= e.to_word && e.from_word <= range.to)), item].sort((a, b) => a.from_word - b.from_word));
    setActiveFx(item.id);
    setEditingFx(item.id);
    const seg = fxSegments(timeline, [item])[0];
    if (seg) preview.current?.seekOutput(seg.start, true);
  }

  function showFx(id: string) {
    setActiveFx(id);
    const seg = fxSegs.find((s) => s.id === id);
    if (seg) preview.current?.seekOutput(seg.start, true);
  }

  function moveFx(id: string, range: { from: number; to: number }) {
    if (brollItems.some((b) => b.choice && range.from <= b.to_word && b.from_word <= range.to)) {
      toast.error("Ese tramo ya tiene b-roll. Elige otras palabras.");
      return;
    }
    setFxItems((prev) => prev.filter((e) => e.id === id || !(range.from <= e.to_word && e.from_word <= range.to)).map((e) => (e.id === id ? { ...e, from_word: range.from, to_word: range.to, words: e.words?.filter((w) => w >= range.from && w <= range.to) } : e)).sort((a, b) => a.from_word - b.from_word));
  }

  // Recorte para la vista previa: mientras falten segundos, se consulta (y se pide al worker) cada 5 s.
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

  function moveBroll(id: string, range: { from: number; to: number }) {
    setBrollItems((prev) =>
      prev
        .filter((b) => b.id === id || !(range.from <= b.to_word && b.from_word <= range.to))
        .map((b) => (b.id === id ? { ...b, from_word: range.from, to_word: range.to } : b))
        .sort((a, b) => a.from_word - b.from_word),
    );
  }

  // Guardado automático de la revisión (1,2 s después del último cambio).
  const reviewKey = useMemo(() => JSON.stringify([review, format]), [review, format]);
  const [savedKey, setSavedKey] = useState(reviewKey);
  const [saving, setSaving] = useState<"idle" | "saving" | "error">("idle");
  const sending = useRef(false);
  useEffect(() => {
    if (!canEdit || reviewKey === savedKey) return;
    const timer = setTimeout(async () => {
      if (sending.current) return;
      setSaving("saving");
      const result = await saveReviewAction(projectId, review, format);
      if (result.ok) {
        setSavedKey(reviewKey);
        setSaving("idle");
      } else {
        setSaving("error");
        toast.error(result.error);
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [reviewKey, savedKey, review, format, projectId, canEdit]);
  const saveState = saving === "error" ? "error" : saving === "saving" || reviewKey !== savedKey ? "saving" : "saved";

  // "Escuchar" un gancho: primero se elige (pasa al principio) y, cuando el timeline cambia, se reproduce desde 0.
  const listenAfterChange = useRef(false);
  useEffect(() => {
    if (!listenAfterChange.current) return;
    listenAfterChange.current = false;
    preview.current?.seekOutput(0, true);
  }, [timeline]);

  const setCut = useCallback((ids: number[], cut: boolean) => {
    setRemoved((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (cut) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  function listenFrom(id: number) {
    const w = timeline.words.find((x) => x.id >= id);
    preview.current?.seekOutput(w ? w.start : 0, true);
  }

  function render() {
    sending.current = true;
    startRender(async () => {
      const result = await renderAction(projectId, review, format);
      if (!result.ok) {
        sending.current = false;
        toast.error(result.error);
      } else router.refresh();
    });
  }

  const hook = selectedHook != null ? plan.hook_candidates[selectedHook] : undefined;
  const cutCount = removed.size;
  const landscape = sourceWidth > sourceHeight * 1.02;
  const showFraming = format === "9:16" && landscape;
  const changedFromProposal = removed.size !== proposed.size || [...removed].some((id) => !proposed.has(id));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
      <div className="order-2 flex min-w-0 flex-col gap-6 lg:order-1">
        {director && (
          <UnderstandingPanel
            projectId={projectId}
            view={director}
            words={words}
            corrections={corrections}
            removed={removed}
            coveredBy={(from, to) => brollItems.some((b) => b.choice && b.from_word <= from && b.to_word >= to)}
            onListen={listenFrom}
            canEdit={canEdit}
            sourceWidth={sourceWidth}
            sourceHeight={sourceHeight}
            defaultOpen={!director.state.edits.length}
          />
        )}
        {plan.planned_by === "auto" && (
          <Notice tone="warning" title="Plan armado sin IA">
            {plan.warning || "La IA no respondió: se cortaron solo las tomas repetidas, arranques en falso y muletillas más claras. Revisa los cortes con más atención."}
          </Notice>
        )}
        {plan.planned_by === "ai" && plan.warning && <Notice tone="warning">{plan.warning}</Notice>}
        {plan.summary && plan.planned_by === "ai" && (
          <div className="card flex gap-3 p-4">
            <Sparkles className="mt-0.5 h-4 w-4 flex-none text-accent-hi" aria-hidden />
            <p className="text-sm text-text/90">{plan.summary}</p>
          </div>
        )}

        <section aria-labelledby="hooks-title" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="hooks-title" className="text-base font-semibold">
                Elige el gancho
              </h2>
              <p className="text-sm text-muted">El gancho pasa al principio del video. Los primeros 3 segundos deciden si siguen mirando.</p>
            </div>
          </div>
          <div role="radiogroup" aria-label="Gancho" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {plan.hook_candidates.map((h, i) => {
              const text = words.slice(h.from_word, h.to_word + 1).map((w) => corrections[String(w.id)] ?? w.text).join(" ");
              const secs = (words[h.to_word]?.end ?? 0) - (words[h.from_word]?.start ?? 0);
              const active = selectedHook === i;
              return (
                <div key={`${h.from_word}-${h.to_word}`} className={cn("card flex flex-col gap-2 p-4 transition", active ? "!border-accent bg-accent/12" : "hover:border-white/25")}>
                  <button type="button" role="radio" aria-checked={active} disabled={!canEdit} onClick={() => setSelectedHook(i)} className="flex flex-col gap-2 text-left">
                    <span className="flex items-center justify-between gap-2">
                      <span className="eyebrow">Gancho {i + 1}</span>
                      <span className="font-mono text-[11px] text-muted">{secs.toFixed(1)} s</span>
                    </span>
                    <span className="line-clamp-4 text-sm font-semibold text-white">“{text}”</span>
                    <span className="line-clamp-3 text-xs text-muted">{h.why}</span>
                  </button>
                  <Button
                    size="sm"
                    variant="subtle"
                    className="mt-auto self-start !px-2 -ml-2"
                    onClick={() => {
                      if (canEdit && selectedHook !== i) {
                        listenAfterChange.current = true;
                        setSelectedHook(i);
                      } else preview.current?.seekOutput(0, true);
                    }}
                  >
                    Escuchar
                  </Button>
                </div>
              );
            })}
            <button
              type="button"
              role="radio"
              aria-checked={selectedHook == null}
              disabled={!canEdit}
              onClick={() => setSelectedHook(null)}
              className={cn("card flex flex-col justify-center gap-1 p-4 text-left transition", selectedHook == null ? "!border-accent bg-accent/12" : "hover:border-white/25")}
            >
              <span className="text-sm font-semibold text-white">Sin gancho</span>
              <span className="text-xs text-muted">El video empieza como lo grabaste.</span>
            </button>
          </div>
          {plan.hook_candidates.length === 0 && <p className="text-sm text-muted">No encontramos frases de 3 a 8 segundos que funcionen solas como gancho.</p>}
        </section>

        {director && <VariantsPanel projectId={projectId} variants={director.state.variants} current={timeline.duration} canEdit={canEdit} dirty={reviewKey !== savedKey} />}

        <DecisionsPanel
          plan={plan}
          words={words}
          corrections={corrections}
          removed={removed}
          moves={moves}
          onMoves={setMoves}
          onListen={listenFrom}
          onRestore={(range) => setCut(Array.from({ length: range.to - range.from + 1 }, (_, k) => range.from + k), false)}
          canEdit={canEdit}
        />

        <BrollPanel
          items={brollItems}
          segments={segments}
          signed={signed}
          words={words}
          corrections={corrections}
          canEdit={canEdit}
          activeId={activeBroll}
          onActivate={showBroll}
          onRemove={(id) => setBrollItems((prev) => prev.filter((b) => b.id !== id))}
          onChange={(id, tab) => {
            setPickTab(tab);
            setAskFocus(false);
            setPicking(id);
          }}
          onEdit={(id) => {
            showBroll(id);
            setEditing(id);
          }}
          format={format}
        />
        {(() => {
          const item = brollItems.find((b) => b.id === editing);
          const choice = item ? signedOf(item.choice) : null;
          if (!item || !choice) return null;
          const seg = segments.find((sg) => sg.id === item.id) ?? null;
          const others = brollItems.filter((b) => b.id !== item.id && b.choice && b.choice.source !== "graphic").length;
          const text = words.slice(item.from_word, item.to_word + 1).map((w) => corrections[String(w.id)] ?? w.text).join(" ");
          return (
            <BrollEditPanel
              key={item.id}
              open
              onClose={() => setEditing(null)}
              edit={resolveEdit(item.edit)}
              onChange={(edit) => setBrollEdit(item.id, edit)}
              onApplyLookToAll={() => applyLookToAll(item.id)}
              otherVideos={others}
              format={format}
              media={{ previewUrl: choice.previewUrl, thumbUrl: choice.thumbUrl, width: choice.width, height: choice.height }}
              poster={posterUrl}
              accent={graphicLook.theme.accent}
              ground={graphicLook.theme.bg}
              focusY={style?.focusY ?? 0.42}
              span={seg ? { start: seg.start, end: seg.end } : null}
              clipDuration={choice.duration}
              isGraphic={choice.source === "graphic"}
              graphic={choice.graphic ?? null}
              posterFit={format === "16:9" && sourceHeight > sourceWidth * 1.02 ? "contain" : "cover"}
              posterX={showFraming ? offsetX : 0}
              title={text.length > 70 ? `${text.slice(0, 70).trimEnd()}…` : text}
            />
          );
        })()}
        <BrollPicker
          key={picking ?? "none"}
          item={brollItems.find((b) => b.id === picking) ?? null}
          signed={signed}
          look={graphicLook}
          initialTab={pickTab}
          projectId={projectId}
          focusRequest={askFocus}
          spokenText={(() => {
            const b = brollItems.find((x) => x.id === picking);
            return b ? words.slice(b.from_word, b.to_word + 1).map((w) => corrections[String(w.id)] ?? w.text).join(" ") : "";
          })()}
          format={format}
          minDuration={(() => {
            const b = brollItems.find((x) => x.id === picking);
            return b ? Math.max(0, (words[b.to_word]?.end ?? 0) - (words[b.from_word]?.start ?? 0)) : 0;
          })()}
          onClose={() => setPicking(null)}
          onPick={(option) => {
            // Al plan va la alternativa sin las URLs firmadas (vencen); esas quedan solo para la vista previa.
            const plain: BrollOption = { ...option };
            delete (plain as Partial<SignedOption>).thumbUrl;
            delete (plain as Partial<SignedOption>).previewUrl;
            if (plain.source !== "graphic") setSigned((prev) => ({ ...prev, [optionKey(option)]: option }));
            setBrollItems((prev) =>
              prev.map((b) => {
                if (b.id !== picking) return b;
                // Un gráfico editado reemplaza al anterior en las alternativas (queda uno solo por tramo).
                if (plain.source === "graphic") return { ...b, choice: plain, options: [plain, ...b.options.filter((o) => o.source !== "graphic")].slice(0, 12) };
                return { ...b, choice: plain, options: b.options.some((o) => optionKey(o) === optionKey(plain)) ? b.options : [plain, ...b.options].slice(0, 12) };
              }),
            );
            setPicking(null);
            if (picking) setActiveBroll(picking);
          }}
        />

        <FxPanel
          items={fxItems}
          segments={fxSegs}
          words={words}
          corrections={corrections}
          canEdit={canEdit}
          activeId={activeFx}
          brand={fxBrand}
          maskStatus={{ pending: Boolean(masks?.pending), failed: Boolean(masks?.failed), missing: maskMissing }}
          noThumbs={thumbs.length === 0}
          onActivate={showFx}
          onEdit={(id) => {
            showFx(id);
            setEditingFx(id);
          }}
          onRemove={(id) => setFxItems((prev) => prev.filter((e) => e.id !== id))}
          onGallery={() => setGallery({ range: null, replace: null })}
        />
        <FxEditor
          key={editingFx ?? "sin-efecto"}
          item={fxItems.find((e) => e.id === editingFx) ?? null}
          words={words}
          corrections={corrections}
          onChange={(next) => setFxItems((prev) => prev.map((e) => (e.id === next.id ? next : e)))}
          onClose={() => setEditingFx(null)}
          onReplace={() => {
            const item = fxItems.find((e) => e.id === editingFx);
            if (item) setGallery({ range: { from: item.from_word, to: item.to_word }, replace: item.id });
            setEditingFx(null);
          }}
          onRemove={() => {
            setFxItems((prev) => prev.filter((e) => e.id !== editingFx));
            setEditingFx(null);
          }}
          maskNote={(() => {
            const item = fxItems.find((e) => e.id === editingFx);
            if (!item || !FX_INFO[item.kind].mask) return null;
            return maskMissing.has(item.id)
              ? "Este efecto va detrás tuyo. Mientras preparamos tu recorte, la vista previa lo muestra más tenue; en el video final siempre quedas adelante."
              : "Este efecto va detrás tuyo: la vista previa ya usa tu recorte (el mismo del video final).";
          })()}
        />
        {gallery && (
          <FxGallery
            open
            onClose={() => setGallery(null)}
            brand={fxBrand}
            current={gallery.replace ? (fxItems.find((e) => e.id === gallery.replace)?.kind ?? null) : null}
            rangeText={gallery.range ? words.slice(gallery.range.from, gallery.range.to + 1).map((w) => corrections[String(w.id)] ?? w.text).join(" ").slice(0, 120) : null}
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

        <PhraseFixPanel
          projectId={projectId}
          fixes={phrase.fixes}
          canEdit={canEdit}
          onUpsert={phrase.upsert}
          onCoverChanged={(fix) => {
            // Con labios o sin cambios ya no hace falta el b-roll vacío que se puso para tapar la frase.
            if (fix.cover !== "broll") setBrollItems((prev) => prev.filter((b) => b.choice || b.to_word < fix.fromWord || b.from_word > fix.toWord));
          }}
          onRemove={(fix) => {
            phrase.remove(fix.id);
            // Los subtítulos vuelven a la frase original (solo los que puso la corrección).
            const ours = captionCorrections(fix.fromWord, fix.toWord, fix.newText);
            setCorrections((prev) => {
              const next = { ...prev };
              for (const [id, text] of Object.entries(ours)) if (next[id] === text) delete next[id];
              return next;
            });
          }}
          onCoverWithBroll={(fix) => addBroll({ from: fix.fromWord, to: fix.toWord })}
          onListen={listenFrom}
          hasBrollAt={(from, to) => brollItems.some((b) => b.choice && b.from_word <= to && from <= b.to_word)}
        />
        <PhraseFixDialog
          key={fixRange ? `frase-${fixRange.from}-${fixRange.to}` : "frase-cerrada"}
          projectId={projectId}
          range={fixRange}
          words={words}
          corrections={corrections}
          duration={duration}
          onClose={() => setFixRange(null)}
          onCreated={(fix) => {
            phrase.upsert(fix);
            setCorrections((prev) => ({ ...prev, ...captionCorrections(fix.fromWord, fix.toWord, fix.newText) }));
            if (fix.cover === "broll") addBroll({ from: fix.fromWord, to: fix.toWord });
          }}
        />

        <section aria-labelledby="transcript-title" className="section-shell flex flex-col gap-4 !p-4 sm:!p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="transcript-title" className="text-base font-semibold">
                Revisa los cortes
              </h2>
              <p className="text-sm text-muted">
                {formatNumber(cutCount)} {cutCount === 1 ? "palabra cortada" : "palabras cortadas"} de {formatNumber(words.length)}. Lo tachado no sale en el video.
              </p>
            </div>
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                {changedFromProposal && proposed.size > 0 && (
                  <Button size="sm" variant="ghost" icon={<Wand2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => setRemoved(new Set(proposed))}>
                    Volver a la propuesta
                  </Button>
                )}
                <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => setRemoved(new Set())} disabled={removed.size === 0}>
                  Restaurar todo
                </Button>
              </div>
            )}
          </div>
          <TranscriptEditor
            words={words}
            removed={removed}
            reasons={reasons}
            hook={hook ? { from: hook.from_word, to: hook.to_word } : null}
            offScript={offScript}
            corrections={corrections}
            activeTime={activeTime}
            canEdit={canEdit}
            onSetCut={setCut}
            onCorrect={(id, text) =>
              setCorrections((prev) => {
                const next = { ...prev };
                if (text) next[String(id)] = text;
                else delete next[String(id)];
                return next;
              })
            }
            onListen={listenFrom}
            brollMarks={brollMarks}
            activeBroll={activeBroll}
            onBrollClick={showBroll}
            extraActions={
              canEdit
                ? (range, clear) => (
                    <>
                      <Button size="sm" variant="ghost" icon={<Clapperboard className="h-3.5 w-3.5" aria-hidden />} onClick={() => (addBroll(range), clear())}>
                        Poner b-roll aquí
                      </Button>
                      <Button size="sm" variant="ghost" icon={<WandSparkles className="h-3.5 w-3.5" aria-hidden />} onClick={() => (addBroll(range, true), clear())}>
                        Pide un gráfico aquí
                      </Button>
                      <Button size="sm" variant="ghost" icon={<Sparkles className="h-3.5 w-3.5" aria-hidden />} onClick={() => (setGallery({ range, replace: null }), clear())}>
                        Poner un efecto aquí
                      </Button>
                      <Button size="sm" variant="ghost" icon={<Mic className="h-3.5 w-3.5" aria-hidden />} onClick={() => (setFixRange(range), clear())}>
                        Corregir esta frase
                      </Button>
                      {activeFx && fxItems.some((e) => e.id === activeFx) && (
                        <Button size="sm" variant="ghost" onClick={() => (moveFx(activeFx, range), clear())}>
                          Mover el efecto elegido aquí
                        </Button>
                      )}
                      {activeBroll && brollItems.some((b) => b.id === activeBroll) && (
                        <Button size="sm" variant="ghost" onClick={() => (moveBroll(activeBroll, range), clear())}>
                          Mover el b-roll elegido aquí
                        </Button>
                      )}
                    </>
                  )
                : undefined
            }
          />
          {offScript.size > 0 && <p className="text-xs text-muted">Lo subrayado con puntos amarillos no está en el guion (no se corta solo).</p>}
        </section>
      </div>

      <aside className="order-1 lg:order-2">
        <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
          <div className="card flex flex-col gap-4 p-4">
            <PreviewPlayer
              ref={preview}
              src={proxyUrl}
              poster={posterUrl}
              clips={timeline.clips}
              duration={timeline.duration}
              blocks={blocks}
              preset={preset}
              format={format}
              accent={accent}
              sourceWidth={sourceWidth}
              sourceHeight={sourceHeight}
              offsetX={showFraming ? offsetX : 0}
              onSourceTime={setActiveTime}
              onOutputTime={setOutTime}
              captionStyle={preset === "estilo" ? captionStyle : null}
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
            <RhythmPanel
              score={rhythm}
              cuts={cutTimes(timeline)}
              sfx={sfxMarks}
              entries={entries}
              time={outTime}
              density={density}
              onDensity={changeDensity}
              onSeek={(t) => preview.current?.seekOutput(t, false)}
              canEdit={canEdit}
            />
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-white/[0.04] px-2 py-2">
                <dt className="text-[11px] text-muted">Original</dt>
                <dd className="font-mono text-sm font-semibold text-white tabular-nums">{formatDuration(duration)}</dd>
              </div>
              <div className="rounded-xl bg-accent/12 px-2 py-2">
                <dt className="text-[11px] text-accent-glow">Final</dt>
                <dd className="font-mono text-sm font-semibold text-white tabular-nums" aria-live="polite">
                  {formatDuration(timeline.duration)}
                </dd>
              </div>
              <div className="rounded-xl bg-white/[0.04] px-2 py-2">
                <dt className="text-[11px] text-muted">Cortes</dt>
                <dd className="font-mono text-sm font-semibold text-white tabular-nums">{formatNumber(Math.max(0, timeline.clips.length - 1))}</dd>
              </div>
            </dl>
          </div>

          {canEdit && (
            <EditRequestCard
              projectId={projectId}
              canEdit={canEdit}
              estimate={director?.editEstimate ?? 0}
              spent={director?.cost.totalUsd ?? 0}
              cap={director?.budgetUsd ?? 5}
              edits={director?.state.edits ?? []}
              dirty={reviewKey !== savedKey}
            />
          )}

          <div className="card flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-white">Formato</span>
              <SegmentedControl
                label="Formato"
                value={format}
                onValueChange={(v) => canEdit && setFormat(v)}
                options={[
                  { value: "9:16", label: "Vertical 9:16" },
                  { value: "16:9", label: "Horizontal 16:9" },
                ]}
              />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-white">Subtítulos</span>
              <CaptionPicker
                value={preset}
                onChange={(v) => canEdit && setPreset(v)}
                options={CAPTION_PICKER_ORDER.filter((k) => k !== "estilo" || Boolean(captionStyle))}
                accent={accent}
                brandFont={graphicLook.font}
                emoji={emoji}
                captionStyle={captionStyle}
                disabled={!canEdit}
              />
              <p className="text-xs text-muted" aria-live="polite">
                <span className="font-semibold text-text">{CAPTION_PRESETS[preset].label}:</span> {CAPTION_PRESETS[preset].description}
              </p>
              {isCaptionStyle(preset) && (
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5">
                  <span className="flex flex-col">
                    <span className="text-sm text-text">Emojis en las palabras clave</span>
                    <span className="text-xs text-muted">Uno por frase, solo donde encaja (dinero, tiempo, idea…).</span>
                  </span>
                  <input type="checkbox" className="h-4 w-4 flex-none accent-[#0070f8]" checked={emoji} disabled={!canEdit} onChange={(e) => setEmoji(e.target.checked)} />
                </label>
              )}
            </div>
            {style && (
              <div className="flex flex-col gap-2 border-t border-white/10 pt-4">
                <span className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Palette className="h-4 w-4 text-accent-hi" aria-hidden /> Estilo: <span className="truncate font-normal text-text">{style.name}</span>
                </span>
                {style.zoom.enabled ? (
                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5">
                    <span className="flex items-center gap-2 text-sm text-text">
                      <ZoomIn className="h-4 w-4 text-accent-hi" aria-hidden />
                      Zooms del estilo {zoomsOn ? `(${formatNumber(zooms.length)})` : ""}
                    </span>
                    <input type="checkbox" className="h-4 w-4 accent-[#0070f8]" checked={zoomsOn} disabled={!canEdit} onChange={(e) => setZoomsOn(e.target.checked)} />
                  </label>
                ) : (
                  <p className="text-xs text-muted">La referencia no usa zooms.</p>
                )}
              </div>
            )}
            {showFraming && (
              <div className="flex flex-col gap-2">
                <label htmlFor="framing" className="flex items-center justify-between text-sm font-semibold text-white">
                  Encuadre
                  {offsetX !== 0 && (
                    <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-accent-hi" onClick={() => setOffsetX(0)}>
                      <RotateCcw className="h-3 w-3" aria-hidden /> Centrar
                    </button>
                  )}
                </label>
                <input
                  id="framing"
                  type="range"
                  className="range"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={offsetX}
                  disabled={!canEdit}
                  onChange={(e) => setOffsetX(Number(e.target.value))}
                  style={{ ["--pct" as string]: `${((offsetX + 1) / 2) * 100}%` }}
                  aria-valuetext={offsetX === 0 ? "Centrado" : offsetX < 0 ? "Hacia la izquierda" : "Hacia la derecha"}
                />
                <p className="text-xs text-muted">Tu video es horizontal: mueve el recorte para que tu cara quede al centro.</p>
              </div>
            )}
          </div>

          <div className="card flex flex-col gap-4 p-4">
            <AudioPanel studio={studio} onStudio={setStudio} audioPreview={audioPreview} sfx={sfx} onSfx={setSfx} musicId={music.trackId} musicDb={music.db} onMusic={setMusic} tracks={tracks} canEdit={canEdit} />
          </div>

          {canEdit && (
            <div className="flex flex-col gap-2">
              <Button onClick={render} disabled={rendering || timeline.clips.length === 0} icon={rendering ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Clapperboard className="h-4 w-4" aria-hidden />}>
                {rendering ? "Enviando…" : "Renderizar video"}
              </Button>
              <p className="text-center text-xs text-muted" aria-live="polite">
                {saveState === "saving" ? "Guardando cambios…" : saveState === "error" ? "No se pudieron guardar los cambios." : "Cambios guardados."} Puedes salir y volver cuando quieras.
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
