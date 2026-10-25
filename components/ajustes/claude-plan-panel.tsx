"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState, useTransition } from "react";
import { ExternalLink, KeyRound, Loader2, LogIn, RefreshCw, Send, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import type { ClaudePlanPanelStatus } from "@/lib/dal/claude-plan";
import { useJob } from "@/lib/carousels/use-job";
import { formatRelative } from "@/lib/format";
import { cancelClaudeLoginAction, removeClaudePlanAction, saveClaudePlanAction, sendClaudeCodeAction, startClaudeLoginAction, type ClaudePlanState } from "./claude-plan-actions";

/** Conectar desde la plataforma: el worker abre el inicio de sesión de Claude y la persona pega el código que le da. */
function LoginFlow({ jobId, workerOnline, workerAutoStart, onDone, onCancel }: { jobId: string; workerOnline: boolean; workerAutoStart: boolean; onDone: () => void; onCancel: () => void }) {
  const done = useRef(false);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const job = useJob(jobId, (s) => {
    if (s.status === "SUCCEEDED" && !done.current) {
      done.current = true;
      toast.success("Claude conectado.", { description: "Las próximas animaciones del Editor usan tu suscripción." });
      onDone();
    }
  });
  const url = typeof job?.output.url === "string" ? job.output.url : null;
  const send = () =>
    start(async () => {
      setError(null);
      const res = await sendClaudeCodeAction(jobId, code);
      if (!res.ok) setError(res.error ?? "No pudimos mandar el código.");
      else setSent(true);
    });

  if (job?.status === "FAILED" || job?.status === "CANCELED") {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="danger" title="No se conectó">
          {job.error ?? "La conexión se canceló."}
        </Notice>
        <div>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cerrar
          </Button>
        </div>
      </div>
    );
  }
  if (!url) {
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin text-accent-hi" aria-hidden />
          Preparando el inicio de sesión con Claude…
        </p>
        {!workerOnline && (
          <Notice tone="warning" title={workerAutoStart ? "Encendiendo el servicio de procesamiento" : "El servicio de procesamiento está apagado"}>
            {workerAutoStart ? "Suele tardar menos de un minuto." : "La conexión arranca apenas se encienda. Si en unos minutos no aparece el enlace, avísale a soporte."}
          </Notice>
        )}
        <div>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <ol className="flex flex-col gap-4">
        <li className="flex gap-3">
          <span className="step-node flex-none">1</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Entra con tu cuenta de Claude</p>
            <p className="mt-1 text-sm text-muted">Se abre la página oficial de Claude. Entra con la cuenta de tu plan (Pro o Max) y toca «Autorizar».</p>
            <a href={url} target="_blank" rel="noreferrer" className="btn mt-2 !inline-flex !px-4 !py-2 text-sm">
              <ExternalLink className="h-4 w-4" aria-hidden />
              Abrir Claude
              <span className="sr-only">(se abre en otra pestaña)</span>
            </a>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="step-node flex-none">2</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">Copia el código que te muestra Claude y pégalo aquí</p>
            {sent ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin text-accent-hi" aria-hidden />
                Terminando la conexión… Esta pantalla se actualiza sola.
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                {error && <Notice tone="danger">{error}</Notice>}
                <div className="flex flex-wrap gap-2">
                  <label htmlFor="claude-code" className="sr-only">
                    Código de Claude
                  </label>
                  <Input id="claude-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} placeholder="Pega el código" className="min-w-0 flex-1 font-mono" onKeyDown={(e) => e.key === "Enter" && code.trim() && send()} />
                  <Button size="sm" disabled={pending || code.trim().length < 10} onClick={send} icon={<Send className="h-3.5 w-3.5" aria-hidden />}>
                    {pending ? "Enviando…" : "Conectar"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </li>
      </ol>
      <div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/** Alternativa: pegar el token de `claude setup-token` (para quien ya lo tiene a mano). */
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
      <Field label="Token de tu suscripción" htmlFor="claude-token" hint="El que da `claude setup-token` (empieza con sk-ant-oat). Lo guardamos cifrado y nunca se muestra completo.">
        <Input id="claude-token" name="token" type="password" required autoComplete="off" spellCheck={false} placeholder="sk-ant-oat01-…" className="font-mono" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending} icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden />}>
          {pending ? "Guardando…" : "Guardar token"}
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
export function ClaudePlanPanel({ status }: { status: ClaudePlanPanelStatus }) {
  const router = useRouter();
  const c = status.claude;
  const [jobId, setJobId] = useState<string | null>(status.loginJobId);
  const [replacing, setReplacing] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const begin = () =>
    start(async () => {
      const res = await startClaudeLoginAction();
      if (!res.ok || !res.jobId) toast.error(res.error ?? "No pudimos empezar la conexión.");
      else setJobId(res.jobId);
    });
  const cancel = () =>
    start(async () => {
      await cancelClaudeLoginAction();
      setJobId(null);
    });
  const finished = () => {
    setJobId(null);
    setReplacing(false);
    router.refresh();
  };
  const remove = () =>
    start(async () => {
      const res = await removeClaudePlanAction();
      setConfirm(false);
      if (!res.ok) toast.error(res.error ?? "No se pudo quitar.");
      else toast.success("Claude desconectado. Las animaciones vuelven a usar la API.");
    });
  const showConnect = !c.connected || replacing;
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
            Toda la IA de la plataforma (edición de videos, animaciones, guiones, carruseles, métricas) usa tu suscripción de Claude (Pro o Max): gasta tu uso semanal, no saldo de la API. Las animaciones las escribe un agente que las prueba y las mira sobre tu video antes de entregártelas. Si se te acaba el uso, seguimos con la API si hay una clave de respaldo.
          </p>
          {c.connected && (
            <p className="mt-2 text-sm text-muted">
              Conexión <span className="font-mono text-text">····{c.label}</span>
              {c.updatedAt && <span suppressHydrationWarning> · guardada {formatRelative(new Date(c.updatedAt))}</span>}
            </p>
          )}
        </div>
      </div>
      {!status.isOwner ? (
        <p className="text-xs text-muted">Solo el dueño de la cuenta puede conectar o quitar la suscripción.</p>
      ) : jobId ? (
        <LoginFlow jobId={jobId} workerOnline={status.workerOnline} workerAutoStart={status.workerAutoStart} onDone={finished} onCancel={cancel} />
      ) : showConnect ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending} onClick={begin} icon={<LogIn className="h-3.5 w-3.5" aria-hidden />}>
              {pending ? "Preparando…" : "Conectar mi Claude"}
            </Button>
            {replacing && (
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => setReplacing(false)}>
                Cancelar
              </Button>
            )}
          </div>
          {pasting ? (
            <TokenForm onDone={() => setPasting(false)} />
          ) : (
            <button type="button" className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-accent-hi hover:underline" onClick={() => setPasting(true)}>
              <KeyRound className="h-3.5 w-3.5" aria-hidden />
              ¿Ya tienes un token de `claude setup-token`? Pégalo
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setReplacing(true)} icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}>
            Reconectar
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
