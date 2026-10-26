"use client";

import { useEffect, useState } from "react";
import { BookmarkMinus, BookmarkPlus, Bot, Check, Clapperboard, Copy, ImageIcon, Loader2, PenLine, Trash2, UserRound, Wand2, WandSparkles, X } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { myEffectStateAction, removeMyEffectAction, renameMyEffectAction, saveToMyEffectsAction } from "../my-effects-actions";
import { myEffectsChanged } from "../studio/library-mine";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { secondsLabel, timeLabel } from "@/lib/video/studio";
import type { Composition } from "@/lib/video/compos/schema";
import { cn } from "@/lib/utils";
import type { StudioApi } from "../studio/types";
import { isActive, requestStage } from "./use-compos-work";

const SOURCE: Record<Composition["source"], { label: string; icon: React.ReactNode }> = {
  copy: { label: "Copiada de la referencia", icon: <Copy className="h-3.5 w-3.5" aria-hidden /> },
  director: { label: "La creó el director para este momento", icon: <Bot className="h-3.5 w-3.5" aria-hidden /> },
  user: { label: "La pediste tú", icon: <WandSparkles className="h-3.5 w-3.5" aria-hidden /> },
};

const IDEAS_CHANGE = ["Más grande", "Que entre más rápido", "Con los colores de mi marca", "Que vaya detrás de mí", "Otra tipografía, más gruesa"];
export const IDEAS_NEW = ["Crea con IA un mapa del mundo, haz foco en el país que nombro y trae una flecha con su nombre", "La cifra que digo en una tarjeta 3D que gira", "Lista que aparece a medida que nombro cada cosa", "Mi palabra clave gigante detrás de mí"];

/** Pedidos en curso para mostrar debajo del campo (los de este tramo, o el cambio de esta animación). */
export function ComposProgress({ api, compId, from, to }: { api: StudioApi; compId?: string; from?: number; to?: number }) {
  const list = api.compos.requests.filter((r) => isActive(r) && (compId ? r.request?.replaceId === compId : from == null || (r.request && r.request.from_word <= (to ?? from) && from <= r.request.to_word)));
  if (!list.length) return null;
  return (
    <ul className="flex flex-col gap-1" aria-live="polite">
      {list.map((r) => (
        <li key={r.id} className="flex items-center gap-2 rounded-xl bg-[#8b5cf6]/10 px-3 py-2 text-xs text-[#5b3fd1]">
          <Loader2 className="h-3.5 w-3.5 flex-none animate-spin motion-reduce:animate-none" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            {requestStage(r)} <span className="text-muted">«{r.request?.instruction}»</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Pedidos de animaciones en curso (pestaña IA y pedido elegido en la pista): qué se pidió, en qué va, y cancelar. Los
 * que no se pudieron hacer quedan con su motivo hasta cerrarlos.
 */
export function RequestsPanel({ api, only }: { api: StudioApi; only?: string }) {
  const list = api.compos.requests.filter((r) => !only || r.id === only);
  if (!list.length) return only ? <p className="px-4 py-3 text-sm text-muted">Este pedido ya terminó.</p> : null;
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-[#8b5cf6]/35 bg-[#8b5cf6]/[0.06] p-3" aria-label="Animaciones en curso" data-testid="compos-requests">
      {!only && (
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white">
          <WandSparkles className="h-4 w-4 text-[#5b3fd1]" aria-hidden /> Animaciones en curso
          <span className="font-mono text-[11px] font-normal text-muted">{list.filter(isActive).length}</span>
        </h3>
      )}
      <ul className="flex flex-col gap-1.5">
        {list.map((r) => {
          const range = r.request ? api.textOf(r.request.from_word, r.request.to_word, 40) : "";
          const failed = r.status === "failed";
          return (
            <li key={r.id} className={cn("flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs", failed ? "border-danger/40 bg-danger/[0.06]" : "border-white/10 bg-white/[0.03]")} data-testid="compos-request">
              {failed ? <X className="mt-0.5 h-3.5 w-3.5 flex-none text-danger" aria-hidden /> : <Loader2 className="mt-0.5 h-3.5 w-3.5 flex-none animate-spin text-[#5b3fd1] motion-reduce:animate-none" aria-hidden />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-white">{r.request?.replaceId ? "Cambio: " : ""}{r.request?.instruction}</span>
                <span className="block truncate text-muted">
                  {requestStage(r)}
                  {range ? ` · «${range}»` : ""}
                </span>
                {failed && <span className="mt-0.5 block text-danger">{r.error ?? r.tasks[0]?.error ?? "Prueba de nuevo con otras palabras."}</span>}
              </span>
              {api.props.canEdit && (
                <button
                  type="button"
                  onClick={() => void (failed ? api.compos.dismiss(r.id) : api.compos.cancel(r.id))}
                  className="flex-none rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-muted hover:bg-white/[0.07] hover:text-white"
                  aria-label={failed ? "Cerrar este aviso" : `Cancelar «${r.request?.instruction ?? ""}»`}
                  disabled={r.id.startsWith("tmp-")}
                >
                  {failed ? "Cerrar" : "Cancelar"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "Pide una animación aquí": texto libre sobre el tramo elegido. */
export function AskAnimation({ api, from, to }: { api: StudioApi; from: number; to: number }) {
  const [text, setText] = useState("");
  // Siempre habilitada: cada pedido corre por su cuenta (se pueden pedir varios seguidos).
  async function send() {
    const instruction = text.trim();
    if (instruction.length < 3) return;
    setText("");
    const ok = await api.compos.request({ from_word: from, to_word: to, instruction, replace: null });
    if (!ok && api.compos.error) setText(instruction);
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#8b5cf6]/40 bg-[#8b5cf6]/[0.08] p-3">
      <label htmlFor="ask-animation" className="flex items-center gap-1.5 text-sm font-semibold text-white">
        <WandSparkles className="h-4 w-4 text-[#5b3fd1]" aria-hidden /> Pide una animación aquí
      </label>
      <p className="text-xs text-muted">Descríbela como a un motion designer: qué se ve, cómo se mueve y cuándo. Puede llevar imágenes creadas con IA. La programamos a medida para este tramo.</p>
      <Textarea id="ask-animation" value={text} onChange={(e) => setText(e.target.value)} maxLength={1500} className="!min-h-20 text-sm" placeholder="Ej.: un mapa del mundo creado con IA, zoom a Francia, la remarca y una flecha que diga «el mejor país del mundo»" onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && void send()} />
      <div className="flex flex-wrap gap-1.5" aria-label="Ideas de animaciones">
        {IDEAS_NEW.map((s) => (
          <button key={s} type="button" className="pill border border-white/10 text-left text-[11px] text-muted transition hover:border-white/25 hover:text-text" onClick={() => setText(s)}>
            {s}
          </button>
        ))}
      </div>
      <Button size="sm" onClick={() => void send()} disabled={text.trim().length < 3} icon={<Wand2 className="h-3.5 w-3.5" aria-hidden />}>
        Crear animación
      </Button>
      <p className="text-[11px] text-muted">Puedes pedir varias seguidas: cada una aparece en la pista Animaciones mientras se crea y cae en su propia capa.</p>
      {api.compos.error && <p className="text-xs text-danger">{api.compos.error}</p>}
      <ComposProgress api={api} from={from} to={to} />
    </div>
  );
}

/** Una animación elegida: qué es, por qué, cuánto se parece a la referencia, sus textos y "Pídele un cambio". */
export function ComposInspectorBody({ api, item }: { api: StudioApi; item: Composition }) {
  const { props } = api;
  const seg = api.composSegs.find((s) => s.id === item.id) ?? null;
  const [ask, setAsk] = useState("");
  // Un cambio a esta animación a la vez (los demás pedidos del video siguen en paralelo).
  const busy = api.compos.requests.some((r) => isActive(r) && r.request?.replaceId === item.id);
  const src = SOURCE[item.source];
  // Pieza única: la escena donde está el cabezal (los cambios se piden por escena).
  const local = seg ? Math.max(0, api.time - seg.start) : 0;
  const sceneIndex = item.long && item.scenes?.length ? Math.max(0, item.scenes.findIndex((sc) => local >= sc.start && local < sc.end)) : -1;
  const scene = sceneIndex >= 0 ? item.scenes![sceneIndex]! : null;
  async function change() {
    if (ask.trim().length < 3) return;
    const ok = await api.compos.request({ from_word: item.from_word, to_word: item.to_word, instruction: ask.trim(), replace: item, at: scene ? local : null });
    if (ok) setAsk("");
  }
  const setFrame = (patch: Partial<NonNullable<Composition["frame"]>>) =>
    api.update((s) => ({ ...s, compositions: s.compositions.map((c) => (c.id === item.id && c.frame ? { ...c, frame: { ...c.frame, ...patch } } : c)) }), { coalesce: `frame:${item.id}` });
  const setParam = (key: string, value: string) => api.update((s) => ({ ...s, compositions: s.compositions.map((c) => (c.id === item.id ? { ...c, params: c.params.map((p) => (p.key === key ? { ...p, value } : p)) } : c)) }), { coalesce: `compos:${item.id}:${key}` });
  return (
    <>
      <div className="flex flex-col gap-3 p-4">
        {api.maskMissing.has(item.id) && (
          <p className="flex items-center gap-1.5 rounded-xl bg-accent/10 px-3 py-2 text-xs text-accent-glow" aria-live="polite" data-testid="compos-mask-wait">
            {api.masks.pending ? <Loader2 className="h-3.5 w-3.5 flex-none animate-spin motion-reduce:animate-none" aria-hidden /> : <UserRound className="h-3.5 w-3.5 flex-none" aria-hidden />}
            {api.masks.pending
              ? "Recortándote del fondo para la vista previa… Mientras tanto se ve el video completo en tu lugar."
              : api.masks.failed
                ? "No pudimos recortarte para la vista previa. Al renderizar se vuelve a intentar."
                : "La vista previa todavía no tiene tu recorte: se ve el video completo en tu lugar."}
          </p>
        )}
        {seg ? (
          <p className="font-mono text-[11px] text-muted tabular-nums">
            {timeLabel(seg.start)} – {timeLabel(seg.end)} · {secondsLabel(seg.end - seg.start)}
          </p>
        ) : (
          <p className="text-xs text-warning">Cae sobre palabras cortadas: no se ve en el video.</p>
        )}
        <div className="flex flex-col gap-2 rounded-xl border border-[#8b5cf6]/35 bg-[#8b5cf6]/[0.08] p-3 text-xs">
          <p className="flex items-center gap-1.5 font-semibold text-[#5b3fd1]">
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
        {props.canEdit && <MyEffectControls api={api} item={item} />}
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
      {item.long && (item.scenes ?? []).length > 0 && seg && (
        <section className="border-b border-white/[0.06] px-4 pb-4">
          <h3 className="flex items-center gap-2 py-3 text-sm font-semibold text-white">
            <Clapperboard className="h-4 w-4 text-accent-hi" aria-hidden /> Escenas de la pieza
          </h3>
          <ol className="flex flex-col gap-1">
            {item.scenes!.map((sc, i) => (
              <li key={`${i}-${sc.start}`}>
                <button
                  type="button"
                  onClick={() => api.actions.seek(seg.start + sc.start + 0.05)}
                  className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition", i === sceneIndex ? "bg-[#8b5cf6]/15 text-white" : "text-muted hover:bg-white/[0.05]")}
                  aria-current={i === sceneIndex ? "step" : undefined}
                >
                  <span className="font-mono tabular-nums">{timeLabel(seg.start + sc.start)}</span>
                  <span className="truncate">{sc.title}</span>
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] text-muted">Pon el cabezal en una escena y pídele el cambio abajo: se rehace solo esa escena.</p>
        </section>
      )}
      {item.frame && props.canEdit && (
        <section className="border-b border-white/[0.06] px-4 pb-4">
          <h3 className="flex items-center gap-2 py-3 text-sm font-semibold text-white">
            <UserRound className="h-4 w-4 text-accent-hi" aria-hidden /> Tu cara abajo
          </h3>
          <p className="mb-2 text-[11px] text-muted">El mismo encuadre en toda la pieza. Se ajusta al instante, sin volver a crear la animación.</p>
          {(
            [
              ["zoom", "Acercar", 1, 4, 0.05],
              ["cx", "Izquierda · derecha", 0, 1, 0.01],
              ["cy", "Arriba · abajo", 0, 1, 0.01],
            ] as const
          ).map(([key, label, min, max, step]) => (
            <label key={key} className="mb-2 flex flex-col gap-1 text-xs text-muted">
              {label}
              <input
                type="range"
                className="range"
                min={min}
                max={max}
                step={step}
                value={item.frame![key]}
                onChange={(e) => setFrame({ [key]: Number(e.target.value) })}
                style={{ ["--pct" as string]: `${((item.frame![key] - min) / (max - min)) * 100}%` }}
              />
            </label>
          ))}
        </section>
      )}
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
            <Wand2 className="h-4 w-4 text-accent-hi" aria-hidden /> {scene ? `Pídele un cambio a la escena «${scene.title}»` : "Pídele un cambio a esta animación"}
          </label>
          <Textarea id={`ask-${item.id}`} value={ask} onChange={(e) => setAsk(e.target.value)} maxLength={1500} className="!min-h-16 text-sm" placeholder="Ej.: que la cifra sea más grande y entre girando más rápido" disabled={busy} onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && void change()} />
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
          <p className="text-[11px] text-muted">{scene ? "La IA rehace esa escena y deja el resto de la pieza igual." : "La reescribe la IA."} Puedes deshacer el cambio con Cmd+Z.</p>
        </section>
      )}
    </>
  );
}

/**
 * "Guardar en mis efectos" / "Quitar de mis efectos" y renombrar. Lo que se guarda es la animación tal como quedó
 * guardada en el video (el servidor toma su código del plan, nunca del navegador).
 */
function MyEffectControls({ api, item }: { api: StudioApi; item: Composition }) {
  const [state, setState] = useState<{ id: string; saved: boolean; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const libId = item.lib_id ?? null;
  useEffect(() => {
    let alive = true;
    if (!libId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sin efecto guardado no hay nada que consultar
      setState(null);
      return;
    }
    void myEffectStateAction(libId).then((r) => {
      if (!alive || !r.ok) return;
      setState(r.data ? { id: libId, ...r.data } : null);
      setName(r.data?.name ?? "");
    });
    return () => {
      alive = false;
    };
  }, [libId]);

  async function save() {
    setBusy(true);
    // Si el último cambio todavía no se guardó, se espera al guardado automático (1,2 s) y se reintenta.
    let res = await saveToMyEffectsAction(api.props.projectId, item.id);
    for (let i = 0; i < 3 && !res.ok && /prueba de nuevo en un segundo/.test(res.error); i++) {
      await new Promise((r) => setTimeout(r, 1600));
      res = await saveToMyEffectsAction(api.props.projectId, item.id);
    }
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    const { id, status, name: saved, version } = res.data;
    api.update((s) => ({ ...s, compositions: s.compositions.map((c) => (c.id === item.id ? { ...c, lib_id: id } : c)) }));
    setState({ id, saved: true, name: saved });
    setName(saved);
    myEffectsChanged();
    toast.success(status === "exists" ? `«${saved}» ya estaba en Mis efectos.` : status === "version" ? `Guardada como versión ${version} de «${saved}».` : `Guardamos «${saved}» en Mis efectos.`, { description: "La encuentras arriba de todo en Biblioteca → Efectos, para usarla en otros videos." });
  }
  async function remove() {
    if (!state) return;
    setBusy(true);
    const res = await removeMyEffectAction(state.id);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    setState({ ...state, saved: false });
    myEffectsChanged();
    toast.success(`Quitamos «${state.name}» de Mis efectos.`, { description: "Sigue en este video. No se vuelve a guardar sola al renderizar." });
  }
  async function rename() {
    if (!state || !name.trim() || name.trim() === state.name) return;
    const res = await renameMyEffectAction(state.id, name);
    if (!res.ok) return void toast.error(res.error);
    const clean = name.replace(/\s+/g, " ").trim().slice(0, 60);
    setState({ ...state, name: clean });
    api.update((s) => ({ ...s, compositions: s.compositions.map((c) => (c.id === item.id ? { ...c, name: clean } : c)) }));
    myEffectsChanged();
    toast.success("Nombre guardado.");
  }

  if (state?.saved)
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3" data-testid="my-effect-saved">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-[#5b3fd1]">
          <BookmarkPlus className="h-3.5 w-3.5" aria-hidden /> Está en Mis efectos
        </p>
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Nombre en Mis efectos" className="!h-8 text-xs" />
          <Button size="sm" variant="ghost" type="submit" disabled={!name.trim() || name.trim() === state.name}>
            Renombrar
          </Button>
        </form>
        <Button size="sm" variant="subtle" icon={<BookmarkMinus className="h-3.5 w-3.5" aria-hidden />} onClick={() => void remove()} disabled={busy}>
          Quitar de mis efectos
        </Button>
      </div>
    );
  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" variant="ghost" icon={busy ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <BookmarkPlus className="h-3.5 w-3.5" aria-hidden />} onClick={() => void save()} disabled={busy}>
        Guardar en mis efectos
      </Button>
      <p className="text-[11px] text-muted">{state && !state.saved ? "La quitaste de Mis efectos: guárdala de nuevo si la quieres usar en otros videos." : "Se guarda sola al renderizar; guárdala ahora para usarla ya en otro video."}</p>
    </div>
  );
}
