"use client";

import { useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, BarChart3, Film, LayoutList, Loader2, MessageSquareText, Scissors, SplitSquareHorizontal, Sparkles, Trash2, Undo2, Wand2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { WordSpan } from "@/lib/video/studio";
import { formatNumber } from "@/lib/format";
import { editAction } from "../director-actions";
import { suggestTrimAction } from "../edit-actions";
import type { StudioApi } from "./types";

const EDIT_ALL = "Edita todo el video sin cambiar el orden ni traer frases de otra parte: corta los silencios y las tomas malas, pon subtítulos con mi estilo, b-roll, gráficos y animaciones donde sumen, y el sonido.";

/**
 * Pestaña «Edición» del Estudio: las herramientas que usas tú, a mano. Lo que se pide con palabras (animar todo,
 * copiar la edición de un reel, varias cosas a la vez) va en el Chat con la IA, a la derecha. Todo se deshace con Ctrl+Z.
 */
export function EditPanel({
  api,
  onRestoreAll,
  onTrim,
  onTrimPauses,
  onAnimationAt,
  onGraphicAt,
  onBrollAt,
  onEffectAt,
  onOpenChat,
  parts,
  framing,
  rangeHere,
}: {
  api: StudioApi;
  onRestoreAll: () => void;
  /** Aplica los cortes de «Recortar» (palabras) y acorta las pausas largas. */
  onTrim: (removed: number[]) => void;
  /** Solo acorta las pausas largas (sin cortar palabras). */
  onTrimPauses: () => void;
  /** Abre el cuadro de «Pide una animación aquí» en ese tramo. */
  onAnimationAt: (range: WordSpan) => void;
  onGraphicAt: (range: WordSpan) => void;
  onBrollAt: (range: WordSpan) => void;
  onEffectAt: (range: WordSpan) => void;
  onOpenChat: () => void;
  /** Mover partes del video a mano (dividir, mover antes o después, quitar). */
  parts?: React.ReactNode;
  /** Encuadre y zooms del estilo (solo si aplican). */
  framing?: React.ReactNode;
  /** El tramo elegido (en la transcripción o la línea de tiempo) o, si no hay, la frase donde está el cabezal. */
  rangeHere: () => { range: WordSpan; from: "seleccion" | "cabezal" } | null;
}) {
  const { props, state, removedSet } = api;
  const { projectId, canEdit } = props;
  const [trimming, startTrim] = useTransition();
  const [trimNote, setTrimNote] = useState<string | null>(null);
  const here = rangeHere();
  const hereLabel = here ? `${here.from === "seleccion" ? "En lo elegido" : "Donde está el cabezal"}: «${api.textOf(here.range.from, here.range.to, 70)}»` : "Elige un tramo en la transcripción o mueve el cabezal.";

  function trim() {
    startTrim(async () => {
      const r = await suggestTrimAction(projectId);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      onTrim(r.removed);
      const n = r.removed.length;
      setTrimNote(n ? `Se ${n === 1 ? "cortó 1 palabra" : `cortaron ${formatNumber(n)} palabras`} (tomas repetidas, arranques en falso y muletillas) y se acortaron los silencios.` : "No encontramos tomas malas: solo se acortaron los silencios.");
      if (r.planned === "auto") toast.info("La IA no respondió: se cortó solo lo más claro. Revisa los cortes.");
    });
  }

  if (!canEdit) return <p className="p-4 text-sm text-muted">Tienes acceso de solo lectura: puedes ver la edición, pero no cambiarla.</p>;

  return (
    <div className="flex flex-col gap-3 p-3">
      <Tool icon={<Scissors className="h-4 w-4" aria-hidden />} title="Recortar" text="Saca los silencios largos, las tomas repetidas y los arranques en falso. No cambia el orden del video.">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={trim} disabled={trimming} icon={trimming ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Scissors className="h-3.5 w-3.5" aria-hidden />}>
            {trimming ? "Buscando qué cortar…" : "Recortar"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => (onTrimPauses(), setTrimNote("Se acortaron los silencios largos. Las palabras quedan todas."))} disabled={trimming}>
            Solo silencios
          </Button>
          {(removedSet.size > 0 || !state.pauses.all) && (
            <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => (onRestoreAll(), setTrimNote(null))}>
              Como lo grabaste
            </Button>
          )}
        </div>
        {trimNote && <p className="text-xs text-muted">{trimNote}</p>}
      </Tool>

      {parts}

      {framing}

      <Tool icon={<Sparkles className="h-4 w-4" aria-hidden />} title="Añadir en este momento" text={hereLabel}>
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" variant="ghost" disabled={!here} onClick={() => here && onAnimationAt(here.range)} icon={<WandSparkles className="h-3.5 w-3.5" aria-hidden />}>
            Animación
          </Button>
          <Button size="sm" variant="ghost" disabled={!here} onClick={() => here && onGraphicAt(here.range)} icon={<BarChart3 className="h-3.5 w-3.5" aria-hidden />}>
            Gráfico
          </Button>
          <Button size="sm" variant="ghost" disabled={!here} onClick={() => here && onEffectAt(here.range)} icon={<Wand2 className="h-3.5 w-3.5" aria-hidden />}>
            Efecto
          </Button>
          <Button size="sm" variant="ghost" disabled={!here} onClick={() => here && onBrollAt(here.range)} icon={<Film className="h-3.5 w-3.5" aria-hidden />}>
            B-roll
          </Button>
        </div>
      </Tool>

      <section className="flex flex-col gap-2 rounded-2xl border border-accent/25 bg-accent/[0.04] p-3">
        <div className="flex items-start gap-2.5">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-xl bg-accent/10 text-accent">
            <MessageSquareText className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white">Lo demás, pídeselo al chat</h3>
            <p className="text-xs text-muted">Animar todo el video, copiar la edición de un reel (pega el link), poner tu video como b-roll o varias cosas a la vez. Le hablas, te dice qué va a hacer y cuando le dices «edítalo», lo hace.</p>
          </div>
        </div>
        <Button size="sm" className="self-start" onClick={onOpenChat} icon={<MessageSquareText className="h-3.5 w-3.5" aria-hidden />}>
          Abrir el chat
        </Button>
      </section>
    </div>
  );
}

/** «Partes del video»: dividir, mover una parte antes o después y quitarla. Todo a mano. */
export function PartsTool({ chosen, reordered, onSplit, onMove, onRemove, onReset }: { chosen: string | null; reordered: boolean; onSplit: () => void; onMove: (dir: -1 | 1) => void; onRemove: () => void; onReset: () => void }) {
  return (
    <Tool icon={<LayoutList className="h-4 w-4" aria-hidden />} title="Partes del video" text="Divide en el cabezal (C), toca una parte en la pista Video y muévela o quítala.">
      <Button size="sm" variant="ghost" className="self-start" onClick={onSplit} icon={<SplitSquareHorizontal className="h-3.5 w-3.5" aria-hidden />}>
        Dividir en el cabezal
      </Button>
      {chosen ? (
        <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
          <p className="text-xs text-muted">
            Parte elegida: <span className="text-white">«{chosen}»</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => onMove(-1)} icon={<ArrowLeft className="h-3.5 w-3.5" aria-hidden />} title="Mayús + Alt + ←">
              Mover antes
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onMove(1)} icon={<ArrowRight className="h-3.5 w-3.5" aria-hidden />} title="Mayús + Alt + →">
              Mover después
            </Button>
            <Button size="sm" variant="ghost" onClick={onRemove} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} title="Supr">
              Quitar
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">Elige una parte en la pista Video para moverla.</p>
      )}
      {reordered && (
        <Button size="sm" variant="ghost" className="self-start" onClick={onReset} icon={<Undo2 className="h-3.5 w-3.5" aria-hidden />}>
          Orden como lo grabaste
        </Button>
      )}
    </Tool>
  );
}

/** «Editar todo con IA»: el director hace la edición completa sin cambiar el orden. Va en «Lo que hizo la IA». */
export function EditAllCard({ projectId, dirty }: { projectId: string; dirty: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [editing, start] = useTransition();
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-white/15 p-3">
      <p className="text-sm font-semibold text-white">Editar todo con IA</p>
      <p className="text-xs text-muted">Corta silencios y tomas malas, y agrega subtítulos, b-roll, gráficos, animaciones y sonido. No cambia el orden de tu video. Tarda unos minutos.</p>
      {dirty && <p className="text-xs text-warning">Guarda tus cambios antes: la IA parte de lo guardado.</p>}
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant={confirm ? "primary" : "ghost"}
          disabled={dirty || editing}
          icon={editing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Wand2 className="h-3.5 w-3.5" aria-hidden />}
          onClick={() => {
            if (!confirm) return setConfirm(true);
            start(async () => {
              const r = await editAction(projectId, EDIT_ALL);
              if (!r.ok) toast.error(r.error);
              setConfirm(false);
            });
          }}
        >
          {editing ? "Enviando…" : confirm ? "Sí, editar todo" : "Editar todo con IA"}
        </Button>
        {confirm && !editing && (
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}

function Tool({ icon, title, text, children }: { icon: React.ReactNode; title: string; text: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-2xl border border-white/10 bg-card p-3">
      <div className="flex items-start gap-2.5">
        <span className="grid h-8 w-8 flex-none place-items-center rounded-xl bg-white/5 text-white">{icon}</span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <p className="text-xs text-muted">{text}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
