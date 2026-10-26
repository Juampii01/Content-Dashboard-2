"use client";

import { useState, useTransition } from "react";
import { BarChart3, Eye, Loader2, MessageSquareText, Scissors, Undo2, Wand2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { sentences } from "@/lib/ai/prompts/editor";
import type { WordSpan } from "@/lib/video/studio";
import type { Word } from "@/lib/video/types";
import { formatNumber } from "@/lib/format";
import { editAction } from "../director-actions";
import { editAssistantAction, suggestTrimAction, type AssistantItem } from "../edit-actions";
import type { StudioApi } from "./types";
import type { RefImage } from "@/lib/video/compos/schema";
import type { SignedOption } from "../broll-panel";
import { AttachButton, AttachList, refsOf, useAttachments } from "./attachments";

const EDIT_ALL = "Edita todo el video: corta los silencios y las tomas malas, arma el gancho, pon subtítulos con mi estilo, b-roll, gráficos y animaciones donde sumen, y el sonido.";

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/**
 * Pestaña «Edición» del Estudio: el video llega limpio y cada herramienta corre por separado (recortar,
 * animar, gráficos), más un asistente que convierte lo que pides en pedidos bien armados. Todo se deshace con Ctrl+Z.
 */
export function EditPanel({
  api,
  dirty,
  onRestoreAll,
  onTrim,
  onTrimPauses,
  onWholeVideo,
  onAnimationAt,
  onGraphicAt,
  onClipAt,
  rangeHere,
}: {
  api: StudioApi;
  dirty: boolean;
  onRestoreAll: () => void;
  /** Aplica los cortes de «Recortar» (palabras) y acorta las pausas largas. */
  onTrim: (removed: number[]) => void;
  /** Solo acorta las pausas largas (sin cortar palabras). */
  onTrimPauses: () => void;
  onWholeVideo: (notes?: string) => void;
  /** Sin pedido: abre el cuadro de «Pide una animación aquí» en ese tramo. Con pedido: lo manda directo. */
  onAnimationAt: (range: WordSpan, prompt?: string, refs?: RefImage[]) => void;
  onGraphicAt: (range: WordSpan, prompt?: string) => void;
  /** Pone un video que subió la persona (ya en su biblioteca) como b-roll en ese tramo. */
  onClipAt: (range: WordSpan, option: SignedOption) => void;
  /** El tramo elegido (en la transcripción o la línea de tiempo) o, si no hay, la frase donde está el cabezal. */
  rangeHere: () => { range: WordSpan; from: "seleccion" | "cabezal" } | null;
}) {
  const { props, state, timeline, removedSet } = api;
  const { projectId, canEdit } = props;
  const [trimming, startTrim] = useTransition();
  const [trimNote, setTrimNote] = useState<string | null>(null);
  const [graphicText, setGraphicText] = useState("");
  const [wish, setWish] = useState("");
  const [prefer, setPrefer] = useState<"auto" | "animacion" | "grafico">("auto");
  const [items, setItems] = useState<AssistantItem[] | null>(null);
  const [note, setNote] = useState("");
  const [asking, startAsk] = useTransition();
  const [confirmAll, setConfirmAll] = useState(false);
  const [editing, startEditAll] = useTransition();
  const files = useAttachments(projectId, { video: true });
  const here = rangeHere();
  const hereLabel = here ? `${here.from === "seleccion" ? "Lo elegido" : "Donde está el cabezal"}: «${api.textOf(here.range.from, here.range.to, 70)}»` : "Elige un tramo en la transcripción o mueve el cabezal.";

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

  function ask() {
    const text = wish.trim();
    if (text.length < 3 || files.uploading) return;
    const sel = here?.from === "seleccion" ? here.range : null;
    const attachments = files.list.filter((a) => a.status === "ready").map((a) => ({ ref: a.ref, kind: a.kind, name: a.name, duration: a.duration ?? null }));
    startAsk(async () => {
      const list = sentences(timeline.words as unknown as Word[]).map((f) => ({ from: f.from, to: f.to, start: f.start, end: f.end, text: f.text.slice(0, 600) }));
      const r = await editAssistantAction({ projectId, wish: text, sentences: list.slice(0, 800), duration: timeline.duration, format: state.format, selection: sel, playhead: api.time, prefer: prefer === "auto" ? null : prefer, attachments });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setItems(r.items);
      setNote(r.note);
      if (!r.items.length && !r.note) setNote("No encontramos dónde va. Di el minuto o la frase, o elige el tramo en la transcripción.");
    });
  }

  function timeOf(it: AssistantItem): string {
    const a = timeline.words.find((w) => w.id >= it.from_word);
    const b = [...timeline.words].reverse().find((w) => w.id <= it.to_word);
    return a && b ? `${mmss(a.start)}–${mmss(b.end)}` : "";
  }

  function use(it: AssistantItem, i: number) {
    const range = { from: it.from_word, to: it.to_word };
    if (it.kind === "video") {
      const clip = files.list.find((a) => a.ref === it.attachments.find((x) => x.use === "broll")?.ref)?.clip;
      if (!clip) {
        toast.error("Ese video ya no está en los adjuntos. Vuelve a adjuntarlo.");
        return;
      }
      onClipAt(range, clip);
    } else if (it.scope === "todo") onWholeVideo(it.prompt);
    else if (it.kind === "grafico") onGraphicAt(range, it.prompt);
    else {
      const pick = it.attachments.filter((x) => x.use !== "broll").map((x) => ({ ref: x.ref, use: x.use as RefImage["use"] }));
      onAnimationAt(range, it.prompt, pick.length ? refsOf(files.list, pick) : undefined);
    }
    const rest = (items ?? []).filter((_, k) => k !== i);
    setItems(rest);
    // Todo lo que armó el asistente ya se usó: los adjuntos quedan para el próximo pedido solo si sobraron.
    if (!rest.length) files.clear();
  }

  if (!canEdit) return <p className="p-4 text-sm text-muted">Tienes acceso de solo lectura: puedes ver la edición, pero no cambiarla.</p>;

  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="px-1 text-xs text-muted">Cada herramienta corre por separado: usa las que quieras, en el orden que quieras. Todo se deshace con Ctrl+Z.</p>

      <Tool icon={<Scissors className="h-4 w-4" aria-hidden />} title="Recortar" text="Saca los silencios largos, las tomas repetidas y los arranques en falso.">
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

      <Tool icon={<WandSparkles className="h-4 w-4" aria-hidden />} title="Añadir animaciones" text="Una animación para todo el video o para un momento.">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" icon={<WandSparkles className="h-3.5 w-3.5" aria-hidden />} onClick={() => onWholeVideo()}>
            Animar todo el video
          </Button>
          <Button size="sm" variant="ghost" disabled={!here} onClick={() => here && onAnimationAt(here.range)}>
            En este momento
          </Button>
        </div>
        <p className="text-xs text-muted">{hereLabel}</p>
      </Tool>

      <Tool icon={<BarChart3 className="h-4 w-4" aria-hidden />} title="Añadir gráficos" text="Cifras, listas o comparaciones con tu marca, con lo que dices en ese momento.">
        <label htmlFor="edit-graphic" className="sr-only">
          Qué gráfico quieres
        </label>
        <Textarea id="edit-graphic" value={graphicText} onChange={(e) => setGraphicText(e.target.value)} maxLength={600} className="!min-h-16 text-sm" placeholder="¿Qué gráfico quieres? Ej.: las 3 razones en una lista que aparece de a una" />
        <Button
          size="sm"
          disabled={!here || graphicText.trim().length < 3}
          icon={<BarChart3 className="h-3.5 w-3.5" aria-hidden />}
          onClick={() => {
            if (!here) return;
            onGraphicAt(here.range, graphicText.trim());
            setGraphicText("");
          }}
        >
          Crear el gráfico aquí
        </Button>
        <p className="text-xs text-muted">{hereLabel}</p>
      </Tool>

      <Tool icon={<MessageSquareText className="h-4 w-4" aria-hidden />} title="Asistente de pedidos" text="Dime qué quieres y dónde, con tus palabras. Adjunta un video tuyo para ponerlo como b-roll o imágenes de referencia para una animación.">
        <label htmlFor="edit-wish" className="sr-only">
          Qué quieres
        </label>
        <Textarea
          id="edit-wish"
          value={wish}
          onChange={(e) => setWish(e.target.value)}
          maxLength={1500}
          className="!min-h-20 text-sm"
          placeholder={files.list.some((a) => a.kind === "video") ? "Ej.: pon este video cuando hablo de los clientes" : "Ej.: en el 0:45 quiero un mapa que se acerque a mi ciudad, y cuando hablo de precios, una comparación"}
          onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && ask()}
        />
        <AttachList api={files} showUse={false} />
        <AttachButton api={files} video className="self-start" />
        <SegmentedControl
          label="Qué prefieres"
          size="sm"
          value={prefer}
          onValueChange={setPrefer}
          options={[
            { value: "auto", label: "Lo que convenga" },
            { value: "animacion", label: "Animación" },
            { value: "grafico", label: "Gráfico" },
          ]}
        />
        <Button size="sm" onClick={ask} disabled={asking || files.uploading || wish.trim().length < 3} icon={asking ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Wand2 className="h-3.5 w-3.5" aria-hidden />}>
          {files.uploading ? "Subiendo los adjuntos…" : asking ? "Armando el pedido…" : "Armar el pedido"}
        </Button>
        {note && <p className="text-xs text-muted">{note}</p>}
        {items && items.length > 0 && (
          <ul className="flex flex-col gap-2">
            {items.map((it, i) => (
              <li key={`${it.title}-${i}`} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-card p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{it.title}</p>
                    <p className="text-[11px] text-muted">
                      {it.kind === "grafico" ? "Gráfico" : it.kind === "video" ? "Tu video como b-roll" : "Animación"} · {it.scope === "todo" ? "todo el video" : `${timeOf(it)} · «${api.textOf(it.from_word, it.to_word, 60)}»`}
                    </p>
                    {it.attachments.length > 0 && (
                      <p className="mt-0.5 text-[11px] text-accent-hi">
                        Usa{" "}
                        {it.attachments
                          .map((x) => {
                            const a = files.list.find((f) => f.ref === x.ref);
                            return `${x.ref}${a ? ` «${a.name}»` : ""}${x.use === "inside" ? " (dentro de la animación)" : x.use === "style" ? " (estilo de referencia)" : ""}`;
                          })
                          .join(", ")}
                      </p>
                    )}
                  </div>
                  {it.scope !== "todo" && (
                    <button
                      type="button"
                      className="grid h-7 w-7 flex-none place-items-center rounded-lg text-muted hover:bg-white/[0.06] hover:text-white"
                      aria-label="Ver ese momento"
                      title="Ver ese momento"
                      onClick={() => {
                        const w = timeline.words.find((x) => x.id >= it.from_word);
                        if (w) api.actions.seek(w.start);
                      }}
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </div>
                {it.kind !== "video" && <label htmlFor={`edit-item-${i}`} className="sr-only">Pedido</label>}
                {it.kind !== "video" && (
                  <Textarea id={`edit-item-${i}`} value={it.prompt} maxLength={1500} onChange={(e) => setItems((list) => list?.map((x, k) => (k === i ? { ...x, prompt: e.target.value } : x)) ?? list)} className="!min-h-24 text-xs" />
                )}
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" disabled={it.kind !== "video" && it.prompt.trim().length < 3} onClick={() => use(it, i)}>
                    {it.kind === "video" ? "Ponerlo ahí" : it.scope === "todo" ? "Animar todo con esto" : it.kind === "grafico" ? "Crear el gráfico" : "Crear la animación"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setItems((list) => list?.filter((_, k) => k !== i) ?? list)}>
                    Descartar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Tool>

      <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-white/15 p-3">
        <p className="text-sm font-semibold text-white">Editar todo con IA</p>
        <p className="text-xs text-muted">La IA hace todo junto: cortes, gancho, subtítulos, b-roll, animaciones y sonido. Tarda unos minutos y puedes revisar todo después.</p>
        {dirty && <p className="text-xs text-warning">Guarda tus cambios antes: la IA parte de lo guardado.</p>}
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={confirmAll ? "primary" : "ghost"}
            disabled={dirty || editing}
            icon={editing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Wand2 className="h-3.5 w-3.5" aria-hidden />}
            onClick={() => {
              if (!confirmAll) {
                setConfirmAll(true);
                return;
              }
              startEditAll(async () => {
                const r = await editAction(projectId, EDIT_ALL);
                if (!r.ok) toast.error(r.error);
                setConfirmAll(false);
              });
            }}
          >
            {editing ? "Enviando…" : confirmAll ? "Sí, editar todo" : "Editar todo con IA"}
          </Button>
          {confirmAll && !editing && (
            <Button size="sm" variant="ghost" onClick={() => setConfirmAll(false)}>
              Cancelar
            </Button>
          )}
        </div>
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
