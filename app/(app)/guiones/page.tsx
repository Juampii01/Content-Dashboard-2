import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Copy, FilePlus2, ScrollText } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/badges";
import { Skeleton } from "@/components/ui/feedback";
import { countScriptsByStatus, listScripts } from "@/lib/dal/scripts";
import { formatDuration, formatRelative } from "@/lib/format";
import { formatLabel, statusLabel, statusTone, type ScriptStatus } from "@/lib/scripts/labels";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Guiones" };

const tabs: { key: string; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "DRAFT", label: "Borradores" },
  { key: "READY", label: "Listos para grabar" },
  { key: "RECORDED", label: "Grabados" },
  { key: "PUBLISHED", label: "Publicados" },
  { key: "ARCHIVED", label: "Archivados" },
];

async function ScriptList({ searchParams }: { searchParams: PageProps<"/guiones">["searchParams"] }) {
  const params = await searchParams;
  const status = typeof params.estado === "string" ? params.estado : "todos";
  const [scripts, counts] = await Promise.all([listScripts(status), countScriptsByStatus()]);
  const total = Object.entries(counts).filter(([k]) => k !== "ARCHIVED").reduce((a, [, n]) => a + n, 0);

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Filtrar por estado" className="flex flex-wrap gap-1.5">
        {tabs.map((t) => {
          const n = t.key === "todos" ? total : (counts[t.key] ?? 0);
          const active = status === t.key;
          return (
            <Link
              key={t.key}
              href={t.key === "todos" ? "/guiones" : `/guiones?estado=${t.key}`}
              aria-current={active ? "page" : undefined}
              className={cn("pill transition", active ? "!border-accent/60 !bg-accent/20 !text-white" : "hover:!text-white")}
            >
              {t.label} <span className="font-mono text-[10px] opacity-70">{n}</span>
            </Link>
          );
        })}
      </nav>

      {scripts.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-5 w-5" aria-hidden />}
          title={total === 0 ? "Todavía no tienes guiones" : "No hay guiones en este estado"}
          description={total === 0 ? "Escribe tu primer guion con tu voz: le das una idea y te devuelve 5 ganchos, el cuerpo, el CTA y el caption." : undefined}
          action={
            <ButtonLink href="/guiones/nuevo" icon={<FilePlus2 className="h-4 w-4" aria-hidden />}>
              Nuevo guion
            </ButtonLink>
          }
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {scripts.map((s) => (
            <li key={s.id}>
              <Link href={`/guiones/${s.id}`} className="card card-lift flex h-full flex-col gap-3 p-5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <StatusBadge tone={statusTone[s.status as ScriptStatus]}>{statusLabel[s.status as ScriptStatus]}</StatusBadge>
                  <span>{formatLabel[s.format]}</span>
                  {s.estimatedSeconds ? <span>· {formatDuration(s.estimatedSeconds)}</span> : null}
                  {s.pillar ? <span>· {s.pillar}</span> : null}
                </div>
                <h3 className="font-semibold text-white">{s.title}</h3>
                {s.hook && <p className="line-clamp-2 text-sm text-muted">“{s.hook}”</p>}
                <span className="mt-auto text-xs text-placeholder">Editado {formatRelative(s.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function GuionesPage({ searchParams }: PageProps<"/guiones">) {
  return (
    <>
      <PageHeader
        eyebrow="Guiones"
        title="Guiones que suenan a ti"
        description="Le das una idea y te devuelve 5 ganchos, el cuerpo, el CTA y el caption, con tu voz y lo que ya te funcionó."
        icon={<ScrollText className="h-5 w-5" aria-hidden />}
        actions={
          <>
            <ButtonLink href="/guiones/copiar" variant="ghost" icon={<Copy className="h-4 w-4" aria-hidden />}>
              Copia este reel
            </ButtonLink>
            <ButtonLink href="/guiones/nuevo" icon={<FilePlus2 className="h-4 w-4" aria-hidden />}>
              Nuevo guion
            </ButtonLink>
          </>
        }
      />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <ScriptList searchParams={searchParams} />
      </Suspense>
    </>
  );
}
