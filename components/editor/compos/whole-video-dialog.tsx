"use client";

import { useState, useTransition } from "react";
import { Clapperboard, Columns2, Layers, Loader2, Mic, PanelTop, Sparkles, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { WholeMoment, WholePlan } from "@/lib/video/compos/flows";
import { planWholeVideoAction, startWholeVideoAction } from "../compos-actions";

type Mode = WholePlan["mode"];

const MODES: { value: Mode; title: string; text: string; icon: typeof UserRound }[] = [
  { value: "face", title: "Con tu cara", text: "Anima las secciones que más ganan (gancho, cifras, listas, cierre) y entre una y otra se te ve hablando.", icon: UserRound },
  { value: "over", title: "Sobre tu cara", text: "Se te ve todo el tiempo y las animaciones van encima, alrededor de tu cara, de punta a punta.", icon: Layers },
  { value: "split", title: "Mitad y mitad", text: "Arriba la animación, abajo tu cara. Todo el video igual.", icon: Columns2 },
  { value: "top", title: "Fondo blanco arriba", text: "Tu cara recortada abajo y un panel blanco arriba del que salen todas las animaciones.", icon: PanelTop },
  { value: "full", title: "Pantalla completa", text: "Solo tu voz: todo es animación y no se te ve. Sirve también para un audio solo.", icon: Mic },
];

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/**
 * «Animar todo el video»: 1) eliges el modo (y, si quieres, qué buscas); 2) Claude lee el video y propone un estilo común
 * y un pedido por momento; 3) los revisas (editas o quitas) y se crean todos. Entran a la cola de a varios y cada uno
 * aparece en la pista Animaciones cuando termina: se puede cerrar el Estudio y volver.
 */
export function WholeVideoDialog({ projectId, open, onOpenChange, onStarted }: { projectId: string; open: boolean; onOpenChange: (open: boolean) => void; onStarted: () => void }) {
  const [mode, setMode] = useState<Mode>("face");
  const [notes, setNotes] = useState("");
  const [plan, setPlan] = useState<WholePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planning, startPlan] = useTransition();
  const [creating, startCreate] = useTransition();

  const reset = () => {
    setPlan(null);
    setError(null);
  };
  const close = (v: boolean) => {
    if (planning || creating) return;
    onOpenChange(v);
    if (!v) reset();
  };

  const makePlan = () =>
    startPlan(async () => {
      setError(null);
      const r = await planWholeVideoAction(projectId, mode, notes);
      if (!r.ok) return setError(r.error);
      setPlan(r.plan);
    });

  const create = () =>
    startCreate(async () => {
      if (!plan) return;
      setError(null);
      const r = await startWholeVideoAction(projectId, { mode: plan.mode, style: plan.style, moments: plan.moments.map((m) => ({ from_word: m.from_word, to_word: m.to_word, title: m.title, prompt: m.prompt })) });
      if (!r.ok) return setError(r.error);
      if (r.error) return setError(r.error);
      toast.success("Creando la animación de todo el video.", { description: `Una sola pieza de ${r.count === 1 ? "1 escena" : `${r.count} escenas`}. Tarda de 10 a 20 minutos: aparece sola en la pista Animaciones y puedes cerrar el Estudio y volver.` });
      onStarted();
      onOpenChange(false);
      reset();
    });

  const setMoment = (i: number, patch: Partial<WholeMoment>) => setPlan((p) => (p ? { ...p, moments: p.moments.map((m, k) => (k === i ? { ...m, ...patch } : m)) } : p));
  const removeMoment = (i: number) => setPlan((p) => (p ? { ...p, moments: p.moments.filter((_, k) => k !== i) } : p));

  const footer = plan ? (
    <>
      <Button variant="ghost" onClick={reset} disabled={creating}>
        Volver
      </Button>
      <Button onClick={create} disabled={creating || plan.moments.length === 0} icon={creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}>
        {creating ? "Creando…" : `Crear la animación (${plan.moments.length === 1 ? "1 escena" : `${plan.moments.length} escenas`})`}
      </Button>
    </>
  ) : (
    <>
      <Button variant="ghost" onClick={() => close(false)} disabled={planning}>
        Cancelar
      </Button>
      <Button onClick={makePlan} disabled={planning} icon={planning ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}>
        {planning ? "Leyendo tu video…" : "Armar el plan"}
      </Button>
    </>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      dismissOnBackdrop={!planning && !creating}
      className="!max-w-3xl"
      title="Animar todo el video"
      description={plan ? "Una sola animación de principio a fin, por escenas. Revisa cada escena: puedes cambiarla o quitarla." : "La IA lee tu video entero y arma una sola animación de principio a fin, con inicio, escenas y cierre."}
      footer={footer}
    >
      {error && (
        <div className="mb-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      {!plan ? (
        <div className="flex flex-col gap-5" aria-busy={planning}>
          <ol className="step-list">
            <li className="step">
              <span className="step-node">1</span>
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <p className="text-sm font-semibold text-white">¿Cómo lo animamos?</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Modo">
                  {MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      role="radio"
                      aria-checked={mode === m.value}
                      disabled={planning}
                      onClick={() => setMode(m.value)}
                      className={cn("card flex flex-col gap-2 whitespace-normal p-4 text-left transition", mode === m.value ? "!border-white ring-1 ring-white" : "hover:border-white/30")}
                    >
                      <span className="flex items-center gap-2 font-semibold text-white">
                        <m.icon className="h-4 w-4" aria-hidden /> {m.title}
                      </span>
                      <span className="text-sm text-muted">{m.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            </li>
            <li className="step">
              <span className="step-node">2</span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Field label="¿Qué buscas? (opcional)" htmlFor="whole-notes" hint="El tono, un look, referencias. Por ejemplo: «cinematográfico, tonos fríos con dorado, fotos reales, nada de dibujos».">
                  <Textarea id="whole-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={800} disabled={planning} className="!min-h-20 text-sm" />
                </Field>
              </div>
            </li>
          </ol>
          {planning && (
            <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin text-accent-hi" aria-hidden />
              Claude está leyendo tu video y armando las animaciones. Tarda hasta un par de minutos.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Estilo común" htmlFor="whole-style" hint="Lo que comparten todas las escenas: look, colores, tipografía, movimiento y sonido.">
            <Textarea id="whole-style" value={plan.style} maxLength={500} onChange={(e) => setPlan((p) => (p ? { ...p, style: e.target.value } : p))} className="!min-h-16 text-sm" disabled={creating} />
          </Field>
          <ul className="flex flex-col gap-3" aria-label="Escenas de la pieza">
            {plan.moments.map((m, i) => (
              <li key={`${m.from_word}-${i}`} className="card flex flex-col gap-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-semibold text-white">
                      <Clapperboard className="h-3.5 w-3.5 flex-none text-accent-hi" aria-hidden />
                      <span className="font-mono text-xs text-muted tabular-nums">
                        {clock(m.start)}–{clock(m.end)}
                      </span>
                      <span className="truncate">{m.title}</span>
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted">«{m.said}»</p>
                  </div>
                  <button type="button" onClick={() => removeMoment(i)} disabled={creating} className="grid h-8 w-8 flex-none place-items-center rounded-lg text-muted hover:bg-white/[0.06] hover:text-danger" aria-label={`Quitar «${m.title}»`} title="Quitar esta escena">
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                <label className="sr-only" htmlFor={`whole-${i}`}>
                  Pedido de «{m.title}»
                </label>
                <Textarea id={`whole-${i}`} value={m.prompt} maxLength={1100} onChange={(e) => setMoment(i, { prompt: e.target.value })} className="!min-h-24 text-sm" disabled={creating} />
              </li>
            ))}
          </ul>
          {plan.mode !== "face" && <p className="text-xs text-muted">Las escenas van una detrás de otra: si quitas una, la anterior se estira hasta la siguiente.</p>}
          {(plan.mode === "split" || plan.mode === "top") && <p className="text-xs text-muted">Tu cara va abajo, fija y con el mismo encuadre en todo el video. Lo ajustas después en la animación (Tu cara abajo).</p>}
        </div>
      )}
    </Dialog>
  );
}
