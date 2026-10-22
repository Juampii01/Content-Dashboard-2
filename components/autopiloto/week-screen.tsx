"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArchiveRestore, CalendarCheck, Check, CheckCheck, ExternalLink, Loader2, Palette, PencilLine, RefreshCw, Sparkles, TriangleAlert, Wand2, X } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice, Progress, Skeleton } from "@/components/ui/feedback";
import { Input, Select, Textarea } from "@/components/ui/field";
import { PlatformBadge } from "@/components/ui/platform";
import { StatusBadge } from "@/components/ui/badges";
import { toast } from "@/components/ui/toast";
import { addDays, dayLong } from "@/lib/calendar/dates";
import { calendarStatusColor, calendarStatusLabel, plannedFormatLabel } from "@/lib/calendar/labels";
import type { AutopilotView, WeekItem } from "@/lib/dal/autopilot";
import { formatDate, formatDateRange, formatDuration, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { approveAllAction, approveItemAction, buildNowAction, discardItemAction, editItemAction, restoreItemAction, resumePackAction, retryItemAction, saveSettingsAction } from "./actions";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * "Tu semana lista": el paquete que deja el autopiloto (plan + guiones + borradores de carrusel) para aprobar,
 * editar o descartar pieza por pieza, y el ajuste para encenderlo y elegir cuántas piezas por semana.
 */
export function WeekScreen({ view }: { view: AutopilotView }) {
  const router = useRouter();
  const pack = view.pack;
  const generating = pack?.status === "GENERATING" && !pack.stale;

  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [generating, router]);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="flex min-w-0 flex-col gap-6">
        {!view.brandReady && (
          <Notice tone="warning" title="Primero completa Mi marca">
            El plan sale de tus pilares, tus ofertas y lo que ya te funcionó. <a href="/marca" className="font-semibold underline underline-offset-2">Completar Mi marca</a>
          </Notice>
        )}
        {!pack ? <NoPack view={view} /> : pack.status === "GENERATING" && !pack.stale ? <Generating view={view} /> : pack.status === "FAILED" || pack.stale ? <Failed view={view} /> : <Ready view={view} />}
      </div>
      <SettingsCard view={view} />
    </div>
  );
}

function BuildNowButton({ view, label = "Armar mi semana ahora" }: { view: AutopilotView; label?: string }) {
  const [pending, start] = useTransition();
  if (!view.canEdit) return null;
  return (
    <Button
      disabled={pending || !view.brandReady || !view.aiReady}
      icon={pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Wand2 className="h-4 w-4" aria-hidden />}
      onClick={() =>
        start(async () => {
          const res = await buildNowAction();
          if (!res.ok) toast.error(res.error);
        })
      }
    >
      {label}
    </Button>
  );
}

function NoPack({ view }: { view: AutopilotView }) {
  const nextWeek = view.manualWeek > view.today;
  return (
    <EmptyState
      icon={<Sparkles className="h-6 w-6" aria-hidden />}
      title={view.enabled ? "Tu próxima semana llega el lunes" : "Tu semana, escrita cada lunes"}
      description={
        view.enabled
          ? `El lunes a las 9:00 vas a tener ${view.effectivePieces === 1 ? "1 pieza" : `${view.effectivePieces} piezas`} con sus guiones y carruseles listos para aprobar. Si no quieres esperar, ármala ahora.`
          : `Enciende el autopiloto y cada lunes preparamos tu semana: el plan, los guiones escritos y los borradores de carrusel, apoyados en lo que mejor te funcionó. Tú apruebas, editas o descartas.`
      }
      action={
        <>
          <BuildNowButton view={view} label={nextWeek ? "Armar la semana que viene" : "Armar mi semana ahora"} />
          {!view.brandReady && (
            <ButtonLink href="/marca" variant="ghost" icon={<Palette className="h-4 w-4" aria-hidden />}>
              Completar Mi marca
            </ButtonLink>
          )}
        </>
      }
    />
  );
}

function Generating({ view }: { view: AutopilotView }) {
  const pack = view.pack!;
  const total = pack.items.length;
  const done = pack.items.filter((i) => i.genStatus !== "pending").length;
  const pct = total ? 15 + (done / total) * 85 : 8;
  return (
    <section className="section-shell flex flex-col gap-5" aria-busy="true">
      <div>
        <p className="eyebrow mb-1">Semana del {formatDateRange(pack.weekStart, addDays(pack.weekStart, 6))}</p>
        <h2 className="text-lg font-semibold text-white">Estamos armando tu semana</h2>
        <p className="mt-1 text-sm text-muted">{total ? `Escribiendo guiones y carruseles: ${done} de ${total} listos.` : "Revisando tus pilares, lo que mejor te funcionó y lo que ya tienes programado…"} Puedes salir y volver: te avisamos cuando esté lista.</p>
      </div>
      <Progress value={pct} label={total ? "Piezas escritas" : "Planeando"} />
      <ul className="flex flex-col gap-3">
        {(total ? pack.items : [null, null, null]).map((item, i) =>
          item ? (
            <li key={item.id} className="card flex items-center gap-3 p-4">
              {item.genStatus === "pending" ? <Loader2 className="h-4 w-4 flex-none animate-spin text-accent-hi" aria-hidden /> : item.genStatus === "ready" ? <Check className="h-4 w-4 flex-none text-success" aria-hidden /> : <TriangleAlert className="h-4 w-4 flex-none text-warning" aria-hidden />}
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{item.title}</span>
              <span className="pill">{plannedFormatLabel[item.format]}</span>
            </li>
          ) : (
            <Skeleton key={i} className="h-16" />
          ),
        )}
      </ul>
    </section>
  );
}

function Failed({ view }: { view: AutopilotView }) {
  const pack = view.pack!;
  const [pending, start] = useTransition();
  return (
    <section className="section-shell flex flex-col gap-4">
      <p className="eyebrow">Semana del {formatDateRange(pack.weekStart, addDays(pack.weekStart, 6))}</p>
      <Notice tone="danger" title="No pudimos armar tu semana">
        {pack.stale ? "La preparación se interrumpió antes de terminar." : (pack.errorMessage ?? "Algo falló al preparar las piezas.")} Vuelve a intentarlo: las piezas que ya estaban escritas se conservan.
      </Notice>
      {view.canEdit && (
        <div>
          <Button
            disabled={pending}
            icon={<RefreshCw className={cn("h-4 w-4", pending && "animate-spin")} aria-hidden />}
            onClick={() =>
              start(async () => {
                const res = await resumePackAction(pack.weekStart);
                if (!res.ok) toast.error(res.error);
              })
            }
          >
            Volver a intentar
          </Button>
        </div>
      )}
      {pack.items.length > 0 && <ItemList view={view} />}
    </section>
  );
}

function Ready({ view }: { view: AutopilotView }) {
  const pack = view.pack!;
  const [pending, start] = useTransition();
  const waiting = pack.items.filter((i) => i.decision === "pending" && i.genStatus === "ready").length;
  const approved = pack.items.filter((i) => i.decision === "approved").length;
  const discarded = pack.items.filter((i) => i.decision === "discarded").length;
  return (
    <section className="flex flex-col gap-4">
      <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <p className="eyebrow mb-1">Semana del {formatDateRange(pack.weekStart, addDays(pack.weekStart, 6))}</p>
          <h2 className="text-lg font-semibold text-white">{waiting ? `${waiting === 1 ? "1 pieza espera" : `${waiting} piezas esperan`} tu aprobación` : approved ? "Tu semana está aprobada" : "No quedan piezas por aprobar"}</h2>
          <p className="mt-1 text-sm text-muted">
            {formatNumber(approved)} {approved === 1 ? "aprobada" : "aprobadas"} · {formatNumber(discarded)} {discarded === 1 ? "descartada" : "descartadas"} · Preparada {pack.trigger === "cron" ? "por el autopiloto" : "a pedido"} el {formatDate(pack.createdAt)}
          </p>
        </div>
        {view.canEdit && waiting > 0 && (
          <Button
            disabled={pending}
            icon={pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCheck className="h-4 w-4" aria-hidden />}
            onClick={() =>
              start(async () => {
                const res = await approveAllAction(pack.weekStart);
                if (!res.ok) return void toast.error(res.error);
                toast.success(res.data!.approved === 1 ? "Listo: 1 pieza en tu calendario." : `Listo: ${res.data!.approved} piezas en tu calendario.`);
              })
            }
          >
            Aprobar {waiting === 1 ? "la pieza" : `las ${waiting}`}
          </Button>
        )}
        {!waiting && approved > 0 && (
          <ButtonLink href={`/calendario?vista=semana&fecha=${pack.weekStart}`} variant="ghost" icon={<CalendarCheck className="h-4 w-4" aria-hidden />}>
            Ver en el calendario
          </ButtonLink>
        )}
      </div>
      <ItemList view={view} />
    </section>
  );
}

function ItemList({ view }: { view: AutopilotView }) {
  const pack = view.pack!;
  const days = Array.from({ length: 7 }, (_, i) => addDays(pack.weekStart, i)).filter((d) => d > view.today);
  return (
    <ul className="stagger flex flex-col gap-4">
      {pack.items.map((item) => (
        <ItemCard key={item.id} item={item} days={days} canEdit={view.canEdit} />
      ))}
    </ul>
  );
}

function ItemCard({ item, days, canEdit }: { item: WeekItem; days: string[]; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [hook, setHook] = useState(item.hook ?? "");
  const [date, setDate] = useState(item.scheduledDate ?? "");
  const [pending, start] = useTransition();
  const discarded = item.decision === "discarded";
  const approved = item.decision === "approved";
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Algo salió mal.");
      if (success) toast.success(success);
    });
  const dateOptions = item.scheduledDate && !days.includes(item.scheduledDate) ? [item.scheduledDate, ...days] : days;
  const openHref = item.carousel ? `/carruseles/${item.carousel.id}` : item.script ? `/guiones/${item.script.id}` : null;

  return (
    <li className={cn("card flex flex-col gap-4 p-5 transition", discarded && "opacity-60", approved && "border-success/30")} aria-label={item.title}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold tracking-wide text-accent-glow uppercase">{item.scheduledDate ? cap(dayLong(item.scheduledDate)) : "Sin fecha"}</span>
        <span className="pill">{plannedFormatLabel[item.format]}</span>
        {item.pillar && <span className="pill !border-accent/40 !bg-accent/10 !text-accent-glow">{item.pillar}</span>}
        {item.platforms.map((p) => (
          <PlatformBadge key={p} platform={p} />
        ))}
        <span className="ml-auto">
          {approved && item.entry ? (
            <StatusBadge tone="success" icon={<span className="h-2 w-2 rounded-full" style={{ background: calendarStatusColor[item.entry.status] }} />}>
              En el calendario · {calendarStatusLabel[item.entry.status]}
            </StatusBadge>
          ) : discarded ? (
            <StatusBadge tone="neutral">Descartada</StatusBadge>
          ) : item.genStatus === "failed" ? (
            <StatusBadge tone="warning">No se pudo escribir</StatusBadge>
          ) : item.genStatus === "pending" ? (
            <StatusBadge tone="info">Escribiendo</StatusBadge>
          ) : (
            <StatusBadge tone="info" icon={null}>
              Por aprobar
            </StatusBadge>
          )}
        </span>
      </div>

      {editing ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`t-${item.id}`} className="text-xs font-semibold text-white">
              Título
            </label>
            <Input id={`t-${item.id}`} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`h-${item.id}`} className="text-xs font-semibold text-white">
              Gancho
            </label>
            <Textarea id={`h-${item.id}`} value={hook} rows={2} maxLength={600} onChange={(e) => setHook(e.target.value)} className="min-h-0" />
          </div>
          <div className="flex flex-col gap-1.5 sm:max-w-xs">
            <label htmlFor={`d-${item.id}`} className="text-xs font-semibold text-white">
              Día
            </label>
            <Select id={`d-${item.id}`} value={date} onChange={(e) => setDate(e.target.value)}>
              {dateOptions.map((d) => (
                <option key={d} value={d}>
                  {cap(dayLong(d))}
                </option>
              ))}
              <option value="">Sin fecha</option>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending}
              icon={pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
              onClick={() =>
                start(async () => {
                  const res = await editItemAction(item.id, { title, hook, scheduledDate: date || null });
                  if (!res.ok) return void toast.error(res.error);
                  setEditing(false);
                  toast.success("Cambios guardados.");
                })
              }
            >
              Guardar
            </Button>
            <Button size="sm" variant="subtle" onClick={() => (setEditing(false), setTitle(item.title), setHook(item.hook ?? ""), setDate(item.scheduledDate ?? ""))}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <h3 className="text-base font-semibold text-white">{item.title}</h3>
          {item.hook && <p className="mt-1 text-sm leading-relaxed text-text">“{item.hook}”</p>}
          {item.why && <p className="mt-2 text-xs leading-relaxed text-muted">{item.why}</p>}
        </div>
      )}

      {item.genStatus === "failed" && item.genError && <Notice tone="warning">{item.genError}</Notice>}

      {!editing && (item.script || item.carousel) && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          {item.script && (
            <>
              <p className="text-xs text-muted">
                Guion escrito · {formatNumber(item.script.beats)} bloques{item.script.estimatedSeconds ? ` · ≈ ${formatDuration(item.script.estimatedSeconds)}` : ""}
              </p>
              {item.script.hooks.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {item.script.hooks.map((h, i) => (
                    <li key={i} className={cn("text-sm", i === 0 ? "text-white" : "text-text/75")}>
                      <span className="mr-2 font-mono text-xs text-accent-glow">G{i + 1}</span>
                      {h}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {item.carousel && (
            <>
              <p className="text-xs text-muted">Carrusel en borrador · {formatNumber(item.carousel.slides)} slides · las imágenes las generas en Carruseles</p>
              <ol className="mt-2 flex flex-col gap-1">
                {item.carousel.headlines.slice(0, 4).map((h, i) => (
                  <li key={i} className={cn("text-sm", i === 0 ? "text-white" : "text-text/75")}>
                    <span className="mr-2 font-mono text-xs text-accent-glow">{String(i + 1).padStart(2, "0")}</span>
                    {h}
                  </li>
                ))}
                {item.carousel.slides > 4 && <li className="text-xs text-muted">y {formatNumber(item.carousel.slides - 4)} slides más</li>}
              </ol>
            </>
          )}
        </div>
      )}

      {canEdit && !editing && (
        <ItemActions>
          {discarded ? (
            <Button size="sm" variant="ghost" disabled={pending} icon={<ArchiveRestore className="h-4 w-4" aria-hidden />} onClick={() => run(() => restoreItemAction(item.id), "Pieza recuperada.")}>
              Recuperar
            </Button>
          ) : (
            <>
              {!approved && item.genStatus === "ready" && (
                <Button size="sm" disabled={pending} icon={pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} onClick={() => run(() => approveItemAction(item.id), item.scheduledDate ? `Aprobada: queda en tu calendario el ${formatDate(item.scheduledDate, { withYear: false })}.` : "Aprobada: queda en tu calendario sin fecha.")}>
                  Aprobar
                </Button>
              )}
              {item.genStatus === "failed" && (
                <Button size="sm" variant="ghost" disabled={pending} icon={<RefreshCw className={cn("h-4 w-4", pending && "animate-spin")} aria-hidden />} onClick={() => run(() => retryItemAction(item.id), "Pieza escrita.")}>
                  Reintentar
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={pending} icon={<PencilLine className="h-4 w-4" aria-hidden />} onClick={() => setEditing(true)}>
                Editar
              </Button>
              {openHref && (
                <ButtonLink href={openHref} size="sm" variant="ghost" icon={<ExternalLink className="h-4 w-4" aria-hidden />}>
                  {item.carousel ? "Abrir carrusel" : "Abrir guion"}
                </ButtonLink>
              )}
              <Button size="sm" variant="subtle" disabled={pending} icon={<X className="h-4 w-4" aria-hidden />} onClick={() => run(() => discardItemAction(item.id), approved ? "Descartada y fuera del calendario." : "Pieza descartada.")} className="sm:ml-auto">
                Descartar
              </Button>
            </>
          )}
        </ItemActions>
      )}
    </li>
  );
}

function ItemActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">{children}</div>;
}

function SettingsCard({ view }: { view: AutopilotView }) {
  const [enabled, setEnabled] = useState(view.enabled);
  const [pieces, setPieces] = useState<string>(view.piecesPerWeek == null ? "" : String(view.piecesPerWeek));
  const [pending, start] = useTransition();

  function save(next: { enabled: boolean; pieces: string }) {
    const prev = { enabled, pieces };
    setEnabled(next.enabled);
    setPieces(next.pieces);
    start(async () => {
      const res = await saveSettingsAction({ enabled: next.enabled, piecesPerWeek: next.pieces ? Number(next.pieces) : null });
      if (!res.ok) {
        setEnabled(prev.enabled);
        setPieces(prev.pieces);
        return void toast.error(res.error);
      }
      if (next.enabled !== prev.enabled) toast.success(next.enabled ? "Autopiloto encendido: el lunes tendrás tu semana lista." : "Autopiloto apagado.");
    });
  }

  const goalLabel = view.weeklyGoal ? `Tu meta semanal (${view.weeklyGoal})` : "Automático (3)";
  return (
    <aside className="flex min-w-0 flex-col gap-4">
      <div className="card flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow mb-1">Autopiloto semanal</p>
            <p className="text-sm font-semibold text-white">{enabled ? "Encendido" : "Apagado"}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{enabled ? "Cada lunes a las 9:00 preparamos tu semana y te avisamos aquí y por correo." : "Enciéndelo y cada lunes tendrás tu semana lista para aprobar."}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Autopiloto semanal"
            disabled={!view.canEdit || pending}
            onClick={() => save({ enabled: !enabled, pieces })}
            className={cn("relative h-7 w-12 flex-none rounded-full border transition disabled:opacity-50", enabled ? "border-accent-hi bg-accent" : "border-white/20 bg-white/10")}
          >
            <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", enabled ? "left-6" : "left-0.5")} />
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="autopilot-pieces" className="text-xs font-semibold text-white">
            Piezas por semana
          </label>
          <Select id="autopilot-pieces" value={pieces} disabled={!view.canEdit || pending} onChange={(e) => save({ enabled, pieces: e.target.value })}>
            <option value="">{goalLabel}</option>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "1 pieza" : `${n} piezas`}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted">Una por día como máximo. Si la semana ya empezó, solo se usan los días que quedan.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs leading-relaxed text-muted">
          <p>
            <span className="font-semibold text-white">Consumo estimado:</span> ≈ {formatNumber(view.estimatedTokens)} tokens de IA por semana.
          </p>
          <p className="mt-1">
            Tope: {formatNumber(view.budget)} tokens cada 7 días (llevas {formatNumber(view.usedLast7Days)}). Si se llega al tope, la semana se arma con menos piezas.
          </p>
        </div>
        {view.pack && view.canEdit && view.manualWeek > view.pack.weekStart && <BuildNowButton view={view} label="Armar la semana que viene" />}
      </div>
      <div className="card p-5 text-xs leading-relaxed text-muted">
        <p className="eyebrow mb-2">Cómo funciona</p>
        <ol className="flex list-decimal flex-col gap-1.5 pl-4">
          <li>El lunes planeamos la semana con tus pilares, tus ganchos que mejor rinden, tus mejores piezas y las ideas de tus informes.</li>
          <li>Escribimos cada guion y la ficha de cada carrusel.</li>
          <li>Tú apruebas, editas o descartas. Solo lo aprobado entra al calendario.</li>
        </ol>
      </div>
    </aside>
  );
}
