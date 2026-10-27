"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { ExternalLink, Eye, EyeOff, KeyRound, Link2, RefreshCw, ShieldCheck, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badges";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { formatNumber, formatRelative } from "@/lib/format";
import type { ScrapeCreatorsKeyPanelStatus } from "@/lib/dal/scrapecreators-key";
import { removeScrapeCreatorsKeyAction, saveScrapeCreatorsKeyAction, testScrapeCreatorsKeyAction, type ScrapeCreatorsKeyState } from "./scrapecreators-key-actions";

const SITE = "https://scrapecreators.com";

function credits(n: number | null | undefined): string {
  return typeof n === "number" ? `Te quedan ${formatNumber(n)} créditos.` : "";
}

function KeyForm({ replacing, onCancel }: { replacing: boolean; onCancel?: () => void }) {
  const [state, action, pending] = useActionState<ScrapeCreatorsKeyState, FormData>(saveScrapeCreatorsKeyAction, {});
  const [visible, setVisible] = useState(false);
  const handled = useRef<ScrapeCreatorsKeyState | null>(null);

  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      toast.success(`Clave guardada. ${credits(state.credits)}`.trim());
      onCancel?.();
    }
  }, [state, onCancel]);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      <Field label={replacing ? "Nueva clave de ScrapeCreators" : "Clave de ScrapeCreators"} htmlFor="scrapecreators-key" hint="La probamos con ScrapeCreators antes de guardarla (sin gastar créditos).">
        <div className="relative">
          <Input id="scrapecreators-key" name="apiKey" type={visible ? "text" : "password"} required autoComplete="off" spellCheck={false} placeholder="Tu clave de API" className="pr-11 font-mono" />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Ocultar la clave" : "Mostrar la clave"}
            className="absolute inset-y-0 right-1 my-auto grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-white/[0.07] hover:text-white"
          >
            {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
          </button>
        </div>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} icon={<ShieldCheck className="h-4 w-4" aria-hidden />}>
          {pending ? "Probando con ScrapeCreators…" : "Probar y guardar"}
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

function Intro() {
  return (
    <div className="flex items-start gap-4">
      <span className="tile-icon h-11 w-11 flex-none">
        <Link2 className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-white">ScrapeCreators (opcional)</p>
        <p className="mt-1 text-sm text-muted">
          A veces Instagram y TikTok no dejan bajar un link desde nuestro servidor. Con tu clave lo bajamos igual: cada link que se baja así gasta 1 crédito de tu cuenta. Sin clave, tendrás que subir esos videos.{" "}
          <a href={SITE} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent-hi hover:underline">
            Crear una cuenta
            <ExternalLink className="h-3 w-3" aria-hidden />
            <span className="sr-only">(se abre en otra pestaña)</span>
          </a>
        </p>
      </div>
    </div>
  );
}

/** Ajustes → Claves de servicios: la clave de ScrapeCreators, plan B para bajar links de Instagram y TikTok. */
export function ScrapeCreatorsKeyPanel({ status }: { status: ScrapeCreatorsKeyPanelStatus }) {
  const [replacing, setReplacing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, start] = useTransition();

  if (!status.key.configured) {
    if (!status.isOwner) {
      return (
        <p className="flex items-center gap-2 text-sm text-muted">
          <KeyRound className="h-4 w-4 text-accent-hi" aria-hidden />
          No hay una clave de ScrapeCreators. Solo el dueño de la cuenta puede agregarla.
        </p>
      );
    }
    return (
      <div className="card flex flex-col gap-4 p-5">
        <Intro />
        <KeyForm replacing={false} />
      </div>
    );
  }

  const test = () =>
    start(async () => {
      const res = await testScrapeCreatorsKeyAction();
      if (res.error) toast.error(res.error);
      else toast.success(`La clave funciona. ${credits(res.credits)}`.trim());
    });

  const remove = () =>
    start(async () => {
      const res = await removeScrapeCreatorsKeyAction();
      setConfirmOpen(false);
      if (res.error) toast.error(res.error);
      else toast.success("Clave quitada.");
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className="tile-icon h-11 w-11 flex-none">
            <Link2 className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 font-semibold text-white">
              ScrapeCreators <StatusBadge tone="success">Conectada</StatusBadge>
            </p>
            <p className="mt-1 text-sm text-muted">
              Clave <span className="font-mono text-text">····{status.key.label}</span>
              {status.key.updatedAt && <span suppressHydrationWarning> · guardada {formatRelative(status.key.updatedAt)}</span>}
            </p>
            <p className="mt-1 text-xs text-muted">Se usa solo cuando Instagram o TikTok no dejan bajar un link. 1 crédito por link.</p>
          </div>
        </div>
        {status.isOwner && (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" disabled={pending} onClick={test} icon={<Zap className="h-3.5 w-3.5" aria-hidden />}>
              Probar
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setReplacing((v) => !v)} icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}>
              Reemplazar clave
            </Button>
            <Button variant="subtle" size="sm" disabled={pending} onClick={() => setConfirmOpen(true)} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}>
              Quitar
            </Button>
          </div>
        )}
      </div>
      {replacing && (
        <div className="card p-5">
          <KeyForm replacing onCancel={() => setReplacing(false)} />
        </div>
      )}
      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="¿Quitar la clave de ScrapeCreators?"
        description="Si Instagram o TikTok no dejan bajar un link, tendrás que subir el video."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={remove} disabled={pending}>
              Quitar
            </Button>
          </>
        }
      />
    </div>
  );
}
