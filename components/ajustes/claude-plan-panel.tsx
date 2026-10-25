"use client";

import { useActionState, useState, useTransition } from "react";
import { ExternalLink, RefreshCw, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/format";
import type { ClaudePlanStatus } from "@/lib/ai/claude-plan";
import { removeClaudePlanAction, saveClaudePlanAction, type ClaudePlanState } from "./claude-plan-actions";

function TokenForm({ onDone }: { onDone?: () => void }) {
  const [state, action, pending] = useActionState<ClaudePlanState, FormData>(async (prev, fd) => {
    const res = await saveClaudePlanAction(prev, fd);
    if (res.ok) {
      toast.success("Claude conectado.", { description: "Las próximas animaciones del Editor usan tu suscripción." });
      onDone?.();
    }
    return res;
  }, {});
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted">
        <li>
          En una computadora con Claude Code, abre la terminal y escribe <code className="rounded bg-white/10 px-1 font-mono text-text">claude setup-token</code>.
        </li>
        <li>Entra con tu cuenta de Claude (Pro o Max) en la página que se abre.</li>
        <li>Copia el token que aparece (empieza con sk-ant-oat) y pégalo aquí.</li>
      </ol>
      <Field label="Token de tu suscripción" htmlFor="claude-token" hint="Lo guardamos cifrado y nunca se muestra completo. Dura un año; puedes quitarlo cuando quieras.">
        <Input id="claude-token" name="token" type="password" required autoComplete="off" spellCheck={false} placeholder="sk-ant-oat01-…" className="font-mono" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending} icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden />}>
          {pending ? "Guardando…" : "Conectar mi Claude"}
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

/** Tarjeta de la suscripción de Claude: las animaciones del Editor gastan su uso semanal en vez de la API. */
export function ClaudePlanPanel({ status }: { status: { isOwner: boolean; claude: ClaudePlanStatus } }) {
  const c = status.claude;
  const [replacing, setReplacing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const remove = () =>
    start(async () => {
      const res = await removeClaudePlanAction();
      setConfirm(false);
      if (!res.ok) toast.error(res.error ?? "No se pudo quitar.");
      else toast.success("Claude desconectado. Las animaciones vuelven a usar la API.");
    });
  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex items-start gap-4">
        <span className="tile-icon h-11 w-11 flex-none">
          <Sparkles className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-white">
            Tu suscripción de Claude <span className="text-xs font-normal text-muted">(recomendado)</span>
            {c.connected && <StatusBadge tone="success">Conectada</StatusBadge>}
          </p>
          <p className="mt-1 text-sm text-muted">
            Las animaciones del Editor las escribe un agente de Claude que las prueba y las mira antes de entregártelas. Con tu suscripción (Pro o Max) gastan tu uso semanal, no saldo de la API. Si se te acaba el uso de la semana, seguimos con la API.
          </p>
          {c.connected && (
            <p className="mt-2 text-sm text-muted">
              Token <span className="font-mono text-text">····{c.label}</span>
              {c.updatedAt && <span suppressHydrationWarning> · guardado {formatRelative(new Date(c.updatedAt))}</span>}
            </p>
          )}
          <p className="mt-2 text-xs text-muted">
            <a href="https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent-hi hover:underline">
              Cómo funciona el uso con tu plan <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </p>
        </div>
      </div>
      {!status.isOwner ? (
        <p className="text-xs text-muted">Solo el dueño de la cuenta puede conectar o quitar la suscripción.</p>
      ) : !c.connected || replacing ? (
        <TokenForm onDone={c.connected ? () => setReplacing(false) : undefined} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setReplacing(true)} icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}>
            Reemplazar
          </Button>
          <Button variant="subtle" size="sm" disabled={pending} onClick={() => setConfirm(true)} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}>
            Desconectar
          </Button>
        </div>
      )}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="¿Desconectar tu Claude?"
        description="Las animaciones que ya están en tus videos se quedan. Las nuevas usan la API."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={remove} disabled={pending} icon={<Trash2 className="h-4 w-4" aria-hidden />}>
              {pending ? "Desconectando…" : "Sí, desconectar"}
            </Button>
          </>
        }
      />
    </div>
  );
}
