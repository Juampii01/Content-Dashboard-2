import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDate, formatMultiplier, formatNumber, formatPercent } from "@/lib/format";
import type { PeriodTotals } from "@/lib/dal/metrics";
import { firstLine } from "@/lib/metrics/text";
import { hookKindLabel } from "@/lib/scripts/score";
import { addDays, daysBetween, filtersToSearch, previousRange, todayIn, type MetricsFilters } from "@/lib/metrics/params";
import { typeLabel } from "@/lib/metrics/labels";
import { platformLabel, type ContentType, type Platform } from "@/lib/social/types";
import { MAX_IDEAS, stripUnknownRefs, toIdea, type RefRegistry, type ToolInput, type ToolName } from "./tools";
import type { StrategistIdea } from "@/lib/db/schema";

/**
 * Implementación de las herramientas del estratega. Solo lecturas con filtros cerrados (nada de SQL libre).
 * No pide sesión: la llama únicamente lib/dal/strategist.ts, que ya la comprobó.
 * Cada resultado registra lo que muestra en el RefRegistry para que la respuesta lo pueda citar.
 */
export type ToolOutput = {
  /** Lo que recibe el modelo (JSON compacto). */
  content: Record<string, unknown>;
  /** Resumen corto para el registro de la conversación. */
  summary: string;
  /** Idea propuesta (solo proponer_idea). */
  idea?: StrategistIdea;
};

export type ToolContext = { registry: RefRegistry; ideas: StrategistIdea[] };

const PLATFORM_OF: Record<string, Platform> = { instagram: "INSTAGRAM", youtube: "YOUTUBE", tiktok: "TIKTOK" };
const TYPE_OF: Record<string, ContentType> = { reel: "REEL", carrusel: "CAROUSEL", post: "IMAGE", video: "VIDEO", short: "SHORT" };
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const round = (v: number | null, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const tz = () => env().APP_TIMEZONE;

function metricsHref(f: { from: string; to: string; platforms?: Platform[] }): string {
  return `/metricas${filtersToSearch({ preset: "custom", from: f.from, to: f.to, platforms: f.platforms ?? [] })}`;
}

// ─── buscar_piezas ─────────────────────────────────────────────────────────

const ORDER: Record<ToolInput<"buscar_piezas">["orden"], SQL> = {
  puntaje: sql`ci.perf_score`,
  vistas: sql`ci.views`,
  fecha: sql`ci.published_at`,
  interaccion: sql`(coalesce(ci.likes,0) + coalesce(ci.comments,0) + coalesce(ci.shares,0) + coalesce(ci.saves,0))::float / nullif(ci.views, 0)`,
  guardados: sql`ci.saves`,
  compartidos: sql`ci.shares`,
  comentarios: sql`ci.comments`,
};

type PieceRow = {
  id: string;
  platform: Platform;
  type: ContentType;
  title: string | null;
  caption: string | null;
  published_at: string;
  duration_sec: number | null;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  follows: number | null;
  subscribers_gained: number | null;
  avg_watch_sec: number | null;
  avg_view_percentage: number | null;
  skip_rate: number | null;
  perf_score: number | null;
  hook_type: string | null;
  ai_analysis: { verdict?: string } | null;
};

const PIECE_COLUMNS = sql`ci.id, ci.platform, ci.type, ci.title, ci.caption, ci.published_at, ci.duration_sec, ci.views, ci.reach, ci.likes, ci.comments,
  ci.shares, ci.saves, ci.follows, ci.subscribers_gained, ci.avg_watch_sec, ci.avg_view_percentage, ci.skip_rate, ci.perf_score, ci.hook_type, ci.ai_analysis`;

/** Una pieza como la ve el modelo. Los null quedan: significan "la red no da este dato". */
function pieceForModel(r: PieceRow, registry: RefRegistry) {
  const text = firstLine(r.title, r.caption) || "Sin texto";
  const views = num(r.views);
  const inter = views ? ((num(r.likes) ?? 0) + (num(r.comments) ?? 0) + (num(r.shares) ?? 0) + (num(r.saves) ?? 0)) / views : null;
  const perf = num(r.perf_score);
  const ref = registry.piece({
    id: r.id,
    label: text,
    detail: [platformLabel[r.platform], typeLabel[r.type], formatDate(r.published_at), views != null ? `${formatNumber(views)} vistas` : null, perf != null ? `${formatMultiplier(perf)} tu mediana` : null]
      .filter(Boolean)
      .join(" · "),
    platform: r.platform,
  });
  return {
    ref,
    red: platformLabel[r.platform],
    tipo: typeLabel[r.type],
    fecha: formatDate(r.published_at),
    texto: text.slice(0, 160),
    x_mediana: round(perf),
    vistas: views,
    alcance: num(r.reach),
    me_gusta: num(r.likes),
    comentarios: num(r.comments),
    compartidos: num(r.shares),
    guardados: num(r.saves),
    interaccion_pct: inter == null ? null : round(inter * 100, 1),
    seguidores_ganados: num(r.follows) ?? num(r.subscribers_gained),
    duracion_s: num(r.duration_sec),
    seg_vistos_prom: round(num(r.avg_watch_sec), 1),
    pct_visto_prom: round(num(r.avg_view_percentage), 1),
    pct_salta_3s: round(num(r.skip_rate), 1),
    gancho: r.hook_type && r.hook_type in hookKindLabel ? hookKindLabel[r.hook_type as keyof typeof hookKindLabel] : null,
    tiene_analisis: Boolean(r.ai_analysis?.verdict),
  };
}

export async function searchPieces(input: ToolInput<"buscar_piezas">, ctx: ToolContext): Promise<ToolOutput> {
  const today = todayIn(tz());
  const to = input.hasta && input.hasta < today ? input.hasta : today;
  const from = input.desde && input.desde <= to ? input.desde : addDays(to, -89);
  const parts: SQL[] = [sql`ci.available`, sql`(ci.published_at at time zone ${tz()})::date between ${from}::date and ${to}::date`];
  if (input.red) parts.push(sql`ci.platform = ${PLATFORM_OF[input.red]}`);
  if (input.tipo) parts.push(sql`ci.type = ${TYPE_OF[input.tipo]}`);
  if (input.gancho) parts.push(sql`ci.hook_type = ${input.gancho}`);
  if (input.texto) parts.push(sql`(coalesce(ci.caption, '') || ' ' || coalesce(ci.title, '')) ilike ${`%${input.texto.replace(/[%_\\]/g, "")}%`}`);
  const where = sql.join(parts, sql` and `);
  const dir = input.direccion === "asc" ? sql`asc` : sql`desc`;
  const db = getDb();
  const [rows, count] = await Promise.all([
    db.execute<PieceRow>(sql`select ${PIECE_COLUMNS} from content_items ci where ${where} order by ${ORDER[input.orden]} ${dir} nulls last, ci.published_at desc limit ${input.limite}`),
    db.execute<{ n: number }>(sql`select count(*)::int as n from content_items ci where ${where}`),
  ]);
  const pieces = rows.rows.map((r) => pieceForModel(r, ctx.registry));
  const total = count.rows[0]?.n ?? 0;
  return {
    content: {
      periodo: `${formatDate(from)} – ${formatDate(to)}`,
      total_que_cumplen: total,
      mostradas: pieces.length,
      orden: `${input.orden} ${input.direccion}`,
      piezas: pieces,
      ...(total === 0 ? { nota: "No hay piezas publicadas con esos filtros en ese periodo." } : {}),
    },
    summary: `${pieces.length} de ${total} piezas`,
  };
}

// ─── resumen_periodo ───────────────────────────────────────────────────────

function totalsForModel(t: PeriodTotals) {
  return {
    piezas: t.pieces,
    vistas: t.views,
    interacciones: t.interactions,
    interaccion_pct: round(t.engagementRate, 2),
    guardados: t.saves,
    compartidos: t.shares,
    guardados_y_compartidos_por_mil_vistas: round(t.savesSharesPer1k, 1),
    seg_vistos_prom: round(t.avgWatchSec, 1),
    seguidores_netos: t.followersNet,
  };
}

const change = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : round(((a - b) / Math.abs(b)) * 100, 1));

export async function periodSummary(input: ToolInput<"resumen_periodo">, ctx: ToolContext): Promise<ToolOutput> {
  // Import diferido: lib/dal/* carga la sesión (next/navigation), que no hace falta para estas lecturas.
  const { totalsUnchecked } = await import("@/lib/dal/metrics");
  const today = todayIn(tz());
  let from = input.desde <= input.hasta ? input.desde : input.hasta;
  const to = input.hasta > today ? today : input.hasta;
  if (from > to) from = to;
  if (daysBetween(from, to) > 366) from = addDays(to, -365);
  const prev = previousRange(from, to);
  const connected = await getDb().execute<{ platform: Platform }>(sql`select distinct platform from social_accounts where current order by platform`);
  const platforms = input.red ? [PLATFORM_OF[input.red]!] : connected.rows.map((r) => r.platform);
  const base = (p: Platform[]): MetricsFilters => ({ preset: "custom", from, to, platforms: p, types: [], q: "", minViews: null, maxViews: null, sort: "fecha", dir: "desc", view: "tabla", page: 1 });

  const rows = await Promise.all(
    [...(input.red ? [] : [null]), ...platforms].map(async (p) => {
      const scope = p ? [p] : [];
      const [current, previous] = await Promise.all([totalsUnchecked(base(scope), from, to), input.comparar ? totalsUnchecked(base(scope), prev.from, prev.to) : Promise.resolve(null)]);
      const label = p ? platformLabel[p] : "Total";
      const ref = ctx.registry.figure({
        label: `${label}: ${formatDate(from)} – ${formatDate(to)}`,
        detail: [current.views != null ? `${formatNumber(current.views)} vistas` : null, `${current.pieces} piezas`, previous && change(current.views, previous.views) != null ? `${formatPercent(change(current.views, previous.views), { signed: true })} contra el periodo anterior` : null]
          .filter(Boolean)
          .join(" · "),
        href: metricsHref({ from, to, platforms: scope }),
        platform: p,
      });
      return {
        ref,
        red: label,
        actual: totalsForModel(current),
        ...(previous
          ? {
              anterior: totalsForModel(previous),
              cambio_pct: { vistas: change(current.views, previous.views), interacciones: change(current.interactions, previous.interactions), piezas: change(current.pieces, previous.pieces), seguidores_netos: change(current.followersNet, previous.followersNet) },
            }
          : {}),
      };
    }),
  );
  return {
    content: {
      periodo: `${formatDate(from)} – ${formatDate(to)}`,
      ...(input.comparar ? { periodo_anterior: `${formatDate(prev.from)} – ${formatDate(prev.to)}` } : {}),
      nota: "Vistas e interacciones de las piezas publicadas en el periodo (no las vistas diarias de la cuenta). null = la red no da ese dato.",
      resumen: rows,
    },
    summary: `${rows.length} resumen${rows.length === 1 ? "" : "es"}`,
  };
}

// ─── ranking_ganchos ───────────────────────────────────────────────────────

export async function hookRankingTool(input: ToolInput<"ranking_ganchos">, ctx: ToolContext): Promise<ToolOutput> {
  const platform = input.red ? PLATFORM_OF[input.red]! : null;
  const { hookRankingUnchecked } = await import("@/lib/metrics/hooks");
  const ranking = await hookRankingUnchecked(platform);
  const ids = ranking.stats.map((s) => s.example?.id).filter((id): id is string => Boolean(id));
  const examples = ids.length
    ? await getDb().execute<PieceRow>(sql`select ${PIECE_COLUMNS} from content_items ci where ci.id = any(array[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::uuid[])`)
    : { rows: [] as PieceRow[] };
  const byId = new Map(examples.rows.map((r) => [r.id, r]));
  const ref = ctx.registry.figure({
    label: `Ranking de ganchos${platform ? ` en ${platformLabel[platform]}` : ""}`,
    detail: ranking.stats.length ? ranking.stats.map((s) => `${s.label} ${formatMultiplier(s.medianScore)}`).join(" · ") : "Sin datos suficientes",
    href: "/metricas",
    platform,
  });
  return {
    content: {
      ref,
      red: platform ? platformLabel[platform] : "Todas",
      periodo: "últimos 180 días",
      piezas_clasificadas: ranking.classified,
      piezas_sin_clasificar: ranking.pending,
      tipos: ranking.stats.map((s) => {
        const ex = s.example ? byId.get(s.example.id) : undefined;
        return { tipo: s.label, piezas: s.count, mediana_x: round(s.medianScore), mediana_vistas: s.medianViews == null ? null : Math.round(s.medianViews), mejor_pieza: ex ? pieceForModel(ex, ctx.registry) : null };
      }),
      ...(ranking.stats.length === 0 ? { nota: "Todavía no hay al menos 3 piezas con el mismo tipo de gancho clasificado en este periodo." } : {}),
    },
    summary: `${ranking.stats.length} tipos de gancho`,
  };
}

// ─── calendario ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = { IDEA: "Idea", SCRIPTING: "En guion", PRODUCTION: "En producción", READY: "Listo", PUBLISHED: "Publicado" };

export async function calendarTool(input: ToolInput<"calendario">, ctx: ToolContext): Promise<ToolOutput> {
  const today = todayIn(tz());
  const until = addDays(today, input.dias - 1);
  const db = getDb();
  const [rows, undated] = await Promise.all([
    db.execute<{ id: string; title: string; hook: string | null; format: string; status: string; day: string; time: string | null; platforms: string[] | null }>(sql`
      select e.id, e.title, e.hook, e.format, e.status, to_char(e.scheduled_date, 'YYYY-MM-DD') as day, e.scheduled_time as time,
        (select array_agg(t.platform::text order by t.platform) from calendar_targets t where t.entry_id = e.id) as platforms
      from calendar_entries e
      where e.scheduled_date between ${today}::date and ${until}::date and e.status <> 'PUBLISHED'
      order by e.scheduled_date, e.scheduled_time nulls first, e.position
      limit 40
    `),
    db.execute<{ n: number }>(sql`select count(*)::int as n from calendar_entries where scheduled_date is null and status <> 'PUBLISHED'`),
  ]);
  const busy = new Set(rows.rows.map((r) => r.day));
  const free: string[] = [];
  for (let d = today; d <= until; d = addDays(d, 1)) if (!busy.has(d)) free.push(formatDate(d));
  return {
    content: {
      desde: formatDate(today),
      hasta: formatDate(until),
      planeado: rows.rows.map((r) => ({
        ref: ctx.registry.entry({ id: r.id, label: r.title, detail: `${formatDate(r.day)} · ${STATUS_LABEL[r.status] ?? r.status}`, href: `/calendario?fecha=${r.day}` }),
        fecha: formatDate(r.day),
        hora: r.time,
        titulo: r.title,
        gancho: r.hook,
        formato: r.format,
        estado: STATUS_LABEL[r.status] ?? r.status,
        redes: (r.platforms ?? []).map((p) => platformLabel[p as Platform] ?? p),
      })),
      dias_sin_nada: free,
      ideas_sin_fecha: undated.rows[0]?.n ?? 0,
    },
    summary: `${rows.rows.length} piezas planeadas`,
  };
}

// ─── meta_seguidores ───────────────────────────────────────────────────────

export async function goalTool(_input: ToolInput<"meta_seguidores">, ctx: ToolContext): Promise<ToolOutput> {
  const { computeGrowth } = await import("@/lib/dal/growth");
  const g = await computeGrowth();
  const scope = g.goals && g.goals.platform !== "TOTAL" ? platformLabel[g.goals.platform] : "todas las redes";
  const ref = ctx.registry.figure({
    label: g.goals ? `Meta: ${formatNumber(g.goals.followers)} seguidores (${scope})` : "Seguidores y constancia",
    detail: [g.current != null ? `${formatNumber(g.current)} hoy` : null, g.perDay != null ? `${formatNumber(Math.round(g.perDay * 7))} por semana` : null, g.eta ? `llegarías el ${formatDate(g.eta)}` : null].filter(Boolean).join(" · ") || null,
    href: "/inicio",
  });
  const lastWeeks = g.weeks.slice(-6);
  return {
    content: {
      ref,
      meta: g.goals ? { seguidores: g.goals.followers, red: scope, fecha_limite: g.goals.deadline ? formatDate(g.goals.deadline) : null, piezas_por_semana: g.goals.weeklyPieces } : null,
      ...(g.goals ? {} : { nota: "No hay una meta definida. Se define en Inicio → Tu camino a la meta.", meta_sugerida: g.suggested.followers }),
      seguidores_hoy: g.current,
      ganados_28_dias: g.gained28d,
      ritmo_por_semana: g.perDay == null ? null : Math.round(g.perDay * 7),
      llegada_estimada: g.eta ? formatDate(g.eta) : null,
      necesarios_por_semana: g.neededPerWeek,
      racha_semanas_cumplidas: g.streak,
      semanas: lastWeeks.map((w) => ({ semana: formatDate(w.weekStart), piezas: w.pieces, seguidores_ganados: w.followerGain, cumplio: w.hitTarget, en_curso: w.current })),
      patron: g.insight ? `Las semanas con ${g.insight.target} o más piezas ganaste ${formatMultiplier(g.insight.ratio)} seguidores (${g.insight.withTarget} contra ${g.insight.withoutTarget}).` : null,
    },
    summary: g.goals ? "meta y ritmo" : "sin meta definida",
  };
}

// ─── analisis_pieza ────────────────────────────────────────────────────────

export async function pieceDetailTool(input: ToolInput<"analisis_pieza">, ctx: ToolContext): Promise<ToolOutput> {
  const id = ctx.registry.pieceId(input.pieza);
  if (!id) return { content: { error: `No conozco la pieza ${input.pieza}. Búscala primero con buscar_piezas.` }, summary: "pieza desconocida" };
  const db = getDb();
  const [rows, retention] = await Promise.all([
    db.execute<PieceRow & { views_24h: number | null; views_7d: number | null; profile_visits: number | null }>(sql`
      select ${PIECE_COLUMNS}, ci.views_24h, ci.views_7d, ci.profile_visits from content_items ci where ci.id = ${id}::uuid limit 1
    `),
    db.execute<{ n: number }>(sql`select count(*)::int as n from retention_curves where content_item_id = ${id}::uuid`),
  ]);
  const r = rows.rows[0];
  if (!r) return { content: { error: "Esa pieza ya no está en la base." }, summary: "pieza no encontrada" };
  const analysis = r.ai_analysis as null | { verdict: string; drivers: { factor: string; evidence: string; effect: string }[]; hook: string; lessons: string[] };
  return {
    content: {
      ...pieceForModel(r, ctx.registry),
      caption: (r.caption ?? "").slice(0, 900) || null,
      vistas_24h: num(r.views_24h),
      vistas_7d: num(r.views_7d),
      visitas_al_perfil: num(r.profile_visits),
      tiene_curva_de_retencion: (retention.rows[0]?.n ?? 0) > 0,
      por_que_funciono: analysis?.verdict
        ? { veredicto: analysis.verdict, factores: analysis.drivers.map((d) => `${d.factor} (${d.effect}): ${d.evidence}`), gancho: analysis.hook, aprendizajes: analysis.lessons }
        : null,
      ...(analysis?.verdict ? {} : { nota: "Todavía no tiene el análisis '¿Por qué funcionó?'. Se genera desde el detalle de la pieza en Métricas." }),
    },
    summary: "detalle de pieza",
  };
}

// ─── informe_mensual ───────────────────────────────────────────────────────

export async function monthlyReportTool(input: ToolInput<"informe_mensual">, ctx: ToolContext): Promise<ToolOutput> {
  const result = await getDb().execute<{ month: string; data: import("@/lib/reports/types").MonthlyReportData; partial: boolean }>(
    input.mes ? sql`select month, data, partial from monthly_reports where month = ${input.mes} limit 1` : sql`select month, data, partial from monthly_reports order by month desc limit 1`,
  );
  const row = result.rows[0];
  if (!row) {
    return {
      content: { nota: input.mes ? `No hay un informe guardado de ${input.mes}. Se genera en Inicio → Informe mensual.` : "Todavía no hay informes mensuales guardados. Se generan en Inicio → Informe mensual." },
      summary: "sin informe",
    };
  }
  const d = row.data;
  const ref = ctx.registry.figure({
    label: `Informe de ${row.month}${row.partial ? " (mes en curso)" : ""}`,
    detail: [d.totals.views.current != null ? `${formatNumber(d.totals.views.current)} vistas` : null, d.totals.followersGained.current != null ? `${formatNumber(d.totals.followersGained.current)} seguidores ganados` : null].filter(Boolean).join(" · ") || null,
    href: `/inicio/informes?mes=${row.month}`,
  });
  return {
    content: {
      ref,
      mes: row.month,
      parcial: row.partial,
      totales: d.totals,
      redes: d.platforms.map((p) => ({ red: platformLabel[p.platform], seguidores: p.followers, ganados: p.followersGained, vistas: p.views, interaccion_pct: p.engagementRate, piezas: p.pieces, notas: p.notes })),
      mejores: d.top.slice(0, 5).map((t) => ({
        ref: ctx.registry.piece({ id: t.id, label: t.title, detail: [platformLabel[t.platform], formatDate(t.publishedAt), t.perfScore != null ? `${formatMultiplier(t.perfScore)} tu mediana` : null].filter(Boolean).join(" · "), platform: t.platform }),
        texto: t.title,
        red: platformLabel[t.platform],
        vistas: t.views,
        x_mediana: t.perfScore,
        por_que: t.why,
      })),
      constancia: { publicadas: d.consistency.published, planeadas: d.consistency.planned, meta_semanal: d.consistency.weeklyTarget },
      conclusiones: d.summary,
    },
    summary: `informe ${row.month}`,
  };
}

// ─── proponer_idea ─────────────────────────────────────────────────────────

export async function proposeIdeaTool(input: ToolInput<"proponer_idea">, ctx: ToolContext): Promise<ToolOutput> {
  if (ctx.ideas.length >= MAX_IDEAS) return { content: { error: `Ya propusiste ${MAX_IDEAS} ideas en esta respuesta. No propongas más.` }, summary: "tope de ideas" };
  const raw = toIdea(input, crypto.randomUUID());
  const idea = { ...raw, idea: stripUnknownRefs(raw.idea, ctx.registry), why: raw.why ? stripUnknownRefs(raw.why, ctx.registry) : null };
  return { content: { ok: true, nota: "La idea aparece debajo de tu respuesta con sus botones. Menciónala en una línea." }, summary: `idea: ${idea.title}`, idea };
}

export const TOOL_IMPLEMENTATIONS: { [N in ToolName]: (input: ToolInput<N>, ctx: ToolContext) => Promise<ToolOutput> } = {
  buscar_piezas: searchPieces,
  resumen_periodo: periodSummary,
  ranking_ganchos: hookRankingTool,
  calendario: calendarTool,
  meta_seguidores: goalTool,
  analisis_pieza: pieceDetailTool,
  informe_mensual: monthlyReportTool,
  proponer_idea: proposeIdeaTool,
};
