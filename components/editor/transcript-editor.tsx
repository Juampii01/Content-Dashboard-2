"use client";

import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Clapperboard, Headphones, PenLine, Scissors, Sparkles, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import type { PauseInfo } from "@/lib/video/timeline";
import type { RemovalReason, Word } from "@/lib/video/types";
import { reasonLabel } from "./labels";

type Range = { from: number; to: number };
/** Un b-roll marcado sobre el texto (rango de palabras y miniatura del clip elegido). */
export type BrollMark = { id: string; from: number; to: number; thumbUrl: string | null; empty: boolean; graphic?: boolean };

/**
 * Editor por transcript: cada palabra es un botón. Lo cortado aparece tachado con la etiqueta del motivo.
 * - Clic (o Enter/Espacio): corta o restaura esa palabra.
 * - Arrastrar con el mouse, Mayús+clic o Mayús+flechas: selecciona un tramo para cortarlo, restaurarlo,
 *   corregir cómo se escribe en los subtítulos o escucharlo.
 */
export function TranscriptEditor({
  words,
  removed,
  reasons,
  hook,
  offScript,
  corrections,
  activeTime,
  canEdit,
  onSetCut,
  onCorrect,
  onListen,
  brollMarks = [],
  activeBroll = null,
  onBrollClick,
  extraActions,
  pauses,
  onPause,
}: {
  words: Word[];
  removed: Set<number>;
  /** Motivo de cada palabra cortada (de la propuesta); las que no tienen, son "Cortado a mano". */
  reasons: Map<number, RemovalReason>;
  hook: Range | null;
  offScript: Set<number>;
  corrections: Record<string, string>;
  /** Instante del original que se está reproduciendo (para resaltar la palabra). */
  activeTime: number | null;
  canEdit: boolean;
  onSetCut: (ids: number[], cut: boolean) => void;
  onCorrect: (id: number, text: string | null) => void;
  onListen: (id: number) => void;
  brollMarks?: BrollMark[];
  activeBroll?: string | null;
  onBrollClick?: (id: string) => void;
  /** Botones extra para la selección (por ejemplo "Poner b-roll aquí"). */
  extraActions?: (range: Range, clear: () => void) => ReactNode;
  /** Pausas largas (antes de la palabra `word`): las que se acortan y las que quedan completas. */
  pauses?: PauseInfo[];
  /** Deja una pausa completa (`keep`) o vuelve a acortarla. */
  onPause?: (word: number, keep: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(0);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [selection, setSelection] = useState<Range | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [everywhere, setEverywhere] = useState(true);
  const dragged = useRef(false);

  /** Abre "Corregir cómo se escribe" para una palabra (botón de la selección o doble clic). */
  function openCorrect(id: number) {
    setEditing(id);
    setDraft(corrections[String(id)] ?? words[id]!.text);
    setEverywhere(true);
  }

  // Las otras veces que se transcribió igual la misma palabra (sin contar signos ni mayúsculas) y que nadie corrigió.
  const twins = useMemo(() => {
    if (editing == null) return [];
    const key = bare(words[editing]!.text);
    if (!key) return [];
    return words.filter((w) => w.id !== editing && bare(w.text) === key && !corrections[String(w.id)]).map((w) => w.id);
  }, [editing, words, corrections]);

  function saveCorrection() {
    if (editing == null) return;
    const text = draft.trim();
    onCorrect(editing, text || null);
    if (everywhere && text) {
      // Cada una conserva sus propios signos (coma, punto, ¿?) y la mayúscula de comienzo de frase.
      const core = text.replace(/^[¿¡«"“(]+|[.,;:?!…»"”)]+$/g, "");
      for (const id of twins) {
        const original = words[id]!.text;
        const lead = original.match(/^[¿¡«"“(]+/)?.[0] ?? "";
        const trail = original.match(/[.,;:?!…»"”)]+$/)?.[0] ?? "";
        const first = original.replace(/^[¿¡«"“(]+/, "").charAt(0);
        const cased = first && first === first.toUpperCase() && first !== first.toLowerCase() ? core.charAt(0).toUpperCase() + core.slice(1) : core.charAt(0).toLowerCase() + core.slice(1);
        onCorrect(id, `${lead}${cased}${trail}`);
      }
    }
    setEditing(null);
    setSelection(null);
  }

  const ids = (r: Range) => Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from + i);

  function focusWord(id: number) {
    const el = container.current?.querySelector<HTMLButtonElement>(`[data-w="${id}"]`);
    el?.focus();
  }

  function select(from: number, to: number) {
    setSelection({ from: Math.min(from, to), to: Math.max(from, to) });
  }

  function onWordClick(event: MouseEvent<HTMLButtonElement>, id: number) {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    setCursor(id);
    if (event.shiftKey) {
      select(anchor ?? id, id);
      return;
    }
    setAnchor(id);
    setSelection(null);
    if (canEdit) onSetCut([id], !removed.has(id));
  }

  function onMouseUp() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !container.current) return;
    const find = (node: Node | null) => (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("[data-w]");
    const a = find(sel.anchorNode);
    const b = find(sel.focusNode);
    if (a && b && container.current.contains(a) && container.current.contains(b)) {
      const from = Number(a.dataset.w);
      const to = Number(b.dataset.w);
      if (from !== to || sel.toString().trim().includes(" ")) {
        select(from, to);
        setAnchor(from);
        dragged.current = true;
        setTimeout(() => (dragged.current = false), 0);
      }
    }
    sel.removeAllRanges();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: number) {
    const move = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (move) {
      event.preventDefault();
      const next = Math.max(0, Math.min(words.length - 1, id + move));
      setCursor(next);
      focusWord(next);
      if (event.shiftKey) select(anchor ?? id, next);
      else {
        setAnchor(next);
        setSelection(null);
      }
    } else if (event.key === "Escape") {
      setSelection(null);
    }
  }

  // Resalta la palabra que suena sin volver a dibujar todo el texto.
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    root.querySelector("[data-playing]")?.removeAttribute("data-playing");
    if (activeTime == null) return;
    let lo = 0;
    let hi = words.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (words[mid]!.end < activeTime) lo = mid + 1;
      else hi = mid - 1;
    }
    const w = words[lo];
    if (!w || w.start > activeTime + 0.05) return;
    const el = root.querySelector<HTMLElement>(`[data-w="${w.id}"]`);
    if (!el) return;
    el.setAttribute("data-playing", "");
    const box = root.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    // Solo se desplaza la caja de la transcripción (scrollIntoView movía también la página y sacaba el video de la vista).
    if (r.top < box.top) root.scrollTop += r.top - box.top - 8;
    else if (r.bottom > box.bottom) root.scrollTop += r.bottom - box.bottom + 8;
  }, [activeTime, words]);

  const selIds = selection ? ids(selection) : [];
  const selCut = selIds.filter((id) => removed.has(id)).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="sticky top-0 z-10 -mx-1 flex min-h-11 flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-card/95 px-3 py-2 backdrop-blur" aria-live="polite">
        {selection ? (
          <>
            <span className="mr-1 text-xs font-semibold text-white">
              {selIds.length === 1 ? "1 palabra seleccionada" : `${selIds.length} palabras seleccionadas`}
            </span>
            {canEdit && selCut < selIds.length && (
              <Button size="sm" icon={<Scissors className="h-3.5 w-3.5" aria-hidden />} onClick={() => (onSetCut(selIds, true), setSelection(null))}>
                Cortar
              </Button>
            )}
            {canEdit && selCut > 0 && (
              <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => (onSetCut(selIds, false), setSelection(null))}>
                Restaurar
              </Button>
            )}
            {canEdit && selIds.length === 1 && (
              <Button
                size="sm"
                variant="ghost"
                icon={<PenLine className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => openCorrect(selIds[0]!)}
              >
                Corregir texto
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<Headphones className="h-3.5 w-3.5" aria-hidden />} onClick={() => onListen(selection.from)}>
              Escuchar desde aquí
            </Button>
            {extraActions?.(selection, () => setSelection(null))}
            <Button size="sm" variant="subtle" icon={<X className="h-3.5 w-3.5" aria-hidden />} onClick={() => setSelection(null)} aria-label="Quitar la selección" />
          </>
        ) : (
          <p className="text-xs text-muted">
            {canEdit ? "Toca una palabra para cortarla o restaurarla. Doble clic para corregir cómo se escribe en los subtítulos. Arrastra (o Mayús + clic) para elegir un tramo." : "Solo lectura: tu usuario no puede editar."}
          </p>
        )}
      </div>

      <div
        ref={container}
        onMouseUp={onMouseUp}
        className="transcript max-h-[62vh] overflow-y-auto pr-1 text-[15px] leading-[2.1] sm:text-base"
        role="group"
        aria-label="Transcripción editable"
      >
        <WordList
          words={words}
          removed={removed}
          reasons={reasons}
          hook={hook}
          offScript={offScript}
          corrections={corrections}
          selection={selection}
          cursor={cursor}
          canEdit={canEdit}
          onWordClick={onWordClick}
          onWordDoubleClick={canEdit ? openCorrect : undefined}
          onKeyDown={onKeyDown}
          onRestore={(r) => onSetCut(ids(r), false)}
          brollMarks={brollMarks}
          activeBroll={activeBroll}
          onBrollClick={onBrollClick}
          pauses={pauses}
          onPause={onPause}
        />
      </div>

      <Dialog
        open={editing != null}
        onOpenChange={(open) => !open && setEditing(null)}
        title="Corregir el subtítulo"
        description="Cambia cómo se escribe esta palabra en los subtítulos y en los gráficos. El audio queda igual."
        footer={
          <>
            {editing != null && corrections[String(editing)] && (
              <Button variant="subtle" onClick={() => (onCorrect(editing, null), setEditing(null))}>
                Volver al original
              </Button>
            )}
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={saveCorrection}>Guardar</Button>
          </>
        }
      >
        {editing != null && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted">Se dijo: «{words[editing]?.text}»</p>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), saveCorrection())}
              maxLength={60}
              aria-label="Texto corregido"
              autoFocus
            />
            {twins.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-text">
                <input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
                {twins.length === 1 ? "Corregirla también la otra vez que aparece" : `Corregirla también las otras ${twins.length} veces que aparece`}
              </label>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}

const WordList = memo(function WordList({
  words,
  removed,
  reasons,
  hook,
  offScript,
  corrections,
  selection,
  cursor,
  canEdit,
  onWordClick,
  onWordDoubleClick,
  onKeyDown,
  onRestore,
  brollMarks,
  activeBroll,
  onBrollClick,
  pauses,
  onPause,
}: {
  words: Word[];
  removed: Set<number>;
  reasons: Map<number, RemovalReason>;
  hook: Range | null;
  offScript: Set<number>;
  corrections: Record<string, string>;
  selection: Range | null;
  cursor: number;
  canEdit: boolean;
  onWordClick: (e: MouseEvent<HTMLButtonElement>, id: number) => void;
  onWordDoubleClick?: (id: number) => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>, id: number) => void;
  onRestore: (r: Range) => void;
  brollMarks: BrollMark[];
  activeBroll: string | null;
  onBrollClick?: (id: string) => void;
  pauses?: PauseInfo[];
  onPause?: (word: number, keep: boolean) => void;
}) {
  const nodes = useMemo(() => {
    const out: ReactNode[] = [];
    const pauseAt = new Map((pauses ?? []).map((p) => [p.word, p]));
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      const prev = words[i - 1];
      const cut = removed.has(w.id);
      const pause = pauses ? pauseAt.get(w.id) : undefined;
      if (pause) {
        const len = `${pause.gap.toFixed(1).replace(".", ",")} s`;
        out.push(
          <span
            key={`p${w.id}`}
            data-pause={w.id}
            data-trimmed={pause.trimmed ? "1" : "0"}
            className={cn(
              "mx-1 inline-flex items-center gap-1 rounded-md border py-px pr-0.5 pl-1.5 align-middle font-mono text-[10px] leading-5",
              pause.trimmed ? "border-white/10 bg-white/[0.04] text-placeholder" : "border-accent-hi/40 bg-accent/15 text-accent-glow",
            )}
            title={pause.trimmed ? `Pausa de ${len}: en el video final se acorta` : `Pausa de ${len}: queda completa en el video`}
          >
            ⏸ {len} {pause.trimmed ? "acortada" : "completa"}
            {canEdit && onPause && (
              <button
                type="button"
                onClick={() => onPause(w.id, pause.trimmed)}
                className="rounded px-1 font-sans text-[10px] font-semibold text-accent-hi transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-accent-hi"
                aria-label={pause.trimmed ? `Dejar la pausa completa (${len})` : `Volver a acortar la pausa (${len})`}
              >
                {pause.trimmed ? "Dejar completa" : "Acortar"}
              </button>
            )}
          </span>,
        );
      } else if (!pauses && prev && w.start - prev.end >= 0.6) {
        out.push(
          <span key={`p${w.id}`} className="mx-1 inline-flex items-center rounded-md bg-white/[0.04] px-1.5 align-middle font-mono text-[10px] leading-5 text-placeholder" title="Esta pausa se acorta sola en el video final">
            ⏸ {(w.start - prev.end).toFixed(1)} s
          </span>,
        );
      }
      if (cut && !removed.has(w.id - 1)) {
        let end = w.id;
        while (removed.has(end + 1)) end++;
        const reason = reasons.get(w.id) ?? "manual";
        out.push(
          <span key={`r${w.id}`} className="mr-1 inline-flex items-center gap-1 rounded-full border border-danger/35 bg-danger/10 py-0.5 pr-0.5 pl-2 align-middle text-[11px] leading-4 font-semibold text-danger">
            {reasonLabel[reason]}
            {canEdit && (
              <button
                type="button"
                onClick={() => onRestore({ from: w.id, to: end })}
                className="grid h-4 w-4 place-items-center rounded-full hover:bg-danger/20"
                aria-label={`Restaurar ${end - w.id + 1} palabras (${reasonLabel[reason].toLowerCase()})`}
                title="Restaurar este tramo"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
          </span>,
        );
      }
      const mark = brollMarks.find((b) => b.from === w.id);
      if (mark) {
        out.push(
          <button
            key={`b${mark.id}`}
            type="button"
            onClick={() => onBrollClick?.(mark.id)}
            className={cn(
              "mr-1 inline-flex items-center gap-1 rounded-full border py-0.5 pr-2 pl-0.5 align-middle text-[11px] leading-4 font-semibold transition",
              mark.empty ? "border-warning/50 bg-warning/10 text-warning" : "border-success/45 bg-success/10 text-success",
              activeBroll === mark.id && "ring-2 ring-accent-hi",
            )}
            aria-label={mark.empty ? "B-roll sin clip: elegir uno" : mark.graphic ? "Ver este gráfico" : "Ver este b-roll"}
          >
            {mark.graphic ? (
              <Sparkles className="ml-1 h-3 w-3" aria-hidden />
            ) : mark.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mark.thumbUrl} alt="" className="h-4 w-6 rounded-full object-cover" />
            ) : (
              <Clapperboard className="ml-1 h-3 w-3" aria-hidden />
            )}
            {mark.graphic ? "Gráfico" : "B-roll"}
          </button>,
        );
      }
      if (hook && w.id === hook.from) {
        out.push(
          <span key={`h${w.id}`} className="mr-1 inline-flex rounded-full border border-accent-hi/50 bg-accent/20 px-2 py-0.5 align-middle text-[11px] leading-4 font-semibold text-accent-glow">
            Gancho
          </span>,
        );
      }
      const inSel = selection && w.id >= selection.from && w.id <= selection.to;
      const inHook = hook && w.id >= hook.from && w.id <= hook.to;
      const inBroll = brollMarks.some((b) => w.id >= b.from && w.id <= b.to);
      const corrected = corrections[String(w.id)];
      out.push(
        <button
          key={w.id}
          type="button"
          data-w={w.id}
          tabIndex={w.id === cursor ? 0 : -1}
          onClick={(e) => onWordClick(e, w.id)}
          onDoubleClick={onWordDoubleClick ? () => onWordDoubleClick(w.id) : undefined}
          onKeyDown={(e) => onKeyDown(e, w.id)}
          aria-pressed={cut}
          aria-label={`${corrected ?? w.text}${cut ? ", cortada" : ""}`}
          title={corrected ? `Transcrito como «${w.text}»` : offScript.has(w.id) ? "No está en el guion" : undefined}
          className={cn(
            "word rounded-md px-[3px] py-0.5 transition-colors select-text data-[playing]:ring-2 data-[playing]:ring-accent-hi",
            cut ? "text-placeholder line-through decoration-danger/70 decoration-2" : "text-text hover:bg-white/[0.08]",
            inHook && !cut && "bg-accent/15 text-white",
            inSel && "bg-accent/35 text-white",
            offScript.has(w.id) && !cut && "underline decoration-warning/60 decoration-dotted underline-offset-4",
            corrected && !cut && "underline decoration-accent-hi decoration-dotted underline-offset-4",
            inBroll && !cut && !corrected && "underline decoration-success/70 decoration-2 underline-offset-[6px]",
          )}
        >
          {corrected ?? w.text}
        </button>,
      );
      out.push(" ");
    }
    return out;
  }, [words, removed, reasons, hook, offScript, corrections, selection, cursor, canEdit, onWordClick, onWordDoubleClick, onKeyDown, onRestore, brollMarks, activeBroll, onBrollClick, pauses, onPause]);
  return <>{nodes}</>;
});

/** Una palabra sin signos ni mayúsculas, para encontrar las otras veces que se transcribió igual. */
function bare(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
