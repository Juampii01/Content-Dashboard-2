"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, Clapperboard, Download, Loader2, Pause, PencilLine, Play, RotateCcw, ScanFace, SlidersHorizontal, Undo2, Users, Volume2, VolumeX, X } from "lucide-react";
import { StatusBadge, type StatusTone } from "@/components/ui/badges";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { formatNumber, formatTimecode } from "@/lib/format";
import { cn } from "@/lib/utils";
import { validRange, WINDOW_MARGIN, type RuleKey } from "@/lib/clips/score";
import type { ClipView } from "@/lib/dal/clips";
import { createClipProjectAction, setClipDiscardedAction, updateClipRangeAction, updateClipTextAction } from "./actions";

const RULE_LABEL: Record<RuleKey, string> = {
  hook: "Gancho al inicio",
  duration: "Duración para short",
  density: "Ritmo de habla",
  pauses: "Pocas pausas",
  questions: "Preguntas",
  numbers: "Cifras concretas",
  ending: "Cierre claro",
};

const HOOK_LABEL: Record<string, string> = {
  contraste: "Contraste",
  curiosidad: "Curiosidad",
  dolor: "Dolor",
  resultado: "Resultado",
  historia: "Historia",
  pregunta: "Pregunta",
  lista: "Lista",
  otro: "Sin gancho claro",
};

const PROJECT_LABEL: Record<string, { label: string; tone: StatusTone }> = {
  UPLOADING: { label: "Preparando", tone: "info" },
  PROCESSING: { label: "Recortando y preparando", tone: "info" },
  AWAITING_REVIEW: { label: "Listo para revisar", tone: "warning" },
  RENDERING: { label: "Exportando", tone: "info" },
  DONE: { label: "Exportado", tone: "success" },
  FAILED: { label: "Con error", tone: "danger" },
};

const seconds = (n: number) => `${Math.round(n)} s`;

/** Tarjeta de un clip: vista previa vertical, puntaje con su detalle, título, gancho, por qué, rango ajustable y acciones. */
export function ClipCard({ clip, total, canEdit }: { clip: ClipView; total: number; canEdit: boolean }) {
  const [range, setRange] = useState({ from: clip.fromWord, to: clip.toWord });
  const [adjusting, setAdjusting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [detail, setDetail] = useState(false);
  const [pending, start] = useTransition();

  const byId = useMemo(() => new Map(clip.words.map((w) => [w.id, w])), [clip.words]);
  const first = byId.get(range.from);
  const last = byId.get(range.to);
  // Mientras se ajusta, la vista previa usa el tramo nuevo (con el mismo margen corto que el clip guardado).
  const playStart = adjusting && first ? Math.max(clip.windowStart, first.start - 0.15) : clip.start;
  const playEnd = adjusting && last ? Math.min(clip.windowEnd, last.end + 0.3) : clip.end;
  const project = clip.project;
  const busy = project && (project.status === "PROCESSING" || project.status === "RENDERING" || project.status === "UPLOADING");

  function run(mode: "editor" | "export") {
    start(async () => {
      const r = await createClipProjectAction(clip.id, mode);
      if (r && !r.ok) toast.error(r.error);
      else if (mode === "export") toast.success("Estamos exportando el clip. Te avisamos cuando esté listo.");
    });
  }

  return (
    <article className={cn("card overflow-hidden", clip.discarded && "opacity-60")} aria-labelledby={`clip-${clip.id}-title`}>
      <div className="grid gap-5 p-4 sm:p-5 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
        <ClipPlayer clip={clip} start={playStart} end={playEnd} />

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-start gap-4">
            <ScoreBadge score={clip.score} rank={clip.rank} total={total} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <h3 id={`clip-${clip.id}-title`} className="min-w-0 text-lg leading-snug font-semibold break-words text-white">
                  {clip.title}
                </h3>
                {canEdit && (
                  <button type="button" onClick={() => setEditing(true)} className="grid h-8 w-8 flex-none place-items-center rounded-lg text-muted transition hover:bg-white/[0.07] hover:text-white" aria-label="Editar título y gancho">
                    <PencilLine className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
                <span>
                  {formatTimecode(clip.start)} – {formatTimecode(clip.end)}
                </span>
                <span aria-hidden>·</span>
                <span>{seconds(clip.end - clip.start)}</span>
                {clip.hookType && clip.hookType !== "otro" && (
                  <>
                    <span aria-hidden>·</span>
                    <span>Gancho de {HOOK_LABEL[clip.hookType]?.toLowerCase() ?? clip.hookType}</span>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
            <p className="eyebrow mb-1 !text-[10px]">Texto de gancho sugerido</p>
            <p className="text-base font-semibold text-white">“{clip.hookText}”</p>
          </div>

          <div>
            <p className="text-sm font-semibold text-white">Por qué este momento</p>
            <p className="mt-0.5 text-sm leading-relaxed text-muted">{clip.reason}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FramingPill framing={clip.framing} />
            <button type="button" className="chip" aria-expanded={detail} onClick={() => setDetail((v) => !v)}>
              Detalle del puntaje
              <ChevronDown className={cn("h-3.5 w-3.5 transition", detail && "rotate-180")} aria-hidden />
            </button>
          </div>
          {detail && <ScoreDetailView clip={clip} />}

          {adjusting && canEdit && (
            <RangeEditor
              clip={clip}
              range={range}
              onChange={setRange}
              onCancel={() => {
                setRange({ from: clip.fromWord, to: clip.toWord });
                setAdjusting(false);
              }}
              onSaved={() => setAdjusting(false)}
            />
          )}

          {project && (
            <div className="flex flex-col gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="flex flex-none items-center gap-2">
              <StatusBadge tone={PROJECT_LABEL[project.status]?.tone ?? "neutral"}>
                {project.mode === "export" && project.status === "AWAITING_REVIEW" ? "Exportando" : (PROJECT_LABEL[project.status]?.label ?? project.status)}
              </StatusBadge>
              {busy && <Loader2 className="h-4 w-4 animate-spin text-accent-hi motion-reduce:animate-none" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1 text-muted">
                {project.status === "FAILED"
                  ? (project.errorMessage ?? "Algo falló. Ábrelo en el editor para ver qué pasó.")
                  : project.mode === "export"
                    ? project.status === "DONE"
                      ? "Con los subtítulos de tu marca."
                      : "Lo exportamos con los subtítulos de tu marca. Puedes salir: te avisamos."
                    : "Es un proyecto del Editor: suma subtítulos, gráficos, b-roll y música."}
              </span>
              <span className="flex flex-none flex-wrap gap-2">
              {project.downloadUrl && (
                <a href={project.downloadUrl} className="btn !px-3 !py-1.5 !text-xs" download>
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  Descargar
                </a>
              )}
              <ButtonLink href={`/editor/${project.id}`} variant="ghost" size="sm">
                Ver en el editor
              </ButtonLink>
              </span>
            </div>
          )}

          {canEdit && (
            <div className="mt-auto flex flex-wrap gap-2 border-t border-white/10 pt-4">
              {!clip.discarded ? (
                <>
                  <Button icon={pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Clapperboard className="h-4 w-4" aria-hidden />} disabled={pending || !clip.framing} onClick={() => run("editor")}>
                    Abrir en el editor
                  </Button>
                  {(!project || (project.mode === "editor" && project.status === "AWAITING_REVIEW")) && (
                    <Button variant="ghost" icon={<Download className="h-4 w-4" aria-hidden />} disabled={pending || !clip.framing} onClick={() => run("export")}>
                      Exportar directo
                    </Button>
                  )}
                  {!adjusting && (
                    <Button variant="ghost" icon={<SlidersHorizontal className="h-4 w-4" aria-hidden />} onClick={() => setAdjusting(true)} disabled={pending}>
                      Ajustar inicio y fin
                    </Button>
                  )}
                  <Button
                    variant="subtle"
                    icon={<X className="h-4 w-4" aria-hidden />}
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await setClipDiscardedAction(clip.id, true);
                        if (!r.ok) toast.error(r.error);
                      })
                    }
                  >
                    Descartar
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  icon={<Undo2 className="h-4 w-4" aria-hidden />}
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await setClipDiscardedAction(clip.id, false);
                      if (!r.ok) toast.error(r.error);
                    })
                  }
                >
                  Recuperar
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      <TextDialog key={editing ? "abierto" : "cerrado"} clip={clip} open={editing} onOpenChange={setEditing} />
    </article>
  );
}

function ScoreBadge({ score, rank, total }: { score: number; rank: number; total: number }) {
  return (
    <div className="flex flex-none flex-col items-center rounded-2xl border border-accent-hi/40 bg-accent/12 px-3.5 py-2 text-center" aria-label={`Puntaje ${score} de 100, puesto ${rank} de ${total} en este video`}>
      <span className="font-mono text-[28px] leading-none font-bold text-white">{score}</span>
      <span className="mt-1 font-mono text-[10px] tracking-wider text-accent-glow uppercase">
        #{rank} de {total}
      </span>
    </div>
  );
}

function FramingPill({ framing }: { framing: ClipView["framing"] }) {
  if (!framing) return <span className="pill text-[11px] text-muted">Reencuadre pendiente</span>;
  if (framing.mode === "center")
    return (
      <span className="pill text-[11px]">
        <ScanFace className="h-3.5 w-3.5 text-muted" aria-hidden />
        Sin cara clara: encuadre al centro
      </span>
    );
  return (
    <span className="pill text-[11px]">
      {framing.maxFaces >= 2 ? <Users className="h-3.5 w-3.5 text-accent-hi" aria-hidden /> : <ScanFace className="h-3.5 w-3.5 text-accent-hi" aria-hidden />}
      {framing.maxFaces >= 2
        ? framing.speakerSwitches
          ? `Sigue a quien habla (${framing.speakerSwitches} ${framing.speakerSwitches === 1 ? "cambio" : "cambios"})`
          : "Sigue a la persona principal"
        : "Sigue tu cara"}
    </span>
  );
}

function Bar({ label, value, note }: { label: string; value: number; note?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <li className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-xs">
      <span className="truncate text-muted" title={note}>
        {label}
      </span>
      <span className="h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
        <span className="block h-full rounded-full bg-accent-hi" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-right font-mono text-text">{pct}</span>
    </li>
  );
}

function ScoreDetailView({ clip }: { clip: ClipView }) {
  const d = clip.detail;
  const f = d.features;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/20 p-4">
      <ul className="flex flex-col gap-2" aria-label="Reglas medidas">
        {(Object.keys(RULE_LABEL) as RuleKey[]).map((k) => (
          <Bar key={k} label={RULE_LABEL[k]} value={d.parts[k]} />
        ))}
      </ul>
      <div className="grid gap-2 border-t border-white/10 pt-3 text-xs text-muted sm:grid-cols-3">
        <p>
          Reglas: <span className="font-mono text-white">{d.rules}</span>
        </p>
        <p>
          Criterio de la IA: <span className="font-mono text-white">{d.ai ?? "—"}</span>
        </p>
        <p>
          Tu ranking de ganchos: <span className="font-mono text-white">{d.bonus > 0 ? `+${d.bonus}` : d.bonus}</span>
        </p>
      </div>
      <p className="text-xs text-placeholder">
        {f.questions} {f.questions === 1 ? "pregunta" : "preguntas"} · {f.numbers} {f.numbers === 1 ? "cifra" : "cifras"} · {formatNumber(f.wordsPerSecond, { digits: 1 })} palabras por segundo · {formatNumber(f.pauseSeconds, { digits: 1 })} s de pausas. Puntaje relativo a los demás momentos de este video.
      </p>
    </div>
  );
}

/** Vista previa vertical (ya reencuadrada por el worker) que reproduce solo el tramo del clip. */
function ClipPlayer({ clip, start, end }: { clip: ClipView; start: number; end: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const a = Math.max(0, start - clip.windowStart);
  const b = Math.max(a + 0.5, end - clip.windowStart);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.currentTime < a || v.currentTime > b) {
      v.currentTime = a;
      setTime(0);
    }
  }, [a, b]);

  function toggle() {
    const v = ref.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < a || v.currentTime >= b - 0.05) v.currentTime = a;
      void v.play().catch(() => setPlaying(false));
    } else v.pause();
  }

  if (!clip.previewUrl) {
    return (
      <div className="mx-auto grid aspect-[9/16] w-full max-w-[220px] place-items-center rounded-xl border border-white/10 bg-black/40 text-center text-xs text-placeholder">
        Vista previa no disponible
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, (time / (b - a)) * 100));
  return (
    <div className="mx-auto flex w-full max-w-[220px] flex-col gap-2">
      <div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-white/10 bg-black">
        <video
          ref={ref}
          src={clip.previewUrl}
          poster={clip.posterUrl ?? undefined}
          preload="metadata"
          playsInline
          muted={muted}
          className="h-full w-full object-cover"
          onLoadedMetadata={(e) => {
            e.currentTarget.currentTime = a;
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (v.currentTime >= b) {
              v.pause();
              v.currentTime = a;
              setTime(0);
              return;
            }
            setTime(Math.max(0, v.currentTime - a));
          }}
          aria-label={`Vista previa del clip ${clip.title}`}
        />
        <button type="button" onClick={toggle} className="group absolute inset-0 grid place-items-center focus-visible:outline-none" aria-label={playing ? "Pausar" : "Reproducir el clip"}>
          <span className={cn("grid h-14 w-14 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition group-focus-visible:ring-2 group-focus-visible:ring-accent-hi", playing && "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100")}>
            {playing ? <Pause className="h-6 w-6" aria-hidden /> : <Play className="ml-0.5 h-6 w-6" aria-hidden />}
          </span>
        </button>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Avance del clip" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <div className="h-full rounded-full bg-accent-hi" style={{ width: `${pct}%` }} />
        </div>
        <span className="font-mono text-[11px] text-muted">
          {formatTimecode(time)} / {formatTimecode(b - a)}
        </span>
        <button type="button" onClick={() => setMuted((m) => !m)} className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-white/[0.07] hover:text-white" aria-label={muted ? "Activar el sonido" : "Silenciar"}>
          {muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
        </button>
      </div>
    </div>
  );
}

/** Mover el inicio y el fin por palabra, dentro del margen de la vista previa. */
function RangeEditor({
  clip,
  range,
  onChange,
  onCancel,
  onSaved,
}: {
  clip: ClipView;
  range: { from: number; to: number };
  onChange: (r: { from: number; to: number }) => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [edge, setEdge] = useState<"start" | "end">("start");
  const [pending, start] = useTransition();
  const list = useRef<HTMLDivElement>(null);
  const words = clip.words;
  const ids = words.map((w) => w.id);
  const first = words.find((w) => w.id === range.from);
  const last = words.find((w) => w.id === range.to);
  // validRange solo mira las palabras del rango: con las de la ventana alcanza (se indexan por id).
  const sparse: { id: number; text: string; start: number; end: number }[] = [];
  for (const w of words) sparse[w.id] = w;
  const problem = first && last ? validRange(sparse as never, range.from, range.to, clip) : "Ese tramo no es válido.";
  const changed = range.from !== clip.fromWord || range.to !== clip.toWord;

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-word="${range.from}"]`)?.scrollIntoView({ block: "nearest" });
    // Solo al abrir: lleva la lista al inicio del clip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function step(which: "from" | "to", delta: number) {
    const i = ids.indexOf(range[which]) + delta;
    if (i < 0 || i >= ids.length) return;
    const next = { ...range, [which]: ids[i]! };
    if (next.from <= next.to) onChange(next);
  }

  function pick(id: number) {
    if (edge === "start") onChange({ from: id, to: Math.max(id, range.to) });
    else onChange({ from: Math.min(id, range.from), to: id });
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-accent-hi/30 bg-accent/[0.06] p-4" aria-label="Ajustar inicio y fin">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Ajusta dónde empieza y termina</p>
          <p className="text-xs text-muted">Toca una palabra o usa las flechas. Puedes moverte hasta {WINDOW_MARGIN} s antes o después del momento elegido.</p>
        </div>
        <SegmentedControl
          label="Qué borde mueves"
          value={edge}
          onValueChange={setEdge}
          options={[
            { value: "start", label: "Inicio" },
            { value: "end", label: "Fin" },
          ]}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <EdgeControl label="Inicio" time={first?.start} onPrev={() => step("from", -1)} onNext={() => step("from", 1)} />
        <EdgeControl label="Fin" time={last?.end} onPrev={() => step("to", -1)} onNext={() => step("to", 1)} />
      </div>
      <div ref={list} className="max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-black/30 p-3 text-sm leading-7" role="group" aria-label="Palabras del tramo">
        {words.map((w) => {
          const inside = w.id >= range.from && w.id <= range.to;
          const isEdge = w.id === range.from || w.id === range.to;
          return (
            <button
              key={w.id}
              type="button"
              data-word={w.id}
              onClick={() => pick(w.id)}
              aria-pressed={isEdge}
              aria-label={`${w.text} (${formatTimecode(w.start)})${w.id === range.from ? ", inicio" : ""}${w.id === range.to ? ", fin" : ""}`}
              className={cn(
                "mr-1 rounded px-0.5 transition hover:bg-white/10",
                inside ? "text-white" : "text-placeholder line-through decoration-white/20",
                isEdge && "bg-accent/40 font-semibold ring-1 ring-accent-hi",
              )}
            >
              {w.text}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted">{first && last ? `${formatTimecode(first.start)} – ${formatTimecode(last.end)} · ${seconds(last.end - first.start)}` : ""}</span>
        <span className="flex-1" />
        {changed && (
          <Button variant="subtle" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />} onClick={() => onChange({ from: clip.fromWord, to: clip.toWord })}>
            Como estaba
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          size="sm"
          disabled={pending || !changed || Boolean(problem)}
          onClick={() =>
            start(async () => {
              const r = await updateClipRangeAction(clip.id, range.from, range.to);
              if (!r.ok) toast.error(r.error);
              else {
                toast.success("Guardamos el nuevo tramo.");
                onSaved();
              }
            })
          }
        >
          Guardar tramo
        </Button>
      </div>
      {problem && changed && <Notice tone="warning">{problem}</Notice>}
      {clip.project && changed && <p className="text-xs text-muted">El proyecto del Editor que ya creaste se conserva con el tramo anterior; al abrir o exportar de nuevo se crea uno con este tramo.</p>}
    </section>
  );
}

function EdgeControl({ label, time, onPrev, onNext }: { label: string; time: number | undefined; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
      <span className="text-xs text-muted">
        {label} <span className="ml-1 font-mono text-white">{time != null ? formatTimecode(time) : "—"}</span>
      </span>
      <span className="flex gap-1">
        <button type="button" onClick={onPrev} className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-muted hover:bg-white/[0.07] hover:text-white" aria-label={`${label}: una palabra antes`}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" onClick={onNext} className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-muted hover:bg-white/[0.07] hover:text-white" aria-label={`${label}: una palabra después`}>
          <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </span>
    </div>
  );
}

function TextDialog({ clip, open, onOpenChange }: { clip: ClipView; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [title, setTitle] = useState(clip.title);
  const [hook, setHook] = useState(clip.hookText);
  const [pending, start] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Título y gancho del clip"
      description="El título nombra el proyecto en el Editor. El texto de gancho es una sugerencia para poner arriba del video en los primeros segundos."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={pending || !title.trim()}
            onClick={() =>
              start(async () => {
                const r = await updateClipTextAction(clip.id, { title, hookText: hook });
                if (!r.ok) toast.error(r.error);
                else onOpenChange(false);
              })
            }
          >
            Guardar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Título" htmlFor={`t-${clip.id}`} hint={`${title.length}/80`}>
          <Input id={`t-${clip.id}`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Texto de gancho" htmlFor={`h-${clip.id}`} hint={`${hook.length}/100`}>
          <Textarea id={`h-${clip.id}`} value={hook} onChange={(e) => setHook(e.target.value)} maxLength={100} rows={2} />
        </Field>
      </div>
    </Dialog>
  );
}
