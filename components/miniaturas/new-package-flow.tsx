"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, FileText, MonitorPlay, PenLine, Sparkles } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Field, Textarea } from "@/components/ui/field";
import { Steps } from "@/components/ui/steps";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { formatCompact, formatDate, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createPackageAction } from "./actions";

type Kind = "guion" | "video" | "pieza" | "tema";
export type SourceLists = {
  scripts: { id: string; title: string; format: string; updatedAt: string }[];
  videos: { id: string; title: string; format: string; updatedAt: string }[];
  pieces: { id: string; title: string | null; type: string; publishedAt: string; views: number | null; thumbnail: string | null }[];
};

const KINDS: { value: Kind; label: string; icon: React.ReactNode }[] = [
  { value: "guion", label: "Guion", icon: <FileText className="h-4 w-4" aria-hidden /> },
  { value: "video", label: "Video del Editor", icon: <Clapperboard className="h-4 w-4" aria-hidden /> },
  { value: "pieza", label: "Video publicado", icon: <MonitorPlay className="h-4 w-4" aria-hidden /> },
  { value: "tema", label: "Tema", icon: <PenLine className="h-4 w-4" aria-hidden /> },
];

/** "Nuevo": de qué es el video (guion, video del Editor, video ya publicado o un tema) y en qué formato. */
export function NewPackageFlow({ lists, preset, aiReady, canEdit }: { lists: SourceLists; preset: { kind: Kind; id: string } | null; aiReady: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>(preset?.kind ?? (lists.scripts.length ? "guion" : lists.videos.length ? "video" : lists.pieces.length ? "pieza" : "tema"));
  const [selected, setSelected] = useState<string | null>(preset?.id ?? null);
  const [topic, setTopic] = useState("");
  const [format, setFormat] = useState<"VIDEO" | "SHORT">("VIDEO");
  const [pending, start] = useTransition();

  const items =
    kind === "guion"
      ? lists.scripts.map((s) => ({ id: s.id, title: s.title, detail: `Guion · ${s.format === "YT_LONG" ? "YouTube largo" : s.format === "SHORT" ? "Short" : s.format === "STORY" ? "Historias" : "Reel"} · editado ${formatRelative(s.updatedAt)}`, thumb: null as string | null, format: s.format === "YT_LONG" ? "VIDEO" : "SHORT" }))
      : kind === "video"
        ? lists.videos.map((v) => ({ id: v.id, title: v.title, detail: `Video del Editor · ${v.format} · ${formatRelative(v.updatedAt)}`, thumb: null, format: v.format === "16:9" ? "VIDEO" : "SHORT" }))
        : kind === "pieza"
          ? lists.pieces.map((p) => ({ id: p.id, title: p.title ?? "Sin título", detail: `${p.type === "SHORT" ? "Short" : "Video"} · ${formatDate(p.publishedAt)}${p.views != null ? ` · ${formatCompact(p.views)} vistas` : ""}`, thumb: p.thumbnail, format: p.type === "SHORT" ? "SHORT" : "VIDEO" }))
          : [];
  const ready = kind === "tema" ? topic.trim().length >= 8 : Boolean(selected && items.some((i) => i.id === selected));

  const pick = (id: string, fmt: string) => {
    setSelected(id);
    setFormat(fmt === "SHORT" ? "SHORT" : "VIDEO");
  };

  const create = () =>
    start(async () => {
      const res = await createPackageAction({ kind, id: kind === "tema" ? null : selected, topic: kind === "tema" ? topic : null, format });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.push(`/miniaturas/${res.id}`);
    });

  if (!canEdit) return <Notice tone="warning">Tu usuario es de solo lectura: no puede crear títulos ni miniaturas.</Notice>;

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <Steps
          steps={[
            { id: "origen", label: "De qué es el video", state: ready ? "done" : "active" },
            { id: "formato", label: "Formato", state: ready ? "active" : "pending" },
            { id: "crear", label: "Títulos y miniaturas", state: "pending" },
          ]}
        />
      </aside>

      <div className="flex min-w-0 flex-col gap-6">
        <section className="section-shell flex flex-col gap-4" aria-labelledby="paso-1">
          <div>
            <p className="eyebrow mb-1">Paso 1</p>
            <h2 id="paso-1" className="text-lg font-semibold">
              ¿De qué es el video?
            </h2>
            <p className="mt-1 text-sm text-muted">Con el contenido completo, los títulos y las miniaturas prometen lo que el video cumple.</p>
          </div>
          <SegmentedControl
            label="Origen"
            options={KINDS.map((k) => ({ value: k.value, label: k.label, icon: k.icon }))}
            value={kind}
            onValueChange={(v) => {
              setKind(v);
              setSelected(null);
            }}
            className="flex-wrap"
          />
          {kind === "tema" ? (
            <Field label="Tema del video" htmlFor="topic" hint="Una o dos frases: de qué trata, a quién le sirve y qué resultado promete.">
              <Textarea id="topic" rows={4} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Cómo conseguir tus primeros 3 clientes de agencia de IA sin pagar anuncios" />
            </Field>
          ) : items.length === 0 ? (
            <Notice>
              {kind === "guion" ? "Todavía no tienes guiones." : kind === "video" ? "Todavía no hay videos con transcripción en el Editor." : "Todavía no hay videos de YouTube en Métricas. Conecta YouTube en Ajustes."}{" "}
              <ButtonLink href={kind === "guion" ? "/guiones/nuevo" : kind === "video" ? "/editor/nuevo" : "/ajustes"} variant="subtle" size="sm" className="ml-1">
                {kind === "guion" ? "Escribir un guion" : kind === "video" ? "Subir un video" : "Ir a Ajustes"}
              </ButtonLink>
            </Notice>
          ) : (
            <ul role="radiogroup" aria-label="Elige el origen" className="grid max-h-[420px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {items.map((item) => {
                const active = selected === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => pick(item.id, item.format)}
                      className={cn("flex w-full items-center gap-3 rounded-xl border p-3 text-left transition", active ? "border-accent bg-accent/15" : "border-white/10 hover:border-line-strong hover:bg-white/[0.03]")}
                    >
                      {item.thumb && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.thumb} alt="" referrerPolicy="no-referrer" className="h-12 w-20 flex-none rounded-lg object-cover" />
                      )}
                      <span className="min-w-0">
                        <span className="line-clamp-2 block text-sm font-semibold text-white">{item.title}</span>
                        <span className="mt-0.5 block text-xs text-muted">{item.detail}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="section-shell flex flex-col gap-4" aria-labelledby="paso-2">
          <div>
            <p className="eyebrow mb-1">Paso 2</p>
            <h2 id="paso-2" className="text-lg font-semibold">
              Formato
            </h2>
            <p className="mt-1 text-sm text-muted">Los títulos de un short son más cortos y directos; los de un video largo prometen más.</p>
          </div>
          <SegmentedControl
            label="Formato"
            options={[
              { value: "VIDEO", label: "Video largo" },
              { value: "SHORT", label: "Short" },
            ]}
            value={format}
            onValueChange={setFormat}
          />
          <div className="flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted">Te damos 8 a 10 títulos por ángulo y 3 miniaturas con tu foto y tus colores. Los fondos se generan después, cuando los pidas.</p>
            <Button className="flex-none" disabled={!ready || pending || !aiReady} onClick={create} icon={<Sparkles className={pending ? "h-4 w-4 animate-pulse" : "h-4 w-4"} aria-hidden />}>
              {pending ? "Escribiendo…" : "Crear títulos y miniaturas"}
            </Button>
          </div>
          {!aiReady && <Notice tone="warning">La IA no está configurada en esta instalación. Avísale a soporte.</Notice>}
        </section>
      </div>
    </div>
  );
}
