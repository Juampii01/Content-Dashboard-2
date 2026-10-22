"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowUp, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

const QUICK = ["¿Qué publico esta semana?", "¿Qué gancho me funciona mejor?", "¿Cómo voy este mes?"];

/** Acceso "Pregúntale al estratega" (Inicio): abre /estratega con la pregunta y la manda. */
export function AskStrategistCard() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const go = (question: string) => router.push(`/estratega?q=${encodeURIComponent(question.trim())}&enviar=1`);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim().length >= 3) go(q);
  };
  return (
    <section className="section-shell" aria-labelledby="estratega-inicio">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-8">
        <div className="flex items-start gap-3 lg:max-w-xs">
          <span className="tile-icon h-10 w-10">
            <Compass className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 id="estratega-inicio" className="text-lg font-semibold">
              Pregúntale al estratega
            </h2>
            <p className="mt-1 text-sm text-muted">Te responde con tus números y te dice de dónde sale cada dato.</p>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <form onSubmit={submit} className="flex gap-2">
            <label htmlFor="pregunta-inicio" className="sr-only">
              Tu pregunta para el estratega
            </label>
            <input id="pregunta-inicio" value={q} onChange={(e) => setQ(e.target.value)} maxLength={1000} placeholder="¿Por qué bajaron mis visualizaciones?" className="field min-w-0 flex-1" />
            <Button type="submit" className="flex-none !px-3.5" disabled={q.trim().length < 3} aria-label="Preguntar al estratega">
              <ArrowUp className="h-4 w-4" aria-hidden />
            </Button>
          </form>
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((s) => (
              <button key={s} type="button" onClick={() => go(s)} className="pill transition hover:!border-accent-hi/50 hover:!bg-accent/15">
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
