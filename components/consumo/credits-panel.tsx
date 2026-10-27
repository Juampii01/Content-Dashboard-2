"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { formatPercent, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CreditsView } from "@/lib/dal/usage";
import { setCreditLimitAction } from "./credits-actions";

const WARN = 0.8;

/** Barra de créditos: verde, amarilla desde el 80 % y roja al llegar al tope. */
export function CreditBar({ spent, limit, label }: { spent: number; limit: number | null; label?: string }) {
  const ratio = limit && limit > 0 ? Math.min(1, spent / limit) : 0;
  const tone = limit == null ? "bg-white/30" : ratio >= 1 ? "bg-danger" : ratio >= WARN ? "bg-warning" : "bg-success";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        {label && <span className="text-muted">{label}</span>}
        <span className="ml-auto font-mono text-white">
          {formatUsd(spent)} <span className="text-muted">de {limit == null ? "sin tope" : formatUsd(limit)}</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label={label ?? "Créditos usados"}>
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

function LimitEditor({ id, value, allowEmpty, emptyHint }: { id: string; value: number | null; allowEmpty: boolean; emptyHint: string }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const [pending, start] = useTransition();
  const dirty = text.trim() !== (value == null ? "" : String(value));
  function save() {
    const trimmed = text.trim().replace(",", ".");
    const monthlyUsd = trimmed === "" ? null : Number(trimmed);
    if (monthlyUsd != null && !Number.isFinite(monthlyUsd)) return toast.error("Escribe un monto en dólares, por ejemplo 50.");
    if (monthlyUsd == null && !allowEmpty) return toast.error("Este tope necesita un monto.");
    start(async () => {
      const r = await setCreditLimitAction({ id, monthlyUsd });
      if (!r.ok) toast.error(r.error ?? "No se pudo guardar.");
      else toast.success("Tope guardado.");
    });
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted">USD</span>
      <Input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" placeholder={emptyHint} aria-label="Tope mensual en dólares" className="!w-28 !py-1.5 text-sm" />
      <Button size="sm" variant="ghost" disabled={!dirty || pending} onClick={save}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
    </div>
  );
}

export function CreditsPanel({ view }: { view: CreditsView }) {
  const mine = view.me.limit > 0 ? view.me.spent / view.me.limit : 0;
  return (
    <div className="flex flex-col gap-6">
      <div className="card flex flex-col gap-3 p-5">
        <CreditBar spent={view.me.spent} limit={view.me.limit} label="Tus créditos de IA de este mes" />
        <p className="text-xs text-muted">
          {mine >= 1
            ? "Llegaste al tope: la IA se pausa hasta el 1.º del mes que viene. El dueño de la cuenta puede subirlo."
            : mine >= WARN
              ? `Usaste el ${formatPercent(mine * 100, { digits: 0 })}. Al llegar al 100 % la IA se pausa hasta el 1.º del mes que viene.`
              : "Cada edición, animación o guion con IA descuenta de aquí. Se renuevan el 1.º de cada mes."}
        </p>
      </div>

      {view.team && (
        <div className="flex flex-col gap-4">
          <div className="card flex flex-col gap-4 p-5">
            <CreditBar spent={view.team.installationSpent} limit={view.team.installationLimit} label="Todo el equipo este mes" />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
              <div>
                <p className="text-sm font-semibold text-white">Tope de la instalación</p>
                <p className="text-xs text-muted">Frena a todos al llegar. Vacío: sin tope de equipo (cada persona tiene el suyo).</p>
              </div>
              <LimitEditor id="installation" value={view.team.installationLimit} allowEmpty emptyHint="sin tope" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
              <div>
                <p className="text-sm font-semibold text-white">Tope por persona (por defecto)</p>
                <p className="text-xs text-muted">Para quien no tiene un tope propio.</p>
              </div>
              <LimitEditor id="default" value={view.team.fallback} allowEmpty={false} emptyHint="50" />
            </div>
          </div>
          <ul className="flex flex-col gap-3">
            {view.team.members.map((m) => (
              <li key={m.userId} className="card flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">
                    {m.name} <span className="font-normal text-muted">· {m.role === "OWNER" ? "Dueño" : m.role === "EDITOR" ? "Editor" : "Solo lectura"}</span>
                  </p>
                  <div className="mt-2 max-w-md">
                    <CreditBar spent={m.spent} limit={m.limit} />
                  </div>
                </div>
                <div className="flex flex-col items-start gap-1 md:items-end">
                  <LimitEditor id={m.userId} value={m.ownLimit ? m.limit : null} allowEmpty emptyHint={`${view.team!.fallback} (defecto)`} />
                  <p className="text-xs text-muted">{m.ownLimit ? "Tope propio" : "Usa el tope por defecto"}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
