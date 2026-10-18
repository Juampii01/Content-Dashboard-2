"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";

/** Error inesperado dentro de una sección. Se muestra en español, sin detalles técnicos. */
export default function SectionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="card mx-auto mt-10 flex max-w-lg flex-col items-center gap-4 p-8 text-center">
      <span className="tile-icon h-12 w-12 !text-warning">
        <TriangleAlert className="h-5 w-5" aria-hidden />
      </span>
      <div>
        <h1 className="text-xl font-semibold">Algo salió mal en esta sección</h1>
        <p className="mt-2 text-sm text-muted">
          No perdiste nada de lo que ya estaba guardado. Prueba de nuevo; si sigue pasando, avísale a soporte
          {error.digest ? (
            <>
              {" "}con este código: <span className="font-mono text-text">{error.digest}</span>
            </>
          ) : null}
          .
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={reset} icon={<RotateCcw className="h-4 w-4" aria-hidden />}>
          Intentar de nuevo
        </Button>
        <ButtonLink href="/inicio" variant="ghost">
          Ir al inicio
        </ButtonLink>
      </div>
    </div>
  );
}
