import { Clapperboard, FileText, Lightbulb, Megaphone, Mic, Palette, ShieldCheck, Sparkles } from "lucide-react";
import { StatusBadge } from "@/components/ui/badges";
import { ButtonLink } from "@/components/ui/button";
import type { CopyView } from "@/lib/dal/reel-copies";
import { formatDuration } from "@/lib/format";
import { ctaKindLabel, editWithStyleHref, hookTypeLabel, recordHref, secondsLabel, type ReelCopyAnalysis } from "@/lib/scripts/reel-copy";
import { cn } from "@/lib/utils";
import { describePreset } from "@/lib/video/style";

/** Resultado de "Copia este reel": la estructura del original, la versión propia y su estilo de edición. */
export function CopyReelResult({ copy, canEdit }: { copy: CopyView; canEdit: boolean }) {
  const a = copy.analysis;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section className="hero-panel flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="copy-ready-title">
        <div>
          <p className="eyebrow mb-1.5">Listo</p>
          <h2 id="copy-ready-title" className="text-xl font-semibold">
            {copy.script ? copy.script.title : "Tu versión está lista"}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Misma estructura que el original, con {copy.topic ? "tu tema" : "un tema elegido para tu marca"} y tu voz. Revisa los ganchos, grábalo y edítalo con el mismo estilo.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {copy.script && canEdit && (
            <ButtonLink href={recordHref(copy.script.id)} icon={<Mic className="h-4 w-4" aria-hidden />}>
              Grabar con este guion
            </ButtonLink>
          )}
          {copy.style?.status === "READY" && canEdit && (
            <ButtonLink href={editWithStyleHref(copy.style.id, copy.script?.id ?? null)} variant="ghost" icon={<Clapperboard className="h-4 w-4" aria-hidden />}>
              Usar este estilo en mi próximo video
            </ButtonLink>
          )}
          {copy.script && (
            <ButtonLink href={`/guiones/${copy.script.id}`} variant="subtle" icon={<FileText className="h-4 w-4" aria-hidden />}>
              Abrir el guion completo
            </ButtonLink>
          )}
        </div>
      </section>

      {a && <Structure analysis={a} />}

      <div className="grid gap-5 xl:grid-cols-2">
        {copy.script ? <Version copy={copy} /> : <MissingCard text="El guion de esta copia se borró. La estructura del original sigue aquí abajo." />}
        {copy.style?.status === "READY" && copy.style.preset ? (
          <section className="card flex flex-col gap-4 p-5" aria-labelledby="copy-style-title">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-accent-hi" aria-hidden />
              <h3 id="copy-style-title" className="text-base font-semibold">
                Tu estilo de edición
              </h3>
            </div>
            <p className="text-sm text-muted">Medimos cómo está editado el original y lo guardamos como un estilo del Editor. Se aplica a tu video, nunca copia sus imágenes.</p>
            <ul className="flex flex-wrap gap-2">
              {describePreset(copy.style.preset).map((f) => (
                <li key={f} className="pill">
                  {f}
                </li>
              ))}
            </ul>
            {a && (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Fact label="Duración" value={formatDuration(a.durationSeconds)} />
                <Fact label="Cortes por minuto" value={String(Math.round(a.cutsPerMinute))} />
                <Fact label="Palabras por segundo" value={a.wordsPerSecond ? a.wordsPerSecond.toFixed(1) : "—"} />
              </dl>
            )}
            <ButtonLink href={`/editor/estilos/${copy.style.id}`} variant="subtle" size="sm" className="self-start">
              Ver el estilo completo
            </ButtonLink>
          </section>
        ) : (
          <MissingCard text={copy.style ? "El estilo de edición todavía no está listo." : "El estilo de edición de esta copia se borró."} />
        )}
      </div>

      <p className="flex items-start gap-2 text-xs text-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-accent-hi" aria-hidden />
        El video original ya se borró. Guardamos solo su estructura y su estilo de edición: ni el video ni su texto.
      </p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="mt-0.5 font-mono text-lg font-semibold text-white">{value}</dd>
    </div>
  );
}

function MissingCard({ text }: { text: string }) {
  return <div className="card grid place-items-center p-6 text-center text-sm text-muted">{text}</div>;
}

const partTone = ["bg-accent-hi", "bg-accent/70", "bg-accent/45", "bg-accent/30", "bg-accent/55", "bg-accent/40"];

/** La estructura del original: una línea de tiempo proporcional y cada parte explicada. */
function Structure({ analysis: a }: { analysis: ReelCopyAnalysis }) {
  const total = Math.max(1, a.cta?.end ?? a.beats.at(-1)?.end ?? a.hook.end);
  const segments = [
    { key: "hook", label: "Gancho", seconds: a.hook.seconds, start: a.hook.start, end: a.hook.end, className: "bg-accent-hi" },
    ...a.beats.map((b, i) => ({ key: `b${i}`, label: `Beat ${i + 1}`, seconds: b.seconds, start: b.start, end: b.end, className: partTone[(i + 1) % partTone.length]! })),
    ...(a.cta ? [{ key: "cta", label: "CTA", seconds: a.cta.seconds, start: a.cta.start, end: a.cta.end, className: "bg-accent-glow" }] : []),
  ];
  return (
    <section className="card flex flex-col gap-5 p-5 sm:p-6" aria-labelledby="copy-structure-title">
      <div>
        <p className="eyebrow mb-1.5">El original</p>
        <h3 id="copy-structure-title" className="text-base font-semibold">
          Así está armado
        </h3>
        <p className="mt-1 text-sm text-muted">Trataba de {a.originalTopic.replace(/\.$/, "")}. Tu versión usa esta misma estructura con otro contenido.</p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/10" role="img" aria-label={`Estructura: ${segments.map((s) => `${s.label} ${secondsLabel(s.seconds)}`).join(", ")}`}>
          {segments.map((s, i) => {
            // Cada parte ocupa desde su inicio hasta el inicio de la siguiente (las pausas cuentan): la barra queda completa.
            const from = i === 0 ? 0 : s.start;
            const to = segments[i + 1]?.start ?? total;
            return <span key={s.key} className={cn("h-full border-r border-bg last:border-0", s.className)} style={{ width: `${(Math.max(0.2, to - from) / total) * 100}%` }} />;
          })}
        </div>
        <div className="flex justify-between font-mono text-[11px] text-muted">
          <span>0 s</span>
          <span>{secondsLabel(total)}</span>
        </div>
      </div>

      <ol className="flex flex-col gap-3">
        <Part icon={<Sparkles className="h-4 w-4" aria-hidden />} title="Gancho" meta={`${hookTypeLabel[a.hook.type]} · ${secondsLabel(a.hook.seconds)}`} text={a.hook.mechanism} />
        {a.beats.map((b, i) => (
          <Part key={i} number={i + 1} title={b.purpose} meta={`Beat ${i + 1} · ${secondsLabel(b.seconds)}`} text={`Recurso: ${b.technique}.`} />
        ))}
        {a.cta ? (
          <Part icon={<Megaphone className="h-4 w-4" aria-hidden />} title="CTA" meta={`${ctaKindLabel[a.cta.kind]} · ${secondsLabel(a.cta.seconds)}`} text={a.cta.description} />
        ) : (
          <Part icon={<Megaphone className="h-4 w-4" aria-hidden />} title="CTA" meta="Sin CTA" text="El original no le pide nada al público. Tu versión lleva uno según tu objetivo." />
        )}
      </ol>

      {a.whyItWorks.length > 0 && (
        <div className="rounded-xl border border-accent/30 bg-accent/[0.07] p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
            <Lightbulb className="h-4 w-4 text-accent-hi" aria-hidden /> Por qué funciona
          </p>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-text/90">
            {a.whyItWorks.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Part({ icon, number, title, meta, text }: { icon?: React.ReactNode; number?: number; title: string; meta: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-8 w-8 flex-none place-items-center rounded-full border border-accent-hi/40 bg-accent/15 font-mono text-xs font-bold text-accent-hi">{icon ?? number}</span>
      <div className="min-w-0 flex-1 border-b border-white/[0.06] pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="text-sm font-semibold text-white">{title}</p>
          <span className="font-mono text-[11px] text-muted">{meta}</span>
        </div>
        <p className="mt-0.5 text-sm text-muted">{text}</p>
      </div>
    </li>
  );
}

/** La versión propia: ganchos con su puntaje antes de publicar y el cuerpo en corto. */
function Version({ copy }: { copy: CopyView }) {
  const script = copy.script!;
  const c = script.content;
  const scored = copy.hookScores.some((h) => h.score != null);
  const best = Math.max(...copy.hookScores.map((h) => h.score ?? -1));
  return (
    <section className="card flex flex-col gap-4 p-5" aria-labelledby="copy-version-title">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-accent-hi" aria-hidden />
        <h3 id="copy-version-title" className="text-base font-semibold">
          Tu versión
        </h3>
        {script.estimatedSeconds ? <span className="ml-auto font-mono text-xs text-muted">≈ {formatDuration(script.estimatedSeconds)}</span> : null}
      </div>
      <p className="text-sm text-muted">{c.angle}</p>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-white">Ganchos {scored ? "con su puntaje antes de publicar" : ""}</p>
        <ul className="flex flex-col gap-2">
          {c.hooks.map((h, i) => {
            const s = copy.hookScores[i];
            return (
              <li key={i} className={cn("rounded-xl border p-3", i === c.selectedHook ? "border-accent/50 bg-accent/10" : "border-white/10")}>
                <p className="text-sm text-white">{h.text}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                  <span className="pill !py-0.5 !text-[11px]">{hookTypeLabel[h.type as keyof typeof hookTypeLabel] ?? h.type}</span>
                  {s?.score != null && (
                    <span className="font-mono">
                      Puntaje <strong className="text-white">{s.score}</strong>/100
                    </span>
                  )}
                  {s?.score != null && s.score === best && (
                    <StatusBadge tone="success" className="!px-2 !py-0.5 !text-[11px]">
                      Mejor puntaje
                    </StatusBadge>
                  )}
                  {i === c.selectedHook && <span className="text-accent-glow">Elegido</span>}
                </div>
              </li>
            );
          })}
        </ul>
        {!scored && (
          <p className="text-xs text-muted">
            {copy.scoreConfidence === "sin-datos" ? "Todavía no hay suficientes piezas publicadas para puntuar los ganchos con tus números. Conecta tus redes y el puntaje aparece solo." : "El puntaje aparece en el guion cuando haya datos de tus piezas."}
          </p>
        )}
      </div>

      <ol className="flex flex-col gap-2 border-t border-white/[0.06] pt-3">
        {c.beats.map((b, i) => (
          <li key={b.id} className="flex gap-2 text-sm">
            <span className="font-mono text-xs text-accent-hi">{i + 1}</span>
            <span className="line-clamp-2 text-text/90">{b.spoken}</span>
          </li>
        ))}
        <li className="flex gap-2 text-sm">
          <span className="font-mono text-xs text-accent-hi">CTA</span>
          <span className="line-clamp-2 text-text/90">{c.cta.spoken}</span>
        </li>
      </ol>
    </section>
  );
}
