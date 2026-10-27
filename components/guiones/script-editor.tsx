"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  CalendarDays,
  Film,
  GalleryHorizontalEnd,
  UserRound,
  Video,
  ArrowDown,
  ArrowUp,
  Check,
  Clapperboard,
  Copy,
  History,
  Plus,
  RefreshCw,
  Save,
  Scissors,
  Sparkles,
  Target,
  Trash2,
  Wand2,
  Zap,
} from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Section } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { DropdownMenu } from "@/components/ui/menu";
import { toast } from "@/components/ui/toast";
import type { ScriptBeat, ScriptContent } from "@/lib/db/schema";
import { formatDuration, formatRelative } from "@/lib/format";
import { actionLabel, formatLabel, hookTypeLabel, statusLabel, type ScriptStatus } from "@/lib/scripts/labels";
import { scriptStats } from "@/lib/scripts/stats";
import { cn } from "@/lib/utils";
import { ScorePanel } from "./score-panel";
import { adaptScriptAction, restoreVersionAction, runScriptAction, saveScriptAction, setScriptStatusAction, type ActionResult } from "./actions";
import { FEATURES } from "@/lib/features";

type Format = keyof typeof formatLabel;
type Version = { id: string; action: string; createdAt: string };

function spokenText(c: ScriptContent) {
  return [c.hooks[c.selectedHook]?.text ?? "", ...c.beats.map((b) => b.spoken), c.cta.spoken].filter(Boolean).join("\n\n");
}

function fullText(c: ScriptContent) {
  const parts = [`GANCHO\n${c.hooks[c.selectedHook]?.text ?? ""}`];
  c.beats.forEach((b, i) => {
    parts.push(`${i + 1}. ${b.purpose.toUpperCase()} (${b.seconds} s)\n${b.spoken}${b.onScreenText ? `\n[Texto en pantalla: ${b.onScreenText}]` : ""}${b.broll ? `\n[B-roll: ${b.broll}]` : ""}`);
  });
  parts.push(`CTA\n${c.cta.spoken}${c.cta.onScreenText ? `\n[Texto en pantalla: ${c.cta.onScreenText}]` : ""}`);
  parts.push(`CAPTION\n${c.caption}`);
  return parts.join("\n\n");
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado.`);
  } catch {
    toast.error("No se pudo copiar. Selecciona el texto y cópialo a mano.");
  }
}

export function ScriptEditor({
  scriptId,
  initial,
  format,
  status: initialStatus,
  versions,
  parent,
  canEdit,
}: {
  scriptId: string;
  initial: ScriptContent;
  format: Format;
  status: ScriptStatus;
  versions: Version[];
  parent: { id: string; title: string } | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [content, setContent] = useState<ScriptContent>(initial);
  const [status, setStatus] = useState<ScriptStatus>(initialStatus);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [prompter, setPrompter] = useState(false);
  const [beatEdit, setBeatEdit] = useState<{ id: string; instruction: string } | null>(null);

  const stats = scriptStats(content);
  const update = (fn: (c: ScriptContent) => ScriptContent) => {
    setContent((c) => fn(structuredClone(c)));
    setDirty(true);
  };
  const updateBeat = (id: string, patch: Partial<ScriptBeat>) => update((c) => ({ ...c, beats: c.beats.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));

  async function save(silent = false): Promise<boolean> {
    const res = await saveScriptAction(scriptId, content);
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    setDirty(false);
    if (!silent) toast.success("Guion guardado.");
    router.refresh();
    return true;
  }

  /** Las acciones de IA trabajan sobre lo guardado: si hay cambios, primero se guardan. */
  function runAi(key: string, fn: () => Promise<ActionResult<ScriptContent>>, done: string) {
    setBusy(key);
    startTransition(async () => {
      if (dirty && !(await save(true))) {
        setBusy(null);
        return;
      }
      const res = await fn();
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.data) setContent(res.data);
      setDirty(false);
      toast.success(done);
      router.refresh();
    });
  }

  function adapt(to: Format) {
    setBusy("adaptar");
    startTransition(async () => {
      if (dirty && !(await save(true))) {
        setBusy(null);
        return;
      }
      const res = await adaptScriptAction(scriptId, to);
      setBusy(null);
      if (!res.ok) toast.error(res.error);
      else if (res.data) {
        toast.success(`Listo: nuevo guion para ${formatLabel[to]}.`);
        router.push(`/guiones/${res.data}`);
      }
    });
  }

  function changeStatus(next: ScriptStatus) {
    setStatus(next);
    startTransition(async () => {
      const res = await setScriptStatusAction(scriptId, next);
      if (!res.ok) toast.error(res.error);
    });
  }

  const disabled = !canEdit || busy !== null;

  return (
    <div className="grid gap-6 pb-24 xl:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        <div className="card flex flex-col gap-4 p-6">
          <Input aria-label="Título del guion" value={content.title} onChange={(e) => update((c) => ({ ...c, title: e.target.value }))} disabled={!canEdit} className="!border-transparent !bg-transparent !px-0 text-xl font-bold text-white" />
          <p className="text-sm text-muted">{content.angle}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
            <span>{formatLabel[format]}</span>
            <span>
              ≈ <strong className="text-white">{formatDuration(stats.estimatedSeconds)}</strong> hablado
            </span>
            <span>{stats.wordCount} palabras</span>
            {parent && (
              <a href={`/guiones/${parent.id}`} className="text-accent-hi hover:text-white">
                Adaptado de: {parent.title}
              </a>
            )}
          </div>
        </div>

        <Section
          title="Gancho"
          description="Los primeros 2 segundos. Elige el que más te convence."
          actions={
            canEdit && (
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => runAi("ganchos", () => runScriptAction(scriptId, { kind: "ganchos" }), "5 ganchos nuevos.")} icon={<RefreshCw className={cn("h-3.5 w-3.5", busy === "ganchos" && "animate-spin")} aria-hidden />}>
                {busy === "ganchos" ? "Escribiendo…" : "5 ganchos nuevos"}
              </Button>
            )
          }
        >
          <ul className="flex flex-col gap-2" role="radiogroup" aria-label="Ganchos">
            {content.hooks.map((h, i) => {
              const selected = i === content.selectedHook;
              return (
                <li key={i}>
                  <div
                    role="radio"
                    aria-checked={selected}
                    tabIndex={0}
                    onClick={() => canEdit && update((c) => ({ ...c, selectedHook: i }))}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === " ") && canEdit) {
                        e.preventDefault();
                        update((c) => ({ ...c, selectedHook: i }));
                      }
                    }}
                    className={cn("flex cursor-pointer gap-3 rounded-xl border p-4 transition", selected ? "border-accent bg-accent/12" : "border-white/10 hover:border-white/25")}
                  >
                    <span className={cn("mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full border", selected ? "border-accent bg-accent" : "border-white/30")}>
                      {selected && <Check className="h-3 w-3 text-white" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      {selected && canEdit ? (
                        <Textarea
                          aria-label="Gancho elegido"
                          value={h.text}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => update((c) => ({ ...c, hooks: c.hooks.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) }))}
                          className="!min-h-16 !bg-transparent font-medium text-white"
                        />
                      ) : (
                        <span className="block font-medium text-white">{h.text}</span>
                      )}
                      <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span className="pill !py-0.5 !text-[11px]">{hookTypeLabel[h.type] ?? h.type}</span>
                        <span className="flex items-center gap-1" title="Qué tan fuerte es para tu audiencia">
                          <span className="flex gap-0.5" aria-hidden>
                            {Array.from({ length: 10 }, (_, k) => (
                              <span key={k} className={cn("h-1.5 w-2 rounded-sm", k < h.score ? "bg-accent-hi" : "bg-white/10")} />
                            ))}
                          </span>
                          <span className="font-mono">{h.score}/10</span>
                        </span>
                        <span className="text-placeholder">{h.why}</span>
                      </span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>

        <ScorePanel
          hook={content.hooks[content.selectedHook]?.text ?? ""}
          hookType={content.hooks[content.selectedHook]?.type ?? null}
          estimatedSeconds={stats.estimatedSeconds}
          format={format}
          canEdit={canEdit}
          onHookTypeChange={(type) => update((c) => ({ ...c, hooks: c.hooks.map((h, j) => (j === c.selectedHook ? { ...h, type } : h)) }))}
        />

        <Section title="Cuerpo" description="Cada bloque cumple un solo propósito. Edita lo que quieras o pide que se reescriba.">
          <ol className="flex flex-col gap-4">
            {content.beats.map((b, i) => (
              <li key={b.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-accent/20 font-mono text-xs font-bold text-accent-glow">{i + 1}</span>
                    {canEdit ? (
                      <Input aria-label={`Propósito del bloque ${i + 1}`} value={b.purpose} onChange={(e) => updateBeat(b.id, { purpose: e.target.value })} className="!w-auto !border-transparent !bg-transparent !px-1 !py-0.5 text-sm font-semibold text-white" />
                    ) : (
                      <span className="text-sm font-semibold text-white">{b.purpose}</span>
                    )}
                  </span>
                  {canEdit && (
                    <span className="flex items-center gap-1">
                      <Button variant="subtle" size="sm" aria-label="Subir bloque" disabled={i === 0 || disabled} onClick={() => update((c) => { const beats = [...c.beats]; [beats[i - 1], beats[i]] = [beats[i]!, beats[i - 1]!]; return { ...c, beats }; })}>
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      <Button variant="subtle" size="sm" aria-label="Bajar bloque" disabled={i === content.beats.length - 1 || disabled} onClick={() => update((c) => { const beats = [...c.beats]; [beats[i + 1], beats[i]] = [beats[i]!, beats[i + 1]!]; return { ...c, beats }; })}>
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      <Button variant="subtle" size="sm" disabled={disabled} onClick={() => setBeatEdit({ id: b.id, instruction: "" })} icon={<Wand2 className={cn("h-3.5 w-3.5", busy === `beat-${b.id}` && "animate-pulse")} aria-hidden />}>
                        Reescribir
                      </Button>
                      <Button variant="subtle" size="sm" aria-label="Quitar bloque" disabled={disabled || content.beats.length <= 1} onClick={() => update((c) => ({ ...c, beats: c.beats.filter((x) => x.id !== b.id) }))}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </span>
                  )}
                </div>
                <Textarea aria-label={`Texto hablado del bloque ${i + 1}`} value={b.spoken} onChange={(e) => updateBeat(b.id, { spoken: e.target.value })} disabled={!canEdit} className="!min-h-20 text-[15px] leading-relaxed" />
                <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1.4fr_90px]">
                  <Field label="Texto en pantalla" htmlFor={`ost-${b.id}`}>
                    <Input id={`ost-${b.id}`} value={b.onScreenText} onChange={(e) => updateBeat(b.id, { onScreenText: e.target.value })} disabled={!canEdit} />
                  </Field>
                  <Field label="B-roll" htmlFor={`broll-${b.id}`}>
                    <Input id={`broll-${b.id}`} value={b.broll} onChange={(e) => updateBeat(b.id, { broll: e.target.value })} disabled={!canEdit} />
                  </Field>
                  <Field label="Segundos" htmlFor={`sec-${b.id}`}>
                    <Input id={`sec-${b.id}`} type="number" min={1} value={b.seconds} onChange={(e) => updateBeat(b.id, { seconds: Number(e.target.value) || 1 })} disabled={!canEdit} />
                  </Field>
                </div>
              </li>
            ))}
          </ol>
          {canEdit && (
            <Button variant="subtle" size="sm" className="mt-3" disabled={disabled} icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={() => update((c) => ({ ...c, beats: [...c.beats, { id: crypto.randomUUID().slice(0, 8), purpose: "Nuevo bloque", spoken: "", onScreenText: "", broll: "", seconds: 5 }] }))}>
              Agregar bloque
            </Button>
          )}
        </Section>

        <Section
          title="Llamado a la acción"
          actions={
            canEdit && (
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => runAi("cta", () => runScriptAction(scriptId, { kind: "cta" }), "CTA y caption nuevos.")} icon={<Target className={cn("h-3.5 w-3.5", busy === "cta" && "animate-pulse")} aria-hidden />}>
                {busy === "cta" ? "Escribiendo…" : "Otro CTA"}
              </Button>
            )
          }
        >
          <div className="grid gap-3">
            <Textarea aria-label="CTA hablado" value={content.cta.spoken} onChange={(e) => update((c) => ({ ...c, cta: { ...c.cta, spoken: e.target.value } }))} disabled={!canEdit} className="!min-h-16" />
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Texto en pantalla" htmlFor="cta-ost">
                <Input id="cta-ost" value={content.cta.onScreenText} onChange={(e) => update((c) => ({ ...c, cta: { ...c.cta, onScreenText: e.target.value } }))} disabled={!canEdit} />
              </Field>
              <Field label="Oferta" htmlFor="cta-offer">
                <Input id="cta-offer" value={content.cta.offer ?? ""} placeholder="Sin oferta (seguir o guardar)" onChange={(e) => update((c) => ({ ...c, cta: { ...c.cta, offer: e.target.value || null } }))} disabled={!canEdit} />
              </Field>
            </div>
          </div>
        </Section>

        <Section
          title="Caption"
          actions={
            <Button variant="subtle" size="sm" icon={<Copy className="h-3.5 w-3.5" aria-hidden />} onClick={() => copy(content.caption, "Caption")}>
              Copiar
            </Button>
          }
        >
          <Textarea aria-label="Caption" value={content.caption} onChange={(e) => update((c) => ({ ...c, caption: e.target.value }))} disabled={!canEdit} className="!min-h-32" />
        </Section>
      </div>

      <aside className="flex flex-col gap-4 xl:sticky xl:top-6 xl:self-start">
        <div className="card flex flex-col gap-3 p-5">
          <Field label="Estado" htmlFor="status">
            <Select id="status" value={status} onChange={(e) => changeStatus(e.target.value as ScriptStatus)} disabled={!canEdit}>
              {(Object.keys(statusLabel) as ScriptStatus[]).map((s) => (
                <option key={s} value={s}>
                  {statusLabel[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Button onClick={() => setPrompter(true)} icon={<Clapperboard className="h-4 w-4" aria-hidden />}>
            Modo grabación
          </Button>
          <Button variant="ghost" onClick={() => copy(fullText(content), "Guion")} icon={<Copy className="h-4 w-4" aria-hidden />}>
            Copiar guion completo
          </Button>
        </div>

        {canEdit && (
          <nav className="card flex flex-col gap-2 p-5" aria-label="Usar este guion">
            <p className="mb-1 text-sm font-semibold text-white">Usar este guion</p>
            <ButtonLink href={`/calendario?nuevo=1&guion=${scriptId}`} variant="ghost" size="sm" icon={<CalendarDays className="h-4 w-4" aria-hidden />}>
              Programar en el calendario
            </ButtonLink>
            <ButtonLink href={`/editor/grabar?guion=${scriptId}`} variant="ghost" size="sm" icon={<Video className="h-4 w-4" aria-hidden />}>
              Grabar
            </ButtonLink>
            <ButtonLink href={`/editor/nuevo?guion=${scriptId}`} variant="ghost" size="sm" icon={<Film className="h-4 w-4" aria-hidden />}>
              Editar mi grabación
            </ButtonLink>
            {FEATURES.clone && (
              <ButtonLink href={`/clon/nuevo?guion=${scriptId}`} variant="ghost" size="sm" icon={<UserRound className="h-4 w-4" aria-hidden />}>
                Generar con mi clon
              </ButtonLink>
            )}
            <ButtonLink href={`/carruseles/nuevo?guion=${scriptId}`} variant="ghost" size="sm" icon={<GalleryHorizontalEnd className="h-4 w-4" aria-hidden />}>
              Convertir en carrusel
            </ButtonLink>
            {dirty && <p className="text-xs text-warning">Guarda primero: se usa la última versión guardada.</p>}
          </nav>
        )}

        {canEdit && (
          <div className="card flex flex-col gap-2 p-5">
            <p className="mb-1 text-sm font-semibold text-white">Ajustar con IA</p>
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => runAi("acortar", () => runScriptAction(scriptId, { kind: "acortar" }), "Guion acortado.")} icon={<Scissors className={cn("h-4 w-4", busy === "acortar" && "animate-pulse")} aria-hidden />}>
              {busy === "acortar" ? "Acortando…" : "Acortar"}
            </Button>
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => runAi("directo", () => runScriptAction(scriptId, { kind: "directo" }), "Más directo.")} icon={<Zap className={cn("h-4 w-4", busy === "directo" && "animate-pulse")} aria-hidden />}>
              {busy === "directo" ? "Reescribiendo…" : "Más directo"}
            </Button>
            <DropdownMenu
              label="Adaptar a otro formato"
              className="w-full [&>button]:w-full [&>button]:!py-1.5 [&>button]:text-xs"
              trigger={
                <>
                  <Sparkles className={cn("h-4 w-4", busy === "adaptar" && "animate-pulse")} aria-hidden />
                  {busy === "adaptar" ? "Adaptando…" : "Adaptar a otro formato"}
                </>
              }
              items={(Object.keys(formatLabel) as Format[])
                .filter((f) => f !== format)
                .map((f) => ({ label: formatLabel[f], onSelect: () => adapt(f), disabled }))}
            />
          </div>
        )}

        <div className="card flex flex-col gap-2 p-5">
          <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
            <History className="h-4 w-4 text-accent-hi" aria-hidden /> Historial
          </p>
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {versions.map((v, i) => (
              <li key={v.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-white/5">
                <span>
                  <span className="block text-text">{actionLabel[v.action] ?? v.action}</span>
                  <span className="text-placeholder">{formatRelative(v.createdAt)}</span>
                </span>
                {i > 0 && canEdit ? (
                  <Button
                    variant="subtle"
                    size="sm"
                    disabled={disabled}
                    onClick={() => runAi("restaurar", () => restoreVersionAction(scriptId, v.id), "Versión restaurada.")}
                  >
                    Volver
                  </Button>
                ) : i === 0 ? (
                  <span className="text-placeholder">Actual</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {canEdit && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-bg/90 px-4 py-3 backdrop-blur-xl lg:left-64">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <span className="text-sm text-muted" role="status">
              {busy ? "La IA está trabajando…" : dirty ? "Tienes cambios sin guardar." : "Todo guardado."}
            </span>
            <Button onClick={() => startTransition(async () => void (await save()))} disabled={!dirty || busy !== null} icon={<Save className="h-4 w-4" aria-hidden />}>
              Guardar
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={beatEdit !== null}
        onOpenChange={(open) => !open && setBeatEdit(null)}
        title="Reescribir este bloque"
        description="Dile qué cambiar o déjalo vacío para que lo haga más claro y con un ejemplo más concreto."
        footer={
          <>
            <Button variant="ghost" onClick={() => setBeatEdit(null)}>
              Cancelar
            </Button>
            <Button
              icon={<Wand2 className="h-4 w-4" aria-hidden />}
              onClick={() => {
                if (!beatEdit) return;
                const { id, instruction } = beatEdit;
                setBeatEdit(null);
                runAi(`beat-${id}`, () => runScriptAction(scriptId, { kind: "beat", beatId: id, instruction }), "Bloque reescrito.");
              }}
            >
              Reescribir
            </Button>
          </>
        }
      >
        <Field label="Indicación (opcional)" htmlFor="beat-instruction">
          <Input id="beat-instruction" value={beatEdit?.instruction ?? ""} onChange={(e) => setBeatEdit((b) => (b ? { ...b, instruction: e.target.value } : b))} placeholder="Agrega un ejemplo de un cliente real, más corto, con humor…" />
        </Field>
      </Dialog>

      <Dialog open={prompter} onOpenChange={setPrompter} title="Modo grabación" description="Lee a tu ritmo. Solo lo que se dice, sin indicaciones." className="!max-w-3xl">
        <div className="max-h-[65vh] overflow-y-auto pr-2">
          {spokenText(content)
            .split("\n\n")
            .map((p, i) => (
              <p key={i} className="mb-6 text-2xl leading-relaxed font-medium text-white sm:text-3xl">
                {p}
              </p>
            ))}
        </div>
      </Dialog>
    </div>
  );
}
