"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { ExternalLink, Eye, EyeOff, KeyRound, RefreshCw, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badges";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/format";
import type { AnthropicKeyPanelStatus } from "@/lib/dal/anthropic-key";
import { removeAnthropicKeyAction, removeLegacyClaudeAction, saveAnthropicKeyAction, type AnthropicKeyState } from "./anthropic-key-actions";

const CONSOLE_KEYS = "https://console.anthropic.com/settings/keys";
const CONSOLE_BILLING = "https://console.anthropic.com/settings/billing";
const CONSOLE_LIMITS = "https://console.anthropic.com/settings/limits";

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent-hi hover:underline">
      {children}
      <ExternalLink className="h-3 w-3" aria-hidden />
      <span className="sr-only">(se abre en otra pestaña)</span>
    </a>
  );
}

/** Los pasos para sacar la clave, en criollo: cuenta, saldo, clave y un tope de gasto. */
function Guide() {
  return (
    <details className="group rounded-xl bg-white/[0.04] px-4 py-3 text-sm">
      <summary className="cursor-pointer font-semibold text-white marker:text-muted">Cómo sacar tu clave (5 minutos)</summary>
      <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-text">
        <li>
          Entra a <Link href={CONSOLE_KEYS}>console.anthropic.com</Link> con tu correo. Es la consola para desarrolladores: es otra cuenta que tu plan de Claude, aunque uses el mismo correo.
        </li>
        <li>
          Carga saldo en <Link href={CONSOLE_BILLING}>Billing</Link> (desde USD 5). Se paga por uso: un video editado con la IA suele costar entre USD 1 y 3, y una animación grande, entre USD 1 y 7.
        </li>
        <li>
          Pon un tope de gasto por mes en <Link href={CONSOLE_LIMITS}>Limits</Link>, así nunca te sorprende la cuenta.
        </li>
        <li>
          En <Link href={CONSOLE_KEYS}>API Keys</Link> toca «Create Key», ponle un nombre (por ejemplo «Content Studio») y copia la clave: empieza con <span className="font-mono">sk-ant-api</span> y solo se muestra una vez.
        </li>
        <li>Pégala aquí abajo y toca «Probar y guardar».</li>
      </ol>
    </details>
  );
}

function KeyForm({ replacing, onCancel }: { replacing: boolean; onCancel?: () => void }) {
  const [state, action, pending] = useActionState<AnthropicKeyState, FormData>(saveAnthropicKeyAction, {});
  const [visible, setVisible] = useState(false);
  const handled = useRef<AnthropicKeyState | null>(null);

  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      toast.success("Clave guardada. La IA ya usa tu cuenta de Anthropic.");
      onCancel?.();
    }
  }, [state, onCancel]);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      <Field label={replacing ? "Nueva clave de API de Anthropic" : "Clave de API de Anthropic"} htmlFor="anthropic-key" hint="La probamos con Anthropic antes de guardarla (sin gastar saldo).">
        <div className="relative">
          <Input id="anthropic-key" name="apiKey" type={visible ? "text" : "password"} required autoComplete="off" spellCheck={false} placeholder="sk-ant-api…" className="pr-11 font-mono" />
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
          {pending ? "Probando con Anthropic…" : "Probar y guardar"}
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

/** Ajustes → Claves de servicios: la clave de API de Anthropic con la que funciona toda la IA de la app. */
export function AnthropicKeyPanel({ status }: { status: AnthropicKeyPanelStatus }) {
  const [replacing, setReplacing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, start] = useTransition();

  const legacy = status.legacyPlan && status.isOwner && (
    <Notice tone="info" title="Tu suscripción de Claude ya no se usa">
      <p>Anthropic no permite que otras apps usen los planes Pro o Max, así que la IA ahora funciona con tu clave de API. Puedes borrar la conexión vieja.</p>
      <Button
        variant="ghost"
        size="sm"
        className="mt-2"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await removeLegacyClaudeAction();
            if (r.error) toast.error(r.error);
            else toast.success("Conexión vieja borrada.");
          })
        }
        icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
      >
        Borrar la conexión vieja
      </Button>
    </Notice>
  );

  if (!status.key.configured) {
    return (
      <div className="flex flex-col gap-4">
        {legacy}
        {!status.isOwner ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <KeyRound className="h-4 w-4 text-accent-hi" aria-hidden />
            Todavía no hay una clave de API de Anthropic. Solo el dueño de la cuenta puede agregarla.
          </p>
        ) : (
          <div className="card flex flex-col gap-4 p-5">
            <div className="flex items-start gap-4">
              <span className="tile-icon h-11 w-11 flex-none">
                <Sparkles className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-white">Claude (Anthropic)</p>
                <p className="mt-1 text-sm text-muted">
                  Toda la IA de la app (guiones, edición, animaciones, carruseles) funciona con tu clave. El consumo se cobra en tu cuenta de Anthropic, a precio de API, y tú pones el tope.
                  {status.serverKey && " Mientras no cargues una, se usa la de la instalación."}
                </p>
              </div>
            </div>
            <Guide />
            <KeyForm replacing={false} />
          </div>
        )}
      </div>
    );
  }

  const remove = () =>
    start(async () => {
      const res = await removeAnthropicKeyAction();
      setConfirmOpen(false);
      if (res.error) toast.error(res.error);
      else toast.success("Clave quitada.");
    });

  return (
    <div className="flex flex-col gap-4">
      {legacy}
      <div className="card flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className="tile-icon h-11 w-11 flex-none">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 font-semibold text-white">
              Claude (Anthropic) <StatusBadge tone="success">Conectada</StatusBadge>
            </p>
            <p className="mt-1 text-sm text-muted">
              Clave <span className="font-mono text-text">····{status.key.label}</span>
              {status.key.updatedAt && <span suppressHydrationWarning> · guardada {formatRelative(status.key.updatedAt)}</span>}
            </p>
            <p className="mt-1 text-xs text-muted">
              Mira tu consumo y tu tope en <Link href={CONSOLE_LIMITS}>la consola de Anthropic</Link>.
            </p>
          </div>
        </div>
        {status.isOwner && (
          <div className="flex flex-wrap gap-2">
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
        title="¿Quitar la clave de Anthropic?"
        description={status.serverKey ? "La IA va a usar la clave de la instalación hasta que cargues otra." : "La IA deja de funcionar hasta que cargues otra clave."}
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
