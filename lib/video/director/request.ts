/**
 * "Edítalo así" en partes: qué pidió la persona, qué topes cede el pedido, qué se aplica sin depender de la IA y qué
 * se cumplió de cada parte.
 *
 * Antes, el pedido viajaba al director como un texto suelto y después pasaban cosas que lo deshacían o lo limitaban sin
 * avisar: el tope de b-roll por densidad cortaba "más gráficos", Mi marca descartaba en silencio un efecto pedido, el
 * relleno de ritmo volvía a poner los zooms que la persona pidió quitar, y lo que el director no podía tocar
 * (subtítulos, música, formato) se perdía con un "No hizo falta cambiar nada". Aquí:
 *
 * - `parseRequest`: el pedido en partes (una por cada cosa que pide), cada una con su tipo y sus datos.
 * - `requestOverrides`: lo que cede ante el pedido (topes de b-roll y de efectos, densidad, ritmo).
 * - `settingsFromRequest` + `applySettings`: los ajustes que la persona también puede tocar a mano en el Estudio
 *   (subtítulos, audio, formato, densidad, zooms, lugar y animación de gráficos y efectos).
 * - `enforceRequest`: lo que se puede hacer sin IA para que el pedido se cumpla aunque el modelo se quede corto
 *   (quitar zooms, efectos o b-roll; poner el efecto pedido; recortar a la duración pedida; cortar lo que sobra).
 * - `checkCompliance`: compara el pedido con el plan resultante, parte por parte, y dice qué se hizo y qué no, y por qué.
 *
 * Sin servidor: lo usan el servicio del director, el simulador, la vista del Estudio y las pruebas.
 */
import { sentences } from "@/lib/ai/prompts/editor";
import { captionLook, isCaptionStyle } from "../caption-styles";
import { FX_INFO, FX_KINDS, type FxKind } from "../fx/catalog";
import { clampFx, defaultFx, newFxId, type FxItem } from "../fx/schema";
import { normalizeRemovals, planSchemaFor } from "../plan";
import { DENSITY_LABELS, type Density } from "../rhythm";
import { buildTimeline, removedIds, type Timeline } from "../timeline";
import { CAPTION_PRESET_KEYS, type CaptionPresetKey, type EditPlan, type VideoFormat, type Word } from "../types";
import { formatDuration } from "@/lib/format";

// ─── Partes del pedido ────────────────────────────────────────────────────

export const REQUEST_KINDS = [
  "ritmo",
  "densidad",
  "duracion",
  "recortar",
  "conservar",
  "graficos_mas",
  "graficos_menos",
  "sin_broll",
  "sin_graficos",
  "zooms_fuera",
  "zooms_mas",
  "efecto",
  "sin_efectos",
  "subtitulos_tamano",
  "subtitulos_posicion",
  "subtitulos_estilo",
  "subtitulos_fuera",
  "subtitulos_emoji",
  "musica",
  "sonidos",
  "audio_estudio",
  "formato",
  "gancho",
  "referencia",
  "otro",
] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export type Region = "inicio" | "primera_mitad" | "segunda_mitad" | "final" | "todo";
export type CaptionPosition = "arriba" | "centro" | "abajo";

export type RequestItem = {
  /** Número de la parte (empieza en 1): así la nombran el director y el crítico. */
  n: number;
  kind: RequestKind;
  /** Lo que escribió la persona para esta parte. */
  quote: string;
  /** Qué pidió, en una frase corta para la persona ("Más gráficos en la segunda mitad"). */
  label: string;
  pace?: "fast" | "calm";
  density?: Density;
  seconds?: number;
  region?: Region;
  fx?: FxKind;
  where?: "start" | "end" | "middle" | null;
  /** Subtítulos: factor de tamaño respecto del actual (1,25 = 25 % más grandes). */
  scale?: number;
  position?: CaptionPosition;
  preset?: CaptionPresetKey;
  /** Encender o apagar (música, emojis). */
  on?: boolean;
  /** Música: más alta (true) o más baja (false). */
  louder?: boolean | null;
  level?: "off" | "subtle" | "strong" | "soft";
  format?: VideoFormat;
  /** "No cortes la parte del precio": palabras a buscar. */
  terms?: string[];
};

export type ParsedRequest = { instruction: string; items: RequestItem[]; links: string[] };

const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const LINK_RE = /https?:\/\/[^\s<>"'«»]+/gi;
const REFERENCE_HOSTS = ["instagram.com", "tiktok.com", "youtube.com", "youtu.be"];

/** Links de Instagram, TikTok o YouTube pegados en el texto (sin el punto o la coma del final). */
export function findLinks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(LINK_RE)) {
    const url = m[0].replace(/[).,;:!?]+$/, "");
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (REFERENCE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) out.push(url);
    } catch {
      // No es un link válido: se ignora.
    }
  }
  return [...new Set(out)].slice(0, 2);
}

/** Si el link es de una red que se puede bajar (Instagram, TikTok, YouTube). */
export function isReferenceLink(url: string): boolean {
  return findLinks(url).length === 1;
}

const FX_WORDS: [RegExp, FxKind][] = [
  [/revista|portada/, "cover_story"],
  [/zoom digital/, "digital_zoom"],
  [/checklist|lista de (tareas|pasos)/, "checklist"],
  [/letras de vidrio|vidrio|cristal/, "glass_type"],
  [/telefono con tareas|iphone/, "iphone"],
  [/grafico que crece|curva que sube/, "chart_grow"],
  [/titulares|muro de/, "headline_wall"],
  [/giro 3d|orbita/, "orbit"],
  [/pantalla verde|temporizador|pomodoro/, "green_screen"],
  [/vertigo|dolly/, "vertigo"],
  [/garabato|doodle/, "doodle_boil"],
  [/recorte de papel|nota de rescate/, "paper_cut"],
  [/corte con zoom/, "zoom_cut"],
  [/zoom out/, "zoom_out"],
];

const PRESET_WORDS: [RegExp, CaptionPresetKey][] = [
  [/hormozi/, "hormozi"],
  [/karaoke/, "karaoke"],
  [/palabra (a|por) palabra/, "palabra"],
  [/minimal/, "minimal"],
  [/resaltador/, "resaltador"],
  [/\bcaja\b|con fondo|en caja/, "caja"],
  [/clasico/, "clasico"],
  [/\bpop\b/, "pop"],
];

function regionOf(t: string): Region | null {
  if (/segunda mitad|ultima mitad|parte final|hacia el final|al final|en el cierre/.test(t)) return t.includes("mitad") ? "segunda_mitad" : "final";
  if (/primera mitad/.test(t)) return "primera_mitad";
  if (/al (principio|inicio|comienzo)|para abrir|de entrada|en los primeros/.test(t)) return "inicio";
  return null;
}

function secondsOf(t: string): number | null {
  const m = t.match(/(\d{1,3})\s*(?:s\b|seg\b|segs\b|segundos)/);
  if (m) return Number(m[1]);
  if (/medio minuto/.test(t)) return 30;
  if (/un minuto|1 minuto|60 segundos/.test(t)) return 60;
  const min = t.match(/(\d)\s*minutos?/);
  return min ? Number(min[1]) * 60 : null;
}

/** Parte el pedido en frases que piden una cosa cada una. */
function clauses(text: string): string[] {
  return text
    .split(/[.;\n]+|,(?!\d)|\s+(?:y|e|tambien|ademas|pero)\s+(?=(?:que|quita|quitale|pon|ponle|agrega|agregale|saca|sacale|corta|cortale|haz|hazlo|los|las|el|la|sin|mas|menos|una|un|deja|dejalo|cambia|sube|baja|pasa|pasalo|usa|copia|imita|no|algo|todo|dale|ponlo|subtitulos|musica)\b)/)
    .map((c) => c.trim())
    .filter((c) => c.length >= 3);
}

/**
 * El pedido en partes. Cada frase puede pedir varias cosas ("subtítulos más grandes y arriba"); lo que no se reconoce
 * queda como "otro" (lo interpreta el director y lo responde en "answers").
 */
export function parseRequest(instruction: string, extraLinks: string[] = []): ParsedRequest {
  const clean = instruction.trim().slice(0, 600);
  const links = [...new Set([...findLinks(clean), ...extraLinks])].slice(0, 2);
  const text = plain(clean.replace(LINK_RE, " "));
  const items: Omit<RequestItem, "n" | "label">[] = [];
  const add = (item: Omit<RequestItem, "n" | "label">) => {
    if (!items.some((i) => i.kind === item.kind && i.fx === item.fx && i.preset === item.preset)) items.push(item);
  };
  for (const c of clauses(text)) {
    const before = items.length;
    const quote = c;
    const negate = /\b(sin|quita|quitale|saca|sacale|elimina|borra|apaga|fuera|nada de|no quiero|no pongas)\b/.test(c);
    // Duración y recorte.
    const secs = secondsOf(c);
    if (secs && /version|dure|duracion|deja(lo)? en|que quede|recorta|corta(lo)?|de \d+|a \d+|menos de|maximo|corto/.test(c) && secs >= 5 && secs <= 600) add({ kind: "duracion", quote, seconds: secs });
    else if (/todo lo que sobra|lo que sobra|relleno|al grano|mas corto|mas cort|recorta|mas conciso|sin vueltas/.test(c)) add({ kind: "recortar", quote });
    const keep = c.match(/no (?:cortes|quites|saques|elimines)(?: la parte)?(?: de| del| de la| el| la| lo| las| los)? ([a-z0-9ñ ]{3,40})/);
    if (keep) add({ kind: "conservar", quote, terms: keep[1]!.split(/\s+/).filter((w) => w.length >= 4) });
    // Ritmo y densidad.
    if (/editor de reels|mucho mas dinamic|muy dinamic/.test(c)) add({ kind: "densidad", quote, density: "reels" });
    else if (/sobri|minimalista|pocos cambios|menos recargad/.test(c) && !/subtitulo/.test(c)) add({ kind: "densidad", quote, density: "sobria" });
    else if (/densidad normal/.test(c)) add({ kind: "densidad", quote, density: "normal" });
    if (/pausas al minimo|corta (las )?pausas|sin pausas|dinamic|mas rapido|ritmo (alto|rapido)|mas ritmo|agil|mas energia/.test(c)) add({ kind: "ritmo", quote, pace: "fast" });
    else if (/mas tranquil|mas lento|con calma|sin apuro|mas pausad|que respire/.test(c)) add({ kind: "ritmo", quote, pace: "calm" });
    // Subtítulos.
    const subs = /subtitul|letras|captions?|textos? de abajo/.test(c);
    if (subs) {
      if (/(sin|quita|saca|elimina|apaga) (los )?subtitul|sin letras/.test(c)) add({ kind: "subtitulos_fuera", quote });
      else {
        if (/grande|enorme|gigante|agranda|mas visibles|se lean mejor/.test(c)) add({ kind: "subtitulos_tamano", quote, scale: /muy|mucho|enorme|gigante|bastante/.test(c) ? 1.45 : 1.25 });
        else if (/chic|pequen|achica|mas finos/.test(c)) add({ kind: "subtitulos_tamano", quote, scale: /muy|mucho/.test(c) ? 0.7 : 0.82 });
        const pos = /arriba|parte de arriba/.test(c) ? "arriba" : /al centro|en el centro|en el medio|centrad/.test(c) ? "centro" : /abajo|parte de abajo/.test(c) ? "abajo" : null;
        if (pos) add({ kind: "subtitulos_posicion", quote, position: pos });
        const preset = PRESET_WORDS.find(([re]) => re.test(c));
        if (preset) add({ kind: "subtitulos_estilo", quote, preset: preset[1] });
      }
    }
    if (/emoji/.test(c)) add({ kind: "subtitulos_emoji", quote, on: !negate });
    // B-roll, gráficos, zooms y efectos.
    const zoomDigital = /zoom digital|zoom out|corte con zoom/.test(c);
    if (/zooms?|punch/.test(c) && !zoomDigital) {
      if (negate || /menos zoom/.test(c)) add({ kind: "zooms_fuera", quote });
      else if (/mas zoom|mas punch|zooms? en cada|mas acercamientos/.test(c)) add({ kind: "zooms_mas", quote });
    }
    const graphics = /graficos?|b-?roll|tomas de apoyo|cosas en pantalla|elementos visuales|apoyos visuales|animaciones/.test(c);
    if (graphics) {
      if (/(sin|quita|saca|elimina|nada de) (todo )?(el |los )?b-?roll/.test(c)) add({ kind: "sin_broll", quote });
      else if (/(sin|quita|saca|elimina|nada de) (todos )?(los )?graficos/.test(c) || /sin nada encima/.test(c)) add({ kind: "sin_graficos", quote });
      else if (/menos/.test(c)) add({ kind: "graficos_menos", quote, region: regionOf(c) ?? "todo" });
      else if (/mas|agrega|suma|pon|ponle|llena/.test(c)) add({ kind: "graficos_mas", quote, region: regionOf(c) ?? "todo" });
    }
    if (/(sin|quita|saca|elimina) (todos )?(los )?efectos(?! de sonido)/.test(c)) add({ kind: "sin_efectos", quote });
    else {
      const fx = FX_WORDS.find(([re]) => re.test(c))?.[1] ?? FX_KINDS.find((k) => c.includes(plain(FX_INFO[k].label)));
      if (fx && !negate) {
        const where = /al (principio|inicio|comienzo)|para abrir|de entrada|en el gancho|abre con/.test(c) ? "start" : /al final|para cerrar|en el cierre/.test(c) ? "end" : /en el medio|a la mitad/.test(c) ? "middle" : null;
        add({ kind: "efecto", quote, fx, where });
      }
    }
    // Audio.
    if (/musica/.test(c)) {
      if (/(sin|quita|saca|apaga) (la )?musica/.test(c)) add({ kind: "musica", quote, on: false });
      else add({ kind: "musica", quote, on: true, louder: /mas (alta|fuerte)|sube/.test(c) ? true : /mas (baja|suave)|baja/.test(c) ? false : null });
    }
    if (/efectos de sonido|sonidos|sfx|whoosh/.test(c)) add({ kind: "sonidos", quote, level: negate ? "off" : /mas|marcad|fuerte|exagerad/.test(c) ? "strong" : "subtle" });
    if (/audio de estudio|ruido|eco|limpia el audio|mejora el audio|que suene mejor|suena mal/.test(c)) add({ kind: "audio_estudio", quote, level: /(sin|apaga) (el )?audio de estudio/.test(c) ? "off" : /fuerte|mucho|bastante|todo el ruido|mas limpio/.test(c) ? "strong" : "soft" });
    // Formato.
    if (/formato|pasa(lo)? a|ponlo en|en (vertical|horizontal)|para youtube|para reels|9:16|16:9/.test(c)) {
      const format = /horizontal|16:9|para youtube/.test(c) ? "16:9" : /vertical|9:16|para reels|para tiktok/.test(c) ? "9:16" : null;
      if (format) add({ kind: "formato", quote, format });
    }
    // Gancho.
    if (/otro gancho|cambia el gancho|mejor gancho|gancho mas|empieza con|que empiece con|abre con (?!el efecto|un efecto|la portada)/.test(c) && !items.slice(before).some((i) => i.kind === "efecto")) add({ kind: "gancho", quote });
    // Referencia.
    if (/como (este|ese|el) video|como (esta|esa|la) referencia|como el link|igual que este|parecido a este|al estilo de|imita|copia (el|la) (edicion|estilo|ritmo)/.test(c)) add({ kind: "referencia", quote });
    if (items.length === before && c.split(/\s+/).length >= 2) add({ kind: "otro", quote: clean.length < 140 ? quoteBack(clean, c) : c });
  }
  if (links.length && !items.some((i) => i.kind === "referencia")) items.push({ kind: "referencia", quote: "como este video" });
  // "Otro" sin nada concreto cuando ya se entendió todo lo demás ("hazlo así") no suma una parte.
  const parts = items.filter((i) => !(i.kind === "otro" && items.length > 1 && /^(hazlo|asi|por favor|gracias|porfa)\b/.test(i.quote)));
  return { instruction: clean, links, items: parts.slice(0, 12).map((i, k) => ({ ...i, n: k + 1, label: labelOf(i) })) };
}

/** La frase original (con tildes y mayúsculas) de una cláusula normalizada, si se encuentra. */
function quoteBack(original: string, clause: string): string {
  const flat = plain(original);
  const at = flat.indexOf(clause);
  return at >= 0 ? original.slice(at, at + clause.length) : clause;
}

const REGION_LABELS: Record<Region, string> = { inicio: "al principio", primera_mitad: "en la primera mitad", segunda_mitad: "en la segunda mitad", final: "al final", todo: "" };
const POSITION_LABELS: Record<CaptionPosition, string> = { arriba: "arriba", centro: "al centro", abajo: "abajo" };
const PRESET_LABEL = (p: CaptionPresetKey) =>
  ({ clasico: "Clásico", pop: "Pop", caja: "Caja", hormozi: "Hormozi", karaoke: "Karaoke", palabra: "Palabra a palabra", minimal: "Minimal", resaltador: "Resaltador", estilo: "Del estilo", ninguno: "Sin subtítulos" })[p];

export function labelOf(i: Omit<RequestItem, "n" | "label">): string {
  const r = (x: Region | undefined) => (x && x !== "todo" ? ` ${REGION_LABELS[x]}` : "");
  switch (i.kind) {
    case "ritmo":
      return i.pace === "calm" ? "Ritmo más tranquilo" : "Ritmo más rápido";
    case "densidad":
      return `Densidad «${DENSITY_LABELS[i.density ?? "normal"].label}»`;
    case "duracion":
      return `Que dure unos ${i.seconds} s`;
    case "recortar":
      return "Cortar lo que sobra";
    case "conservar":
      return `No cortar ${i.terms?.length ? `la parte de «${i.terms.join(" ")}»` : "lo que pediste"}`;
    case "graficos_mas":
      return `Más gráficos${r(i.region)}`;
    case "graficos_menos":
      return `Menos gráficos${r(i.region)}`;
    case "sin_broll":
      return "Sin b-roll";
    case "sin_graficos":
      return "Sin gráficos";
    case "zooms_fuera":
      return "Quitar los zooms";
    case "zooms_mas":
      return "Más zooms";
    case "efecto":
      return `Efecto «${FX_INFO[i.fx!].label}»${i.where === "start" ? " al principio" : i.where === "end" ? " al final" : i.where === "middle" ? " en el medio" : ""}`;
    case "sin_efectos":
      return "Sin efectos";
    case "subtitulos_tamano":
      return (i.scale ?? 1) >= 1 ? "Subtítulos más grandes" : "Subtítulos más chicos";
    case "subtitulos_posicion":
      return `Subtítulos ${POSITION_LABELS[i.position ?? "abajo"]}`;
    case "subtitulos_estilo":
      return `Subtítulos estilo ${PRESET_LABEL(i.preset ?? "caja")}`;
    case "subtitulos_fuera":
      return "Sin subtítulos";
    case "subtitulos_emoji":
      return i.on === false ? "Sin emojis en los subtítulos" : "Emojis en los subtítulos";
    case "musica":
      return i.on === false ? "Sin música" : i.louder === true ? "Música más alta" : i.louder === false ? "Música más baja" : "Con música";
    case "sonidos":
      return i.level === "off" ? "Sin efectos de sonido" : i.level === "strong" ? "Efectos de sonido marcados" : "Efectos de sonido sutiles";
    case "audio_estudio":
      return i.level === "off" ? "Sin audio de estudio" : i.level === "strong" ? "Audio de estudio fuerte" : "Audio de estudio";
    case "formato":
      return i.format === "16:9" ? "Formato horizontal (16:9)" : "Formato vertical (9:16)";
    case "gancho":
      return "Otro gancho";
    case "referencia":
      return "Editar como la referencia";
    case "otro":
      return i.quote.charAt(0).toUpperCase() + i.quote.slice(1, 90);
  }
}

// ─── Lo que cede ante el pedido ───────────────────────────────────────────

export type RequestOverrides = {
  density: Density | null;
  pace: "fast" | "calm" | null;
  /** B-roll y gráficos de más que puede poner el director (sobre el tope de la densidad). */
  brollExtra: number;
  brollRegion: Region | null;
  fewerBroll: boolean;
  noBroll: boolean;
  noGraphics: boolean;
  noZooms: boolean;
  moreZooms: boolean;
  noFx: boolean;
  /** Efectos pedidos (entran aunque Mi marca no los tenga elegidos o ya se llegue al tope). */
  fx: { kind: FxKind; where: "start" | "end" | "middle" | null }[];
  seconds: number | null;
  trim: boolean;
  keepTerms: string[];
};

export function requestOverrides(req: ParsedRequest | null | undefined): RequestOverrides {
  const items = req?.items ?? [];
  const has = (k: RequestKind) => items.find((i) => i.kind === k);
  const more = has("graficos_mas");
  return {
    density: has("densidad")?.density ?? null,
    pace: has("ritmo")?.pace ?? (has("recortar") || has("densidad")?.density === "reels" ? "fast" : null),
    brollExtra: more ? 4 : 0,
    brollRegion: more?.region ?? null,
    fewerBroll: Boolean(has("graficos_menos")),
    noBroll: Boolean(has("sin_broll")),
    noGraphics: Boolean(has("sin_graficos")),
    noZooms: Boolean(has("zooms_fuera")),
    moreZooms: Boolean(has("zooms_mas")),
    noFx: Boolean(has("sin_efectos")),
    fx: items.filter((i) => i.kind === "efecto" && i.fx).map((i) => ({ kind: i.fx!, where: i.where ?? null })),
    seconds: has("duracion")?.seconds ?? null,
    trim: Boolean(has("recortar")),
    keepTerms: items.flatMap((i) => (i.kind === "conservar" ? (i.terms ?? []) : [])),
  };
}

/** El pedido en partes, para la tarea del director y del crítico. */
export function requestText(req: ParsedRequest | null | undefined, opts: { limits?: string; focus?: string[] } = {}): string {
  if (!req?.items.length) return "";
  return [
    `PEDIDO DE LA PERSONA, EN PARTES (todas son obligatorias; responde cada una en "answers" con su número)`,
    ...req.items.map((i) => `${i.n}. «${i.quote}» → ${i.label}`),
    "",
    `EL PEDIDO MANDA SOBRE LOS TOPES: lo que pide la persona pasa por encima de la densidad, de los topes de Mi marca (efectos permitidos y cuántos) y de la cantidad de b-roll. Solo lo técnico lo impide (tapar el producto o la pantalla, dejar una frase cortada, inventar una cifra, un efecto que necesita verte a cámara donde no se te ve): si pasa, hazlo lo más cerca posible y responde esa parte con status "parcial" o "no" y el porqué en una frase.${opts.limits ? `\n${opts.limits}` : ""}`,
    ...(opts.focus?.length ? ["", "EN LA VUELTA ANTERIOR NO SE CUMPLIÓ (arréglalo ahora, sin deshacer lo demás):", ...opts.focus.map((f) => `- ${f}`)] : []),
  ].join("\n");
}

// ─── Ajustes del plan (lo que también se toca a mano en el Estudio) ──────

export type LookSetting = {
  target: "graficos" | "broll" | "efectos";
  /** Rango de palabras (o todo el video si falta). */
  from?: number;
  to?: number;
  layout?: "full" | "split" | "card" | "side";
  filter?: "none" | "bw" | "duotone" | "warm" | "cool";
  /** Tamaño del gráfico o del elemento del efecto (multiplicador). */
  size?: number;
  /** Corrimiento vertical del gráfico o del efecto (fracción del alto: negativo = más arriba). */
  y?: number;
  animIn?: "aparecer" | "deslizar_arriba" | "deslizar_lado" | "pop" | "escribir" | "ninguna";
  animOut?: "aparecer" | "deslizar_arriba" | "deslizar_lado" | "pop" | "escribir" | "ninguna";
};

export type PlanSettings = {
  captions?: { preset?: CaptionPresetKey; scale?: number; position?: CaptionPosition; emoji?: boolean; off?: boolean };
  audio?: { music?: boolean; louder?: boolean | null; musicDb?: number; sfx?: "off" | "subtle" | "strong"; studio?: "off" | "soft" | "strong" };
  format?: VideoFormat;
  density?: Density;
  zooms?: "off";
  look?: LookSetting[];
};

/** Lo que el pedido ya dice de los ajustes (el piso: el director puede afinarlo con sus acciones). */
export function settingsFromRequest(req: ParsedRequest | null | undefined): PlanSettings {
  const out: PlanSettings = {};
  for (const i of req?.items ?? []) {
    switch (i.kind) {
      case "subtitulos_tamano":
        out.captions = { ...out.captions, scale: i.scale };
        break;
      case "subtitulos_posicion":
        out.captions = { ...out.captions, position: i.position };
        break;
      case "subtitulos_estilo":
        out.captions = { ...out.captions, preset: i.preset };
        break;
      case "subtitulos_fuera":
        out.captions = { ...out.captions, off: true };
        break;
      case "subtitulos_emoji":
        out.captions = { ...out.captions, emoji: i.on !== false };
        break;
      case "musica":
        out.audio = { ...out.audio, music: i.on !== false, louder: i.louder ?? null };
        break;
      case "sonidos":
        out.audio = { ...out.audio, sfx: i.level === "off" ? "off" : i.level === "strong" ? "strong" : "subtle" };
        break;
      case "audio_estudio":
        out.audio = { ...out.audio, studio: i.level === "off" ? "off" : i.level === "strong" ? "strong" : "soft" };
        break;
      case "formato":
        if (i.format) out.format = i.format;
        break;
      case "densidad":
        if (i.density) out.density = i.density;
        break;
      case "zooms_fuera":
        out.zooms = "off";
        break;
    }
  }
  return out;
}

/** Junta dos ajustes: lo del director (`over`) manda sobre lo que salió del texto (`base`), campo por campo. */
export function mergeSettings(base: PlanSettings, over: PlanSettings | null | undefined): PlanSettings {
  if (!over) return base;
  return {
    ...base,
    ...over,
    captions: base.captions || over.captions ? { ...base.captions, ...over.captions } : undefined,
    audio: base.audio || over.audio ? { ...base.audio, ...over.audio } : undefined,
    look: [...(base.look ?? []), ...(over.look ?? [])],
  };
}

const CAPTION_Y: Record<CaptionPosition, number> = { arriba: 0.24, centro: 0.5, abajo: 0.78 };
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clampN = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const overlaps = (a: { from: number; to: number }, b: { from: number; to: number }) => a.from <= b.to && b.from <= a.to;

export type SettingsContext = {
  words: Word[];
  /** Una pista de la biblioteca para "con música" si el video no tiene. */
  musicTrack?: string | null;
};

/**
 * Aplica los ajustes al plan. Devuelve lo que hizo y lo que no se pudo (en palabras para la persona).
 * Subtítulos: el tamaño y el lugar solo se mueven en los estilos de la galería; si el video usa uno clásico, pasa a
 * «Caja» (el más parecido que se puede agrandar) y lo dice.
 */
export function applySettings(plan0: EditPlan, s: PlanSettings, ctx: SettingsContext): { plan: EditPlan; done: string[]; failed: string[]; notes: string[] } {
  let plan: EditPlan = { ...plan0, captions: { ...plan0.captions }, audio: { ...plan0.audio } };
  const done: string[] = [];
  const failed: string[] = [];
  /** Explicaciones que no salen de comparar los planes (por qué se cambió algo más de lo pedido). */
  const notes: string[] = [];
  const c = s.captions;
  if (c) {
    if (c.off) {
      plan.captions.preset = "ninguno";
      done.push("Saqué los subtítulos (igual recibes el archivo SRT).");
    } else {
      if (c.preset && CAPTION_PRESET_KEYS.includes(c.preset) && c.preset !== plan.captions.preset) {
        if (c.preset === "estilo" && !plan.style_id) failed.push("El estilo de subtítulos de un video de referencia necesita un estilo de «Edita como este».");
        else {
          plan.captions.preset = c.preset;
          done.push(`Subtítulos con el estilo ${PRESET_LABEL(c.preset)}.`);
        }
      }
      if ((c.scale != null || c.position) && plan.captions.preset === "ninguno") plan.captions.preset = "caja";
      if ((c.scale != null || c.position) && !isCaptionStyle(plan.captions.preset)) {
        if (plan.captions.preset === "estilo") failed.push("Tus subtítulos copian los de un video de referencia: su tamaño y lugar no se cambian. Elige un estilo de la galería y vuelve a pedirlo.");
        else {
          notes.push(`Pasé tus subtítulos al estilo Caja: el ${PRESET_LABEL(plan.captions.preset)} no se puede agrandar ni mover.`);
          plan.captions.preset = "caja";
        }
      }
      if ((c.scale != null || c.position) && isCaptionStyle(plan.captions.preset)) {
        const look = captionLook(plan.captions.preset, { format: plan.format, accent: "#0070F8" });
        const cur = plan.captions.transform ?? { x: 0, y: 0, scale: 1 };
        const next = { ...cur };
        if (c.scale != null) next.scale = r3(clampN(cur.scale * clampN(c.scale, 0.5, 2), 0.6, 2.2));
        if (c.position) next.y = r3(clampN(CAPTION_Y[c.position] - look.y, -0.5, 0.5));
        plan.captions.transform = next.x || next.y || next.scale !== 1 ? next : undefined;
        if (!plan.captions.transform) delete plan.captions.transform;
        if (c.scale != null) done.push(c.scale >= 1 ? `Subtítulos más grandes (${Math.round(next.scale * 100)} % del tamaño de su estilo).` : `Subtítulos más chicos (${Math.round(next.scale * 100)} %).`);
        if (c.position) done.push(`Subtítulos ${POSITION_LABELS[c.position]}.`);
      }
      if (c.emoji != null && c.emoji !== Boolean(plan.captions.emoji)) {
        if (!isCaptionStyle(plan.captions.preset)) failed.push("Los emojis van solo con los estilos de subtítulos de la galería.");
        else {
          plan.captions.emoji = c.emoji;
          done.push(c.emoji ? "Emojis encima de las palabras clave." : "Sin emojis en los subtítulos.");
        }
      }
    }
  }
  const a = s.audio;
  if (a) {
    if (a.music === false && plan.audio.music_asset_id) {
      plan.audio.music_asset_id = null;
      done.push("Saqué la música.");
    } else if (a.music === true) {
      if (!plan.audio.music_asset_id) {
        if (ctx.musicTrack) {
          plan.audio.music_asset_id = ctx.musicTrack;
          done.push("Puse música de tu biblioteca bajo la voz.");
        } else failed.push("No tienes música lista en la biblioteca: sube una pista en Biblioteca → Música y vuelve a pedirlo.");
      }
      if (a.louder != null && plan.audio.music_asset_id) {
        plan.audio.music_db = clampN(plan.audio.music_db + (a.louder ? 4 : -4), -30, -6);
        done.push(a.louder ? "Subí la música." : "Bajé la música.");
      }
    }
    if (a.musicDb != null && plan.audio.music_asset_id) plan.audio.music_db = clampN(Math.round(a.musicDb), -30, -6);
    if (a.sfx && a.sfx !== (plan.audio.sfx ?? "off")) {
      plan.audio.sfx = a.sfx;
      done.push(a.sfx === "off" ? "Sin efectos de sonido." : a.sfx === "strong" ? "Efectos de sonido marcados." : "Efectos de sonido sutiles.");
    }
    if (a.studio && a.studio !== (plan.audio.studio ?? "off")) {
      plan.audio.studio = a.studio;
      done.push(a.studio === "off" ? "Audio de estudio apagado." : a.studio === "strong" ? "Audio de estudio fuerte: menos ruido y eco." : "Audio de estudio suave.");
    }
  }
  if (s.format && s.format !== plan.format) {
    plan.format = s.format;
    // "A un lado" solo existe en 16:9.
    if (s.format === "9:16") plan.broll = plan.broll.map((b) => (b.edit?.layout === "side" ? { ...b, edit: { ...b.edit, layout: "split" as const } } : b));
    done.push(s.format === "16:9" ? "Pasé el video a horizontal (16:9)." : "Pasé el video a vertical (9:16).");
  }
  if (s.density && s.density !== plan.rhythm?.density) {
    plan.rhythm = { density: s.density, added: plan.rhythm?.added ?? [] };
    done.push(`Densidad «${DENSITY_LABELS[s.density].label}».`);
  }
  if (s.zooms === "off" && ((plan.zoom_moments?.length ?? 0) > 0 || plan.zooms_enabled)) {
    const { zoom_moments: _z, ...rest } = plan;
    void _z;
    plan = { ...rest, zooms_enabled: false };
    done.push("Quité todos los zooms.");
  }
  for (const l of s.look ?? []) {
    const range = l.from != null && l.to != null ? { from: Math.min(l.from, l.to), to: Math.max(l.from, l.to) } : null;
    const hit = (from: number, to: number) => !range || overlaps(range, { from, to });
    let n = 0;
    if (l.target === "graficos" || l.target === "broll") {
      plan.broll = plan.broll.map((b) => {
        const graphic = b.choice?.source === "graphic";
        if ((l.target === "graficos") !== graphic || !hit(b.from_word, b.to_word)) return b;
        n++;
        const edit = { ...(b.edit ?? {}) } as NonNullable<typeof b.edit>;
        if (l.layout && !(l.layout === "side" && plan.format !== "16:9")) edit.layout = l.layout;
        if (l.filter) edit.look = { ...(edit.look ?? {}), filter: l.filter };
        if (graphic && (l.size != null || l.y != null)) {
          const t = edit.transform ?? { x: 0, y: 0, scale: 1 };
          edit.transform = { ...t, ...(l.size != null ? { scale: r3(clampN((t.scale ?? 1) * l.size, 0.4, 2.5)) } : {}), ...(l.y != null ? { y: r3(clampN(l.y, -0.5, 0.5)) } : {}) };
        }
        if (graphic && (l.animIn || l.animOut)) edit.anim = { ...(edit.anim ?? {}), ...(l.animIn ? { in: l.animIn } : {}), ...(l.animOut ? { out: l.animOut } : {}) };
        return { ...b, edit };
      });
    } else {
      plan.effects = (plan.effects ?? []).map((e) => {
        if (!hit(e.from_word, e.to_word)) return e;
        n++;
        const next: FxItem = { ...e };
        if (l.size != null || l.y != null) {
          const t = e.transform ?? { x: 0, y: 0, scale: 1 };
          next.transform = { ...t, ...(l.size != null ? { scale: r3(clampN((t.scale ?? 1) * l.size, 0.4, 2.5)) } : {}), ...(l.y != null ? { y: r3(clampN(l.y, -0.5, 0.5)) } : {}) };
        }
        if (l.animIn || l.animOut) next.anim = { in: l.animIn ?? e.anim?.in ?? "aparecer", out: l.animOut ?? e.anim?.out ?? "aparecer", inDur: e.anim?.inDur ?? 0.2, outDur: e.anim?.outDur ?? 0.2 };
        return clampFx(next);
      });
    }
    if (n) done.push(`Cambié cómo se ven ${n === 1 ? (l.target === "efectos" ? "un efecto" : l.target === "graficos" ? "un gráfico" : "un b-roll") : `${n} ${l.target === "efectos" ? "efectos" : l.target === "graficos" ? "gráficos" : "b-roll"}`}.`);
  }
  return { plan, done, failed, notes };
}

/** Escala relativa de subtítulos: `applySettings` multiplica el tamaño actual; aquí se pasa a absoluto. */
export function absoluteCaptionScale(settings: PlanSettings, currentScale: number): PlanSettings {
  if (settings.captions?.scale == null) return settings;
  return { ...settings, captions: { ...settings.captions, scale: settings.captions.scale / Math.max(0.1, currentScale) } };
}

// ─── Lo que se hace sin IA para que el pedido se cumpla ──────────────────

export type EnforceContext = {
  words: Word[];
  duration: number;
  /** Lo que no se puede tapar (producto, pantalla). */
  forbidden: { from: number; to: number; label: string }[];
  /** Lo que no se puede cortar (brief, la CTA, lo que pidió conservar). */
  mustKeep: { from: number; to: number }[];
  faceWords?: Set<number> | null;
  candidates?: { kind: string; from_word: number; to_word: number; confidence: number }[];
  /** El plan de antes del pedido (para "más gráficos": nunca quedan menos). */
  base?: EditPlan | null;
};

/**
 * El piso del pedido: lo que se puede hacer con reglas claras para que se cumpla aunque el director (o el relleno de
 * ritmo) se haya quedado corto o lo haya deshecho. Devuelve el plan y lo que hizo.
 */
export function enforceRequest(plan0: EditPlan, req: ParsedRequest | null | undefined, ctx: EnforceContext): { plan: EditPlan; done: string[] } {
  if (!req?.items.length) return { plan: plan0, done: [] };
  const o = requestOverrides(req);
  const { words, duration } = ctx;
  const n = words.length;
  let plan: EditPlan = { ...plan0, broll: [...plan0.broll], ...(plan0.effects ? { effects: [...plan0.effects] } : {}) };
  const done: string[] = [];
  if (o.noBroll && plan.broll.some((b) => b.choice?.source !== "graphic")) {
    plan.broll = plan.broll.filter((b) => b.choice?.source === "graphic");
    done.push("Quité todo el b-roll.");
  }
  if (o.noGraphics && plan.broll.some((b) => b.choice?.source === "graphic")) {
    plan.broll = plan.broll.filter((b) => b.choice?.source !== "graphic");
    done.push("Quité todos los gráficos.");
  }
  if (o.noZooms && ((plan.zoom_moments?.length ?? 0) > 0 || plan.zooms_enabled !== false)) {
    const { zoom_moments: _z, ...rest } = plan;
    void _z;
    plan = { ...rest, zooms_enabled: false };
  }
  if (o.noFx && plan.effects?.length) {
    const { effects: _e, ...rest } = plan;
    void _e;
    plan = rest;
    done.push("Quité todos los efectos.");
  }
  if (o.pace === "fast" && (plan.pacing?.long_pause ?? 0.5) > 0.3) plan = { ...plan, pacing: { long_pause: 0.3 }, director: { version: 1, pace: "fast" } };
  if (o.pace === "calm" && (plan.pacing?.long_pause ?? 0.5) < 0.65) plan = { ...plan, pacing: { long_pause: 0.7 }, director: { version: 1, pace: "calm" } };
  if (o.density && plan.rhythm?.density !== o.density) plan = { ...plan, rhythm: { density: o.density, added: plan.rhythm?.added ?? [] } };

  // Lo que pidió conservar vuelve si quedó cortado.
  const keep = [...ctx.mustKeep, ...keepRangesOf(o.keepTerms, words)];
  if (keep.length) {
    const before = plan.removals.length;
    plan = { ...plan, removals: plan.removals.filter((r) => !keep.some((k) => overlaps(k, { from: r.from_word, to: r.to_word }))) };
    if (plan.removals.length < before) done.push("Devolví lo que pediste no cortar.");
  }

  // "Corta todo lo que sobra": muletillas, arranques en falso y tomas repetidas del detector fuera (salvo lo protegido).
  if (o.trim && ctx.candidates?.length) {
    const removed = removedIds(plan, n);
    const extra = ctx.candidates
      .filter((c) => (c.kind === "filler" || c.kind === "false_start" || c.kind === "retake") && c.confidence >= 0.4)
      .filter((c) => !keep.some((k) => overlaps(k, { from: c.from_word, to: c.to_word })))
      .filter((c) => !Array.from({ length: c.to_word - c.from_word + 1 }, (_, k) => c.from_word + k).every((id) => removed.has(id)))
      .map((c) => ({ from_word: c.from_word, to_word: c.to_word, reason: c.kind as "filler" | "false_start" | "retake", confidence: c.confidence, source: "ai" as const, note: "Lo que sobra, como pediste." }));
    if (extra.length) {
      plan = { ...plan, removals: normalizeRemovals([...plan.removals, ...extra], n) };
      done.push(`Corté ${extra.length === 1 ? "una muletilla o repetición más" : `${extra.length} muletillas y repeticiones más`}.`);
    }
  }

  // Duración pedida: si el plan sigue largo, salen frases enteras del medio (nunca el gancho, lo protegido ni el cierre).
  if (o.seconds) {
    const trimmed = trimToSeconds(plan, words, duration, o.seconds, keep);
    if (trimmed.cut) {
      plan = trimmed.plan;
      done.push(`Saqué ${trimmed.cut === 1 ? "una frase" : `${trimmed.cut} frases`} para acercarme a ${o.seconds} s.`);
    }
  }

  // "Más gráficos": nunca menos que antes. Lo que había fuera de la zona pedida (o lo que se perdió) vuelve si no choca.
  if (o.brollExtra && ctx.base) {
    // Lo que agregó el relleno de ritmo ("Ritmo: …") le deja el lugar a lo que ya estaba; lo del director, no.
    const filler = (why: string | undefined) => Boolean(why?.startsWith("Ritmo:"));
    const gone = removedIds(plan, n);
    const restored: typeof plan.broll = [];
    for (const b of ctx.base.broll) {
      if (!b.choice || plan.broll.some((x) => x.id === b.id)) continue;
      const range = { from: b.from_word, to: b.to_word };
      if (Array.from({ length: b.to_word - b.from_word + 1 }, (_, k) => b.from_word + k).some((id) => gone.has(id))) continue;
      if (plan.broll.some((x) => !filler(x.why) && overlaps({ from: x.from_word, to: x.to_word }, range)) || (plan.effects ?? []).some((e) => overlaps({ from: e.from_word, to: e.to_word }, range))) continue;
      if (restored.some((x) => overlaps({ from: x.from_word, to: x.to_word }, range))) continue;
      restored.push(b);
    }
    if (restored.length) {
      const keepNew = plan.broll.filter((x) => !(filler(x.why) && restored.some((b) => overlaps({ from: x.from_word, to: x.to_word }, { from: b.from_word, to: b.to_word }))));
      plan = { ...plan, broll: [...keepNew, ...restored].sort((a, b) => a.from_word - b.from_word) };
    }
  }

  // Efectos pedidos: si no quedaron, se ponen donde se pidió (dejando lugar si hay un b-roll encima).
  for (const ask of o.fx) {
    if ((plan.effects ?? []).some((e) => e.kind === ask.kind && whereOk(e, ask.where, plan, words, duration))) continue;
    const placed = placeEffect(plan, ask.kind, ask.where, ctx);
    if (placed) {
      plan = placed.plan;
      done.push(placed.note);
    }
  }
  return { plan, done };
}

function keepRangesOf(terms: string[], words: Word[]): { from: number; to: number }[] {
  if (!terms.length) return [];
  return sentences(words)
    .filter((f) => terms.some((t) => plain(f.text).includes(plain(t))))
    .map((f) => ({ from: f.from, to: f.to }));
}

/** Saca frases enteras (las de menos peso, del medio) hasta acercarse a `seconds`. */
export function trimToSeconds(plan: EditPlan, words: Word[], duration: number, seconds: number, keep: { from: number; to: number }[]): { plan: EditPlan; cut: number } {
  const n = words.length;
  let current = plan;
  let total = buildTimeline(words, current, duration).duration;
  if (total <= seconds * 1.1) return { plan, cut: 0 };
  const hook = plan.selected_hook != null ? plan.hook_candidates[plan.selected_hook] : null;
  const removed = removedIds(plan, n);
  const phrases = sentences(words).filter((f) => !Array.from({ length: f.to - f.from + 1 }, (_, k) => f.from + k).every((id) => removed.has(id)));
  if (phrases.length < 3) return { plan, cut: 0 };
  const last = phrases[phrases.length - 1]!;
  const first = phrases[0]!;
  // Menos peso primero: sin cifras y más largas (más tiempo por frase), del medio hacia afuera.
  const pool = phrases
    .filter((f) => f !== last && f !== first && !(hook && overlaps({ from: hook.from_word, to: hook.to_word }, f)) && !keep.some((k) => overlaps(k, f)))
    .map((f) => ({ f, weight: (/\d|por ciento|dolares|clientes/.test(plain(f.text)) ? 10 : 0) - (f.end - f.start) }))
    .sort((a, b) => a.weight - b.weight);
  let cut = 0;
  for (const { f } of pool) {
    if (total <= seconds * 1.05) break;
    const next: EditPlan = { ...current, removals: normalizeRemovals([...current.removals, { from_word: f.from, to_word: f.to, reason: "off_topic", confidence: 0.8, source: "ai", note: `Para llegar a ${seconds} s, como pediste.` }], n) };
    total = buildTimeline(words, next, duration).duration;
    current = next;
    cut++;
  }
  if (!cut) return { plan, cut: 0 };
  // Lo que quedó encima de lo cortado se va.
  const gone = removedIds(current, n);
  const alive = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => from + k).filter((id) => !gone.has(id)).length >= (to - from + 1) * 0.6;
  current = {
    ...current,
    broll: current.broll.filter((b) => alive(b.from_word, b.to_word)),
    ...(current.effects ? { effects: current.effects.filter((e) => alive(e.from_word, e.to_word)) } : {}),
    ...(current.zoom_moments ? { zoom_moments: current.zoom_moments.filter((z) => alive(z.from_word, z.to_word)) } : {}),
  };
  return { plan: current, cut };
}

/** Segundo del video final en que suena una palabra (null si quedó cortada). */
function outStart(tl: Timeline, id: number): number | null {
  return tl.words.find((w) => w.id === id)?.start ?? null;
}

function whereOk(e: { from_word: number; to_word: number }, where: "start" | "end" | "middle" | null, plan: EditPlan, words: Word[], duration: number): boolean {
  if (!where) return true;
  const tl = buildTimeline(words, plan, duration);
  const t = outStart(tl, e.from_word);
  if (t == null) return false;
  if (where === "start") return t <= 3;
  if (where === "end") return t >= tl.duration * 0.6;
  return t >= tl.duration * 0.25 && t <= tl.duration * 0.75;
}

/** Pone un efecto pedido en una frase que quede donde se pidió (y que admita ese efecto). */
function placeEffect(plan: EditPlan, kind: FxKind, where: "start" | "end" | "middle" | null, ctx: EnforceContext): { plan: EditPlan; note: string } | null {
  const { words, duration } = ctx;
  const info = FX_INFO[kind];
  const tl = buildTimeline(words, plan, duration);
  // Frases cortas del video final, en el orden en que se ven.
  const removed = removedIds(plan, words.length);
  const phrases = sentences(words).filter((f) => !removed.has(f.from) && !removed.has(f.to));
  const scored = phrases
    .map((f) => ({ f, t: outStart(tl, f.from) }))
    .filter((x): x is { f: (typeof phrases)[number]; t: number } => x.t != null)
    .sort((a, b) => a.t - b.t);
  const ordered = where === "end" ? [...scored].reverse().filter((x) => x.t >= tl.duration * 0.55) : where === "middle" ? [...scored].sort((a, b) => Math.abs(a.t - tl.duration / 2) - Math.abs(b.t - tl.duration / 2)) : scored;
  for (const { f } of ordered) {
    // Lo que cabe en el efecto (desde el inicio de la frase hasta su duración máxima).
    let to = f.from;
    while (to < f.to && words[to + 1]!.end - words[f.from]!.start <= info.duration.max) to++;
    const span = words[to]!.end - words[f.from]!.start;
    if (span < info.duration.min * 0.6) continue;
    const range = { from: f.from, to };
    if (ctx.forbidden.some((z) => overlaps(z, range))) continue;
    if (info.mask && ctx.faceWords && Array.from({ length: to - f.from + 1 }, (_, k) => f.from + k).filter((id) => ctx.faceWords!.has(id)).length < (to - f.from + 1) * 0.7) continue;
    const spoken = words.slice(f.from, to + 1).map((w) => ({ id: w.id, text: w.text }));
    const item = clampFx({ id: newFxId(), kind, from_word: f.from, to_word: to, ...defaultFx(kind, spoken), why: "Lo pediste en «Edítalo así».", source: "director" });
    const next: EditPlan = {
      ...plan,
      broll: plan.broll.filter((b) => !overlaps({ from: b.from_word, to: b.to_word }, range)),
      effects: [...(plan.effects ?? []).filter((e) => !overlaps({ from: e.from_word, to: e.to_word }, range)), item].sort((a, b) => a.from_word - b.from_word),
      ...(plan.zoom_moments ? { zoom_moments: plan.zoom_moments.filter((z) => !overlaps({ from: z.from_word, to: z.to_word }, range)) } : {}),
    };
    return { plan: next, note: `Puse el efecto «${info.label}»${where === "start" ? " al principio" : where === "end" ? " al final" : where === "middle" ? " en el medio" : ""}, como pediste.` };
  }
  return null;
}

/**
 * Ajustes + piso del pedido sobre un plan (lo comparten la dirección, el camino sin IA y las pruebas): de menos a más,
 * lo copiado de la referencia, lo que dice el texto del pedido y lo que afinó el director.
 */
export function applyRequest(
  plan0: EditPlan,
  parsed: ParsedRequest | null,
  input: { ai: PlanSettings | null; reference: PlanSettings | null; words: Word[]; duration: number; forbidden: { from: number; to: number; label: string }[]; mustKeep: { from: number; to: number }[]; faceWords: Set<number> | null; candidates: { kind: string; from_word: number; to_word: number; confidence: number }[]; musicTrack: string | null; base?: EditPlan | null },
): { plan: EditPlan; done: string[]; failed: string[]; notes: string[] } {
  if (!parsed?.items.length && !input.ai && !input.reference) return { plan: plan0, done: [], failed: [], notes: [] };
  // De menos a más: lo de la referencia, lo que dice el pedido, lo que afinó el director.
  const fromText = settingsFromRequest(parsed);
  const ref = input.reference ? absoluteCaptionScale(input.reference, plan0.captions.transform?.scale ?? 1) : {};
  const settings = mergeSettings(mergeSettings(ref, fromText), input.ai);
  const s = applySettings(plan0, settings, { words: input.words, musicTrack: input.musicTrack });
  const e = enforceRequest(s.plan, parsed, { words: input.words, duration: input.duration, forbidden: input.forbidden, mustKeep: input.mustKeep, faceWords: input.faceWords, candidates: input.candidates, base: input.base ?? null });
  // Si un ajuste rompió la validación (por ejemplo, un formato raro), se queda el plan sin ajustes.
  const ok = planSchemaFor(input.words.length).safeParse(e.plan).success;
  return ok ? { plan: e.plan, done: [...s.done, ...e.done], failed: s.failed, notes: s.notes } : { plan: plan0, done: [], failed: ["No pude aplicar algunos ajustes sin romper el plan."], notes: [] };
}

// ─── Cumplimiento ─────────────────────────────────────────────────────────

export type ComplianceStatus = "hecho" | "parcial" | "no" | "revisar";

export type ComplianceItem = {
  n: number;
  label: string;
  status: ComplianceStatus;
  /** Qué se hizo, o qué no y por qué, en una frase para la persona. */
  detail: string;
  /** "reglas": se midió en el plan; "ai": lo dijo el director o el crítico. */
  by: "reglas" | "ai";
  /** Si otra vuelta del director puede arreglarlo. */
  fixable: boolean;
};

/** Lo medible del plan antes del pedido (se guarda en el pedido en curso para comparar después). */
export type PlanBaseline = {
  duration: number;
  removed: number;
  /** Segundos del video final donde empieza cada gráfico y cada b-roll de video. */
  graphics: number[];
  stock: number[];
  zooms: number;
  zoomsEnabled: boolean;
  fx: { kind: FxKind; t: number }[];
  captions: { preset: CaptionPresetKey; scale: number; y: number; emoji: boolean };
  music: boolean;
  musicDb: number;
  sfx: string;
  studio: string;
  format: VideoFormat;
  density: Density | null;
  pace: string;
  longPause: number;
  hook: [number, number] | null;
};

export function planBaseline(plan: EditPlan, words: Word[], duration: number): PlanBaseline {
  const tl = buildTimeline(words, plan, duration);
  const at = (id: number) => outStart(tl, id);
  const hook = plan.selected_hook != null ? plan.hook_candidates[plan.selected_hook] : null;
  return {
    duration: tl.duration,
    removed: removedIds(plan, words.length).size,
    graphics: plan.broll.filter((b) => b.choice?.source === "graphic").map((b) => at(b.from_word)).filter((t): t is number => t != null),
    stock: plan.broll.filter((b) => b.choice && b.choice.source !== "graphic").map((b) => at(b.from_word)).filter((t): t is number => t != null),
    zooms: plan.zoom_moments?.length ?? 0,
    zoomsEnabled: plan.zooms_enabled !== false && Boolean(plan.style_id ? plan.zooms_enabled : false),
    fx: (plan.effects ?? []).map((e) => ({ kind: e.kind, t: at(e.from_word) ?? -1 })),
    captions: { preset: plan.captions.preset, scale: plan.captions.transform?.scale ?? 1, y: plan.captions.transform?.y ?? 0, emoji: Boolean(plan.captions.emoji) },
    music: Boolean(plan.audio.music_asset_id),
    musicDb: plan.audio.music_db,
    sfx: plan.audio.sfx ?? "off",
    studio: plan.audio.studio ?? "off",
    format: plan.format,
    density: plan.rhythm?.density ?? null,
    pace: plan.director?.pace ?? "normal",
    longPause: plan.pacing?.long_pause ?? 0.5,
    hook: hook ? [hook.from_word, hook.to_word] : null,
  };
}

function inRegion(t: number, region: Region | undefined, total: number): boolean {
  switch (region ?? "todo") {
    case "inicio":
      return t < Math.min(8, total * 0.25);
    case "primera_mitad":
      return t < total / 2;
    case "segunda_mitad":
      return t >= total / 2;
    case "final":
      return t >= total * 0.7;
    case "todo":
      return true;
  }
}

/** Lo que respondió el director (o el crítico) de cada parte. */
export type RequestAnswer = { item: number; status: "hecho" | "parcial" | "no"; note: string };

export type ComplianceInput = {
  before: PlanBaseline;
  after: EditPlan;
  words: Word[];
  duration: number;
  /** La referencia se pudo mirar (null = no hay referencia en este pedido). */
  reference?: { ok: boolean; error?: string | null; summary?: string } | null;
  answers?: RequestAnswer[];
  /** Lo que no se pudo de los ajustes (applySettings), en palabras para la persona. */
  failed?: string[];
};

/**
 * Compara el pedido con el plan resultante, parte por parte. Lo medible se decide con el plan; lo demás, con lo que
 * respondió el director (y queda "revisar" si no respondió). `fixable`: otra vuelta del director lo puede arreglar.
 */
export function checkCompliance(req: ParsedRequest, input: ComplianceInput): ComplianceItem[] {
  const { before: b, after, words, duration } = input;
  const a = planBaseline(after, words, duration);
  const answers = new Map((input.answers ?? []).map((x) => [x.item, x]));
  const out: ComplianceItem[] = [];
  const total = a.duration;
  for (const item of req.items) {
    const said = answers.get(item.n);
    const res = (status: ComplianceStatus, detail: string, fixable = status === "no" || status === "parcial"): ComplianceItem => {
      // Si el director dijo que no se puede (y por qué), su porqué es el que vale y otra vuelta no lo arregla.
      if ((status === "no" || status === "parcial") && said && said.status !== "hecho" && said.note) return { n: item.n, label: item.label, status, detail: said.note.slice(0, 240), by: "ai", fixable: false };
      return { n: item.n, label: item.label, status, detail, by: "reglas", fixable };
    };
    const failedFor = (re: RegExp) => input.failed?.find((f) => re.test(plain(f)));
    switch (item.kind) {
      case "duracion": {
        const s = item.seconds!;
        if (a.duration <= s * 1.12) out.push(res("hecho", `Quedó en ${formatDuration(a.duration)} (pediste ${s} s).`));
        else if (a.duration < b.duration - 1) out.push(res("parcial", `Quedó en ${formatDuration(a.duration)}: no alcanzó para ${s} s sin cortar lo que tiene que quedar.`));
        else out.push(res("no", `Sigue en ${formatDuration(a.duration)}.`));
        break;
      }
      case "recortar":
        if (a.removed > b.removed || a.duration < b.duration - 0.5) out.push(res("hecho", `Pasó de ${formatDuration(b.duration)} a ${formatDuration(a.duration)}.`));
        else out.push(res("no", "No encontré más para cortar sin romper frases.", true));
        break;
      case "conservar": {
        const kept = keepRangesOf(item.terms ?? [], words);
        const gone = removedIds(after, words.length);
        const lost = kept.filter((k) => Array.from({ length: k.to - k.from + 1 }, (_, i) => k.from + i).some((id) => gone.has(id)));
        if (!kept.length) out.push(res("revisar", "No encontré esa parte en lo que dices: revisa que haya quedado.", false));
        else out.push(lost.length ? res("no", "Una parte de eso sigue cortada.") : res("hecho", "Esa parte queda completa."));
        break;
      }
      case "ritmo":
        if (item.pace === "fast") out.push(a.longPause <= 0.31 ? res("hecho", "Pausas de 0,3 s como mucho y ritmo rápido.") : res("no", `Las pausas siguen en ${a.longPause.toFixed(1).replace(".", ",")} s.`));
        else out.push(a.longPause >= 0.6 ? res("hecho", "Ritmo más pausado: las pausas respiran.") : res("no", "El ritmo sigue rápido."));
        break;
      case "densidad":
        out.push(a.density === item.density ? res("hecho", `Densidad «${DENSITY_LABELS[item.density!].label}».`) : res("no", "La densidad no cambió."));
        break;
      case "graficos_mas": {
        const count = (x: PlanBaseline) => [...x.graphics, ...x.stock, ...x.fx.map((f) => f.t)].filter((t) => t >= 0 && inRegion(t, item.region, item.region === "todo" ? total : x.duration)).length;
        const n0 = count(b);
        const n1 = count(a);
        if (n1 >= n0 + 2) out.push(res("hecho", `Pasó de ${n0} a ${n1} gráficos, b-roll y efectos${item.region && item.region !== "todo" ? ` ${REGION_LABELS[item.region]}` : ""}.`));
        else if (n1 > n0) out.push(res("parcial", `Agregué ${n1 - n0 === 1 ? "uno" : n1 - n0}${item.region && item.region !== "todo" ? ` ${REGION_LABELS[item.region]}` : ""}: no había más lugares que no taparan algo importante.`));
        else out.push(res("no", `Siguen ${n0}${item.region && item.region !== "todo" ? ` ${REGION_LABELS[item.region]}` : ""}.`));
        break;
      }
      case "graficos_menos": {
        const n0 = b.graphics.length + b.stock.length;
        const n1 = a.graphics.length + a.stock.length;
        out.push(n1 < n0 ? res("hecho", `Pasó de ${n0} a ${n1} gráficos y b-roll.`) : res("no", `Siguen ${n1}.`));
        break;
      }
      case "sin_broll":
        out.push(a.stock.length === 0 ? res("hecho", "Sin b-roll de video.") : res("no", `Quedan ${a.stock.length} b-roll.`));
        break;
      case "sin_graficos":
        out.push(a.graphics.length === 0 ? res("hecho", "Sin gráficos.") : res("no", `Quedan ${a.graphics.length} gráficos.`));
        break;
      case "zooms_fuera":
        out.push(a.zooms === 0 && !a.zoomsEnabled ? res("hecho", "Sin zooms: ni los del director ni los del ritmo.") : res("no", `Quedan ${a.zooms} zooms.`));
        break;
      case "zooms_mas":
        out.push(a.zooms > b.zooms ? res("hecho", `Pasó de ${b.zooms} a ${a.zooms} zooms.`) : res("no", `Siguen ${a.zooms} zooms.`));
        break;
      case "efecto": {
        const fx = a.fx.filter((f) => f.kind === item.fx && f.t >= 0);
        const name = FX_INFO[item.fx!].label;
        const placed = fx.find((f) => (item.where === "start" ? f.t <= 3 : item.where === "end" ? f.t >= total * 0.6 : item.where === "middle" ? f.t >= total * 0.25 && f.t <= total * 0.75 : true));
        if (placed) out.push(res("hecho", `«${name}» en ${formatDuration(placed.t)}.`));
        else if (fx.length) out.push(res("parcial", `«${name}» quedó en ${formatDuration(fx[0]!.t)}: donde pediste no entraba sin tapar algo importante.`));
        else out.push(res("no", FX_INFO[item.fx!].mask ? `«${name}» necesita verte a cámara y no encontré un tramo así.` : `No encontré un tramo para «${name}» que no tape algo importante.`, !FX_INFO[item.fx!].mask));
        break;
      }
      case "sin_efectos":
        out.push(a.fx.length === 0 ? res("hecho", "Sin efectos.") : res("no", `Quedan ${a.fx.length} efectos.`));
        break;
      case "subtitulos_tamano": {
        const fail = failedFor(/subtitul/);
        const up = (item.scale ?? 1) >= 1;
        if (fail) out.push(res("no", fail, false));
        else if (up ? a.captions.scale > b.captions.scale + 0.01 : a.captions.scale < b.captions.scale - 0.01) out.push(res("hecho", `${up ? "Más grandes" : "Más chicos"}: ${Math.round(a.captions.scale * 100)} % del tamaño de su estilo.`));
        else out.push(res("no", "El tamaño no cambió."));
        break;
      }
      case "subtitulos_posicion": {
        const fail = failedFor(/subtitul/);
        if (fail) out.push(res("no", fail, false));
        else out.push(Math.abs(a.captions.y - b.captions.y) > 0.01 || (a.captions.y !== 0 && Math.abs(a.captions.y) > 0.01) ? res("hecho", `Subtítulos ${POSITION_LABELS[item.position ?? "abajo"]}.`) : res("no", "Siguen en el mismo lugar."));
        break;
      }
      case "subtitulos_estilo":
        out.push(a.captions.preset === item.preset ? res("hecho", `Estilo ${PRESET_LABEL(item.preset!)}.`) : res("no", failedFor(/estilo/) ?? "El estilo no cambió.", false));
        break;
      case "subtitulos_fuera":
        out.push(a.captions.preset === "ninguno" ? res("hecho", "Sin subtítulos (igual recibes el SRT).") : res("no", "Los subtítulos siguen."));
        break;
      case "subtitulos_emoji":
        out.push(a.captions.emoji === (item.on !== false) ? res("hecho", item.on === false ? "Sin emojis." : "Con emojis en las palabras clave.") : res("no", failedFor(/emoji/) ?? "No cambió.", false));
        break;
      case "musica": {
        const fail = failedFor(/musica/);
        if (item.on === false) out.push(!a.music ? res("hecho", "Sin música.") : res("no", "La música sigue."));
        else if (fail) out.push(res("no", fail, false));
        else if (item.louder != null) out.push(a.music && (item.louder ? a.musicDb > b.musicDb : a.musicDb < b.musicDb) ? res("hecho", item.louder ? "Música más alta." : "Música más baja.") : res("no", "El volumen no cambió."));
        else out.push(a.music ? res("hecho", "Con música bajo la voz.") : res("no", "Sigue sin música."));
        break;
      }
      case "sonidos":
        out.push(a.sfx === (item.level === "off" ? "off" : item.level) ? res("hecho", item.level === "off" ? "Sin efectos de sonido." : `Efectos de sonido ${item.level === "strong" ? "marcados" : "sutiles"}.`) : res("no", "No cambió."));
        break;
      case "audio_estudio":
        out.push(a.studio === (item.level === "subtle" ? "soft" : item.level) ? res("hecho", item.level === "off" ? "Audio de estudio apagado." : `Audio de estudio ${item.level === "strong" ? "fuerte" : "suave"}.`) : res("no", "No cambió."));
        break;
      case "formato":
        out.push(a.format === item.format ? res("hecho", item.format === "16:9" ? "Ahora es horizontal." : "Ahora es vertical.") : res("no", "El formato no cambió."));
        break;
      case "gancho": {
        const changed = (a.hook?.[0] ?? -1) !== (b.hook?.[0] ?? -1) || (a.hook?.[1] ?? -1) !== (b.hook?.[1] ?? -1);
        out.push(changed ? res("hecho", a.hook ? "Gancho nuevo al principio." : "Empieza como lo grabaste.") : said ? fromAnswer(item, said) : res("no", "El gancho no cambió."));
        break;
      }
      case "referencia": {
        const ref = input.reference;
        if (!ref) out.push(res("no", "No llegó ninguna referencia: pega el link o sube el video.", false));
        else if (!ref.ok) out.push(res("no", ref.error || "No pudimos mirar la referencia. Descarga el video y súbelo.", false));
        else out.push(said ? fromAnswer(item, said) : { n: item.n, label: item.label, status: "revisar", detail: ref.summary ? `Miré la referencia (${ref.summary}). Revisa si se parece a lo que querías.` : "Miré la referencia. Revisa si se parece a lo que querías.", by: "reglas", fixable: false });
        break;
      }
      case "otro":
        out.push(said ? fromAnswer(item, said) : { n: item.n, label: item.label, status: "revisar", detail: "Revisa si quedó como querías.", by: "reglas", fixable: false });
        break;
    }
  }
  return out;
}

function fromAnswer(item: RequestItem, said: RequestAnswer): ComplianceItem {
  return { n: item.n, label: item.label, status: said.status, detail: said.note.slice(0, 240) || (said.status === "hecho" ? "Hecho." : "No se pudo."), by: "ai", fixable: false };
}

/** Junta el cumplimiento medido con lo que dijo el crítico mirando los cuadros (lo del crítico manda en lo que no se mide). */
export function mergeCompliance(rules: ComplianceItem[], critic: RequestAnswer[] | null | undefined): ComplianceItem[] {
  if (!critic?.length) return rules;
  const by = new Map(critic.map((c) => [c.item, c]));
  return rules.map((r) => {
    const c = by.get(r.n);
    if (!c) return r;
    // Lo medido por reglas manda cuando dice "hecho"; si el crítico ve que no se nota, lo baja a parcial y se puede corregir.
    if (r.by === "reglas" && r.status === "hecho") return c.status === "hecho" ? r : { ...r, status: "parcial", detail: c.note.slice(0, 240) || r.detail, by: "ai", fixable: true };
    if (r.status === "revisar" || r.by === "ai") return { ...r, status: c.status, detail: c.note.slice(0, 240) || r.detail, by: "ai", fixable: c.status !== "hecho" };
    return r;
  });
}

/** Lo que falta (para pedirle otra vuelta al director), en frases. */
export function missingOf(items: ComplianceItem[]): string[] {
  return items.filter((i) => i.fixable && (i.status === "no" || i.status === "parcial")).map((i) => `Parte ${i.n} (${i.label}): ${i.detail}`);
}

/** Resumen corto del cumplimiento ("Hice 4 de 5 cosas que pediste"). */
export function complianceSummary(items: ComplianceItem[]): string {
  if (!items.length) return "";
  const done = items.filter((i) => i.status === "hecho").length;
  if (done === items.length) return items.length === 1 ? "Hice lo que pediste." : `Hice las ${items.length} cosas que pediste.`;
  return `Hice ${done} de ${items.length} cosas que pediste.`;
}
