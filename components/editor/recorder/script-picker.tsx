"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarCheck, Check, FileText, Mic, Video } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badges";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, formatDuration } from "@/lib/format";
import { formatLabel, statusLabel, statusTone, type ScriptStatus } from "@/lib/scripts/labels";
import { cn } from "@/lib/utils";
import type { ScriptChoice } from "@/lib/dal/recording";

const MAX = 20;

/**
 * Primer paso del "Día de grabación": elegir qué guiones se graban hoy (de "Tu semana lista" y de Guiones) y en qué
 * orden. Se graban seguidos y cada toma se vuelve su propio video del Editor.
 */
export function ScriptPicker({ week, scripts }: { week: { weekStart: string; scripts: ScriptChoice[] } | null; scripts: ScriptChoice[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>(() => (week ? week.scripts.filter((s) => !s.recorded).map((s) => s.id).slice(0, MAX) : []));
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX ? cur : [...cur, id]));
  const all = [...(week?.scripts ?? []), ...scripts];
  const seconds = picked.reduce((sum, id) => sum + (all.find((s) => s.id === id)?.estimatedSeconds ?? 45), 0);

  if (all.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="h-5 w-5" aria-hidden />}
        title="Todavía no tienes guiones para grabar"
        description="Escribe un guion (o arma tu semana con el autopiloto) y vuelve: lo lees en el teleprompter mientras grabas. También puedes grabar sin guion."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <ButtonLink href="/guiones/nuevo" icon={<FileText className="h-4 w-4" aria-hidden />}>
              Escribir un guion
            </ButtonLink>
            <ButtonLink href="/editor/grabar?libre=1" variant="ghost" icon={<Video className="h-4 w-4" aria-hidden />}>
              Grabar sin guion
            </ButtonLink>
          </div>
        }
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        {week && week.scripts.length > 0 && (
          <Group
            title="De tu semana lista"
            description={`Los guiones del autopiloto para la semana del ${formatDate(week.weekStart)}. Ya marcamos los que todavía no grabaste.`}
            icon={<CalendarCheck className="h-4 w-4" aria-hidden />}
            items={week.scripts}
            picked={picked}
            onToggle={toggle}
          />
        )}
        <Group
          title={week ? "Otros guiones" : "Tus guiones"}
          description="Los más recientes primero. Elige en el orden en que los quieres grabar."
          icon={<FileText className="h-4 w-4" aria-hidden />}
          items={scripts}
          picked={picked}
          onToggle={toggle}
        />
      </div>

      <aside className="sticky bottom-3 z-10 flex flex-col gap-4 lg:top-6 lg:bottom-auto lg:self-start">
        <div className="card flex flex-col gap-4 p-5 shadow-[0_-12px_40px_rgba(2,6,26,0.8)] lg:shadow-none">
          <div>
            <p className="eyebrow mb-1.5">Día de grabación</p>
            <p className="text-2xl font-bold text-white tabular-nums">{picked.length === 0 ? "Elige tus guiones" : picked.length === 1 ? "1 guion" : `${picked.length} guiones`}</p>
            <p className="mt-1 hidden text-sm text-muted sm:block">
              {picked.length ? `Unos ${formatDuration(seconds)} de grabación, sin contar repeticiones.` : "Elige uno o más guiones para grabarlos seguidos."}
            </p>
          </div>
          {picked.length > 0 && (
            <ol className="hidden flex-col gap-1.5 text-sm lg:flex">
              {picked.map((id, i) => (
                <li key={id} className="flex items-center gap-2">
                  <span className="grid h-6 w-6 flex-none place-items-center rounded-full border border-accent-hi/60 font-mono text-[11px] font-bold text-accent-glow">{i + 1}</span>
                  <span className="truncate text-text">{all.find((s) => s.id === id)?.title}</span>
                </li>
              ))}
            </ol>
          )}
          <Button disabled={!picked.length} icon={<Mic className="h-4 w-4" aria-hidden />} onClick={() => router.push(`/editor/grabar?guiones=${picked.join(",")}`)}>
            Empezar a grabar
          </Button>
          <p className="text-xs text-muted">
            <span className="hidden sm:inline">Cada toma se vuelve su propio video del Editor. </span>
            <Link href="/editor/grabar?libre=1" className="font-semibold text-accent-hi hover:underline">
              Grabar sin guion
            </Link>
          </p>
        </div>
      </aside>
    </div>
  );
}

function Group({
  title,
  description,
  icon,
  items,
  picked,
  onToggle,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  items: ScriptChoice[];
  picked: string[];
  onToggle: (id: string) => void;
}) {
  if (!items.length) return null;
  return (
    <section className="section-shell" aria-label={title}>
      <header className="mb-4 flex items-start gap-3">
        <span className="tile-icon h-9 w-9 flex-none">{icon}</span>
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        </div>
      </header>
      <ul className="grid gap-2 md:grid-cols-2">
        {items.map((s) => {
          const order = picked.indexOf(s.id);
          const on = order !== -1;
          return (
            <li key={s.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => onToggle(s.id)}
                className={cn("flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition", on ? "border-accent bg-accent/12" : "border-white/10 hover:border-white/25")}
              >
                <span className={cn("mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-lg border font-mono text-[11px] font-bold", on ? "border-accent-hi bg-accent text-white" : "border-white/25 text-transparent")} aria-hidden>
                  {on ? order + 1 : <Check className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-sm font-semibold text-white">{s.title}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <StatusBadge tone={statusTone[s.status as ScriptStatus] ?? "neutral"}>{statusLabel[s.status as ScriptStatus] ?? s.status}</StatusBadge>
                    <span>{formatLabel[s.format as keyof typeof formatLabel] ?? s.format}</span>
                    {s.estimatedSeconds ? <span>· {formatDuration(s.estimatedSeconds)}</span> : null}
                    {s.recorded && s.status !== "RECORDED" && <span>· ya grabado</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
