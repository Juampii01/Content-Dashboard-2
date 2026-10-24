"use client";

import { useActionState, useState, useTransition } from "react";
import { ExternalLink, Music2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/format";
import { removeJamendoKeyAction, saveJamendoKeyAction, type MusicKeyState } from "./music-keys-actions";

export type MusicKeysStatus = { isOwner: boolean; jamendo: { configured: boolean; label: string | null; updatedAt: string | null } };

function JamendoForm({ onDone }: { onDone?: () => void }) {
  const [state, action, pending] = useActionState<MusicKeyState, FormData>(async (prev, fd) => {
    const res = await saveJamendoKeyAction(prev, fd);
    if (res.ok) {
      toast.success("Jamendo conectado.", { description: "Ya puedes buscar su música en la Biblioteca del Estudio." });
      onDone?.();
    }
    return res;
  }, {});
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      <Field label="Client ID de Jamendo" htmlFor="jamendo-id" hint="Créalo gratis en devportal.jamendo.com (Mis aplicaciones). Lo probamos con una búsqueda antes de guardarlo.">
        <Input id="jamendo-id" name="clientId" required autoComplete="off" spellCheck={false} placeholder="a1b2c3d4" className="font-mono" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending} icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden />}>
          {pending ? "Probando con Jamendo…" : "Probar y guardar"}
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

/** Tarjeta de Jamendo: música de artistas independientes con licencia CC BY (uso comercial con atribución). */
export function MusicKeysPanel({ status }: { status: MusicKeysStatus }) {
  const j = status.jamendo;
  const [replacing, setReplacing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const remove = () =>
    start(async () => {
      const res = await removeJamendoKeyAction();
      setConfirm(false);
      if (!res.ok) toast.error(res.error ?? "No se pudo quitar.");
      else toast.success("Jamendo desconectado. Las pistas que ya agregaste siguen en tu biblioteca.");
    });
  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex items-start gap-4">
        <span className="tile-icon h-11 w-11 flex-none">
          <Music2 className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-white">
            Música de Jamendo <span className="text-xs font-normal text-muted">(opcional)</span>
            {j.configured && <StatusBadge tone="success">Conectado</StatusBadge>}
          </p>
          <p className="mt-1 text-sm text-muted">
            Busca música de artistas independientes desde el Estudio. Solo mostramos pistas con licencia CC BY (se pueden usar en videos de tu marca nombrando al artista: la atribución se arma sola). La música generada del Estudio no necesita nada de esto.
          </p>
          <p className="mt-2 text-xs text-muted">
            Ojo: la API de Jamendo es gratis solo para uso no comercial. Si tu marca vende con estos videos, pide un acuerdo comercial a Jamendo antes de usarla.{" "}
            <a href="https://devportal.jamendo.com/api_terms_of_use" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent-hi hover:underline">
              Condiciones <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </p>
          {j.configured && (
            <p className="mt-2 text-sm text-muted">
              Client ID <span className="font-mono text-text">····{j.label}</span>
              {j.updatedAt && <span suppressHydrationWarning> · guardado {formatRelative(new Date(j.updatedAt))}</span>}
            </p>
          )}
        </div>
      </div>
      {!status.isOwner ? (
        <p className="text-xs text-muted">Solo el dueño de la cuenta puede cambiar esta clave.</p>
      ) : !j.configured || replacing ? (
        <JamendoForm onDone={j.configured ? () => setReplacing(false) : undefined} />
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
        title="¿Desconectar Jamendo?"
        description="Las pistas que ya agregaste a tu biblioteca se quedan (con su atribución)."
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
