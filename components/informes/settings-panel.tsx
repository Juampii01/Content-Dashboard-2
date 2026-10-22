"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { FileText, Plus, Save, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { MAX_RECIPIENTS, parseRecipients } from "@/lib/reports/month";
import type { ReportSettingsView } from "@/lib/dal/reports";
import { saveReportSettingsAction } from "./actions";

/** Ajustes → Informe mensual: a quién le llega y si sale solo el día 1. */
export function ReportSettingsPanel({ settings }: { settings: ReportSettingsView }) {
  const [recipients, setRecipients] = useState(settings.recipients);
  const [autoSend, setAutoSend] = useState(settings.autoSend);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const disabled = !settings.canEdit || pending;
  const full = recipients.length >= MAX_RECIPIENTS;
  const dirty = autoSend !== settings.autoSend || recipients.join() !== settings.recipients.join();
  const suggestions = settings.team.filter((m) => !recipients.includes(m.email));

  const add = (raw: string) => {
    const parts = raw.split(/[\s,;]+/).filter(Boolean);
    if (parts.length === 0) return;
    const { valid, invalid } = parseRecipients(parts);
    if (invalid.length) {
      setError(`Este correo no es válido: ${invalid[0]}`);
      return;
    }
    const next = [...recipients, ...valid.filter((v) => !recipients.includes(v))];
    if (next.length > MAX_RECIPIENTS) {
      setError(`Puedes tener hasta ${MAX_RECIPIENTS} destinatarios.`);
      return;
    }
    setError(null);
    setRecipients(next);
    setDraft("");
  };

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    add(draft);
  };

  const save = () =>
    start(async () => {
      const res = await saveReportSettingsAction({ recipients, autoSend });
      if (res.ok) {
        setError(null);
        toast.success("Ajustes del informe guardados.");
      } else setError(res.error);
    });

  return (
    <div className="flex flex-col gap-5">
      {!settings.emailConfigured && <Notice tone="warning">El correo todavía no está configurado en esta instalación: puedes armar la lista, pero los envíos no van a salir hasta que soporte lo active.</Notice>}

      <div className="card flex items-start justify-between gap-4 p-5">
        <div className="flex min-w-0 items-start gap-4">
          <span className="tile-icon h-11 w-11 flex-none">
            <FileText className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p id="auto-send-label" className="font-semibold text-white">
              Enviar solo el día 1 de cada mes
            </p>
            <p className="mt-1 text-sm text-muted">A las 9:00 sale el informe del mes anterior, con el PDF adjunto, a todos los destinatarios. Una sola vez por mes.</p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoSend}
          aria-labelledby="auto-send-label"
          disabled={disabled}
          onClick={() => setAutoSend((v) => !v)}
          className={cn(
            "relative mt-1 h-6 w-11 flex-none rounded-full border transition disabled:cursor-not-allowed disabled:opacity-50",
            autoSend ? "border-accent bg-accent" : "border-line bg-white/10",
          )}
        >
          <span className={cn("absolute top-0.5 left-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-transform motion-reduce:transition-none", autoSend && "translate-x-5")} aria-hidden />
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-white">Destinatarios</h3>
          <span className="font-mono text-xs text-muted tabular-nums">
            {recipients.length}/{MAX_RECIPIENTS}
          </span>
        </div>
        {recipients.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {recipients.map((r) => {
              const member = settings.team.find((m) => m.email === r);
              return (
                <li key={r} className="flex max-w-full items-center gap-1.5 rounded-xl border border-line bg-white/[0.03] py-1 pr-1 pl-3 text-sm">
                  <span className="min-w-0 truncate">
                    {r}
                    <span className="ml-1.5 text-xs text-muted">{member ? "· equipo" : "· externo"}</span>
                  </span>
                  {settings.canEdit && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => setRecipients((list) => list.filter((x) => x !== r))}
                      aria-label={`Quitar a ${r}`}
                      className="grid h-7 w-7 flex-none place-items-center rounded-lg text-muted transition hover:bg-white/[0.07] hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">Todavía no hay destinatarios. Agrega a tu equipo o a un sponsor: cada uno recibe su propio correo con el PDF.</p>
        )}

        {settings.canEdit && (
          <form onSubmit={onAdd} className="flex flex-col gap-2 sm:flex-row sm:items-end" noValidate>
            <Field label="Agregar un correo" htmlFor="report-recipient" hint="Del equipo o externo (por ejemplo, tu sponsor). Puedes pegar varios separados por coma." className="flex-1">
              <Input
                id="report-recipient"
                type="email"
                inputMode="email"
                autoComplete="off"
                value={draft}
                disabled={disabled || full}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setError(null);
                }}
                placeholder={full ? "Llegaste al máximo de 10" : "nombre@empresa.com"}
              />
            </Field>
            <Button type="submit" variant="ghost" disabled={disabled || full || !draft.trim()} icon={<Plus className="h-4 w-4" aria-hidden />} className="sm:mb-[1.6rem]">
              Agregar
            </Button>
          </form>
        )}

        {settings.canEdit && suggestions.length > 0 && !full && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Tu equipo:</span>
            {suggestions.map((m) => (
              <button key={m.email} type="button" className="chip" disabled={pending} onClick={() => add(m.email)}>
                <UserPlus className="h-3.5 w-3.5" aria-hidden />
                <span className="max-w-[14rem] truncate">{m.name || m.email}</span>
                <span className="sr-only">({m.email})</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <Notice tone="danger">{error}</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
        <Link href="/inicio/informes" className="text-sm font-semibold text-accent-hi hover:underline">
          Ver los informes
        </Link>
        {settings.canEdit ? (
          <Button disabled={pending || !dirty} onClick={save} icon={<Save className="h-4 w-4" aria-hidden />}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        ) : (
          <p className="text-sm text-muted">Tu usuario es de solo lectura.</p>
        )}
      </div>
    </div>
  );
}
