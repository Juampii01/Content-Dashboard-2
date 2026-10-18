"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { BellRing, ExternalLink, Eye, EyeOff, KeyRound, RefreshCw, ShieldCheck, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badges";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/format";
import { describeBalance, HEYGEN_API_BILLING_HELP, HEYGEN_API_USAGE_URL, type BalanceLike } from "@/lib/heygen/pricing";
import { removeHeyGenKeyAction, retryHeyGenWebhookAction, saveHeyGenKeyAction, type HeyGenKeyState } from "./heygen-actions";

export type HeyGenStatusView = {
  isOwner: boolean;
  configured: boolean;
  label: string | null;
  updatedAt: string | null;
  webhookActive: boolean;
  webhookError: string | null;
  balance: BalanceLike | null;
  balanceError: string | null;
};

function BillingHelp() {
  return (
    <p className="text-xs leading-relaxed text-muted">
      La API de HeyGen se paga aparte del plan web: aunque tengas Creator o Pro, necesitas cargar saldo de API (desde US$ 5) en HeyGen →
      Developers.{" "}
      <a href={HEYGEN_API_BILLING_HELP} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent-hi hover:underline">
        Cómo se cobra la API
        <ExternalLink className="h-3 w-3" aria-hidden />
        <span className="sr-only">(se abre en otra pestaña)</span>
      </a>
    </p>
  );
}

function KeyForm({ replacing, onCancel }: { replacing: boolean; onCancel?: () => void }) {
  const [state, action, pending] = useActionState<HeyGenKeyState, FormData>(saveHeyGenKeyAction, {});
  const [visible, setVisible] = useState(false);
  const handled = useRef<HeyGenKeyState | null>(null);

  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      toast.success("API key guardada.", { description: state.webhookError ? "Los avisos automáticos no quedaron activos: mira el detalle abajo." : undefined });
      onCancel?.();
    }
  }, [state, onCancel]);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      <Field
        label={replacing ? "Nueva API key de HeyGen" : "API key de HeyGen"}
        htmlFor="heygen-key"
        hint="Está en app.heygen.com → Settings → API. La validamos con HeyGen antes de guardarla."
      >
        <div className="relative">
          <Input
            id="heygen-key"
            name="apiKey"
            type={visible ? "text" : "password"}
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="Pega aquí tu API key"
            className="pr-11 font-mono"
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Ocultar la API key" : "Mostrar la API key"}
            className="absolute inset-y-0 right-1 my-auto grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-white/[0.07] hover:text-white"
          >
            {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
          </button>
        </div>
      </Field>
      <BillingHelp />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} icon={<ShieldCheck className="h-4 w-4" aria-hidden />}>
          {pending ? "Validando con HeyGen…" : "Validar y guardar"}
        </Button>
        {onCancel && (
          <Button variant="ghost" disabled={pending} onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}

export function HeyGenKeyPanel({ status }: { status: HeyGenStatusView }) {
  const [replacing, setReplacing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, start] = useTransition();
  const balance = status.balance ? describeBalance(status.balance) : null;

  if (!status.configured) {
    if (!status.isOwner) {
      return (
        <p className="flex items-center gap-2 text-sm text-muted">
          <KeyRound className="h-4 w-4 text-accent-hi" aria-hidden />
          Todavía no hay una API key de HeyGen. Solo el dueño de la cuenta puede agregarla.
        </p>
      );
    }
    return (
      <div className="card p-5">
        <KeyForm replacing={false} />
      </div>
    );
  }

  const remove = () =>
    start(async () => {
      const res = await removeHeyGenKeyAction();
      setConfirmOpen(false);
      if (res.error) toast.error(res.error);
      else toast.success("API key quitada. Los videos ya generados se conservan.");
    });

  const retryWebhook = () =>
    start(async () => {
      const res = await retryHeyGenWebhookAction();
      if (res.error) toast.error("Los avisos automáticos siguen sin activarse.", { description: res.error });
      else toast.success("Avisos automáticos activos.");
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className="tile-icon h-11 w-11 flex-none">
            <KeyRound className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 font-semibold text-white">
              HeyGen
              {status.balanceError ? <StatusBadge tone="danger">Con error</StatusBadge> : <StatusBadge tone="success">Conectada</StatusBadge>}
            </p>
            <p className="mt-1 text-sm text-muted">
              API key <span className="font-mono text-text">····{status.label}</span>
              {status.updatedAt && <span suppressHydrationWarning> · guardada {formatRelative(status.updatedAt)}</span>}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {balance && (
            <div className="flex items-center gap-3">
              <Wallet className="h-4 w-4 flex-none text-accent-hi" aria-hidden />
              <div>
                <p className="eyebrow !text-[10px]">Saldo de API</p>
                <p className={`font-mono text-lg font-semibold tabular-nums ${balance.empty ? "text-warning" : "text-white"}`}>{balance.value}</p>
              </div>
            </div>
          )}
          {status.isOwner && (
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => setReplacing((v) => !v)} icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}>
                Reemplazar key
              </Button>
              <Button variant="subtle" size="sm" disabled={pending} onClick={() => setConfirmOpen(true)} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}>
                Quitar
              </Button>
            </div>
          )}
        </div>
      </div>

      {status.balanceError && <Notice tone="danger">{status.balanceError}</Notice>}
      {balance?.empty && !status.balanceError && (
        <Notice tone="warning" title="No tienes saldo de API">
          Sin saldo no se pueden generar videos.{" "}
          <a href={HEYGEN_API_USAGE_URL} target="_blank" rel="noreferrer" className="font-semibold underline">
            Cargar saldo en HeyGen
          </a>
          . Recuerda: el plan web no incluye la API.
        </Notice>
      )}
      {balance?.note && !balance.empty && <p className="text-xs text-muted">{balance.note}</p>}

      {status.webhookActive ? (
        <p className="flex items-center gap-2 text-xs text-muted">
          <BellRing className="h-3.5 w-3.5 text-success" aria-hidden />
          Avisos automáticos activos: HeyGen nos avisa cuando un video está listo.
        </p>
      ) : (
        status.webhookError && (
          <Notice tone="warning" title="Avisos automáticos sin activar">
            <p>{status.webhookError}</p>
            {status.isOwner && (
              <Button variant="ghost" size="sm" className="mt-2" disabled={pending} onClick={retryWebhook} icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}>
                Reintentar
              </Button>
            )}
          </Notice>
        )
      )}

      {replacing && status.isOwner && (
        <div className="card p-5">
          <KeyForm replacing onCancel={() => setReplacing(false)} />
        </div>
      )}
      {!status.isOwner && <p className="text-xs text-muted">Solo el dueño de la cuenta puede reemplazar o quitar esta clave.</p>}

      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="¿Quitar la API key de HeyGen?"
        description="No se podrán generar videos con clon hasta que guardes otra. Los videos ya generados se conservan y tu cuenta de HeyGen no cambia."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={remove} disabled={pending} icon={<Trash2 className="h-4 w-4" aria-hidden />}>
              {pending ? "Quitando…" : "Sí, quitar"}
            </Button>
          </>
        }
      />
    </div>
  );
}
