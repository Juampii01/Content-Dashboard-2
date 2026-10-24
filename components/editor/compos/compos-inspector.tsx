"use client";

import { useState } from "react";
import { Bot, Check, Clapperboard, Copy, ImageIcon, Loader2, PenLine, Trash2, Wand2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { secondsLabel, timeLabel } from "@/lib/video/studio";
import type { Composition } from "@/lib/video/compos/schema";
import { cn } from "@/lib/utils";
import type { StudioApi } from "../studio/types";

const SOURCE: Record<Composition["source"], { label: string; icon: React.ReactNode }> = {
  copy: { label: "Copiada de la referencia", icon: <Copy className="h-3.5 w-3.5" aria-hidden /> },
  director: { label: "La creó el director para este momento", icon: <Bot className="h-3.5 w-3.5" aria-hidden /> },
  user: { label: "La pediste tú", icon: <WandSparkles className="h-3.5 w-3.5" aria-hidden /> },
};

const IDEAS_CHANGE = ["Más grande", "Que entre más rápido", "Con los colores de mi marca", "Que vaya detrás de mí", "Otra tipografía, más gruesa"];
export const IDEAS_NEW = ["Crea con IA un mapa del mundo, haz foco en el país que nombro y trae una flecha con su nombre", "La cifra que digo en una tarjeta 3D que gira", "Lista que aparece a medida que nombro cada cosa", "Mi palabra clave gigante detrás de mí"];

/** Estado de un pedido en curso, para mostrar debajo del campo. */
export function ComposProgress({ api, compId }: { api: StudioApi; compId?: string }) {
  const w = api.compos.work;
  if (!w || w.done) return null;
  if (compId && w.request?.replaceId !== compId) return null;
  const t = w.tasks[0];
  const step: Record<string, string> = {
    plan: "Pensando la animación…",
    images: "Generando la imagen con IA…",
    vision: "Mirando la imagen para ubicar cada cosa…",
    code: "Programando la animación…",
    look: "Dibujándola sobre tu video…",
    looking: "Revisándola cuadro a cuadro…",
  };
  return (
    <p className="flex items-center gap-2 rounded-xl bg-accent/10 px-3 py-2 text-xs text-accent-glow" role="status" aria-live="polite">
      <Loader2 className="h-3.5 w-3.5 flex-none animate-spin motion-reduce:animate-none" aria-hidden />
      {t ? (step[t.status] ?? "Creando la animación…") : "Empezando…"} <span className="text-muted">Puedes seguir editando.</span>
    </p>
  );
}

/** "Pide una animación aquí": texto libre sobre el tramo elegido. */
export function AskAnimation({ api, from, to }: { api: StudioApi; from: number; to: number }) {
  const [text, setText] = useState("");
  const busy = api.compos.running;
  async function send() {
    if (text.trim().length < 3) return;
    const ok = await api.compos.request({ from_word: from, to_word: to, instruction: text.trim(), replace: null });
    if (ok) setText("");
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#8b5cf6]/40 bg-[#8b5cf6]/[0.08] p-3">
      <label htmlFor="ask-animation" className="flex items-center gap-1.5 text-sm font-semibold text-white">
        <WandSparkles className="h-4 w-4 text-[#c4b5fd]" aria-hidden /> Pide una animación aquí
      </label>
      <p className="text-xs text-muted">Descríbela como a un motion designer: qué se ve, cómo se mueve y cuándo. Puede llevar imágenes creadas con IA. La programamos a medida para este tramo.</p>
      <Textarea id="ask-animation" value={text} onChange={(e) => setText(e.target.value)} maxLength={600} className="!min-h-20 text-sm" placeholder="Ej.: un mapa del mundo creado con IA, zoom a Francia, la remarca y una flecha que diga «el mejor país del mundo»" disabled={busy} onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && void send()} />
      <div className="flex flex-wrap gap-1.5" aria-label="Ideas de animaciones">
        {IDEAS_NEW.map((s) => (
          <button key={s} type="button" className="pill border border-white/10 text-left text-[11px] text-muted transition hover:border-white/25 hover:text-text" onClick={() => setText(s)} disabled={busy}>
            {s}
          </button>
        ))}
      </div>
      <Button size="sm" onClick={() => void send()} disabled={busy || text.trim().length < 3} icon={busy ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Wand2 className="h-3.5 w-3.5" aria-hidden />}>
        {busy ? "Creando una animación…" : "Crear animación"}
      </Button>
      {api.compos.error && <p className="text-xs text-danger">{api.compos.error}</p>}
      <ComposProgress api={api} />
    </div>
  );
}

/** Una animación elegida: qué es, por qué, cuánto se parece a la referencia, sus textos y "Pídele un cambio". */
export function ComposInspectorBody({ api, item }: { api: StudioApi; item: Composition }) {
  const { props } = api;
  const seg = api.composSegs.find((s) => s.id === item.id) ?? null;
  const [ask, setAsk] = useState("");
  const busy = api.compos.running;
  const src = SOURCE[item.source];
  async function change() {
    if (ask.trim().length < 3) return;
    const ok = await api.compos.request({ from_word: item.from_word, to_word: item.to_word, instruction: ask.trim(), replace: item });
    if (ok) setAsk("");
  }
  const setParam = (key: string, value: string) => api.update((s) => ({ ...s, compositions: s.compositions.map((c) => (c.id === item.id ? { ...c, params: c.params.map((p) => (p.key === key ? { ...p, value } : p)) } : c)) }), { coalesce: `compos:${item.id}:${key}` });
  return (
    <>
      <div className="flex flex-col gap-3 p-4">
        {seg ? (
          <p className="font-mono text-[11px] text-muted tabular-nums">
            {timeLabel(seg.start)} – {timeLabel(seg.end)} · {secondsLabel(seg.end - seg.start)}
          </p>
        ) : (
          <p className="text-xs text-warning">Cae sobre palabras cortadas: no se ve en el video.</p>
        )}
        <div className="flex flex-col gap-2 rounded-xl border border-[#8b5cf6]/35 bg-[#8b5cf6]/[0.08] p-3 text-xs">
          <p className="flex items-center gap-1.5 font-semibold text-[#c4b5fd]">
            {src.icon} {src.label}
          </p>
          {item.why && <p className="text-text">{api.humanize(item.why)}</p>}
          {item.request && <p className="text-muted">Pedido: «{item.request}»</p>}
          {item.match && (
            <div className="flex items-center gap-2" aria-label={`Parecido con la referencia: ${item.match.score} por ciento`}>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <span className={cn("block h-full rounded-full", item.match.score >= 75 ? "bg-success" : item.match.score >= 55 ? "bg-warning" : "bg-danger")} style={{ width: `${item.match.score}%` }} />
              </span>
              <span className="font-mono text-[11px] text-white tabular-nums">{item.match.score} %</span>
            </div>
          )}
          {item.match?.note && <p className="text-muted">{api.humanize(item.match.note)}</p>}
          {(item.images ?? []).length > 0 && (
            <p className="flex items-center gap-1.5 text-muted">
              <ImageIcon className="h-3.5 w-3.5" aria-hidden /> Usa {(item.images ?? []).length === 1 ? "una imagen creada" : `${(item.images ?? []).length} imágenes creadas`} con IA (quedan guardadas en este proyecto).
            </p>
          )}
        </div>
        {props.canEdit && (
          <div className="flex flex-wrap gap-2">
            {item.source !== "user" && (
              <Button size="sm" variant="ghost" icon={<Check className="h-3.5 w-3.5" aria-hidden />} onClick={() => api.update((s) => ({ ...s, compositions: s.compositions.map((c) => (c.id === item.id ? { ...c, source: "user" as const } : c)) }))}>
                Aceptar
              </Button>
            )}
            <Button size="sm" variant="subtle" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={api.actions.removeSelection} title="Quitar (Supr)">
              Quitar
            </Button>
          </div>
        )}
      </div>
      {item.params.length > 0 && (
        <section className="border-b border-white/[0.06] px-4 pb-4">
          <h3 className="flex items-center gap-2 py-3 text-sm font-semibold text-white">
            <PenLine className="h-4 w-4 text-accent-hi" aria-hidden /> Textos
          </h3>
          <fieldset disabled={!props.canEdit} className="flex flex-col gap-2.5">
            {item.params.map((p) => (
              <Field key={p.key} label={p.label} htmlFor={`cp-${item.id}-${p.key}`}>
                <Input id={`cp-${item.id}-${p.key}`} value={p.value} maxLength={160} onChange={(e) => setParam(p.key, e.target.value)} />
              </Field>
            ))}
            <p className="text-[11px] text-muted">Se actualiza en la vista previa sin volver a crear la animación.</p>
          </fieldset>
        </section>
      )}
      {props.canEdit && (
        <section className="flex flex-col gap-2 px-4 py-4">
          <label htmlFor={`ask-${item.id}`} className="flex items-center gap-1.5 text-sm font-semibold text-white">
            <Wand2 className="h-4 w-4 text-accent-hi" aria-hidden /> Pídele un cambio a esta animación
          </label>
          <Textarea id={`ask-${item.id}`} value={ask} onChange={(e) => setAsk(e.target.value)} maxLength={600} className="!min-h-16 text-sm" placeholder="Ej.: que la cifra sea más grande y entre girando más rápido" disabled={busy} onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && void change()} />
          <div className="flex flex-wrap gap-1.5" aria-label="Ideas de cambios">
            {IDEAS_CHANGE.map((s) => (
              <button key={s} type="button" className="pill border border-white/10 text-[11px] text-muted transition hover:border-white/25 hover:text-text" onClick={() => setAsk(s)} disabled={busy}>
                {s}
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={() => void change()} disabled={busy || ask.trim().length < 3} icon={busy ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Clapperboard className="h-3.5 w-3.5" aria-hidden />}>
            {busy ? "Cambiando la animación…" : "Reescribir la animación"}
          </Button>
          {api.compos.error && <p className="text-xs text-danger">{api.compos.error}</p>}
          <ComposProgress api={api} compId={item.id} />
          <p className="text-[11px] text-muted">La reescribe la IA (cuesta de USD 0,30 a 0,80 de tu tope). Puedes deshacer el cambio con Cmd+Z.</p>
        </section>
      )}
    </>
  );
}
