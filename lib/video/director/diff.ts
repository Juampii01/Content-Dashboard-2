/**
 * "Qué cambió" entre dos planes, en frases cortas para la persona ("Edítalo así", arreglos y versiones).
 * Se calcula sobre los planes de verdad (no sobre lo que dice la IA que cambió). Sin servidor.
 */
import { formatDuration } from "@/lib/format";
import { buildTimeline, removedIds } from "../timeline";
import type { EditPlan, Word } from "../types";
import { textOf } from "./context";
import { FX_INFO } from "../fx/catalog";

function ranges(ids: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const id of [...ids].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && id === last[1] + 1) last[1] = id;
    else out.push([id, id]);
  }
  return out;
}

const PACE: Record<string, string> = { calm: "tranquilo", normal: "normal", fast: "rápido" };

export function diffPlans(before: EditPlan, after: EditPlan, words: Word[], duration: number): string[] {
  const out: string[] = [];
  const n = words.length;
  const d0 = buildTimeline(words, before, duration).duration;
  const d1 = buildTimeline(words, after, duration).duration;
  if (Math.abs(d1 - d0) >= 0.5) out.push(`El video pasó de ${formatDuration(d0)} a ${formatDuration(d1)}.`);

  const r0 = removedIds(before, n);
  const r1 = removedIds(after, n);
  const cut = ranges([...r1].filter((id) => !r0.has(id)));
  const back = ranges([...r0].filter((id) => !r1.has(id)));
  const quote = ([a, b]: [number, number]) => `"${textOf(words, a, b, after.corrections, 48)}"`;
  if (cut.length) out.push(`Corté ${cut.slice(0, 2).map(quote).join(" y ")}${cut.length > 2 ? ` y ${cut.length - 2} tramos más` : ""}.`);
  if (back.length) out.push(`Devolví ${back.slice(0, 2).map(quote).join(" y ")}${back.length > 2 ? ` y ${back.length - 2} tramos más` : ""}.`);

  const h0 = before.selected_hook != null ? before.hook_candidates[before.selected_hook] : null;
  const h1 = after.selected_hook != null ? after.hook_candidates[after.selected_hook] : null;
  if ((h0?.from_word ?? -1) !== (h1?.from_word ?? -1) || (h0?.to_word ?? -1) !== (h1?.to_word ?? -1)) {
    out.push(h1 ? `Gancho nuevo: "${textOf(words, h1.from_word, h1.to_word, after.corrections, 60)}".` : "Ahora el video empieza como lo grabaste, sin gancho movido.");
  }

  const key = (b: EditPlan["broll"][number]) => `${b.from_word}-${b.to_word}-${b.choice?.source === "graphic" ? "g" : "s"}`;
  const k0 = new Set(before.broll.filter((b) => b.choice).map(key));
  const k1 = new Set(after.broll.filter((b) => b.choice).map(key));
  const added = after.broll.filter((b) => b.choice && !k0.has(key(b)));
  const removed = before.broll.filter((b) => b.choice && !k1.has(key(b)));
  const kind = (list: EditPlan["broll"]) => {
    const g = list.filter((b) => b.choice?.source === "graphic").length;
    const s = list.length - g;
    return [g ? `${g} ${g === 1 ? "gráfico" : "gráficos"}` : "", s ? `${s} b-roll` : ""].filter(Boolean).join(" y ");
  };
  if (added.length) out.push(`Agregué ${kind(added)}.`);
  if (removed.length) out.push(`Quité ${kind(removed)}.`);

  const fxKey = (e: NonNullable<EditPlan["effects"]>[number]) => `${e.kind}-${e.from_word}-${e.to_word}`;
  const f0 = new Set((before.effects ?? []).map(fxKey));
  const f1 = new Set((after.effects ?? []).map(fxKey));
  const fxAdded = (after.effects ?? []).filter((e) => !f0.has(fxKey(e)));
  const fxRemoved = (before.effects ?? []).filter((e) => !f1.has(fxKey(e)));
  const names = (list: typeof fxAdded) => [...new Set(list.map((e) => `«${FX_INFO[e.kind].label}»`))].slice(0, 3).join(", ");
  if (fxAdded.length) out.push(`Agregué ${fxAdded.length === 1 ? "el efecto" : "los efectos"} ${names(fxAdded)}.`);
  if (fxRemoved.length) out.push(`Quité ${fxRemoved.length === 1 ? "el efecto" : "los efectos"} ${names(fxRemoved)}.`);

  const m0 = (before.moves ?? []).length;
  const m1 = (after.moves ?? []).length;
  if (m1 > m0) out.push(m1 - m0 === 1 ? "Moví un bloque para mejorar el orden." : `Moví ${m1 - m0} bloques para mejorar el orden.`);
  else if (m1 < m0) out.push("Devolví a su lugar un bloque que había movido.");

  if ((before.director?.pace ?? "normal") !== (after.director?.pace ?? "normal")) out.push(`Ritmo ${PACE[after.director?.pace ?? "normal"]}.`);
  const z0 = (before.zoom_moments ?? []).length;
  const z1 = (after.zoom_moments ?? []).length;
  if (z1 !== z0) out.push(z1 > z0 ? `Más zooms (${z1}).` : z1 ? `Menos zooms (${z1}).` : "Sin zooms.");
  const c0 = (before.captions.hide ?? []).length;
  const c1 = (after.captions.hide ?? []).length;
  if (c1 > c0) out.push("Oculté los subtítulos donde ya hay texto en pantalla.");
  if (!out.length) out.push("No hizo falta cambiar nada.");
  return out.slice(0, 8);
}
