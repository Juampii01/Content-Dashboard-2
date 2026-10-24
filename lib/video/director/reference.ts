/**
 * Referencia de edición para el director ("Edítalo así: como este video" y el brief).
 *
 * El worker baja el link (o el archivo que subió la persona), lo mide con el mismo camino de "Edita como este"
 * (worker/video/style.py: cortes, zooms, b-roll, subtítulos, habla y música), arma hojas de contacto con cuadros en
 * los cortes y transcribe lo que dice (worker/video/reference.py). Aquí:
 * - `referencePayloadSchema`: lo que entrega el worker (validado).
 * - `referenceText`: lo que lee el director (medidas + qué pasa en cada momento), con la instrucción de imitar la
 *   EDICIÓN y nunca el contenido.
 * - `referenceSettings`: lo que se puede copiar sin IA (densidad, ritmo, lugar y tamaño de los subtítulos).
 *
 * La referencia nunca se guarda entera: el archivo subido se borra al terminar y del link solo quedan las medidas y
 * las hojas (para que el director y el crítico las miren). Sin servidor.
 */
import { z } from "zod";
import { formatDuration } from "@/lib/format";
import { captionLook, isCaptionStyle } from "../caption-styles";
import { styleMetricsSchema, type StyleMetrics } from "../style";
import type { CaptionPresetKey, VideoFormat } from "../types";
import type { Density } from "../rhythm";
import type { PlanSettings } from "./request";

export type ReferenceSource = { kind: "link"; url: string } | { kind: "upload"; key: string; name: string };

export type ReferenceMoment = { t: number; frame: number; cut: boolean; face: boolean; text: string; said: string };

export type ReferenceSheet = { key: string; width: number; height: number; frames: number[] };

export type DirectorReference = {
  /** Id del pedido de referencia (para no medir dos veces la misma). */
  id: string;
  source: ReferenceSource;
  status: "pending" | "ready" | "failed";
  error?: string | null;
  metrics?: StyleMetrics | null;
  moments?: ReferenceMoment[];
  transcript?: string;
  sheets?: ReferenceSheet[];
  at: string;
};

const sheetSchema = z.object({ key: z.string().max(200), width: z.number().int().min(1).max(4000), height: z.number().int().min(1).max(4000), frames: z.array(z.number().int().min(1).max(500)).max(80) });

export const referencePayloadSchema = z.object({
  id: z.string().regex(/^r[a-z0-9]{4,30}$/),
  ok: z.boolean(),
  error: z.string().max(400).optional(),
  metrics: z.unknown().optional(),
  moments: z
    .array(z.object({ t: z.number().min(0).max(3600), frame: z.number().int().min(0).max(500), cut: z.boolean(), face: z.boolean(), text: z.string().max(160), said: z.string().max(200) }))
    .max(80)
    .optional(),
  transcript: z.string().max(6000).optional(),
  sheets: z.array(sheetSchema).max(4).optional(),
});
export type ReferencePayload = z.infer<typeof referencePayloadSchema>;

/** Del cable del worker a la referencia guardada (las métricas pasan por el mismo esquema que los estilos). */
export function referenceFromPayload(prev: DirectorReference, p: ReferencePayload): DirectorReference {
  if (!p.ok) return { ...prev, status: "failed", error: (p.error || "No pudimos bajar ese video. Descárgalo y súbelo.").slice(0, 400), at: new Date().toISOString() };
  const metrics = styleMetricsSchema.safeParse(p.metrics);
  return {
    ...prev,
    status: "ready",
    error: null,
    metrics: metrics.success ? metrics.data : null,
    moments: p.moments ?? [],
    transcript: (p.transcript ?? "").slice(0, 4000),
    sheets: p.sheets ?? [],
    at: new Date().toISOString(),
  };
}

const d1 = (n: number) => n.toFixed(1).replace(".", ",");

/** Una frase con lo principal de la referencia ("14 cortes por minuto, zooms cada 4 s, subtítulos grandes abajo"). */
export function referenceSummary(m: StyleMetrics | null | undefined): string {
  if (!m) return "";
  const parts = [`${Math.round(m.cuts.perMinute)} cortes por minuto`];
  if (m.zooms.perMinute >= 1) parts.push(`un zoom cada ${Math.round(60 / m.zooms.perMinute)} s`);
  if (m.broll.reliable && m.broll.ratio > 0.03) parts.push(`b-roll en el ${Math.round(m.broll.ratio * 100)} % del video`);
  const c = m.captions;
  if (c.detected) parts.push(`subtítulos ${c.size >= 0.05 ? "grandes" : c.size >= 0.032 ? "medianos" : "chicos"} ${c.position < 0.35 ? "arriba" : c.position > 0.6 ? "abajo" : "al centro"}${c.uppercase ? " en mayúsculas" : ""}`);
  if (m.audio.music) parts.push("música de fondo");
  return parts.join(", ");
}

/** Lo que lee el director (y el crítico) de la referencia. */
export function referenceText(ref: DirectorReference | null | undefined, sheetOffset = 0): string {
  if (!ref || ref.status !== "ready") return "";
  const m = ref.metrics;
  const lines: string[] = [
    "REFERENCIA QUE PASÓ LA PERSONA (imita su EDICIÓN: ritmo, tipo y frecuencia de gráficos y b-roll, subtítulos, zooms y efectos; NUNCA su contenido, sus frases ni sus cifras)",
  ];
  if (m) {
    lines.push(
      `- Dura ${formatDuration(m.duration)} (${m.aspect}). Cortes: ${m.cuts.count} (${d1(m.cuts.perMinute)} por minuto, una toma cada ${d1(m.cuts.avgShot)} s).`,
      `- Zooms: ${m.zooms.punchIns} punch-ins y ${m.zooms.smooth} suaves (${d1(m.zooms.perMinute)} por minuto, al ${Math.round(m.zooms.avgScale * 100)} %).`,
      m.broll.reliable ? `- B-roll (tomas sin la persona): ${Math.round(m.broll.ratio * 100)} % del video, ${d1(m.broll.perMinute)} por minuto, de ${d1(m.broll.avgDuration)} s.` : "- B-roll: no se pudo medir (no aparece una cara).",
      m.captions.detected
        ? `- Subtítulos: al ${Math.round(m.captions.position * 100)} % de la altura, letra ${m.captions.size >= 0.05 ? "grande" : m.captions.size >= 0.032 ? "mediana" : "chica"} (${(m.captions.size * 100).toFixed(1)} % del alto), ${m.captions.uppercase ? "MAYÚSCULAS" : "minúsculas"}, ${m.captions.wordsPerBlock} palabras por bloque, texto ${m.captions.textColor}${m.captions.highlightColor ? `, resaltado ${m.captions.highlightColor}` : ""}${m.captions.box ? `, con caja ${m.captions.boxColor ?? ""}` : ""}.`
        : "- Subtítulos: no tiene (o no se pudieron leer).",
      m.speech.detected ? `- Habla: ${d1(m.speech.wps ?? 0)} palabras por segundo, pausas de hasta ${d1(m.speech.pauseP90 ?? 0)} s, primera frase de ${d1(m.speech.hookSeconds ?? 0)} s.` : "- Habla: no se detectó voz.",
      `- Música de fondo: ${m.audio.music ? "sí" : "no"}.`,
    );
  }
  if (ref.moments?.length) {
    lines.push(`- Momento a momento (cuadros R#n de las hojas de la referencia${sheetOffset ? `, que van después de las ${sheetOffset} primeras imágenes` : ""}):`);
    for (const x of ref.moments.slice(0, 40)) lines.push(`  R#${x.frame} ${formatDuration(x.t)}${x.cut ? " · corte" : ""}${x.face ? " · persona a cámara" : " · sin la persona (b-roll o gráfico)"}${x.text ? ` · texto en pantalla «${x.text.slice(0, 80)}»` : ""}${x.said ? ` · dice «${x.said.slice(0, 90)}»` : ""}`);
  }
  if (ref.transcript) lines.push(`- Lo que dice (solo para entender la estructura, no lo copies): «${ref.transcript.slice(0, 700)}»`);
  lines.push(
    "CÓMO IMITARLA: su ritmo de cortes y pausas → pace y densidad (acción settings); su frecuencia y tipo de gráficos y b-roll → broll (mismo tipo de componente cuando se ve un gráfico: lista, cifra, palabra clave…); sus subtítulos → acción captions (estilo de la galería más parecido, tamaño y lugar); sus zooms → zooms con la misma frecuencia; si se ven efectos parecidos a la biblioteca, effects. Lo que no se pueda imitar, dilo en answers.",
  );
  return lines.join("\n");
}

const CAPTION_KEYS_BY_LOOK: { test: (m: Extract<StyleMetrics["captions"], { detected: true }>) => boolean; preset: CaptionPresetKey }[] = [
  { test: (c) => c.box, preset: "caja" },
  { test: (c) => Boolean(c.highlightColor) && c.wordsPerBlock <= 2, preset: "palabra" },
  { test: (c) => Boolean(c.highlightColor), preset: "karaoke" },
  { test: (c) => c.uppercase && c.size >= 0.045, preset: "hormozi" },
  { test: () => true, preset: "minimal" },
];

/**
 * Lo que se copia de la referencia sin IA: densidad y ritmo según sus cortes y pausas, y los subtítulos (el estilo de
 * la galería más parecido, su tamaño y su lugar). El director puede afinarlo con sus acciones.
 */
export function referenceSettings(m: StyleMetrics | null | undefined, format: VideoFormat, current: CaptionPresetKey): { settings: PlanSettings; density: Density | null; pace: "fast" | "calm" | null } {
  if (!m) return { settings: {}, density: null, pace: null };
  const perMin = m.cuts.perMinute + m.zooms.perMinute + (m.broll.reliable ? m.broll.perMinute : 0);
  const density: Density = perMin >= 18 ? "reels" : perMin >= 7 ? "normal" : "sobria";
  const pause = m.speech.detected ? (m.speech.pauseP90 ?? 0.5) : null;
  const pace = pause != null ? (pause <= 0.35 ? "fast" : pause >= 0.7 ? "calm" : null) : null;
  const settings: PlanSettings = { density };
  const c = m.captions;
  if (c.detected) {
    const preset = current === "estilo" ? "estilo" : (CAPTION_KEYS_BY_LOOK.find((x) => x.test(c))?.preset ?? "minimal");
    const look = isCaptionStyle(preset) ? captionLook(preset, { format, accent: "#0070F8" }) : null;
    settings.captions = {
      ...(preset !== current ? { preset } : {}),
      position: c.position < 0.35 ? "arriba" : c.position > 0.6 ? "abajo" : "centro",
      ...(look ? { scale: Math.max(0.6, Math.min(2, c.size / look.size)) } : {}),
    };
  }
  if (m.audio.music) settings.audio = { music: true };
  return { settings, density, pace };
}

let refCounter = 0;
export const newReferenceId = () => `r${Date.now().toString(36)}${(refCounter++).toString(36)}`;
