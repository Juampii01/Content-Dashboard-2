/**
 * Respuestas simuladas (AI_FAKE=1) de las composiciones y de "Copiar edición", armadas con los datos reales: eligen
 * una muestra escrita a mano (lib/video/compos/samples.ts) según lo que se dice y le ponen los textos del tramo. Sirven
 * para probar el flujo completo sin clave; nunca se usan en producción. Sin servidor.
 */
import type { ComposCodeWire, RecipeWire } from "@/lib/ai/prompts/compos";
import { COMPOS_SAMPLES, type ComposSample } from "./samples";
import type { Composition } from "./schema";

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const STOP = new Set("el la los las un una de del al a en y o que con por para es se te tu mi su lo le como pero si no ya muy mas este esta esto eso hay me".split(" "));

function keyWord(text: string): string {
  const ws = text.split(/\s+/).map((w) => w.replace(/[¿?¡!.,;:«»"]/g, "")).filter(Boolean);
  const num = ws.find((w) => /\d/.test(w));
  if (num) return num;
  return ws.filter((w) => !STOP.has(norm(w))).sort((a, b) => b.length - a.length)[0] ?? ws[0] ?? "IDEA";
}

/** La muestra que mejor encaja con el pedido y lo que se dice. */
export function pickSample(brief: string, said: string, avoid: string[] = []): ComposSample {
  const t = norm(`${brief} ${said}`).replace(/\bm\d+\b/g, "");
  const want = (key: string) => COMPOS_SAMPLES.find((s) => s.key === key)!;
  const rules: [RegExp, string][] = [
    [/mapa|imagen|foto|ilustraci|pais|ciudad|flecha/, "image_focus"],
    [/lista|pasos|primero|errores|enumera|tres cosas|checklist/, "list_reveal"],
    [/contador|sube|seguidores|crec/, "counter_up"],
    [/\d|cifra|porcentaje|%|tarjeta|3d/, "card3d_stat"],
    [/detras|recorte|gigante/, "text_behind"],
    [/telefono|app|mensaje|pantalla dividida|chat/, "split_mockup"],
    [/zoom|golpe|serio|giro|sorpresa/, "zoom_motion_blur"],
    [/subray|frase|nadie/, "underline_draw"],
    [/glitch|letra|gancho|palabra/, "letter_glitch"],
  ];
  for (const [re, key] of rules) if (re.test(t) && !avoid.includes(key)) return want(key);
  const pool = COMPOS_SAMPLES.filter((s) => !avoid.includes(s.key) && s.key !== "image_focus");
  return pool[Math.abs([...t].reduce((a, c) => a + c.charCodeAt(0), 0)) % pool.length] ?? COMPOS_SAMPLES[0]!;
}

/** Los textos de una muestra adaptados a lo que se dice. */
function adaptParams(sample: ComposSample, said: string): ComposSample["params"] {
  const key = keyWord(said);
  const phrases = said
    .split(/(?<=[.?!,;])\s+|\b(?:primero|segundo|tercero|despu[eé]s|luego)\b/i)
    .map((p) => p.trim())
    .filter((p) => p.split(/\s+/).length >= 2)
    .map((p) => p.split(/\s+/).slice(0, 5).join(" "));
  return sample.params.map((p) => {
    switch (p.key) {
      case "word":
        return { ...p, value: key.toLocaleUpperCase("es").slice(0, 12) };
      case "value":
      case "target":
        return { ...p, value: /\d/.test(key) ? key : p.value };
      case "line":
        return { ...p, value: said.split(/\s+/).slice(0, 6).join(" ") || p.value };
      case "key":
        return { ...p, value: key.toLowerCase() };
      case "item1":
      case "item2":
      case "item3":
        return { ...p, value: phrases[Number(p.key.slice(-1)) - 1] ?? p.value };
      default:
        return p;
    }
  });
}

/**
 * Plan simulado. Con efectos guardados, reusa el primero que comparte una palabra con el pedido (o siempre, si el
 * pedido menciona "mis efectos"): así se prueba el camino de reusar sin gastar.
 */
export function fakePlan(brief: string, library: { id: string; name: string; description: string; params: { key: string; value: string }[] }[] = []) {
  const wantsImage = /mapa|imagen|foto|ilustraci|pa[ií]s/i.test(brief);
  const words = new Set(brief.toLowerCase().split(/[^a-záéíóúñ0-9]+/).filter((w) => w.length >= 5));
  const hit = library.find((e) => /mis efectos/i.test(brief) || `${e.name} ${e.description}`.toLowerCase().split(/[^a-záéíóúñ0-9]+/).some((w) => words.has(w)));
  return {
    approach: hit ? `Simulación: reuso «${hit.name}» de Mis efectos.` : "Simulación: capas dibujadas con código sobre el video, entrada con resorte y salida propia.",
    images: !hit && wantsImage ? [{ purpose: "Imagen de fondo de la animación", prompt: "A clean flat world map, dark navy background, no text", aspect: "vertical" as const }] : [],
    reuse: hit?.id ?? "",
    reuse_params: hit ? hit.params.map((p) => ({ key: p.key, value: p.value })) : [],
  };
}

export function fakeImageLook(count: number) {
  return { images: Array.from({ length: count }, (_, i) => ({ index: i + 1, focus: { x: 0.45, y: 0.33, w: 0.09, h: 0.08 }, label: "La zona pedida", notes: "Simulación: zona centrada arriba.", usable: true })) };
}

/** Simulación con un video adentro: una pantalla con marco que muestra el clip 0 desde que aparece (env.clip). */
const CLIP_SCREEN_CODE = `export default {
  background: "video",
  params: { title: "MIRA ESTA WEB" },
  render(ctx, t, env) {
    const u = env.u;
    const c = env.clips[0];
    const k = env.ease.outBack(env.progress(t, 0, 0.6));
    const w = env.W * 0.86;
    const h = Math.min(env.H * 0.42, (w * c.height) / c.width);
    const x = (env.W - w) / 2;
    const y = env.H * 0.08;
    ctx.save();
    ctx.globalAlpha = env.clamp(k, 0, 1);
    ctx.translate(env.W / 2, y + h / 2);
    ctx.scale(0.85 + 0.15 * k, 0.85 + 0.15 * k);
    ctx.translate(-env.W / 2, -(y + h / 2));
    ctx.fillStyle = env.brand.accent;
    ctx.beginPath();
    ctx.roundRect(x - 14 * u, y - 14 * u, w + 28 * u, h + 28 * u, 28 * u);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 18 * u);
    ctx.clip();
    ctx.drawImage(env.clip(0, t), x, y, w, h);
    ctx.restore();
    ctx.fillStyle = "#ffffff";
    ctx.font = env.font(900, 64 * u, env.fonts.display);
    ctx.textAlign = "center";
    ctx.fillText(env.params.title, env.W / 2, y + h + 90 * u);
    ctx.restore();
  },
};`;

export function fakeCode(input: { brief: string; said: string; base: Composition | null; request: string | null; attempt: number; hasImage: boolean; hasClip?: boolean }): ComposCodeWire {
  if (input.hasClip && !input.base) {
    return { name: "Tu video en pantalla", why: `Simulación: tu video dentro de una pantalla para ${input.brief.slice(0, 120)}`, code: CLIP_SCREEN_CODE, params: [{ key: "title", label: "Título", value: "MIRA ESTA WEB" }], sounds: [], hide_captions: false, tags: ["pantalla-con-video"] };
  }
  if (input.base) {
    // Un cambio pedido: la misma animación con el texto principal cambiado (si el pedido trae uno entre comillas).
    const quoted = /[«"“]([^»"”]{1,60})[»"”]/.exec(input.request ?? "")?.[1];
    const params = input.base.params.map((p, i) => (i === 0 && quoted ? { ...p, value: quoted } : p));
    return { name: input.base.name, why: input.base.why ?? "Cambio pedido.", code: input.base.code, params, sounds: input.base.sounds ?? [], hide_captions: input.base.hide_captions ?? false, tags: input.base.tags ?? [] };
  }
  const sample = input.hasImage ? COMPOS_SAMPLES.find((s) => s.key === "image_focus")! : pickSample(input.brief, input.said);
  return {
    name: sample.name,
    why: `Simulación: «${sample.name}» para ${input.brief.slice(0, 120)}`,
    code: sample.code,
    params: adaptParams(sample, input.said),
    sounds: sample.sounds,
    hide_captions: sample.hide_captions,
    tags: sample.tags,
  };
}

export function fakeLook(round: number) {
  return { score: round === 0 ? 78 : 86, ok: round > 0, issues: round === 0 ? ["Simulación: el texto podría ser un poco más grande."] : [], fixed: "", note: round === 0 ? "Se parece en composición y movimiento (simulación)." : "Quedó muy parecida (simulación)." };
}

/** Receta simulada: un momento por corte medido de la referencia, con tipos que rotan. */
export function fakeRecipe(moments: { t: number; frame: number; cut: boolean; text: string }[], duration: number): RecipeWire {
  const kinds = ["texto", "tarjeta", "camara", "grafico", "recorte", "transicion"] as const;
  const fns = ["gancho", "cifra", "enumeracion", "enfasis", "promesa", "cta"] as const;
  const picked = moments.filter((m) => m.cut || m.text).slice(0, 8);
  const base = picked.length ? picked : [{ t: 0.3, frame: 1, cut: false, text: "" }];
  return {
    summary: "Simulación: edición rápida con textos grandes animados, tarjetas y golpes de cámara en cada idea.",
    global: { pace: "Algo cambia cada 2–3 s.", captions: "Palabra por palabra, grandes, abajo del centro.", typography: "Condensada gruesa en mayúsculas.", palette: ["#ffffff", "#2b8cff"], look: "Contraste alto, viñeta suave.", music: "Música electrónica con golpes en los cortes.", density: "reels" },
    kit: { background: "Fondo oscuro #0e0d11 con grilla sutil.", character: "", components: ["Panel oscuro #1b191b con borde #3e3937 de 90 % del ancho", "Título chico en mayúsculas arriba del panel", "Caja negra de subtítulos con 2 o 3 palabras"], layout: "Título 24 %, panel 26–58 %, subtítulos 78 %.", transitions: "La escena nueva sube 40 px con fundido en 0,16 s." },
    moments: base.map((m, i) => ({
      t0: m.t,
      t1: Math.min(duration, m.t + 1.6),
      kind: kinds[i % kinds.length]!,
      function: (i === 0 ? "gancho" : fns[i % fns.length])!,
      visual: m.text ? `Texto en pantalla «${m.text.slice(0, 40)}» grande y centrado.` : "Elemento gráfico con la marca sobre la persona.",
      motion: "Entra con escala y rebote en 0,3 s; sale con desenfoque.",
      relation: "Aparece cuando se dice la idea clave.",
      frames: [m.frame],
      catalog: "",
      importance: (i < 3 ? 3 : 2) as 2 | 3,
    })),
  };
}

/** Adaptación simulada: cada momento a una frase, repartidos en el video. */
export function fakeAdapt(moments: { id: string; function: string; importance: number }[], sentences: { from: number; to: number; text: string }[], maxCompose: number) {
  const out = [];
  const step = Math.max(1, Math.floor(sentences.length / Math.max(1, moments.length)));
  let composed = 0;
  for (const [i, m] of moments.entries()) {
    const f = sentences[Math.min(sentences.length - 1, i * step)];
    if (!f) break;
    const compose = composed < maxCompose && m.importance >= 2;
    if (compose) composed++;
    out.push({ moment: m.id, plan: compose ? ("compose" as const) : ("catalog" as const), from_word: f.from, to_word: f.to, brief: `Copiar el momento ${m.id} (${m.function}) sobre «${f.text.slice(0, 80)}».`, texts: [], reason: "Simulación: misma función en la historia." });
  }
  // Sin pisarse.
  const used = new Set<number>();
  return { moments: out.filter((m) => (used.has(m.from_word) ? false : (used.add(m.from_word), true))) };
}

export function fakeKeyMoments(sentences: { from: number; to: number; text: string }[], count: number) {
  const picks = [sentences[0], sentences[Math.floor(sentences.length / 2)], sentences.at(-1)].filter((x): x is { from: number; to: number; text: string } => Boolean(x)).slice(0, count);
  const seen = new Set<number>();
  return { moments: picks.filter((p) => (seen.has(p.from) ? false : (seen.add(p.from), true))).map((p, i) => ({ from_word: p.from, to_word: p.to, brief: `Animación a medida para «${p.text.slice(0, 80)}».`, family: ["texto-letra-a-letra", "tarjeta-3d", "lista"][i] ?? "otro" })) };
}

export function fakeRequestPlan(instruction: string, span: { from: number; to: number } | null, sentences: { from: number; to: number }[]) {
  const s = span ?? sentences[0] ?? { from: 0, to: 0 };
  return { tasks: [{ from_word: s.from, to_word: s.to, brief: instruction }], cannot: "" };
}
