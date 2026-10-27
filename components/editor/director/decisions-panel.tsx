"use client";

import { useState } from "react";
import { ArrowDownUp, CaptionsOff, Play, Scissors, Undo2, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import type { EditPlan, PlanMove, Word } from "@/lib/video/types";
import { reasonLabel } from "../labels";
import { useHumanize } from "../studio/humanize";

const text = (words: Word[], from: number, to: number, corrections: Record<string, string>, max = 80) => {
  const t = words
    .slice(from, to + 1)
    .map((w) => corrections[String(w.id)] ?? w.text)
    .join(" ");
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/**
 * El "por qué" de cada decisión del director: cortes, bloques movidos, zooms y subtítulos ocultos (el de los ganchos y
 * los b-roll va en sus tarjetas). Cada cosa se escucha o se deshace desde aquí.
 */
export function DecisionsPanel({
  plan,
  words,
  corrections,
  removed,
  moves,
  onMoves,
  onListen,
  onRestore,
  canEdit,
}: {
  plan: EditPlan;
  words: Word[];
  corrections: Record<string, string>;
  removed: Set<number>;
  moves: PlanMove[];
  onMoves: (next: PlanMove[]) => void;
  onListen: (wordId: number) => void;
  onRestore: (range: { from: number; to: number }) => void;
  canEdit: boolean;
}) {
  const [all, setAll] = useState(false);
  const h = useHumanize();
  const cuts = plan.proposed_removals.filter((r) => r.note && r.source !== "user" && Array.from({ length: r.to_word - r.from_word + 1 }, (_, k) => r.from_word + k).every((id) => removed.has(id)));
  const shown = all ? cuts : cuts.slice(0, 5);
  const zooms = plan.zoom_moments ?? [];
  const hidden = plan.captions.hide ?? [];
  if (!cuts.length && !moves.length && !zooms.length && !hidden.length) return null;

  return (
    <section aria-labelledby="why-title" className="flex flex-col gap-3">
      <div>
        <h2 id="why-title" className="text-base font-semibold">
          Por qué se editó así
        </h2>
        <p className="text-sm text-muted">Cada decisión del director con su motivo. Escúchala o deshazla.</p>
      </div>
      <div className="card flex flex-col divide-y divide-white/[0.06] p-1">
        {shown.map((r) => (
          <div key={`${r.from_word}-${r.to_word}`} className="flex items-start gap-3 p-3">
            <Scissors className="mt-0.5 h-4 w-4 flex-none text-danger" aria-hidden />
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-xs font-semibold text-danger">{reasonLabel[r.reason]}</p>
              <p className="line-clamp-2 text-text/80 line-through decoration-danger/60">“{text(words, r.from_word, r.to_word, corrections)}”</p>
              <p className="mt-0.5 text-xs text-muted">{h(r.note)}</p>
            </div>
            <div className="flex flex-none gap-1">
              <Button size="sm" variant="subtle" className="!h-8 !w-8 !px-0" icon={<Play className="h-3.5 w-3.5" aria-hidden />} aria-label="Escuchar cómo queda" title="Escuchar cómo queda" onClick={() => onListen(Math.max(0, r.from_word - 3))} />
              {canEdit && <Button size="sm" variant="subtle" className="!h-8 !w-8 !px-0" icon={<Undo2 className="h-3.5 w-3.5" aria-hidden />} aria-label="Restaurar este corte" title="Restaurar este corte" onClick={() => onRestore({ from: r.from_word, to: r.to_word })} />}
            </div>
          </div>
        ))}
        {cuts.length > 5 && (
          <button type="button" className="p-3 text-left text-xs font-semibold text-accent-hi hover:underline" onClick={() => setAll((a) => !a)}>
            {all ? "Ver menos" : `Ver los ${formatNumber(cuts.length)} cortes`}
          </button>
        )}
        {moves.map((m) => (
          <div key={`m${m.from_word}`} className="flex items-start gap-3 p-3">
            <ArrowDownUp className="mt-0.5 h-4 w-4 flex-none text-accent-hi" aria-hidden />
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-xs font-semibold text-accent-glow">Bloque movido {m.after_word < 0 ? "al principio" : "más adelante"}</p>
              <p className="line-clamp-2 text-text/90">“{text(words, m.from_word, m.to_word, corrections)}”</p>
              <p className="mt-0.5 text-xs text-muted">{h(m.why)}</p>
            </div>
            {canEdit && (
              <Button size="sm" variant="ghost" className="!h-8 flex-none !px-2.5" onClick={() => onMoves(moves.filter((x) => x !== m))}>
                Dejar en su lugar
              </Button>
            )}
          </div>
        ))}
        {zooms.length > 0 && (
          <div className="flex items-start gap-3 p-3">
            <ZoomIn className="mt-0.5 h-4 w-4 flex-none text-accent-hi" aria-hidden />
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-xs font-semibold text-accent-glow">
                {formatNumber(zooms.length)} {zooms.length === 1 ? "zoom de énfasis" : "zooms de énfasis"}
              </p>
              <ul className="mt-0.5 flex flex-col gap-0.5 text-xs text-muted">
                {zooms.slice(0, 4).map((z) => (
                  <li key={z.from_word}>
                    <button type="button" className="text-left hover:text-text" onClick={() => onListen(z.from_word)}>
                      “{text(words, z.from_word, z.to_word, corrections, 40)}” · {h(z.why)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {hidden.length > 0 && (
          <div className="flex items-start gap-3 p-3">
            <CaptionsOff className="mt-0.5 h-4 w-4 flex-none text-accent-hi" aria-hidden />
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-xs font-semibold text-accent-glow">Sin subtítulos en {formatNumber(hidden.length)} {hidden.length === 1 ? "tramo" : "tramos"}</p>
              <p className="mt-0.5 text-xs text-muted">{h(hidden[0]!.why)}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
