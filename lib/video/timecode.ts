/**
 * Código de tiempo por cuadro (HH:MM:SS:FF), como en un editor de video: el video final va a FPS cuadros fijos
 * (lib/video/types.ts), así que cada cuadro tiene su número y avanzar uno con ← → cae siempre en un cuadro exacto.
 * Sin servidor.
 */
import { FPS } from "./types";

/** Cuadro del video final que se ve en el segundo `t` (el que empieza en ese instante o antes). */
export function frameAt(t: number, fps = FPS): number {
  // Un pelito de margen: 0,1 + 0,2 no da 0,3 exacto y no queremos caer en el cuadro anterior.
  return Math.max(0, Math.floor(t * fps + 1e-6));
}

/** Segundo en que empieza el cuadro `frame`. */
export const frameStart = (frame: number, fps = FPS) => Math.max(0, frame) / fps;

/** «00:01:23:15» (horas, minutos, segundos y cuadro). */
export function timecode(t: number, fps = FPS): string {
  const total = frameAt(t, fps);
  const ff = total % fps;
  const secs = Math.floor(total / fps);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}:${pad(ff)}`;
}

/**
 * El segundo del cuadro siguiente (o anterior) a `t`, dentro de [0, duración). Siempre cae al inicio de un cuadro:
 * desde la mitad de un cuadro, ← va al inicio de ese mismo cuadro.
 */
export function stepFrame(t: number, dir: 1 | -1, duration: number, fps = FPS): number {
  const f = frameAt(t, fps);
  const onStart = Math.abs(t - frameStart(f, fps)) < 1e-4;
  const next = dir > 0 ? f + 1 : onStart ? f - 1 : f;
  const last = Math.max(0, Math.ceil(duration * fps - 1e-6) - 1);
  return frameStart(Math.max(0, Math.min(last, next)), fps);
}

/** Lee «HH:MM:SS:FF», «MM:SS:FF», «MM:SS» o segundos («12,5»). null si no se entiende. */
export function parseTimecode(text: string, fps = FPS): number | null {
  const s = text.trim().replace(",", ".");
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(/[:;]/).map((p) => p.trim());
  if (parts.some((p) => !/^\d+$/.test(p)) || parts.length < 2 || parts.length > 4) return null;
  const n = parts.map(Number);
  if (n.length === 2) return n[0]! * 60 + n[1]!;
  if (n.length === 3) return n[0]! * 60 + n[1]! + Math.min(fps - 1, n[2]!) / fps;
  return n[0]! * 3600 + n[1]! * 60 + n[2]! + Math.min(fps - 1, n[3]!) / fps;
}
