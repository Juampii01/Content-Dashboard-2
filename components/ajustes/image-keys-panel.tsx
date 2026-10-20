"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Copy, ExternalLink, Eye, EyeOff, ImageIcon, KeyRound, Loader2, LogIn, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import type { ImageProvidersStatus } from "@/lib/carousels/images";
import { useJob } from "@/lib/carousels/use-job";
import { formatNumber, formatRelative } from "@/lib/format";
import {
  cancelChatGptLoginAction,
  removeChatGptAction,
  removeOpenAiKeyAction,
  saveChatGptAuthAction,
  saveOpenAiKeyAction,
  startChatGptLoginAction,
  type KeyState,
} from "./image-keys-actions";

export type ImageKeysStatus = {
  isOwner: boolean;
  providers: ImageProvidersStatus;
  last24h: { chatgpt: number; openai: number };
  loginJobId: string | null;
  workerOnline: boolean;
  workerAutoStart: boolean;
};

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Código copiado.");
  } catch {
    toast.error("No se pudo copiar. Escríbelo a mano.");
  }
}

// ─── ChatGPT ──────────────────────────────────────────────────────────────

function LoginFlow({ jobId, workerOnline, workerAutoStart, onDone, onCancel }: { jobId: string; workerOnline: boolean; workerAutoStart: boolean; onDone: () => void; onCancel: () => void }) {
  const done = useRef(false);
  const job = useJob(jobId, (s) => {
    if (s.status === "SUCCEEDED" && !done.current) {
      done.current = true;
      toast.success("ChatGPT conectado.", { description: "Ya puedes generar imágenes en tus carruseles." });
      onDone();
    }
  });
  const url = typeof job?.output.url === "string" ? job.output.url : null;
  const code = typeof job?.output.code === "string" ? job.output.code : null;

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
  if (!url || !code) {
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin text-accent-hi" aria-hidden />
          Pidiendo tu código de conexión a ChatGPT…
        </p>
        {!workerOnline && (
          <Notice tone="warning" title={workerAutoStart ? "Encendiendo el servicio de procesamiento" : "El servicio de procesamiento está apagado"}>
            {workerAutoStart ? "Suele tardar menos de un minuto." : "La conexión arranca apenas se encienda. Si en unos minutos no aparece el código, avísale a soporte."}
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
            <p className="text-sm font-semibold text-white">Abre el enlace de ChatGPT</p>
            <a href={url} target="_blank" rel="noreferrer" className="btn mt-2 !inline-flex !px-4 !py-2 text-sm">
              <ExternalLink className="h-4 w-4" aria-hidden />
              Abrir {new URL(url).host}
              <span className="sr-only">(se abre en otra pestaña)</span>
            </a>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="step-node flex-none">2</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Escribe este código (vence en 15 minutos)</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-2 font-mono text-2xl font-bold tracking-[0.18em] text-white" aria-label={`Código ${code.split("").join(" ")}`}>
                {code}
              </span>
              <Button variant="ghost" size="sm" onClick={() => void copy(code)} icon={<Copy className="h-3.5 w-3.5" aria-hidden />}>
                Copiar
              </Button>
            </div>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="step-node flex-none">3</span>
          <p className="text-sm text-muted">
            Entra con tu cuenta de ChatGPT y acepta. <strong className="text-white">Esta pantalla se actualiza sola</strong> cuando termines.
          </p>
        </li>
      </ol>
      <p className="flex items-center gap-2 text-xs text-placeholder">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Esperando que entres con tu cuenta…
      </p>
      <div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function PasteAuth() {
  const [state, action, pending] = useActionState<KeyState, FormData>(saveChatGptAuthAction, {});
  const handled = useRef<KeyState | null>(null);
  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      toast.success("ChatGPT conectado.", { description: state.label });
    }
  }, [state]);
  return (
    <details className="group rounded-xl border border-white/10 px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-muted transition hover:text-white">¿No te funciona el código? Pega tu auth.json</summary>
      <form action={action} className="mt-3 flex flex-col gap-3">
        <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed text-muted">
          <li>
            En tu computadora, instala Codex: <code className="font-mono text-text">npm install -g @openai/codex</code>
          </li>
          <li>
            Corre <code className="font-mono text-text">codex login</code> y entra con tu cuenta de ChatGPT.
          </li>
          <li>
            Abre el archivo <code className="font-mono text-text">~/.codex/auth.json</code> (en Windows, <code className="font-mono text-text">%USERPROFILE%\.codex\auth.json</code>), copia todo y pégalo aquí.
          </li>
        </ol>
        {state.error && <Notice tone="danger">{state.error}</Notice>}
        <Field label="Contenido de auth.json" htmlFor="chatgpt-auth" hint="Se guarda cifrado y nunca se muestra. Es como una contraseña: no lo compartas con nadie más.">
          <Textarea id="chatgpt-auth" name="authJson" required spellCheck={false} autoComplete="off" className="!min-h-28 font-mono text-xs" placeholder='{ "tokens": { … } }' />
        </Field>
        <div>
          <Button type="submit" size="sm" disabled={pending} icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden />}>
            {pending ? "Guardando…" : "Guardar conexión"}
          </Button>
        </div>
      </form>
    </details>
  );
}

function ChatGptCard({ status }: { status: ImageKeysStatus }) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(status.loginJobId);
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const c = status.providers.chatgpt;

  const connect = () =>
    start(async () => {
      const res = await startChatGptLoginAction();
      if (!res.ok || !res.jobId) return void toast.error(res.error ?? "No pudimos empezar la conexión.");
      setJobId(res.jobId);
    });
  const cancel = () =>
    start(async () => {
      await cancelChatGptLoginAction();
      setJobId(null);
    });
  const disconnect = () =>
    start(async () => {
      const res = await removeChatGptAction();
      setConfirm(false);
      if (!res.ok) toast.error(res.error ?? "No se pudo desconectar.");
      else toast.success("ChatGPT desconectado.");
    });

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex items-start gap-4">
        <span className="tile-icon h-11 w-11 flex-none">
          <ImageIcon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-white">
            Tu ChatGPT para las imágenes
            {c.configured ? <StatusBadge tone="success">Conectado</StatusBadge> : <StatusBadge tone="neutral">Sin conectar</StatusBadge>}
          </p>
          <p className="mt-1 text-sm text-muted">Las imágenes de tus carruseles (siempre sin texto) se generan con tu propia cuenta de ChatGPT Plus o Pro, desde nuestro servicio de procesamiento.</p>
          {c.configured && (
            <p className="mt-2 text-sm text-muted">
              <span className="font-mono text-text">{c.label}</span>
              {c.updatedAt && <span suppressHydrationWarning> · conectado {formatRelative(c.updatedAt)}</span>}
              <span> · {formatNumber(status.last24h.chatgpt)} imágenes en las últimas 24 h</span>
            </p>
          )}
        </div>
      </div>

      {jobId ? (
        <LoginFlow
          jobId={jobId}
          workerOnline={status.workerOnline}
          workerAutoStart={status.workerAutoStart}
          onDone={() => {
            setJobId(null);
            router.refresh();
          }}
          onCancel={cancel}
        />
      ) : status.isOwner ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={connect} disabled={pending} size={c.configured ? "sm" : "md"} variant={c.configured ? "ghost" : "primary"} icon={c.configured ? <RefreshCw className="h-3.5 w-3.5" aria-hidden /> : <LogIn className="h-4 w-4" aria-hidden />}>
              {c.configured ? "Volver a conectar" : "Conectar mi ChatGPT"}
            </Button>
            {c.configured && (
              <Button variant="subtle" size="sm" disabled={pending} onClick={() => setConfirm(true)} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}>
                Desconectar
              </Button>
            )}
          </div>
          {!c.configured && <PasteAuth />}
        </div>
      ) : (
        <p className="text-xs text-muted">Solo el dueño de la cuenta puede conectar o desconectar ChatGPT.</p>
      )}

      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="¿Desconectar tu ChatGPT?"
        description="No se podrán generar imágenes con tu cuenta hasta que la vuelvas a conectar. Las imágenes ya generadas se conservan."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={disconnect} disabled={pending} icon={<Trash2 className="h-4 w-4" aria-hidden />}>
              {pending ? "Desconectando…" : "Sí, desconectar"}
            </Button>
          </>
        }
      />
    </div>
  );
}

// ─── API key de OpenAI ────────────────────────────────────────────────────

function OpenAiForm({ onDone }: { onDone?: () => void }) {
  const [state, action, pending] = useActionState<KeyState, FormData>(saveOpenAiKeyAction, {});
  const [visible, setVisible] = useState(false);
  const handled = useRef<KeyState | null>(null);
  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      toast.success("API key de OpenAI guardada.", { description: state.note });
      onDone?.();
    }
  }, [state, onDone]);
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
            API key de OpenAI <span className="text-xs font-normal text-muted">(opcional)</span>
            {o.configured && <StatusBadge tone="success">Guardada</StatusBadge>}
          </p>
          <p className="mt-1 text-sm text-muted">Respaldo: se usa si no conectas ChatGPT o si llegas al límite del día. OpenAI cobra cada imagen en tu propia cuenta.</p>
          {o.configured && (
            <p className="mt-2 text-sm text-muted">
              API key <span className="font-mono text-text">····{o.label}</span>
              {o.updatedAt && <span suppressHydrationWarning> · guardada {formatRelative(o.updatedAt)}</span>}
              <span> · {formatNumber(status.last24h.openai)} imágenes en las últimas 24 h</span>
            </p>
          )}
        </div>
      </div>
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
        description="Las imágenes se seguirán generando con tu ChatGPT, si está conectado."
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

export function ImageKeysPanel({ status }: { status: ImageKeysStatus }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChatGptCard status={status} />
      <OpenAiCard status={status} />
    </div>
  );
}
