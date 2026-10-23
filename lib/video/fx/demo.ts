/**
 * Muestra de cada efecto para la galería del panel "Efectos" (y las pruebas): una frase de ejemplo, los textos por
 * defecto, la marca y una persona de muestra (public/efectos/demo.jpg, la astronauta de la NASA, dominio público, con
 * su recorte en demo-alpha.png). Se repite en bucle. Sin servidor.
 */
import { FX_INFO, type FxKind } from "./catalog";
import { compileFx, type FxBrand, type FxSpec } from "./compile";
import { defaultFx } from "./schema";
import type { TimedWord } from "../types";

export const FX_DEMO = { frame: "/efectos/demo.jpg", mask: "/efectos/demo-alpha.png", face: { x: 338, y: 648, w: 264, h: 322 } } as const;

const SENTENCE = "Primero define tu cliente ideal. Segundo publica todos los días. Así escala tu marca.";

function demoWords(duration: number): TimedWord[] {
  const parts = SENTENCE.split(" ");
  const step = (duration - 0.3) / parts.length;
  return parts.map((text, i) => ({ id: i, text, start: +(0.15 + i * step).toFixed(3), end: +(0.15 + i * step + step * 0.85).toFixed(3), emphasis: false, stop: /[.]$/.test(text) }));
}

/** Duración del bucle de cada muestra. */
export function demoDuration(kind: FxKind): number {
  return kind === "zoom_cut" ? 1.4 : Math.min(FX_INFO[kind].duration.max, 4.2);
}

export function demoSpec(kind: FxKind, brand: FxBrand, override?: { text?: string; items?: string[]; kicker?: string }): FxSpec {
  const duration = demoDuration(kind);
  const words = demoWords(duration);
  const timeline = { words, duration, clips: [{ startFrame: 0, endFrame: Math.round(duration * 30), role: "body" as const, firstWord: 0, lastWord: words.length - 1 }] };
  const defaults = defaultFx(kind, words, new Date(2026, 9, 22));
  if (kind === "cover_story") defaults.text = "CRECER";
  if (kind === "glass_type") defaults.text = "FOCO";
  if (kind === "paper_cut") defaults.text = "SECRETO";
  if (kind === "doodle_boil") defaults.text = "¡clave!";
  if (kind === "checklist" || kind === "iphone" || kind === "green_screen") defaults.items = ["Define tu cliente", "Publica todos los días", "Mide y escala", "Responde"].slice(0, FX_INFO[kind].items!.count);
  if (kind === "headline_wall") defaults.items = ["Nadie te lo dice", "El error de todos", "Lo que sí funciona", "Así empezó todo", "La verdad"];
  if (kind === "cover_story") defaults.items = ["La guía para", "crecer en 2026"];
  if (kind === "digital_zoom") defaults.words = [2, 7, 12];
  const item = { id: `demo-${kind}`, kind, from_word: 0, to_word: words.length - 1, ...defaults, ...(override ?? {}) };
  const spec = compileFx({
    segment: { id: item.id, start: 0, end: duration, item },
    timeline,
    format: "9:16",
    brand,
    face: FX_DEMO.face,
    thumbs: 0,
    cards: ["Cómo crecer en 30 días", "3 errores al grabar", "Mi rutina", "El gancho perfecto", "Escala tu marca", "Lo que nadie dice", "Mi sistema", "Detrás de cámara"],
  });
  return kind === "zoom_cut" ? { ...spec, cut: duration / 2 } : spec;
}
