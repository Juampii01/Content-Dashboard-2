"use client";

import { useId, useState } from "react";
import { ChevronDown, Palette, RotateCcw } from "lucide-react";
import { svgMatrixValues } from "@/lib/video/broll-edit";
import { cleanGrade, GRADE_PRESETS, GRADE_SLIDERS, gradeMatrix, matchingGradePreset, NEUTRAL_GRADE, presetGrade, type Grade } from "@/lib/video/grade";
import { cn } from "@/lib/utils";
import type { StudioApi } from "./types";

const pct = (v: number, min: number, max: number) => `${((v - min) / (max - min)) * 100}%`;
const signed = (v: number) => (v === 0 ? "0" : `${v > 0 ? "+" : ""}${Math.round(v * 100)}`);

/**
 * «Color y filtros» (pestaña Edición): filtros de un toque y ajustes finos del video grabado (brillo, contraste,
 * saturación y temperatura). Las miniaturas usan un cuadro de tu video con el mismo filtro que la vista previa; el render
 * aplica la misma matriz como LUT. Solo cambia a la persona: el b-roll y las animaciones quedan como están.
 */
export function ColorPanel({ api, accent }: { api: StudioApi; accent: string }) {
  const { state, props } = api;
  const canEdit = props.canEdit;
  const grade = state.grade ?? NEUTRAL_GRADE;
  const active = matchingGradePreset(state.grade);
  const [open, setOpen] = useState(Boolean(state.grade));
  const uid = useId().replace(/:/g, "");
  const set = (next: Grade, coalesce?: string) => api.update((s) => ({ ...s, grade: cleanGrade(next) }), coalesce ? { coalesce } : undefined);

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-card p-3">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-2 text-left">
        <span className="tile-icon grid h-8 w-8 flex-none place-items-center">
          <Palette className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-white">Color y filtros</span>
          <span className="block text-xs text-muted">{state.grade ? `Con ${active ? (GRADE_PRESETS.find((p) => p.id === active)?.label ?? "ajustes") : "ajustes a mano"}` : "Tu video como se grabó"}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <>
          <ul className="grid grid-cols-5 gap-1.5" aria-label="Filtros">
            {GRADE_PRESETS.map((p) => {
              const g = presetGrade(p.id);
              const m = gradeMatrix(g, accent);
              const fid = `cp-${uid}-${p.id}`;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={!canEdit}
                    aria-pressed={active === p.id}
                    onClick={() => set(g)}
                    className={cn("group flex w-full flex-col items-center gap-1 rounded-lg p-0.5 text-[10.5px] text-muted transition", active === p.id ? "text-white" : "hover:text-white")}
                  >
                    <span className={cn("relative block aspect-square w-full overflow-hidden rounded-md border bg-black/40", active === p.id ? "border-accent ring-2 ring-accent/40" : "border-white/10 group-hover:border-white/30")}>
                      {m && (
                        <svg aria-hidden width="0" height="0" className="absolute">
                          <filter id={fid} colorInterpolationFilters="sRGB">
                            <feColorMatrix type="matrix" values={svgMatrixValues(m)} />
                          </filter>
                        </svg>
                      )}
                      {props.posterUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={props.posterUrl} alt="" className="h-full w-full object-cover" style={{ filter: m ? `url(#${fid})` : undefined }} draggable={false} />
                      ) : (
                        <span className="block h-full w-full" style={{ background: "linear-gradient(135deg,#c98b6b,#5f7fa6)", filter: m ? `url(#${fid})` : undefined }} />
                      )}
                    </span>
                    <span className="w-full truncate text-center">{p.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-col gap-2.5">
            {GRADE_SLIDERS.map((sl) => (
              <label key={sl.key} className="flex flex-col gap-1">
                <span className="flex items-center justify-between text-xs text-text">
                  {sl.label}
                  <span className="font-mono text-[11px] text-muted">{signed(grade[sl.key])}</span>
                </span>
                <input
                  type="range"
                  className="range"
                  min={sl.min}
                  max={sl.max}
                  step={sl.step}
                  value={grade[sl.key]}
                  disabled={!canEdit}
                  onChange={(e) => set({ ...grade, [sl.key]: Number(e.target.value) }, `grade-${sl.key}`)}
                  onDoubleClick={() => set({ ...grade, [sl.key]: 0 })}
                  style={{ ["--pct" as string]: pct(grade[sl.key], sl.min, sl.max) }}
                  aria-valuetext={signed(grade[sl.key])}
                />
              </label>
            ))}
            {grade.filter !== "none" && (
              <label className="flex flex-col gap-1">
                <span className="flex items-center justify-between text-xs text-text">
                  Intensidad del filtro
                  <span className="font-mono text-[11px] text-muted">{Math.round(grade.strength * 100)} %</span>
                </span>
                <input type="range" className="range" min={0} max={1} step={0.02} value={grade.strength} disabled={!canEdit} onChange={(e) => set({ ...grade, strength: Number(e.target.value) }, "grade-strength")} style={{ ["--pct" as string]: pct(grade.strength, 0, 1) }} />
              </label>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted">Solo cambia tu video: el b-roll y las animaciones quedan igual. Doble clic en un control lo vuelve a 0.</p>
            {state.grade && canEdit && (
              <button type="button" onClick={() => set(NEUTRAL_GRADE)} className="inline-flex flex-none items-center gap-1 text-xs font-medium text-accent-hi">
                <RotateCcw className="h-3 w-3" aria-hidden /> Quitar
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
