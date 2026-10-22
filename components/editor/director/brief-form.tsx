"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, RefreshCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BRIEF_GOAL_LABELS, BRIEF_GOALS, BUDGET, EMPTY_BRIEF, type Brief, type BriefGoal } from "@/lib/video/director/types";
import { editAction, saveBriefAction } from "../director-actions";

/** Campos del brief (los usa la subida y la revisión). */
export function BriefFields({
  value,
  onChange,
  inferred = null,
  idPrefix = "brief",
  disabled = false,
}: {
  value: Brief;
  onChange: (next: Brief) => void;
  /** Lo que infirió la IA: se muestra como sugerencia en los campos vacíos. */
  inferred?: Brief | null;
  idPrefix?: string;
  disabled?: boolean;
}) {
  const set = <K extends keyof Brief>(key: K, v: Brief[K]) => onChange({ ...value, [key]: v });
  const hint = (key: "audience" | "cta" | "mustKeep") => (!value[key] && inferred?.[key] ? `La IA entendió: “${inferred[key]}”` : undefined);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span id={`${idPrefix}-goal`} className="text-sm font-semibold text-white">
          ¿Para qué es el video?
        </span>
        <div role="radiogroup" aria-labelledby={`${idPrefix}-goal`} className="flex flex-wrap gap-2">
          {BRIEF_GOALS.map((g: BriefGoal) => {
            const active = value.goal === g;
            const guess = !value.goal && inferred?.goal === g;
            return (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                onClick={() => set("goal", active ? null : g)}
                className={cn(
                  "pill min-h-9 border transition",
                  active ? "!border-accent bg-accent/20 text-white" : guess ? "border-dashed border-accent-hi/60 text-text" : "border-white/10 text-muted hover:border-white/25 hover:text-text",
                )}
              >
                {BRIEF_GOAL_LABELS[g]}
                {guess && <span className="ml-1 text-[11px] text-accent-glow">(la IA lo ve así)</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="¿Para quién es?" htmlFor={`${idPrefix}-audience`} hint={hint("audience")}>
          <Input id={`${idPrefix}-audience`} value={value.audience} maxLength={300} disabled={disabled} placeholder={inferred?.audience || "Dueños de clínicas que pautan en redes"} onChange={(e) => set("audience", e.target.value)} />
        </Field>
        <Field label="Llamada a la acción" htmlFor={`${idPrefix}-cta`} hint={hint("cta")}>
          <Input id={`${idPrefix}-cta`} value={value.cta} maxLength={300} disabled={disabled} placeholder={inferred?.cta || "Comenta PANEL y te mando el acceso"} onChange={(e) => set("cta", e.target.value)} />
        </Field>
      </div>
      <Field label="Algo que no se puede cortar" htmlFor={`${idPrefix}-keep`} hint={hint("mustKeep") ?? "Por ejemplo: la parte del precio, la demo del producto."}>
        <Input id={`${idPrefix}-keep`} value={value.mustKeep} maxLength={400} disabled={disabled} placeholder={inferred?.mustKeep || "La parte del precio"} onChange={(e) => set("mustKeep", e.target.value)} />
      </Field>
      <Field label="Notas para el editor (opcional)" htmlFor={`${idPrefix}-notes`}>
        <Textarea id={`${idPrefix}-notes`} value={value.notes} maxLength={600} disabled={disabled} className="!min-h-20" placeholder="Que se note el producto, tono serio, nada de música…" onChange={(e) => set("notes", e.target.value)} />
      </Field>
    </div>
  );
}

/** Tope de gasto de IA por video. */
export function BudgetField({ value, onChange, id = "budget", disabled = false }: { value: number; onChange: (v: number) => void; id?: string; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="flex items-center justify-between text-sm font-semibold text-white">
        Tope de IA para este video
        <span className="font-mono text-sm text-accent-glow">{formatUsd(value)}</span>
      </label>
      <input
        id={id}
        type="range"
        className="range"
        min={BUDGET.min}
        max={BUDGET.max}
        step={0.5}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ["--pct" as string]: `${((value - BUDGET.min) / (BUDGET.max - BUDGET.min)) * 100}%` }}
        aria-valuetext={formatUsd(value)}
      />
      <p className="text-xs text-muted">Con más tope, la IA mira más cuadros y revisa su edición dos veces. Si se acerca al tope, hace menos vueltas, nunca se pasa.</p>
    </div>
  );
}

/** El brief en la revisión: editable, con lo que infirió la IA para confirmar, y "Volver a dirigir". */
export function BriefEditor({ projectId, brief, inferred, budgetUsd, canEdit }: { projectId: string; brief: Brief | null; inferred: Brief | null; budgetUsd: number; canEdit: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState<Brief>(brief ?? EMPTY_BRIEF);
  const [budget, setBudget] = useState(budgetUsd);
  const [saving, startSave] = useTransition();
  const [redirecting, startRedirect] = useTransition();
  const dirty = JSON.stringify(value) !== JSON.stringify(brief ?? EMPTY_BRIEF) || budget !== budgetUsd;
  const canConfirm = Boolean(inferred) && (["goal", "audience", "cta", "mustKeep"] as const).some((k) => !value[k] && inferred?.[k]);

  function save(then?: () => void) {
    startSave(async () => {
      const r = await saveBriefAction(projectId, value, budget);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Brief guardado.");
      then?.();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <BriefFields value={value} onChange={setValue} inferred={inferred} idPrefix="rev-brief" disabled={!canEdit} />
      <BudgetField value={budget} onChange={setBudget} id="rev-budget" disabled={!canEdit} />
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {canConfirm && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Check className="h-3.5 w-3.5" aria-hidden />}
              onClick={() =>
                setValue((v) => ({
                  ...v,
                  goal: v.goal ?? inferred?.goal ?? null,
                  audience: v.audience || inferred?.audience || "",
                  cta: v.cta || inferred?.cta || "",
                  mustKeep: v.mustKeep || inferred?.mustKeep || "",
                }))
              }
            >
              Usar lo que entendió la IA
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={!dirty || saving} onClick={() => save()}>
            {saving ? "Guardando…" : "Guardar brief"}
          </Button>
          <Button
            size="sm"
            disabled={saving || redirecting}
            icon={redirecting ? <RefreshCcw className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
            onClick={() =>
              save(() =>
                startRedirect(async () => {
                  const r = await editAction(projectId, "Vuelve a dirigir la edición con el brief actualizado (objetivo, público, llamada a la acción y lo que no se puede cortar).");
                  if (!r.ok) toast.error(r.error);
                }),
              )
            }
          >
            Volver a dirigir con este brief
          </Button>
        </div>
      )}
    </div>
  );
}
