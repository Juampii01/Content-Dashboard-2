"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Download, ExternalLink, RefreshCw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { monthLabel } from "@/lib/reports/month";
import { generateReportAction, sendReportAction } from "./actions";

const STAGES = ["Reuniendo las cifras del mes…", "Escribiendo el resumen…", "Armando el PDF…"];

/** Genera o rehace el informe. Muestra en qué etapa va mientras tanto (tarda unos segundos). */
export function GenerateReportButton({ month, label, variant = "primary" }: { month: string; label: string; variant?: "primary" | "ghost" }) {
  const [pending, start] = useTransition();
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => setStage((s) => Math.min(STAGES.length - 1, s + 1)), 6000);
    return () => clearInterval(id);
  }, [pending]);

  return (
    <div className="flex flex-col items-center gap-2 sm:items-start">
      <Button
        variant={variant}
        disabled={pending}
        aria-busy={pending}
        icon={variant === "primary" ? <Sparkles className={pending ? "h-4 w-4 animate-pulse" : "h-4 w-4"} aria-hidden /> : <RefreshCw className={pending ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden />}
        onClick={() => {
          setStage(0);
          start(async () => {
            const res = await generateReportAction(month);
            if (res.ok) toast.success(`Informe de ${monthLabel(month, { lower: true })} listo.`);
            else toast.error(res.error);
          });
        }}
      >
        {pending ? "Preparando…" : label}
      </Button>
      {pending && (
        <p className="text-xs text-muted" role="status" aria-live="polite">
          {STAGES[stage]}
        </p>
      )}
    </div>
  );
}

export function PdfLinks({ month }: { month: string }) {
  return (
    <>
      <a href={`/api/informes/${month}/pdf?descargar=1`} className="btn" download>
        <Download className="h-4 w-4" aria-hidden />
        Descargar PDF
      </a>
      <a href={`/api/informes/${month}/pdf`} target="_blank" rel="noreferrer" className="btn-ghost">
        <ExternalLink className="h-4 w-4" aria-hidden />
        Ver PDF
        <span className="sr-only">(se abre en otra pestaña)</span>
      </a>
    </>
  );
}

/** "Enviar ahora": confirma a quiénes sale y lo manda con el PDF adjunto. */
export function SendReportButton({ month, recipients, emailConfigured }: { month: string; recipients: string[]; emailConfigured: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const label = monthLabel(month, { lower: true });

  const send = () =>
    start(async () => {
      const res = await sendReportAction(month);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      if (res.failed.length) toast.error(`Se envió a ${res.sent}, pero falló con ${res.failed.join(", ")}.`);
      else toast.success(res.sent === 1 ? "Informe enviado." : `Informe enviado a ${res.sent} destinatarios.`);
    });

  return (
    <>
      <Button variant="ghost" icon={<Send className="h-4 w-4" aria-hidden />} onClick={() => setOpen(true)}>
        Enviar ahora
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => !pending && setOpen(v)}
        title={`Enviar el informe de ${label}`}
        description="Cada persona recibe su propio correo con el resumen y el PDF adjunto. Nadie ve los correos de los demás."
        footer={
          recipients.length ? (
            <>
              <Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button disabled={pending} icon={<Send className="h-4 w-4" aria-hidden />} onClick={send}>
                {pending ? "Enviando…" : recipients.length === 1 ? "Enviar a 1 persona" : `Enviar a ${recipients.length} personas`}
              </Button>
            </>
          ) : (
            <Link href="/ajustes#informes" className="btn">
              Agregar destinatarios
            </Link>
          )
        }
      >
        {recipients.length ? (
          <div className="flex flex-col gap-4">
            {!emailConfigured && <Notice tone="warning">El correo todavía no está configurado en esta instalación. Avísale a soporte para activar los envíos.</Notice>}
            <ul className="flex flex-col gap-1.5">
              {recipients.map((r) => (
                <li key={r} className="truncate rounded-lg border border-white/10 px-3 py-2 font-mono text-sm text-text">
                  {r}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">
              Cambia la lista en{" "}
              <Link href="/ajustes#informes" className="font-semibold text-accent-hi hover:underline">
                Ajustes → Informe mensual
              </Link>
              .
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">Todavía no hay destinatarios. Agrega los correos de tu equipo o de tus sponsors en Ajustes (hasta 10).</p>
        )}
      </Dialog>
    </>
  );
}
