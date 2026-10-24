/**
 * Mis efectos: lo que no necesita servidor (categoría, textos que se adaptan al tramo
 * donde se suelta un efecto y el orden de los candidatos para reusar). Lo usan el servidor, el Estudio y las pruebas.
 */
import type { Composition } from "./schema";

// ─── Categorías ──────────────────────────────────────────────────────────

export const EFFECT_CATEGORIES = [
  { key: "texto", label: "Texto" },
  { key: "cifras", label: "Cifras" },
  { key: "tarjetas", label: "Tarjetas y listas" },
  { key: "camara", label: "Cámara y movimiento" },
  { key: "imagen", label: "Imágenes" },
  { key: "otros", label: "Otros" },
] as const;
export type EffectCategory = (typeof EFFECT_CATEGORIES)[number]["key"];
export const isEffectCategory = (v: string): v is EffectCategory => EFFECT_CATEGORIES.some((c) => c.key === v);
export const categoryLabel = (v: string) => EFFECT_CATEGORIES.find((c) => c.key === v)?.label ?? "Otros";

/** Categoría por sus familias, su nombre y lo que usa el código. */
export function categoryOf(c: Pick<Composition, "name" | "tags" | "code" | "images">): EffectCategory {
  const text = `${c.name} ${(c.tags ?? []).join(" ")}`.toLowerCase();
  if ((c.images ?? []).length || /imagen|mapa|foto|ilustr/.test(text)) return "imagen";
  if (/cifra|n[uú]mero|contador|counter|stat|porcentaje|gr[aá]fico|barra/.test(text)) return "cifras";
  if (/tarjeta|card|lista|list|checklist|mockup|panel|ventana/.test(text)) return "tarjetas";
  if (/zoom|c[aá]mara|movimiento|blur|desenfoque|giro|sacud|shake|parallax/.test(text)) return "camara";
  if (/texto|letra|palabra|t[ií]tulo|subrayad|frase|text|word|glitch/.test(text)) return "texto";
  if (/\benv\.(letters|wrap)\b|fillText/.test(c.code)) return "texto";
  return "otros";
}

/** Una frase que explica el efecto (para la Biblioteca y para que el director sepa cuándo usarlo). */
export function describeEffect(c: Pick<Composition, "why" | "request" | "moment" | "name">): string {
  const parts = [c.request ? `Pedido: ${c.request}` : "", c.why ?? "", c.moment ? `Momento: ${c.moment}` : ""].map((s) => s.trim()).filter(Boolean);
  return (parts.join(" · ") || c.name).slice(0, 300);
}

// ─── Textos que se adaptan al tramo ──────────────────────────────────────

type Spoken = { text: string; emphasis?: boolean };

const clean = (s: string) => s.replace(/[«»"“”¿?¡!.,;:()]/g, "").trim();
const isUpper = (s: string) => /[A-ZÁÉÍÓÚÑ]/.test(s) && s === s.toUpperCase();
const TAIL_RE = /^(el|la|los|las|un|una|unos|unas|de|del|al|a|en|y|o|que|con|por|para|sin|es|este|esta|esto|ese|esa|eso|mi|tu|su|tus|sus|mis|se|lo|le|no|si|muy|más|pero)$/i;
const NUM_RE = /\d[\d.,]*\s*(%|x|k|mil|millones|m)?/i;

/**
 * Rellena los textos de un efecto con lo que se dice en el tramo donde se suelta, sin IA: una cifra donde había una
 * cifra, la palabra marcada (o la más larga) donde había una palabra, y la frase donde había una frase. Lo que no se
 * puede adaptar queda con su valor por defecto (la persona lo edita en el inspector).
 */
export function fillParams(params: Composition["params"], spoken: Spoken[]): Composition["params"] {
  const words = spoken.map((w) => ({ text: clean(w.text), emphasis: Boolean(w.emphasis) })).filter((w) => w.text);
  if (!words.length) return params;
  const phrase = words.map((w) => w.text).join(" ");
  const number = phrase.match(NUM_RE)?.[0]?.trim() ?? null;
  const strong = words.find((w) => w.emphasis && w.text.length >= 3)?.text ?? [...words].sort((a, b) => b.text.length - a.text.length)[0]!.text;
  return params.map((p) => {
    const def = p.value;
    const key = p.key.toLowerCase();
    const wordsInDefault = def.trim().split(/\s+/).filter(Boolean).length;
    const caseLike = (v: string) => (isUpper(def) ? v.toUpperCase() : v);
    if (/num|cifra|value|valor|stat|count|percent|porcent|monto|amount/.test(key) || /^\s*[+-]?\d[\d.,]*\s*\S{0,8}$/.test(def)) {
      if (!number) return p;
      const suffix = def.match(/\d\s*(\S{1,8})\s*$/)?.[1] ?? "";
      const out = /\D$/.test(number) || !suffix || /\d/.test(suffix) ? number : `${number}${suffix}`;
      return { ...p, value: out.slice(0, 160) };
    }
    if (/^(item|step|paso|punto)\d*$/.test(key) && wordsInDefault > 0) return p;
    if (/word|palabra|keyword|clave/.test(key) || wordsInDefault === 1) return { ...p, value: caseLike(strong).slice(0, 160) };
    if (/title|titulo|text|texto|frase|phrase|headline|line|label|quote|cita/.test(key) || wordsInDefault >= 2) {
      const max = Math.max(2, Math.round(wordsInDefault * 1.5));
      const picked = words.slice(0, max).map((w) => w.text);
      // Sin palabras sueltas al final ("…calificados este"): corta en la última palabra con peso.
      while (picked.length > 2 && TAIL_RE.test(picked[picked.length - 1]!)) picked.pop();
      const cut = picked.join(" ");
      return { ...p, value: caseLike(cut).slice(0, 160) };
    }
    return p;
  });
}

// ─── Candidatos para reusar (director y Copiar edición) ──────────────────

export type LibraryCandidate = {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  duration: number;
  params: Composition["params"];
  usedCount: number;
  lastUsedAt: Date | string | null;
  favorite: boolean;
};

const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9ñ]+/)
      .filter((w) => w.length >= 4),
  );

/**
 * Los efectos guardados que más encajan con lo que se pide, para ofrecérselos a Claude en el plan de una animación.
 * Rotación: lo que ya está en este video no se ofrece, y lo usado en los últimos 3 días va al final (así no se repite
 * siempre el mismo). Los favoritos suben un poco.
 */
export function rankCandidates<T extends LibraryCandidate>(all: T[], input: { brief: string; said: string; exclude: Iterable<string>; now?: number; limit?: number }): T[] {
  const skip = new Set(input.exclude);
  const want = tokens(`${input.brief} ${input.said}`);
  const now = input.now ?? Date.now();
  const scored = all
    .filter((e) => !skip.has(e.id))
    .map((e) => {
      const have = tokens(`${e.name} ${e.description} ${e.tags.join(" ")} ${categoryLabel(e.category)}`);
      let match = 0;
      for (const w of want) if (have.has(w)) match++;
      const last = e.lastUsedAt ? new Date(e.lastUsedAt).getTime() : 0;
      const recent = last && now - last < 3 * 86_400_000 ? 1 : 0;
      return { e, score: match * 2 + (e.favorite ? 1 : 0) - recent * 3 - Math.min(2, e.usedCount * 0.1) };
    })
    .sort((a, b) => b.score - a.score || a.e.usedCount - b.e.usedCount);
  return scored.slice(0, input.limit ?? 8).map((x) => x.e);
}

/** Texto de los candidatos para el prompt del plan. */
export function candidatesText(list: LibraryCandidate[]): string {
  return list
    .map((e, i) => `${i + 1}. id "${e.id}" · «${e.name}» (${categoryLabel(e.category)}, ~${e.duration.toFixed(1)} s): ${e.description.slice(0, 200)}${e.params.length ? ` · textos: ${e.params.map((p) => `${p.key}="${p.value.slice(0, 40)}"`).join(", ")}` : ""}`)
    .join("\n");
}
