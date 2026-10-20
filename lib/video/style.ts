/**
 * Estilos de edición medidos en un video de referencia ("Edita como este").
 *
 * El worker mide (worker/video/style.py) y entrega las métricas; aquí se validan con Zod y se convierten en un
 * preset que alimenta el plan (ritmo, pausas, gancho), el render (zooms, subtítulos, b-roll) y la vista previa.
 * Se copia el estilo, nunca el contenido. Este archivo no importa nada de servidor: lo usan la app, el navegador
 * y las pruebas.
 */
import { z } from "zod";
import { formatNumber } from "@/lib/format";

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const num = z.number().finite();

/** Lo que mide el worker. Se valida lo que se usa; lo demás pasa tal cual (sirve para mostrarlo). */
export const styleMetricsSchema = z.looseObject({
  version: z.literal(1),
  duration: num.min(0),
  analyzedSeconds: num.min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  aspect: z.string().max(8),
  cuts: z.looseObject({ count: z.number().int().min(0), perMinute: num.min(0), avgShot: num.min(0), medianShot: num.min(0) }),
  zooms: z.looseObject({ punchIns: z.number().int().min(0), smooth: z.number().int().min(0), perMinute: num.min(0), avgScale: num.min(0.5).max(3) }),
  faces: z.looseObject({ detected: z.boolean(), ratio: num.min(0).max(1), center: z.object({ x: num, y: num }).optional(), size: num.optional() }),
  broll: z.looseObject({ reliable: z.boolean(), ratio: num.min(0).max(1), perMinute: num.min(0), avgDuration: num.min(0) }),
  captions: z.union([
    z.looseObject({
      detected: z.literal(true),
      position: num.min(0).max(1),
      size: num.min(0).max(0.3),
      uppercase: z.boolean(),
      wordsPerBlock: z.number().int().min(1).max(10),
      textColor: hex,
      highlightColor: hex.nullable(),
      box: z.boolean(),
      boxColor: hex.nullable(),
      outline: z.boolean(),
      samples: z.number().int().min(0),
    }),
    z.looseObject({ detected: z.literal(false) }),
  ]),
  speech: z.looseObject({
    detected: z.boolean(),
    words: z.number().int().min(0),
    wps: num.min(0).max(12).optional(),
    hookSeconds: num.min(0).max(60).optional(),
    pauseMedian: num.min(0).optional(),
    pauseP90: num.min(0).optional(),
    longPausesPerMinute: num.min(0).optional(),
  }),
  audio: z.looseObject({ lufs: num.nullable(), music: z.boolean(), musicDb: num.nullable() }),
});
export type StyleMetrics = z.infer<typeof styleMetricsSchema>;

export const captionStyleSchema = z.object({
  /** Alto de la fuente relativo al alto del cuadro. */
  size: num.min(0.018).max(0.09),
  /** Centro vertical del bloque (0 arriba, 1 abajo). */
  position: num.min(0.08).max(0.92),
  uppercase: z.boolean(),
  wordsPerBlock: z.number().int().min(1).max(6),
  textColor: hex,
  highlightColor: hex.nullable(),
  box: z.boolean(),
  boxColor: hex.nullable(),
  outline: z.boolean(),
  font: z.enum(["extrabold", "black"]),
});
export type CaptionStyle = z.infer<typeof captionStyleSchema>;

export const stylePresetSchema = z.object({
  version: z.literal(1),
  pacing: z.object({
    /** Pausa máxima que queda entre palabras (lo demás se recorta). */
    longPause: num.min(0.2).max(1.2),
    /** Qué tan agresivo es el corte de muletillas y tomas dudosas. */
    aggressiveness: z.enum(["suave", "media", "alta"]),
    /** Duración media de una toma en la referencia. */
    targetShotSeconds: num.min(0.3).max(60),
  }),
  hook: z.object({ targetSeconds: num.min(2).max(10) }),
  zoom: z.object({ enabled: z.boolean(), everySeconds: num.min(1).max(60), scale: num.min(1.03).max(1.3), mode: z.enum(["punch", "smooth", "mixed"]) }),
  captions: captionStyleSchema.nullable(),
  broll: z.object({ enabled: z.boolean(), everySeconds: num.min(3).max(60), durationSeconds: num.min(0.8).max(6), ratio: num.min(0).max(0.6) }),
  audio: z.object({ targetLufs: num.min(-20).max(-9), music: z.boolean() }),
});
export type StylePreset = z.infer<typeof stylePresetSchema>;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Del estilo medido al preset que se aplica. Valores razonables cuando algo no se pudo medir. */
export function presetFromMetrics(m: StyleMetrics): StylePreset {
  const cutsPerMin = m.cuts.perMinute;
  const speech = m.speech.detected ? m.speech : null;
  // Pausas: lo que la referencia deja entre palabras (percentil 90), con un margen; sin habla, según el ritmo de cortes.
  const longPause = speech?.pauseP90 != null ? clamp(speech.pauseP90 * 1.2 + 0.05, 0.25, 0.8) : cutsPerMin >= 20 ? 0.3 : cutsPerMin >= 10 ? 0.4 : 0.5;
  const aggressiveness = cutsPerMin >= 20 ? "alta" : cutsPerMin >= 10 ? "media" : "suave";

  const zoomPerMin = m.zooms.perMinute;
  const zoom = {
    enabled: zoomPerMin >= 1,
    everySeconds: round(clamp(zoomPerMin > 0 ? 60 / zoomPerMin : 8, 2, 30), 1),
    scale: round(clamp(m.zooms.avgScale > 1 ? m.zooms.avgScale : 1 / Math.max(0.77, m.zooms.avgScale), 1.06, 1.25), 3),
    mode: (m.zooms.punchIns > 2 * m.zooms.smooth ? "punch" : m.zooms.smooth > 2 * m.zooms.punchIns ? "smooth" : "mixed") as StylePreset["zoom"]["mode"],
  };

  const c = m.captions.detected ? m.captions : null;
  const captions: CaptionStyle | null = c
    ? {
        size: round(clamp(c.size, 0.018, 0.09), 4),
        position: round(clamp(c.position, 0.08, 0.92), 3),
        uppercase: c.uppercase,
        wordsPerBlock: clamp(c.wordsPerBlock, 1, 6),
        textColor: c.textColor.toUpperCase(),
        highlightColor: c.highlightColor?.toUpperCase() ?? null,
        box: c.box,
        boxColor: c.box ? (c.boxColor?.toUpperCase() ?? "#000000") : null,
        outline: c.outline,
        // Letras grandes en mayúsculas se ven mejor en Black (como los subtítulos "pop" de los reels).
        font: c.uppercase && c.size >= 0.05 ? "black" : "extrabold",
      }
    : null;

  const b = m.broll.reliable && m.broll.ratio >= 0.05 ? m.broll : null;
  const broll = b
    ? { enabled: true, everySeconds: round(clamp(b.perMinute > 0 ? 60 / b.perMinute : 10, 3, 60), 1), durationSeconds: round(clamp(b.avgDuration || 2, 0.8, 6), 1), ratio: round(clamp(b.ratio, 0, 0.6), 2) }
    : { enabled: false, everySeconds: 10, durationSeconds: 2, ratio: 0 };

  return {
    version: 1,
    pacing: { longPause: round(longPause), aggressiveness, targetShotSeconds: round(clamp(m.cuts.avgShot || m.analyzedSeconds, 0.3, 60), 2) },
    hook: { targetSeconds: round(clamp(speech?.hookSeconds ?? 4, 2.5, 8), 1) },
    zoom,
    captions,
    broll,
    audio: { targetLufs: m.audio.lufs != null ? clamp(Math.round(m.audio.lufs), -16, -10) : -14, music: m.audio.music },
  };
}

// ─── Textos para la interfaz (español neutro) ─────────────────────────────

const decimal = (n: number, d = 1) => formatNumber(n, { digits: d });

export type StyleFact = { label: string; value: string; hint?: string };

/** Lo medido, en frases cortas para la pantalla del estilo. */
export function describeMetrics(m: StyleMetrics): { rhythm: StyleFact[]; visual: StyleFact[]; captions: StyleFact[]; audio: StyleFact[] } {
  const rhythm: StyleFact[] = [
    { label: "Cortes", value: m.cuts.count ? `uno cada ${decimal(m.cuts.avgShot)} s` : "sin cortes", hint: `${decimal(m.cuts.perMinute, 0)} por minuto` },
  ];
  if (m.speech.detected) {
    if (m.speech.wps != null) rhythm.push({ label: "Ritmo de habla", value: `${decimal(m.speech.wps)} palabras por segundo` });
    if (m.speech.hookSeconds != null) rhythm.push({ label: "Gancho", value: `${decimal(m.speech.hookSeconds)} s`, hint: "la primera frase" });
    if (m.speech.pauseP90 != null) rhythm.push({ label: "Pausas", value: m.speech.pauseP90 < 0.25 ? "casi ninguna" : `hasta ${decimal(m.speech.pauseP90)} s` });
  } else {
    rhythm.push({ label: "Habla", value: "no detectamos voz", hint: "el ritmo sale solo de los cortes" });
  }
  const visual: StyleFact[] = [
    {
      label: "Zooms",
      value:
        m.zooms.punchIns + m.zooms.smooth === 0
          ? "sin zooms"
          : [m.zooms.punchIns && `${m.zooms.punchIns} ${m.zooms.punchIns === 1 ? "punch-in" : "punch-ins"}`, m.zooms.smooth && `${m.zooms.smooth} ${m.zooms.smooth === 1 ? "suave" : "suaves"}`].filter(Boolean).join(" y "),
      hint: m.zooms.punchIns + m.zooms.smooth ? `al ${Math.round(m.zooms.avgScale * 100)} %` : undefined,
    },
    m.broll.reliable
      ? { label: "B-roll", value: m.broll.ratio > 0.02 ? `${Math.round(m.broll.ratio * 100)} % del video` : "sin b-roll", hint: m.broll.ratio > 0.02 ? `${decimal(m.broll.perMinute, 0)} por minuto, de ${decimal(m.broll.avgDuration)} s` : undefined }
      : { label: "B-roll", value: "no se pudo medir", hint: "no aparece una cara en el video" },
    { label: "Formato", value: m.aspect === "9:16" ? "Vertical 9:16" : m.aspect === "16:9" ? "Horizontal 16:9" : m.aspect },
  ];
  const c = m.captions;
  const captions: StyleFact[] = c.detected
    ? [
        { label: "Posición", value: c.position < 0.35 ? "arriba" : c.position > 0.6 ? "abajo" : "al centro", hint: `al ${Math.round(c.position * 100)} % de la altura` },
        { label: "Tamaño", value: c.size >= 0.05 ? "grande" : c.size >= 0.032 ? "mediano" : "chico" },
        { label: "Texto", value: `${c.uppercase ? "MAYÚSCULAS" : "Minúsculas"}, ${c.wordsPerBlock} ${c.wordsPerBlock === 1 ? "palabra" : "palabras"} por bloque` },
        { label: "Colores", value: [c.textColor, c.highlightColor && `resaltado ${c.highlightColor}`, c.box && `caja ${c.boxColor}`].filter(Boolean).join(" · ") },
      ]
    : [{ label: "Subtítulos", value: "no encontramos subtítulos", hint: "se usan los de tu marca" }];
  const audio: StyleFact[] = [
    { label: "Volumen", value: m.audio.lufs != null ? `${decimal(m.audio.lufs)} LUFS` : "sin audio" },
    { label: "Música", value: m.audio.music ? "sí, de fondo" : "no" },
  ];
  return { rhythm, visual, captions, audio };
}

/** Cómo se aplica el preset, en frases cortas (para el paso "Estilo" y la revisión). */
export function describePreset(p: StylePreset): string[] {
  const out = [`Recorta pausas de más de ${decimal(p.pacing.longPause)} s`, `Gancho de unos ${decimal(p.hook.targetSeconds, 0)} s`];
  if (p.zoom.enabled) out.push(`Un zoom cada ${decimal(p.zoom.everySeconds, 0)} s`);
  if (p.broll.enabled) out.push(`B-roll cada ${decimal(p.broll.everySeconds, 0)} s`);
  if (p.captions) out.push("Subtítulos copiados");
  return out;
}
