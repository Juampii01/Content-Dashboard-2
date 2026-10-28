"use client";

import { useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, BarChart3, ChevronLeft, ChevronRight, Film, LayoutList, Loader2, MessageSquareText, Minus, Scissors, SplitSquareHorizontal, Sparkles, Trash2, Undo2, Wand2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { WordSpan } from "@/lib/video/studio";
import { formatNumber } from "@/lib/format";
import { editAction } from "../director-actions";
import { suggestTrimAction } from "../edit-actions";
import { ColorPanel } from "./color-panel";
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
  /** El tramo elegido (en la transcripción o la línea de tiempo) o, si no hay, la frase donde está la línea de reproducción. */
  rangeHere: () => { range: WordSpan; from: "seleccion" | "cabezal" } | null;
}) {
  const { props, state, removedSet } = api;
  const { projectId, canEdit } = props;
  const [trimming, startTrim] = useTransition();
  const [trimNote, setTrimNote] = useState<string | null>(null);
  const here = rangeHere();
  // El tramo se puede ajustar de a una palabra antes de pedir (si cambia lo elegido, vuelve a lo elegido).
  const hereKey = here ? `${here.range.from}-${here.range.to}` : "";
  const [custom, setCustom] = useState<{ base: string; range: WordSpan } | null>(null);
  const range = here ? (custom && custom.base === hereKey ? custom.range : here.range) : null;
  const last = props.words.length - 1;
  const nudge = (edge: "from" | "to", d: -1 | 1) => {
    if (!range) return;
    const next = { ...range, [edge]: Math.max(0, Math.min(last, range[edge] + d)) };
    if (next.from > next.to) return;
    setCustom({ base: hereKey, range: next });
  };

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
      <Tool icon={<Scissors className="h-4 w-4" aria-hidden />} title="Recortar" text="Elige qué sacar. No cambia el orden del video y lo cortado se ve tachado en Transcripción.">
        <div className="flex flex-col gap-1.5">
          <TrimOption
            title={trimming ? "Buscando qué cortar…" : "Silencios y tomas malas"}
            text="Saca las pausas largas, las frases que repetiste y los arranques en falso. La IA tarda unos segundos."
            icon={trimming ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Scissors className="h-4 w-4" aria-hidden />}
            onClick={trim}
            disabled={trimming}
            primary
          />
          <TrimOption title="Solo silencios" text="Acorta las pausas largas. Todas las palabras quedan." icon={<Minus className="h-4 w-4" aria-hidden />} onClick={() => (onTrimPauses(), setTrimNote("Se acortaron los silencios largos. Las palabras quedan todas."))} disabled={trimming} />
          {(removedSet.size > 0 || !state.pauses.all) && (
            <TrimOption title="Como lo grabaste" text="Deshace todos los recortes: vuelve cada palabra y cada pausa." icon={<Undo2 className="h-4 w-4" aria-hidden />} onClick={() => (onRestoreAll(), setTrimNote(null))} disabled={trimming} />
          )}
        </div>
        {trimNote && <p className="rounded-lg bg-success/10 px-2.5 py-1.5 text-xs text-success">{trimNote} Puedes deshacerlo con Ctrl+Z.</p>}
      </Tool>

      {parts}

      {framing}

      <ColorPanel api={api} accent={props.graphicLook.theme.accent} />

      <Tool icon={<Sparkles className="h-4 w-4" aria-hidden />} title="Añadir en este momento" text={here ? (here.from === "seleccion" ? "En el tramo que elegiste. Ajústalo de a una palabra si hace falta." : "No elegiste un tramo: se usa la frase donde está la línea de reproducción. Para elegir otro, arrastra sobre la transcripción o la pista Video.") : "Elige un tramo: arrastra sobre la transcripción o la pista Video."}>
        {range && (
          <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-1.5">
            <RangeNudge label="el comienzo" onLess={() => nudge("from", -1)} onMore={() => nudge("from", 1)} />
            <p className="min-w-0 flex-1 text-center text-xs text-text">«{api.textOf(range.from, range.to, 90)}»</p>
            <RangeNudge label="el final" onLess={() => nudge("to", -1)} onMore={() => nudge("to", 1)} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" variant="ghost" disabled={!range} onClick={() => range && onAnimationAt(range)} icon={<WandSparkles className="h-3.5 w-3.5" aria-hidden />}>
            Animación
          </Button>
          <Button size="sm" variant="ghost" disabled={!range} onClick={() => range && onGraphicAt(range)} icon={<BarChart3 className="h-3.5 w-3.5" aria-hidden />}>
            Gráfico
          </Button>
          <Button size="sm" variant="ghost" disabled={!range} onClick={() => range && onEffectAt(range)} icon={<Wand2 className="h-3.5 w-3.5" aria-hidden />}>
            Efecto
          </Button>
          <Button size="sm" variant="ghost" disabled={!range} onClick={() => range && onBrollAt(range)} icon={<Film className="h-3.5 w-3.5" aria-hidden />}>
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
    <Tool icon={<LayoutList className="h-4 w-4" aria-hidden />} title="Partes del video" text="Corta el video donde está la línea de reproducción (tecla C). Después toca una parte en la pista Video para moverla o quitarla.">
      <Button size="sm" variant="ghost" className="self-start" onClick={onSplit} icon={<SplitSquareHorizontal className="h-3.5 w-3.5" aria-hidden />}>
        Cortar aquí (C)
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

/** Una forma de recortar: botón grande con su explicación (se entiende sin conocer la plataforma). */
function TrimOption({ title, text, icon, onClick, disabled, primary }: { title: string; text: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-start gap-2.5 rounded-xl border px-3 py-1.5 text-left transition disabled:opacity-60 ${primary ? "border-white bg-white text-paper hover:opacity-90" : "border-white/10 text-text hover:border-white/30"}`}
    >
      <span className="mt-0.5 flex-none">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className={`block text-xs ${primary ? "text-paper/75" : "text-muted"}`}>{text}</span>
      </span>
    </button>
  );
}

/** Correr un borde del tramo una palabra hacia atrás (‹) o hacia adelante (›). */
function RangeNudge({ label, onLess, onMore }: { label: string; onLess: () => void; onMore: () => void }) {
  return (
    <span className="flex flex-none items-center rounded-lg border border-white/10">
      <button type="button" onClick={onLess} className="grid h-6 w-5 place-items-center rounded-l-lg text-muted hover:bg-white/10 hover:text-white" aria-label={`Correr ${label} una palabra hacia atrás`} title="Una palabra hacia atrás">
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button type="button" onClick={onMore} className="grid h-6 w-5 place-items-center rounded-r-lg text-muted hover:bg-white/10 hover:text-white" aria-label={`Correr ${label} una palabra hacia adelante`} title="Una palabra hacia adelante">
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
      </button>
    </span>
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
