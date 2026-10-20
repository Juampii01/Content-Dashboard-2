import { Activity, Captions, Film, Music2, Sparkles } from "lucide-react";
import { describeMetrics, describePreset, type StyleFact, type StyleMetrics, type StylePreset } from "@/lib/video/style";
import { CaptionOverlay } from "./caption-overlay";

/** Lo que se midió en la referencia y cómo se va a aplicar. */
export function StyleDetail({ metrics, preset, thumbUrl }: { metrics: StyleMetrics; preset: StylePreset; thumbUrl: string | null }) {
  const facts = describeMetrics(metrics);
  const vertical = metrics.aspect !== "16:9";
  const sample = {
    start: 0,
    end: 2,
    words: ["Así", "se", "ven", "tus", "subtítulos", "nuevos"]
      .slice(0, preset.captions?.wordsPerBlock ?? 3)
      .map((text, i) => ({ id: i, text, start: i * 0.4, end: i * 0.4 + 0.35, emphasis: false, stop: false })),
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <div className={vertical ? "relative mx-auto aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-2xl border border-white/10 bg-black" : "relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black"}>
          {/* Desenfocada: la referencia trae sus propios subtítulos y no deben mezclarse con la muestra. */}
          {thumbUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbUrl} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-55 blur-lg" />
          )}
          {preset.captions && <CaptionOverlay block={sample} time={0.45} preset="estilo" format={vertical ? "9:16" : "16:9"} accent="#FFD84D" height={vertical ? 533 : 300} captionStyle={preset.captions} />}
        </div>
        <p className="text-center text-xs text-muted">{preset.captions ? "Vista de muestra de los subtítulos del estilo." : "La referencia no tiene subtítulos: se usan los de tu marca."}</p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="card flex flex-col gap-3 p-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent-hi" aria-hidden />
            <h2 className="text-base font-semibold">Cómo lo aplicamos a tus videos</h2>
          </div>
          <ul className="flex flex-wrap gap-2">
            {describePreset(preset).map((f) => (
              <li key={f} className="pill">
                {f}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">Copiamos el estilo, nunca el contenido. En cada video puedes apagar los zooms y cambiar o quitar cada b-roll antes de renderizar.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FactCard title="Ritmo" icon={<Activity className="h-4 w-4" aria-hidden />} facts={facts.rhythm} />
          <FactCard title="Imagen" icon={<Film className="h-4 w-4" aria-hidden />} facts={facts.visual} />
          <FactCard title="Subtítulos" icon={<Captions className="h-4 w-4" aria-hidden />} facts={facts.captions} swatches={metrics.captions.detected ? [metrics.captions.textColor, metrics.captions.highlightColor, metrics.captions.boxColor] : []} />
          <FactCard title="Audio" icon={<Music2 className="h-4 w-4" aria-hidden />} facts={facts.audio} />
        </div>
      </div>
    </div>
  );
}

function FactCard({ title, icon, facts, swatches = [] }: { title: string; icon: React.ReactNode; facts: StyleFact[]; swatches?: (string | null)[] }) {
  return (
    <section className="card flex flex-col gap-3 p-5" aria-label={title}>
      <div className="flex items-center gap-2 text-accent-hi">
        {icon}
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {swatches.filter(Boolean).length > 0 && (
          <span className="ml-auto flex gap-1" aria-hidden>
            {swatches.filter(Boolean).map((c) => (
              <span key={c} className="h-4 w-4 rounded-full border border-white/30" style={{ background: c! }} />
            ))}
          </span>
        )}
      </div>
      <dl className="flex flex-col gap-2">
        {facts.map((f) => (
          <div key={f.label} className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] pb-2 last:border-0 last:pb-0">
            <dt className="text-xs text-muted">{f.label}</dt>
            <dd className="text-right text-sm font-semibold text-white">
              {f.value}
              {f.hint && <span className="block text-[11px] font-normal text-muted">{f.hint}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
