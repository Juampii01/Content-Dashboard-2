"use client";

import { useState, useTransition } from "react";
import { Link2, RefreshCw, Unplug } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badges";
import { Dialog } from "@/components/ui/dialog";
import { PlatformBadge } from "@/components/ui/platform";
import { toast } from "@/components/ui/toast";
import { formatNumber, formatRelative } from "@/lib/format";
import { platformLabel, platformSlug, type Platform } from "@/lib/social/types";
import { disconnectAction, syncNowAction } from "./connection-actions";

type Status = "ACTIVE" | "EXPIRED" | "REVOKED" | "MISSING_SCOPES" | "ERROR" | "DISCONNECTED";

export type ConnectionView = {
  handle: string;
  avatarUrl: string | null;
  status: Status;
  statusMessage: string | null;
  lastSyncedAt: string | null;
  backfillDone: boolean;
  itemCount: number;
  lastError: string | null;
  demo: boolean;
};

const statusView: Record<Status, { tone: "success" | "warning" | "danger" | "neutral"; label: string }> = {
  ACTIVE: { tone: "success", label: "Conectada" },
  EXPIRED: { tone: "danger", label: "Conexión vencida" },
  REVOKED: { tone: "danger", label: "Permiso quitado" },
  MISSING_SCOPES: { tone: "warning", label: "Faltan permisos" },
  ERROR: { tone: "danger", label: "Con error" },
  DISCONNECTED: { tone: "neutral", label: "Desconectada" },
};

export function ConnectionCard({
  platform,
  description,
  configured,
  canConnect,
  canSync,
  connection,
}: {
  platform: Platform;
  description: string;
  configured: boolean;
  canConnect: boolean;
  canSync: boolean;
  connection: ConnectionView | null;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [purge, setPurge] = useState(false);
  const [purgeText, setPurgeText] = useState("");
  const connectHref = `/api/social/${platformSlug[platform]}/connect`;
  const needsReconnect = connection && ["EXPIRED", "REVOKED", "MISSING_SCOPES", "ERROR"].includes(connection.status);

  const sync = () =>
    startTransition(async () => {
      const res = await syncNowAction(platform);
      if (res.error) toast.error(res.error);
      else toast.success(res.message ?? "Sincronizando.");
    });

  const confirmDisconnect = () =>
    startTransition(async () => {
      const res = await disconnectAction(platform, purge);
      setConfirmOpen(false);
      setPurge(false);
      setPurgeText("");
      if (res.error) toast.error(res.error);
      else toast.success(res.message ?? "Red desconectada.");
    });

  return (
    <li className="card flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        {connection?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={connection.avatarUrl} alt="" className="h-11 w-11 flex-none rounded-full border border-white/10 object-cover" referrerPolicy="no-referrer" />
        ) : (
          <span className="grid h-11 w-11 flex-none place-items-center rounded-full border border-white/10 bg-white/5">
            <Link2 className="h-4 w-4 text-muted" aria-hidden />
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <PlatformBadge platform={platform} />
            {connection ? <span className="truncate text-sm font-semibold text-white">@{connection.handle.replace(/^@/, "")}</span> : null}
            {connection?.demo ? (
              <StatusBadge tone="info">Demo</StatusBadge>
            ) : connection ? (
              <StatusBadge tone={statusView[connection.status].tone}>{statusView[connection.status].label}</StatusBadge>
            ) : null}
          </div>
          {connection?.demo ? (
            <p className="text-sm text-muted">
              Datos de ejemplo ({formatNumber(connection.itemCount)} piezas). Al conectar cualquier red real se borran solos.
            </p>
          ) : connection ? (
            <p className="text-sm text-muted">
              {needsReconnect && connection.statusMessage
                ? connection.statusMessage
                : !connection.backfillDone
                  ? `Importando tu histórico… ${connection.itemCount > 0 ? `${formatNumber(connection.itemCount)} piezas hasta ahora.` : ""}`
                  : `${formatNumber(connection.itemCount)} piezas · ${connection.lastSyncedAt ? `actualizado ${formatRelative(connection.lastSyncedAt)}` : "sin sincronizar todavía"}`}
              {connection.lastError && !needsReconnect ? <span className="block text-warning">Última sincronización: {connection.lastError}</span> : null}
            </p>
          ) : (
            <p className="text-sm text-muted">{description}</p>
          )}
        </div>
      </div>

      <div className="flex flex-none flex-wrap items-center gap-2">
        {!configured ? (
          <span className="text-xs text-muted">Falta configurar la app de {platformLabel[platform]} en la instalación.</span>
        ) : !connection || connection.demo ? (
          canConnect ? (
            <ButtonLink href={connectHref} prefetch={false} icon={<Link2 className="h-4 w-4" aria-hidden />}>
              Conectar
            </ButtonLink>
          ) : (
            <span className="text-xs text-muted">Solo el dueño conecta redes.</span>
          )
        ) : (
          <>
            {needsReconnect && canConnect && (
              <ButtonLink href={connectHref} prefetch={false} icon={<Link2 className="h-4 w-4" aria-hidden />}>
                Reconectar
              </ButtonLink>
            )}
            {!needsReconnect && canSync && (
              <Button variant="ghost" size="sm" disabled={pending} onClick={sync} icon={<RefreshCw className={pending ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden />}>
                Sincronizar ahora
              </Button>
            )}
            {canConnect && (
              <Button variant="subtle" size="sm" disabled={pending} onClick={() => setConfirmOpen(true)} icon={<Unplug className="h-4 w-4" aria-hidden />}>
                Desconectar
              </Button>
            )}
          </>
        )}
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`¿Desconectar ${platformLabel[platform]}?`}
        description="Dejamos de actualizar sus números. Todo lo que ya se midió se conserva, y puedes volver a conectar cuando quieras."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button variant={purge ? "danger" : "primary"} onClick={confirmDisconnect} disabled={pending || (purge && purgeText.trim().toUpperCase() !== "BORRAR")}>
              {pending ? "Desconectando…" : purge ? "Desconectar y borrar" : "Desconectar"}
            </Button>
          </>
        }
      >
        <label className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#ff8f8f]" checked={purge} onChange={(e) => setPurge(e.target.checked)} />
          <span>
            <span className="font-medium text-white">Borrar también todo lo medido de {platformLabel[platform]}</span>
            <span className="mt-0.5 block text-muted">Piezas, métricas e histórico. No se puede deshacer. Tus guiones y tu calendario no se borran.</span>
          </span>
        </label>
        {purge && (
          <div className="mt-3">
            <label htmlFor={`purge-${platform}`} className="mb-1.5 block text-xs text-muted">
              Escribe BORRAR para confirmar
            </label>
            <input id={`purge-${platform}`} className="field" value={purgeText} onChange={(e) => setPurgeText(e.target.value)} autoComplete="off" />
          </div>
        )}
      </Dialog>
    </li>
  );
}
