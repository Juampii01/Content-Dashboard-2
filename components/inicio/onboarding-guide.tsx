"use client";

import { useState, useTransition } from "react";
import { ArrowRight, Check, Clock, Rocket } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Progress } from "@/components/ui/feedback";
import type { Onboarding, OnboardingStepKey } from "@/lib/home/onboarding";
import { dismissOnboardingAction } from "./actions";

/**
 * Guía de los primeros 10 minutos. A la izquierda la ruta de pasos (fila con scroll en el teléfono), a la derecha
 * el paso elegido con su botón. El progreso viene de la base: un paso se marca solo cuando se hace de verdad.
 */
export function OnboardingGuide({ onboarding, canConnect }: { onboarding: Onboarding; canConnect: boolean }) {
  const [selected, setSelected] = useState<OnboardingStepKey>(onboarding.current ?? onboarding.steps[0]!.key);
  const [pending, start] = useTransition();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  const index = onboarding.steps.findIndex((s) => s.key === selected);
  const step = onboarding.steps[index]!;
  const minutesLeft = onboarding.steps.filter((s) => !s.done).reduce((n, s) => n + s.minutes, 0);
  const connectBlocked = step.key === "connected" && !canConnect;

  return (
    <section className="section-shell" aria-labelledby="onboarding-title">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Primeros 10 minutos</p>
          <h2 id="onboarding-title" className="mt-1 text-lg font-semibold">
            Deja tu espacio listo
          </h2>
          <p className="mt-1 text-sm text-muted">
            {onboarding.doneCount === 0
              ? "Cinco pasos cortos y todo lo que generes va a partir de tus números y tu forma de hablar."
              : `Vas ${onboarding.doneCount} de ${onboarding.total}. Te quedan unos ${minutesLeft} minutos.`}
          </p>
        </div>
        <Button
          variant="subtle"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setHidden(true);
              const res = await dismissOnboardingAction();
              if (!res.ok) setHidden(false);
            })
          }
        >
          Ya lo conozco
        </Button>
      </header>

      <div className="mb-5">
        <Progress value={onboarding.percent} label={`${onboarding.doneCount} de ${onboarding.total} listos`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)] lg:gap-6">
        <ol className="step-list" aria-label="Pasos de la guía">
          {onboarding.steps.map((s, i) => (
            <li key={s.key} className="step-item" data-done={s.done}>
              <button
                type="button"
                className="step"
                data-state={s.done ? "done" : s.key === selected ? "active" : "pending"}
                aria-current={s.key === selected ? "step" : undefined}
                onClick={() => setSelected(s.key)}
              >
                <span className="step-node">{s.done ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}</span>
                <span>
                  {s.title}
                  {s.done && <span className="sr-only"> (listo)</span>}
                </span>
              </button>
            </li>
          ))}
        </ol>

        <div key={step.key} className="card flex animate-step-in flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="tile-icon h-10 w-10">
              {step.done ? <Check className="h-5 w-5" aria-hidden /> : <Rocket className="h-5 w-5" aria-hidden />}
            </span>
            <span className="font-mono text-xs font-semibold text-accent-glow">
              PASO {String(index + 1).padStart(2, "0")} DE {String(onboarding.total).padStart(2, "0")}
            </span>
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted">
              {step.done ? (
                <span className="font-semibold text-success">Listo</span>
              ) : (
                <>
                  <Clock className="h-3.5 w-3.5" aria-hidden /> {step.minutes} min
                </>
              )}
            </span>
          </div>
          <div>
            <h3 className="text-xl font-semibold tracking-tight text-white">{step.title}</h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{step.description}</p>
            {connectBlocked && <p className="mt-2 text-sm text-warning">Solo el dueño de la cuenta puede conectar las redes. Pídeselo y este paso se marca solo.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {!connectBlocked && (
              <ButtonLink href={step.primary.href} variant={step.done ? "ghost" : "primary"} icon={<ArrowRight className="h-4 w-4" aria-hidden />} className="flex-row-reverse">
                {step.done ? "Abrir de nuevo" : step.primary.label}
              </ButtonLink>
            )}
            {step.secondary && (
              <ButtonLink href={step.secondary.href} variant="ghost">
                {step.secondary.label}
              </ButtonLink>
            )}
          </div>
          <p className="text-xs text-muted">Este paso se marca solo cuando lo haces. La guía desaparece cuando completas los cinco.</p>
        </div>
      </div>
    </section>
  );
}
