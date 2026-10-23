"use client";

import { useState, useTransition } from "react";
import { History, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { formatRelative, formatUsd } from "@/lib/format";
import type { EditRequest } from "@/lib/video/director/types";
import { editAction } from "../director-actions";
import { useHumanize } from "../studio/humanize";

const SUGGESTIONS = ["Más dinámico", "No cortes la parte del precio", "Más gráficos en la segunda mitad", "Versión de 30 s", "Otro gancho"];

/**
 * "Edítalo así": un pedido en lenguaje natural que vuelve a pasar por el director con todo el contexto (el video, lo que
 * entendió, tu brief y la edición actual). Muestra el costo estimado y, después, qué cambió.
 */
export function EditRequestCard({
  projectId,
  canEdit,
  estimate,
  spent,
  cap,
  edits,
  dirty,
}: {
  projectId: string;
  canEdit: boolean;
  estimate: number;
  spent: number;
  cap: number;
  edits: EditRequest[];
  /** Hay cambios sin guardar en la revisión (se guardan solos en un segundo). */
  dirty: boolean;
}) {
  const [text, setText] = useState("");
  const h = useHumanize();
  const [pending, start] = useTransition();
  const over = spent + estimate > cap;
  const last = edits.at(-1);

  function send() {
    start(async () => {
      const r = await editAction(projectId, text);
      if (!r.ok) toast.error(r.error);
    });
  }

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Wand2 className="h-4 w-4 text-accent-hi" aria-hidden /> Edítalo así
        </h2>
        <p className="mt-0.5 text-xs text-muted">Pídele cambios como a un editor. Vuelve a pasar por todo el video y revisa el resultado.</p>
      </div>
      {last && (
        <div className="rounded-xl border border-accent/30 bg-accent/10 p-3 text-xs" aria-live="polite">
          <p className="font-semibold text-white">
            {last.source === "arreglo" ? "Arreglo" : "Tu pedido"}: <span className="font-normal text-text">“{last.instruction}”</span>
          </p>
          <ul className="mt-1.5 flex flex-col gap-0.5 text-text/90">
            {last.changes.map((c, i) => (
              <li key={i}>· {h(c)}</li>
            ))}
          </ul>
          {last.note && <p className="mt-1.5 text-muted">{h(last.note)}</p>}
        </div>
      )}
      {canEdit && (
        <>
          <label htmlFor="edit-request" className="sr-only">
            Qué quieres cambiar
          </label>
          <Textarea
            id="edit-request"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={600}
            className="!min-h-20 text-sm"
            placeholder="Más dinámico, no cortes la parte del precio, más gráficos en la segunda mitad…"
            disabled={pending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim().length >= 3) send();
            }}
          />
          <div className="flex flex-wrap gap-1.5" aria-label="Ideas de pedidos">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="pill border border-white/10 text-[11px] text-muted transition hover:border-white/25 hover:text-text" onClick={() => setText((t) => (t.trim() ? `${t.trim().replace(/[.,]$/, "")}, ${s.toLowerCase()}` : s))}>
                {s}
              </button>
            ))}
          </div>
          <Button onClick={send} disabled={pending || text.trim().length < 3 || dirty} icon={pending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Wand2 className="h-4 w-4" aria-hidden />}>
            {pending ? "Enviando…" : "Aplicar cambios"}
          </Button>
          <p className={over ? "text-xs text-warning" : "text-xs text-muted"}>
            Costo estimado: {formatUsd(estimate)} · llevas {formatUsd(spent)} de {formatUsd(cap)}.
            {over ? " Se pasa del tope: se hará con menos vueltas de revisión." : ""}
            {dirty ? " Esperando a que se guarden tus cambios…" : ""}
          </p>
        </>
      )}
      {edits.length > 1 && (
        <details className="text-xs">
          <summary className="flex cursor-pointer items-center gap-1.5 text-muted hover:text-text">
            <History className="h-3.5 w-3.5" aria-hidden /> Pedidos anteriores ({edits.length - 1})
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {edits
              .slice(0, -1)
              .reverse()
              .map((e, i) => (
                <li key={i} className="rounded-lg bg-white/[0.03] p-2">
                  <p className="text-text">“{e.instruction}”</p>
                  <p className="mt-0.5 text-muted">
                    {formatRelative(e.at)} · {e.changes.map((c) => h(c)).join(" ")}
                  </p>
                </li>
              ))}
          </ul>
        </details>
      )}
    </div>
  );
}
