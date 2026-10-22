import Link from "next/link";
import { ArrowRight, CheckCircle2, Cpu, Link2, PlugZap, ServerCog, TriangleAlert } from "lucide-react";
import { Section } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badges";
import { ButtonLink } from "@/components/ui/button";
import { PlatformBadge } from "@/components/ui/platform";
import { getSystemStatus } from "@/lib/dal/system";
import { formatDate, formatRelative } from "@/lib/format";
import { SystemRetryButton } from "./system-retry";

/**
 * Ajustes → Estado del sistema (solo el dueño): el worker, lo que falló en la semana con su botón para reintentar,
 * las conexiones con problemas y las claves o servicios que faltan. Todo en lenguaje claro y sin secretos.
 */
export async function SystemSection() {
  const status = await getSystemStatus();
  if (!status) return null;
  const { worker, failures, connections, services, problemCount } = status;

  return (
    <div id="estado" className="scroll-mt-6">
      <Section
        title="Estado del sistema"
        description="Si algo deja de funcionar, aquí ves qué pasó y qué hacer. Solo lo ves tú, como dueño de la cuenta."
        actions={
          problemCount === 0 ? (
            <StatusBadge tone="success">Todo funciona</StatusBadge>
          ) : (
            <StatusBadge tone="warning">{problemCount === 1 ? "1 cosa para revisar" : `${problemCount} cosas para revisar`}</StatusBadge>
          )
        }
      >
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card flex flex-col gap-3 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="tile-icon h-10 w-10">
                  <Cpu className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 basis-48">
                  <h3 className="font-semibold">Servicio de procesamiento</h3>
                  <p className="text-xs text-muted">Edita tus videos, saca clips y genera imágenes.</p>
                </div>
                <StatusBadge tone={worker.tone}>{worker.label}</StatusBadge>
              </div>
              <p className="text-sm leading-relaxed text-muted">{worker.message}</p>
              <dl className="grid grid-cols-2 gap-3 border-t border-white/10 pt-3 text-xs">
                <div>
                  <dt className="text-muted">Última vez visto</dt>
                  <dd className="mt-0.5 font-medium text-text">{worker.lastSeen ? formatRelative(worker.lastSeen) : "Nunca"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Versión</dt>
                  <dd className="mt-0.5 font-mono font-medium text-text">{worker.version ?? "—"}</dd>
                </div>
              </dl>
            </div>

            <div className="card flex flex-col gap-3 p-5">
              <div className="flex items-center gap-3">
                <span className="tile-icon h-10 w-10">
                  <PlugZap className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold">Conexiones con tus redes</h3>
                  <p className="text-xs text-muted">Permisos y sesiones de Instagram, YouTube y TikTok.</p>
                </div>
              </div>
              {connections.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted">
                  <CheckCircle2 className="h-4 w-4 flex-none text-success" aria-hidden />
                  Ninguna conexión tiene problemas.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {connections.map((c) => (
                    <li key={c.key} className="flex flex-col gap-2 rounded-xl border border-white/10 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <PlatformBadge platform={c.platform} />
                        <span className="min-w-0 truncate text-xs text-muted">@{c.handle.replace(/^@/, "")}</span>
                        <StatusBadge tone={c.tone} className="ml-auto">
                          {c.label}
                        </StatusBadge>
                      </div>
                      <p className="text-sm text-muted">{c.message}</p>
                      <ButtonLink href={c.reconnectHref} prefetch={false} size="sm" className="self-start" icon={<Link2 className="h-3.5 w-3.5" aria-hidden />}>
                        Volver a conectar
                      </ButtonLink>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div>
            <h3 className="mb-3 flex items-center gap-2 font-semibold">
              <TriangleAlert className="h-4 w-4 text-accent-hi" aria-hidden />
              Lo que falló en los últimos 7 días
            </h3>
            {failures.length === 0 ? (
              <p className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm text-muted">
                <CheckCircle2 className="h-4 w-4 flex-none text-success" aria-hidden />
                Nada falló esta semana. Si un video, un clip o una imagen falla, aparece aquí con su botón para reintentar.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {failures.map((f) => (
                  <li key={f.key} className="flex flex-col gap-3 rounded-xl border border-white/10 p-4 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[11px] font-semibold tracking-wide text-accent-glow uppercase">
                        {f.what} · <span title={formatDate(f.at)}>{formatRelative(f.at)}</span>
                      </p>
                      <p className="mt-1 line-clamp-1 font-medium text-white">{f.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-muted">{f.message}</p>
                    </div>
                    <div className="flex flex-none flex-wrap gap-2">
                      {f.retry && <SystemRetryButton kind={f.retry.kind} id={f.retry.id} title={f.title} />}
                      <Link href={f.href} className="inline-flex items-center gap-1 rounded-xl px-2 py-1.5 text-xs font-semibold text-accent-hi hover:text-white">
                        {f.hrefLabel} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-3 flex items-center gap-2 font-semibold">
              <ServerCog className="h-4 w-4 text-accent-hi" aria-hidden />
              Servicios y claves
            </h3>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {services.map((s) => (
                <li key={s.key} className="flex flex-col gap-2 rounded-xl border border-white/10 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-white">{s.name}</span>
                    <StatusBadge tone={s.tone}>{s.status}</StatusBadge>
                  </div>
                  <p className="text-sm leading-relaxed text-muted">{s.message}</p>
                  {s.href && s.tone !== "success" && (
                    <Link href={s.href} className="mt-auto inline-flex items-center gap-1 self-start text-xs font-semibold text-accent-hi hover:text-white">
                      Configurar <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>
    </div>
  );
}

export function SystemSectionSkeleton() {
  return (
    <div aria-hidden className="section-shell flex flex-col gap-4">
      <div className="skeleton h-6 w-48" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="skeleton h-40" />
        <div className="skeleton h-40" />
      </div>
      <div className="skeleton h-24" />
    </div>
  );
}
