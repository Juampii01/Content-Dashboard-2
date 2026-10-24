/**
 * Caso de la prueba de sincronía (worker/tests/test_sync.py): un video sintético de ~75 s con un plan parecido al de
 * un reel "Editor de reels" real (gancho movido al principio, pausas acortadas, un bloque movido, zooms, gráficos con
 * marca, un b-roll en pantalla dividida, seis efectos de la biblioteca, efectos de sonido y música) y la entrada del
 * render que arma la app con esas mismas funciones (timeline, efectos, zooms, b-roll, subtítulos y sonido).
 *
 * `scripts/make-sync-fixture.mts` lo escribe en worker/tests/fixtures/sync-plan.json; tests/video-sync.test.mts
 * revisa que el archivo esté al día y que la vista previa y el render usen el mismo mapeo de tramos.
 */
import { layerKey, stackIndex } from "../lib/video/layers";
import { brollRenderEdit } from "../lib/video/broll-edit";
import { captionLook, captionTracks } from "../lib/video/caption-styles";
import { captionBlocks, hideDuring, toSrt } from "../lib/video/captions";
import { placeCaptionBlocks } from "../lib/video/canvas/captions";
import { brollSegments, directorZooms, graphicEntries } from "../lib/video/effects";
import { compileFx, faceAnchor, fxCaptionHides, fxSegments, sourceFramesOf, sourceRangesOf, type FxBrand } from "../lib/video/fx/compile";
import type { FxItem } from "../lib/video/fx/schema";
import { hookEnd, sfxCues } from "../lib/video/sfx";
import { buildTimeline, type Timeline } from "../lib/video/timeline";
import type { BrollItem, EditPlan, Word } from "../lib/video/types";

const VOCAB = ["clientes", "contenido", "ventas", "mensaje", "negocio", "sistema", "estrategia", "conversaciones", "seguidores", "resultado", "proceso", "oferta", "video", "marca", "semana", "precio", "cierre", "llamada", "ritmo", "gancho"];
const SHORT = ["que", "no", "te", "es", "tu", "en", "con", "para", "y", "lo", "si", "más", "los", "un"];

/** Generador determinista (el mismo caso en cada corrida). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Fin de frase en estas palabras: el gancho (67–87) y el bloque movido (150–165 después de la 200) son frases enteras. */
const SENTENCE_ENDS = new Set([9, 20, 31, 44, 55, 66, 76, 87, 99, 112, 124, 137, 149, 165, 177, 188, 200, 213, 226, 240, 254]);
/** Pausas largas después de estas palabras (el ritmo las acorta a 0,35 s). */
const LONG_PAUSES = new Map([
  [20, 0.9],
  [55, 1.2],
  [99, 0.8],
  [124, 1.4],
  [188, 0.75],
  [226, 1.1],
]);

export function syncWords(): Word[] {
  const r = rng(20261024);
  const words: Word[] = [];
  let t = 0.35;
  for (let id = 0; id < 255; id++) {
    const long = r() < 0.45;
    const base = long ? VOCAB[Math.floor(r() * VOCAB.length)]! : SHORT[Math.floor(r() * SHORT.length)]!;
    const dur = long ? 0.22 + r() * 0.12 : 0.1 + r() * 0.06;
    const end = SENTENCE_ENDS.has(id);
    words.push({ id, text: end ? `${base}.` : base, start: round3(t), end: round3(t + dur) });
    t += dur + (LONG_PAUSES.get(id) ?? (end ? 0.2 + r() * 0.08 : 0.02 + r() * 0.05));
  }
  return words;
}

export const SYNC_DURATION = 74.0;
const BRAND: FxBrand = { accent: "#2b8cff", bg: "#030a22", surface: "#0a1a45", text: "#f2f6ff", muted: "#a7b9d4", accentText: "#ffffff", font: "inter" };
const THEME = { bg: BRAND.bg, surface: BRAND.surface, text: BRAND.text, muted: BRAND.muted, accent: BRAND.accent, accentText: BRAND.accentText };

function graphic(id: string, from: number, to: number, mode: "overlay" | "full", items: string[]): BrollItem {
  const scene = {
    v: 2,
    duration: 2,
    format: "9:16",
    mode,
    position: "bottom",
    theme: { ...THEME, font: "inter" },
    layers: [{ type: "component", component: "checklist", props: { items } }],
  };
  return { id, from_word: from, to_word: to, query_en: "", keywords: [], choice: { source: "graphic", id: `g-${id}`, duration: 0, width: 1080, height: 1920, graphic: scene }, options: [] } as unknown as BrollItem;
}

export function syncPlan(): EditPlan {
  const broll: BrollItem[] = [
    graphic("g1", 23, 28, "overlay", ["Uno", "Dos"]),
    graphic("g2", 47, 52, "overlay", ["Tres", "Cuatro"]),
    graphic("g3", 118, 123, "full", ["Cinco"]),
    graphic("g4", 186, 192, "overlay", ["Seis", "Siete"]),
    graphic("g5", 203, 209, "overlay", ["Ocho"]),
    graphic("g6", 245, 251, "overlay", ["Nueve", "Diez"]),
    {
      id: "s1",
      from_word: 128,
      to_word: 134,
      query_en: "laptop",
      keywords: [],
      choice: { source: "pexels", id: "1", duration: 6, width: 1920, height: 1080, file: "https://videos.pexels.com/prueba-sincronia.mp4" },
      options: [],
      edit: { layout: "split" },
    } as unknown as BrollItem,
  ];
  const effects: FxItem[] = [
    { id: "fx-portada", kind: "cover_story", from_word: 67, to_word: 72, text: "CLIENTES", items: ["Más clientes", "Sin perder tiempo"], kicker: "OCT 2026" },
    { id: "fx-lista", kind: "checklist", from_word: 100, to_word: 112, items: ["Gancho", "Ritmo", "Cierre"] },
    { id: "fx-vertigo", kind: "vertigo", from_word: 140, to_word: 147 },
    { id: "fx-corte", kind: "zoom_cut", from_word: 164, to_word: 167 },
    { id: "fx-zoom", kind: "digital_zoom", from_word: 214, to_word: 221, words: [216, 219] },
    { id: "fx-giro", kind: "orbit", from_word: 230, to_word: 238 },
  ];
  const zoom_moments = Array.from({ length: 22 }, (_, k) => {
    const from = 3 + k * 11;
    return { from_word: from, to_word: from + 2, scale: k % 2 ? 1.25 : 1.15, why: "prueba" };
  });
  return {
    version: 2,
    format: "9:16",
    segments: [],
    order: [],
    removals: [
      { from_word: 30, to_word: 31, reason: "filler", confidence: 1, source: "user" },
      { from_word: 140, to_word: 142, reason: "retake", confidence: 1, source: "user" },
    ],
    proposed_removals: [],
    hook_candidates: [{ from_word: 67, to_word: 87, score: 0.9, why: "prueba" }],
    selected_hook: 0,
    corrections: {},
    captions: { preset: "hormozi", emphasis_words: [] },
    pacing: { long_pause: 0.35 },
    moves: [{ from_word: 150, to_word: 165, after_word: 200, why: "prueba" }],
    zoom_moments,
    broll,
    effects,
    audio: { target_lufs: -14, sfx: "strong", studio: "soft", music_asset_id: "00000000-0000-4000-8000-000000000001", music_db: -16 },
    framing: { mode: "center", offset_x: 0 },
    warning: "",
  } as unknown as EditPlan;
}

/** La entrada del render, con las mismas funciones que `renderInputFor` (lib/video/service.ts), sin base de datos. */
export function syncRenderInput(words: Word[] = syncWords(), plan: EditPlan = syncPlan()) {
  const timeline: Timeline = buildTimeline(words, plan, SYNC_DURATION);
  const segments = fxSegments(timeline, plan.effects ?? []);
  const fx = segments.map((segment) => {
    const face = faceAnchor([], sourceRangesOf(timeline, segment.start, segment.end), 1080, 1920, "9:16", 0);
    const spec = compileFx({ segment, timeline, format: "9:16", brand: BRAND, face, thumbs: 0, cards: [] });
    return { spec, sourceFrames: spec.mask ? sourceFramesOf(timeline, spec.start, Math.max(1, Math.round(spec.duration * 30))) : [], layer: segment.layer };
  });
  const broll = brollSegments(timeline, plan.broll);
  // Orden de dibujo de las capas, igual que renderInputFor.
  const z = stackIndex([...broll.map((b) => ({ key: layerKey("broll", b.id), kind: "broll" as const, layer: b.layer, start: b.start })), ...fx.map((f) => ({ key: layerKey("fx", f.spec.id), kind: "fx" as const, layer: f.layer, start: f.spec.start }))]);
  const avoid = [...broll, ...segments.map((s) => ({ start: s.start, end: s.end }))];
  const zooms = directorZooms(timeline, plan.zoom_moments, avoid);
  const look = captionLook("hormozi", { format: "9:16", accent: BRAND.accent, brandFont: "inter", emoji: false });
  const blocks = hideDuring(captionBlocks(timeline.words, "hormozi", null), fxCaptionHides(segments));
  const sfx = sfxCues({
    level: "strong",
    duration: timeline.duration,
    broll,
    hookEnd: hookEnd(timeline),
    entries: [...graphicEntries(broll), ...segments.map((f) => f.start)],
    punches: zooms.filter((z) => z.kind === "punch").map((z) => z.start),
    dense: true,
  });
  const edit = (b: (typeof broll)[number]) =>
    brollRenderEdit({ edit: b.edit, format: "9:16", duration: b.end - b.start, clipWidth: b.option.width, clipHeight: b.option.height, focusY: 0.42, accent: BRAND.accent, ground: BRAND.bg, graphic: b.option.source === "graphic" ? { mode: (b.option.graphic as { mode?: string }).mode } : null });
  return {
    timeline,
    input: {
      projectId: "00000000-0000-4000-8000-00000000c0de",
      format: "9:16",
      fps: 30,
      clips: timeline.clips.map((c) => ({ start: c.startFrame, end: c.endFrame, role: c.role })),
      expectedDuration: timeline.duration,
      framing: { offsetX: 0, focusY: 0.42 },
      captions: { preset: "hormozi", accent: BRAND.accent, look, blocks: placeCaptionBlocks(blocks, plan.captions).map((b) => captionTracks(look, b, "9:16", BRAND.accent)) },
      zooms: zooms.map((z) => ({ start: z.start, end: z.end, scale: z.scale, ramp: z.ramp })),
      broll: broll.map((b) =>
        b.option.source === "graphic"
          ? { start: b.start, end: b.end, source: "graphic", spec: b.option.graphic, edit: edit(b), z: z.get(layerKey("broll", b.id)) ?? 0 }
          : { start: b.start, end: b.end, source: b.option.source, url: b.option.file, edit: edit(b), z: z.get(layerKey("broll", b.id)) ?? 0 },
      ),
      effects: fx.map(({ layer: _layer, ...f }) => (void _layer, { ...f, z: z.get(layerKey("fx", f.spec.id)) ?? 0 })),
      srt: toSrt(timeline.words),
      audio: { targetLufs: -14, truePeak: -1, sfx, music: { trackId: "00000000-0000-4000-8000-000000000001", key: "editor/musica/00000000-0000-4000-8000-000000000001/pista.wav", db: -16 }, studio: "soft" },
      phraseFixes: [],
      outputKey: "prueba/render.mp4",
      srtKey: "prueba/render.srt",
      posterKey: "prueba/render.jpg",
      previousKeys: [],
    },
  };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Lo que lee worker/tests/test_sync.py: las palabras (para sintetizar la voz) y la entrada del render. */
export function syncFixture() {
  const words = syncWords();
  const { input } = syncRenderInput(words);
  return { duration: SYNC_DURATION, words, input };
}
