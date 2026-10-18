"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Palette, RefreshCw, Sparkles } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { addDays, dayLong, rangeTitle } from "@/lib/calendar/dates";
import { plannedFormatLabel } from "@/lib/calendar/labels";
import type { PlanIdea } from "@/lib/calendar/plan";
import { cn } from "@/lib/utils";
import { acceptPlanAction, planWeekAction } from "./actions";
import { PlatformIcon } from "./platform-icon";

type Row = PlanIdea & { keep: boolean };

/**
 * "Planear mi semana": la IA propone 3 a 5 piezas para la semana que viene. Nada se crea hasta que la persona
 * acepta: puede descartar ideas y cambiarles el día. Las aceptadas quedan como IDEA con source = "plan".
 */
export function PlanDialog({ open, onOpenChange, canPlan, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; canPlan: boolean; onDone: (weekStart: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const started = useRef(false);

  function generate() {
    setError(null);
    setRows(null);
    startLoading(async () => {
      const res = await planWeekAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setWeekStart(res.data!.weekStart);
      setRows(res.data!.ideas.map((i) => ({ ...i, keep: true })));
    });
  }

  useEffect(() => {
    if (open && canPlan && !started.current) {
      started.current = true;
      generate();
    }
    if (!open) started.current = false;
  }, [open, canPlan]);

  const kept = rows?.filter((r) => r.keep) ?? [];

  function accept() {
    startSaving(async () => {
      const res = await acceptPlanAction(kept.map(({ title, hook, pillar, format, platforms, date, why }) => ({ title, hook, pillar, format, platforms, date: date || null, why })));
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const n = res.data!.created;
      toast.success(n === 1 ? "Listo: 1 idea en tu semana." : `Listo: ${n} ideas en tu semana.`, { description: "Quedaron como Idea. Ábrelas para escribir el guion." });
      onOpenChange(false);
      if (weekStart) onDone(weekStart);
    });
  }

  if (!canPlan) {
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title="Primero completa Mi marca"
        description="El plan sale de tus pilares, tus ofertas y lo que ya te funcionó. Sin eso, la IA solo puede adivinar."
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Ahora no
            </Button>
            <ButtonLink href="/marca" icon={<Palette className="h-4 w-4" aria-hidden />}>
              Completar Mi marca
            </ButtonLink>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-muted">Con tu nicho y 3 a 5 pilares de contenido ya podemos armarte la semana: cuántas piezas, qué día y con qué gancho.</p>
      </Dialog>
    );
  }

  const days = weekStart ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : [];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      dismissOnBackdrop={false}
      className="max-w-2xl"
      title="Tu semana, planeada"
      description={weekStart ? `Semana del ${rangeTitle(weekStart, addDays(weekStart, 6))}. Quédate con las que te sirvan y cámbiales el día si quieres.` : "Revisamos tus pilares, tus ofertas, lo que mejor te funcionó y lo que ya tienes programado."}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="subtle" onClick={generate} disabled={loading || saving} icon={<RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden />}>
            Otras ideas
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={accept} disabled={loading || saving || kept.length === 0} icon={saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}>
              {kept.length === 0 ? "Elige al menos una" : kept.length === 1 ? "Agregar 1 idea" : `Agregar ${kept.length} ideas`}
            </Button>
          </div>
        </div>
      }
    >
      {error ? (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : !rows || loading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <Loader2 className="h-4 w-4 animate-spin text-accent-hi" aria-hidden /> Armando tu semana…
          </p>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">La IA no propuso ideas esta vez. Prueba con “Otras ideas”.</p>
      ) : (
        <ul className="stagger flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.key} className={cn("card flex flex-col gap-3 p-4 transition", !r.keep && "opacity-55")}>
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={r.keep}
                  onChange={(e) => setRows((list) => list!.map((x) => (x.key === r.key ? { ...x, keep: e.target.checked } : x)))}
                  aria-label={`Incluir “${r.title}”`}
                  className="mt-1 h-4 w-4 flex-none accent-[#0070f8]"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white">{r.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-text">“{r.hook}”</p>
                  <p className="mt-2 text-xs leading-relaxed text-muted">{r.why}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-7">
                <span className="pill">{plannedFormatLabel[r.format]}</span>
                {r.pillar && <span className="pill !border-accent/40 !bg-accent/10 !text-accent-glow">{r.pillar}</span>}
                <span className="flex items-center gap-1" aria-label={`Redes: ${r.platforms.join(", ")}`}>
                  {r.platforms.map((p) => (
                    <PlatformIcon key={p} platform={p} label />
                  ))}
                </span>
                <Select
                  aria-label={`Día de “${r.title}”`}
                  value={r.date}
                  disabled={!r.keep}
                  onChange={(e) => setRows((list) => list!.map((x) => (x.key === r.key ? { ...x, date: e.target.value } : x)))}
                  className="!ml-auto !w-auto !py-1.5 !text-sm"
                >
                  {days.map((d) => (
                    <option key={d} value={d}>
                      {dayLong(d).charAt(0).toUpperCase() + dayLong(d).slice(1)}
                    </option>
                  ))}
                  <option value="">Sin fecha</option>
                </Select>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
