"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/card";
import { Notice } from "@/components/ui/feedback";
import { Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/badges";
import { SegmentedControl } from "@/components/ui/tabs";
import { GraphicCanvas, useMotionScene } from "@/components/editor/graphic-canvas";
import { COMPONENTS, COMPONENT_NAMES, SAMPLE_THEMES, sceneFromV1, sceneSchema, validateCompiled, type ComponentName, type MotionScene } from "@/lib/video/motion";
import { brandGraphicLook, type GraphicSpec } from "@/lib/video/graphics";
import { cn } from "@/lib/utils";

type Variant = { format: "9:16" | "16:9"; mode: "full" | "overlay" };
const VARIANTS: Variant[] = [
  { format: "9:16", mode: "full" },
  { format: "9:16", mode: "overlay" },
  { format: "16:9", mode: "full" },
  { format: "16:9", mode: "overlay" },
];
const THEME_KEYS = Object.keys(SAMPLE_THEMES);

/** Los 6 gráficos v1 de siempre, convertidos al motor nuevo (compatibilidad con planes guardados). */
function v1Specs(): GraphicSpec[] {
  const look = brandGraphicLook({ colors: { primary: "#030a22", accent: "#4da3ff" }, fonts: { heading: "Inter" } });
  const base = { v: 1 as const, theme: look.theme, font: look.font, position: "top" as const };
  return [
    { ...base, template: "number", mode: "full", value: "+40%", label: "más citas agendadas en un mes" },
    { ...base, template: "list", mode: "full", title: "Lo que revisa un buen anuncio", items: ["Un gancho en 3 segundos", "Una oferta clara y concreta", "Una sola llamada a la acción"] },
    { ...base, template: "quote", mode: "overlay", text: "El problema no es el anuncio, es lo que pasa después del clic", highlight: "después del clic" },
    { ...base, template: "keyword", mode: "overlay", text: "Seguimiento", label: "La clave", emphasis: "underline" },
    { ...base, template: "compare", mode: "full", left: { label: "Mito", text: "Necesitas más seguidores para vender" }, right: { label: "Realidad", text: "Necesitas un sistema que convierta" } },
    { ...base, template: "flow", mode: "full", title: "El sistema", steps: ["Anuncio", "Llamada de venta", "Cliente"] },
  ];
}

/** Reloj compartido: todas las vistas previas muestran el mismo instante. */
function useClock(duration: number, playing: boolean) {
  const [time, setTime] = useState(0);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = (now: number) => {
      const prev = last.current ?? now;
      last.current = now;
      // Bucle: la escena completa y medio segundo de pausa.
      setTime((t) => {
        const next = t + (now - prev) / 1000;
        return next > duration + 0.5 ? 0 : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      last.current = null;
    };
  }, [playing, duration]);
  return [Math.min(time, duration), setTime] as const;
}

/** Fondo que simula tu video (una persona hablando), para ver los gráficos "sobre el video". */
function FakeVideo() {
  return (
    <div aria-hidden className="absolute inset-0 bg-[linear-gradient(135deg,#7a6a5a,#2a2420)]">
      <div className="absolute top-[30%] left-1/2 h-[30%] w-[34%] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(ellipse_at_50%_40%,#e2c2a4,#b48d70_70%)] [aspect-ratio:auto]" />
      <div className="absolute top-[64%] left-1/2 h-[60%] w-[78%] -translate-x-1/2 rounded-[50%] bg-[#2c3a4f]" />
    </div>
  );
}

/** Una vista previa que solo se redibuja mientras está en pantalla. */
function Preview({ scene, time, title }: { scene: MotionScene; time: number; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const compiled = useMotionScene(scene, scene.format, scene.duration);
  const issues = useMemo(() => (compiled ? validateCompiled(compiled) : []), [compiled]);
  const errors = issues.filter((i) => i.severity === "error").length;
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <div ref={ref} className={cn("relative overflow-hidden rounded-xl border border-white/10 bg-bg-deep", scene.format === "9:16" ? "aspect-[9/16]" : "aspect-video")}>
        {scene.mode === "overlay" && <FakeVideo />}
        {visible && <GraphicCanvas spec={scene} format={scene.format} duration={scene.duration} time={time} scale={scene.format === "9:16" ? 0.3 : 0.25} className="relative" label={title} />}
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="font-mono">
          {scene.format} · {scene.mode === "full" ? "pantalla completa" : `sobre el video (${scene.position === "top" ? "arriba" : "abajo"})`}
        </span>
        {compiled &&
          (issues.length ? (
            <StatusBadge tone={errors ? "danger" : "warning"}>
              <span title={issues.map((i) => i.message).join("\n")}>{errors ? `${errors} problema${errors === 1 ? "" : "s"}` : `${issues.length} aviso${issues.length === 1 ? "" : "s"}`}</span>
            </StatusBadge>
          ) : (
            <StatusBadge tone="success">Sin problemas</StatusBadge>
          ))}
      </figcaption>
      {issues.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] leading-snug text-muted">
          {issues.slice(0, 3).map((i) => (
            <li key={i.message}>{i.message}</li>
          ))}
        </ul>
      )}
    </figure>
  );
}

export function MotionGallery() {
  const [themeKey, setThemeKey] = useState(THEME_KEYS[0]!);
  const [format, setFormat] = useState<"all" | "9:16" | "16:9">("all");
  const [mode, setMode] = useState<"all" | "full" | "overlay">("all");
  const [position, setPosition] = useState<"top" | "bottom">("top");
  const [only, setOnly] = useState<"all" | ComponentName | "v1">("all");
  const [duration, setDuration] = useState(3.5);
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useClock(duration, playing);

  const theme = SAMPLE_THEMES[themeKey]!.theme;
  const scenes = useMemo(() => {
    const variants = VARIANTS.filter((v) => (format === "all" || v.format === format) && (mode === "all" || v.mode === mode));
    const names = only === "all" ? COMPONENT_NAMES : only === "v1" ? [] : [only];
    return names.map((name) => ({
      name,
      scenes: variants.map((v) => sceneSchema.parse({ v: 2, duration, format: v.format, mode: v.mode, position, theme, layers: [{ type: "component", component: name, props: COMPONENTS[name].example }] })),
    }));
  }, [format, mode, only, duration, position, theme]);
  const legacy = useMemo(() => (only === "all" || only === "v1" ? v1Specs().map((spec) => sceneFromV1({ ...spec, position }, { duration, format: format === "16:9" ? "16:9" : "9:16" })) : []), [only, duration, format, position]);

  return (
    <div className="min-h-screen px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Solo desarrollo · /motion"
          title="Galería de motion graphics"
          description="Todos los componentes del motor animados con los datos de ejemplo, en 9:16 y 16:9, a pantalla completa y sobre un video de prueba. Debajo de cada uno, lo que encuentra el validador."
          icon={<Clapperboard className="h-5 w-5" />}
        />

        <div className="card z-10 flex flex-col gap-4 p-4 backdrop-blur sm:p-5 lg:sticky lg:top-2">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex min-w-[180px] flex-col gap-1.5 text-xs font-semibold text-muted">
              Tema de marca
              <Select value={themeKey} onChange={(e) => setThemeKey(e.target.value)} aria-label="Tema de marca">
                {THEME_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {SAMPLE_THEMES[k]!.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex min-w-[180px] flex-col gap-1.5 text-xs font-semibold text-muted">
              Componente
              <Select value={only} onChange={(e) => setOnly(e.target.value as typeof only)} aria-label="Componente">
                <option value="all">Todos</option>
                {COMPONENT_NAMES.map((n) => (
                  <option key={n} value={n}>
                    {COMPONENTS[n].label}
                  </option>
                ))}
                <option value="v1">Gráficos v1 (compatibilidad)</option>
              </Select>
            </label>
            <div className="flex flex-col gap-1.5 text-xs font-semibold text-muted">
              Formato
              <SegmentedControl size="sm" label="Formato" value={format} onValueChange={setFormat} options={[{ value: "all", label: "Ambos" }, { value: "9:16", label: "9:16" }, { value: "16:9", label: "16:9" }]} />
            </div>
            <div className="flex flex-col gap-1.5 text-xs font-semibold text-muted">
              Modo
              <SegmentedControl size="sm" label="Modo" value={mode} onValueChange={setMode} options={[{ value: "all", label: "Ambos" }, { value: "full", label: "Pantalla completa" }, { value: "overlay", label: "Sobre el video" }]} />
            </div>
            <div className="flex flex-col gap-1.5 text-xs font-semibold text-muted">
              Sobre el video
              <SegmentedControl size="sm" label="Posición sobre el video" value={position} onValueChange={setPosition} options={[{ value: "top", label: "Arriba" }, { value: "bottom", label: "Abajo" }]} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" size="sm" icon={playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pausar" : "Reproducir"}>
              {playing ? "Pausar" : "Reproducir"}
            </Button>
            <Button variant="ghost" size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setTime(0)}>
              Desde el inicio
            </Button>
            <input
              type="range"
              className="range min-w-[160px] flex-1"
              min={0}
              max={duration}
              step={0.01}
              value={time}
              onChange={(e) => {
                setPlaying(false);
                setTime(Number(e.target.value));
              }}
              aria-label="Línea de tiempo"
            />
            <span className="w-24 text-right font-mono text-xs text-text tabular-nums">
              {time.toFixed(2).replace(".", ",")} / {duration.toFixed(1).replace(".", ",")} s
            </span>
            <label className="flex items-center gap-2 text-xs text-muted">
              Duración
              <Select value={String(duration)} onChange={(e) => setDuration(Number(e.target.value))} aria-label="Duración de la escena" className="w-24">
                {[1.5, 2.5, 3.5, 5, 7].map((d) => (
                  <option key={d} value={d}>
                    {String(d).replace(".", ",")} s
                  </option>
                ))}
              </Select>
            </label>
          </div>
        </div>

        <Notice tone="info" title="Datos de ejemplo">
          Los textos y cifras son de muestra para ver el diseño. En el editor, las cifras salen de lo que dices en el video.
        </Notice>

        {scenes.map(({ name, scenes: list }) => (
          <Section key={name} title={COMPONENTS[name].label} description={COMPONENTS[name].hint}>
            <div className={cn("grid gap-4", list.length > 2 ? "grid-cols-2 lg:grid-cols-[repeat(2,minmax(0,0.6fr))_repeat(2,minmax(0,1fr))]" : "grid-cols-2")}>
              {list.map((s) => (
                <Preview key={`${s.format}-${s.mode}`} scene={s} time={time} title={`${COMPONENTS[name].label}, ${s.format}`} />
              ))}
            </div>
          </Section>
        ))}

        {legacy.length > 0 && (
          <Section title="Gráficos v1 (planes guardados)" description="Las 6 plantillas de antes, convertidas al motor nuevo con el componente equivalente.">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
              {legacy.map((s, i) => (
                <Preview key={i} scene={s} time={time} title={`Gráfico v1 ${i + 1}`} />
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
