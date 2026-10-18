"use client";

import { useState, useTransition } from "react";
import { Mic, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import type { VoiceTest as VoiceTestResult } from "@/lib/ai/prompts/marca";
import { voiceTestAction } from "./actions";

/** "Prueba de voz": un guion corto escrito con el perfil guardado, para ver si suena a la persona. */
export function VoiceTest({ dirty, canEdit, aiReady }: { dirty: boolean; canEdit: boolean; aiReady: boolean }) {
  const [test, setTest] = useState<VoiceTestResult | null>(null);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const res = await voiceTestAction();
      if (!res.ok) toast.error(res.error);
      else setTest(res.test);
    });

  const disabled = !canEdit || !aiReady || dirty || pending;
  return (
    <Section
      title="Prueba de voz"
      description="Escribimos un reel corto con tu perfil guardado. Léelo en voz alta: si no suena a ti, agrega muestras de cómo hablas o ajusta el tono."
      actions={
        <Button variant={test ? "ghost" : "primary"} size="sm" onClick={run} disabled={disabled} icon={test ? <RefreshCw className={pending ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}>
          {pending ? "Escribiendo…" : test ? "Otra prueba" : "Probar mi voz"}
        </Button>
      }
    >
      {dirty && <p className="text-sm text-warning">Guarda tus cambios para probar con el perfil nuevo.</p>}
      {!aiReady && <p className="text-sm text-muted">La IA no está configurada en esta instalación.</p>}
      {test ? (
        <div className="rounded-xl border border-white/10 bg-bg-deep/50 p-5" aria-live="polite">
          <p className="eyebrow mb-3">Tema: {test.topic}</p>
          <p className="text-lg font-semibold leading-snug text-white">{test.hook}</p>
          <div className="mt-3 space-y-2 text-[15px] leading-relaxed text-text/90">
            {test.body.map((b, i) => (
              <p key={i}>{b}</p>
            ))}
          </div>
          <p className="mt-3 text-[15px] font-medium text-accent-glow">{test.cta}</p>
        </div>
      ) : (
        !dirty &&
        aiReady && <p className="text-sm text-muted">Tarda unos segundos. No se guarda en Guiones.</p>
      )}
    </Section>
  );
}
