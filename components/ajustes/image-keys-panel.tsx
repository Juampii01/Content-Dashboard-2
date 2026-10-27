"use client";

import { useActionState, useState, useTransition } from "react";
import { Eye, EyeOff, KeyRound, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import type { ImageProvidersStatus } from "@/lib/carousels/images";
import { formatNumber, formatRelative } from "@/lib/format";
import { removeOpenAiKeyAction, saveOpenAiKeyAction, type KeyState } from "./image-keys-actions";

export type ImageKeysStatus = {
  isOwner: boolean;
  providers: ImageProvidersStatus;
  last24h: { openai: number };
  workerOnline: boolean;
  workerAutoStart: boolean;
};


// ─── API key de OpenAI ────────────────────────────────────────────────────

function OpenAiForm({ onDone }: { onDone?: () => void }) {
  const [state, action, pending] = useActionState<KeyState, FormData>(async (prev, fd) => {
    const res = await saveOpenAiKeyAction(prev, fd);
    if (res.ok) {
      toast.success("API key de OpenAI guardada.", { description: res.note });
      onDone?.();
    }
    return res;
  }, {});
  const [visible, setVisible] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      <Field label="API key de OpenAI" htmlFor="openai-key" hint="Está en platform.openai.com → API keys. La validamos con OpenAI antes de guardarla.">
        <div className="relative">
          <Input id="openai-key" name="apiKey" type={visible ? "text" : "password"} required autoComplete="off" spellCheck={false} placeholder="sk-…" className="pr-11 font-mono" />
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
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending} icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden />}>
          {pending ? "Validando con OpenAI…" : "Validar y guardar"}
        </Button>
        {onDone && (
          <Button variant="ghost" size="sm" disabled={pending} onClick={onDone}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}

function OpenAiCard({ status }: { status: ImageKeysStatus }) {
  const o = status.providers.openai;
  const [replacing, setReplacing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const remove = () =>
    start(async () => {
      const res = await removeOpenAiKeyAction();
      setConfirm(false);
      if (!res.ok) toast.error(res.error ?? "No se pudo quitar.");
      else toast.success("API key de OpenAI quitada.");
    });
  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex items-start gap-4">
        <span className="tile-icon h-11 w-11 flex-none">
          <KeyRound className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-white">
            Clave de API de OpenAI (imágenes)
            {o.configured && <StatusBadge tone="success">Guardada</StatusBadge>}
          </p>
          <p className="mt-1 text-sm text-muted">Las imágenes de carruseles, animaciones y miniaturas (siempre sin texto) se generan con tu clave. OpenAI cobra cada imagen en tu propia cuenta.</p>
          {o.configured && (
            <p className="mt-2 text-sm text-muted">
              API key <span className="font-mono text-text">····{o.label}</span>
              {o.updatedAt && <span suppressHydrationWarning> · guardada {formatRelative(o.updatedAt)}</span>}
              <span> · {formatNumber(status.last24h.openai)} imágenes en las últimas 24 h</span>
            </p>
          )}
        </div>
      </div>
      {!o.configured && status.isOwner && <OpenAiGuide />}
      {!status.isOwner ? (
        <p className="text-xs text-muted">Solo el dueño de la cuenta puede cambiar esta clave.</p>
      ) : !o.configured || replacing ? (
        <OpenAiForm onDone={o.configured ? () => setReplacing(false) : undefined} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setReplacing(true)} icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}>
            Reemplazar key
          </Button>
          <Button variant="subtle" size="sm" disabled={pending} onClick={() => setConfirm(true)} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}>
            Quitar
          </Button>
        </div>
      )}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="¿Quitar la API key de OpenAI?"
        description="No se podrán generar imágenes hasta que cargues otra clave. Las imágenes ya generadas se conservan."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)} disabled={pending}>
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

/** Los pasos para sacar la clave de OpenAI. */
function OpenAiGuide() {
  const link = (href: string, text: string) => (
    <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-accent-hi hover:underline">
      {text}
    </a>
  );
  return (
    <details className="rounded-xl bg-white/[0.04] px-4 py-3 text-sm">
      <summary className="cursor-pointer font-semibold text-white marker:text-muted">Cómo sacar tu clave (5 minutos)</summary>
      <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-text">
        <li>Entra a {link("https://platform.openai.com/", "platform.openai.com")} con tu correo. Es la plataforma para desarrolladores: es otra cuenta que tu plan de ChatGPT.</li>
        <li>Carga saldo en {link("https://platform.openai.com/settings/organization/billing", "Billing")} (desde USD 5) y pon un tope de gasto por mes en {link("https://platform.openai.com/settings/organization/limits", "Limits")}.</li>
        <li>Si te lo pide, verifica tu organización (lo pide OpenAI para generar imágenes).</li>
        <li>En {link("https://platform.openai.com/api-keys", "API keys")} toca «Create new secret key», ponle un nombre y copia la clave (empieza con sk-).</li>
        <li>Pégala aquí abajo y toca «Validar y guardar».</li>
      </ol>
    </details>
  );
}

/**
 * Las imágenes se generan con la clave de API de OpenAI del cliente. La cuenta de ChatGPT (Codex) ya no se usa: un
 * producto de terceros no debe usar ni guardar la sesión de un plan personal. Si quedó una conectada de antes, se
 * muestra solo para poder desconectarla.
 */
export function ImageKeysPanel({ status }: { status: ImageKeysStatus }) {
  return (
    <div className="flex flex-col gap-4">
      <OpenAiCard status={status} />
    </div>
  );
}
