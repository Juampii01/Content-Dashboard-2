/**
 * Estratega simulado (AI_FAKE=1, solo en desarrollo): el modo simulado de lib/ai/fake.ts no hace tool use,
 * así que aquí se simula el flujo completo de forma determinista. Elige las herramientas por palabras de la
 * pregunta, las corre DE VERDAD contra la base (las cifras son reales) y arma la respuesta con esas cifras,
 * citando las referencias como lo haría Claude. Funciones puras: se prueban sin base.
 */
import { addDays } from "@/lib/metrics/params";
import type { ToolName } from "./tools";

export type FakeKind = "publicar" | "baja" | "ganchos" | "meta" | "informe" | "retencion" | "general";
export type FakeCall = { name: ToolName; input: Record<string, unknown> };

const NETS = [
  { re: /instagram|\big\b|reels?\b/i, key: "instagram", label: "Instagram" },
  { re: /youtube|\byt\b|shorts?\b/i, key: "youtube", label: "YouTube" },
  { re: /tiktok|tik tok/i, key: "tiktok", label: "TikTok" },
] as const;

export function detectNetwork(q: string): (typeof NETS)[number] | null {
  return NETS.find((n) => n.re.test(q)) ?? null;
}

export function classifyQuestion(question: string): FakeKind {
  const q = question.toLowerCase();
  if (/retenci[oó]n|cu[aá]nto (me )?ven|tiempo visto/.test(q)) return "retencion";
  if (/baj[oóa]|cay[oó]|ca[ií]da|peor|empeor/.test(q)) return "baja";
  if (/gancho|hook|primera (frase|l[ií]nea)/.test(q)) return "ganchos";
  if (/meta|seguidores|llegar a/.test(q)) return "meta";
  if (/informe|reporte|resum[eí]me el mes/.test(q)) return "informe";
  if (/public|qu[eé] (hago|subo|grabo)|esta semana|ideas?|calendario/.test(q)) return "publicar";
  return "general";
}

/** Herramientas de lectura para cada tipo de pregunta (en el orden en que las llamaría el modelo). */
export function planFakeTools(question: string, today: string): FakeCall[] {
  const net = detectNetwork(question)?.key;
  const red = net ? { red: net } : {};
  const last28 = { desde: addDays(today, -27), hasta: today };
  switch (classifyQuestion(question)) {
    case "publicar":
      return [
        { name: "calendario", input: { dias: 7 } },
        { name: "ranking_ganchos", input: { ...red } },
        { name: "buscar_piezas", input: { ...red, desde: addDays(today, -59), orden: "puntaje", limite: 4 } },
      ];
    case "baja":
      return [
        { name: "resumen_periodo", input: { ...last28, ...red, comparar: true } },
        { name: "buscar_piezas", input: { ...red, ...last28, orden: "puntaje", direccion: "asc", limite: 3 } },
        { name: "buscar_piezas", input: { ...red, ...last28, orden: "puntaje", limite: 2 } },
      ];
    case "ganchos":
      return [{ name: "ranking_ganchos", input: { ...red } }];
    case "meta":
      return [{ name: "meta_seguidores", input: {} }];
    case "informe":
      return [{ name: "informe_mensual", input: {} }];
    case "retencion":
      return [{ name: "buscar_piezas", input: { ...red, orden: "puntaje", limite: 3 } }];
    default:
      return [
        { name: "resumen_periodo", input: { ...last28, ...red, comparar: true } },
        { name: "buscar_piezas", input: { ...red, ...last28, orden: "puntaje", limite: 3 } },
      ];
  }
}

type Piece = { ref: string; red: string; tipo: string; texto: string; x_mediana: number | null; vistas: number | null; gancho: string | null; seg_vistos_prom: number | null; pct_visto_prom: number | null; pct_salta_3s: number | null; guardados: number | null };
type Totals = { piezas: number; vistas: number | null; interaccion_pct: number | null; seguidores_netos: number | null };
type Summary = { ref: string; red: string; actual: Totals; anterior?: Totals; cambio_pct?: { vistas: number | null; piezas: number | null } };
type HookRow = { tipo: string; piezas: number; mediana_x: number; mejor_pieza: Piece | null };
type Output = Record<string, unknown>;

const n = (v: number | null | undefined) => (v == null ? "sin dato" : new Intl.NumberFormat("es-419", { useGrouping: "always", maximumFractionDigits: 1 }).format(v));
const x = (v: number | null | undefined) => (v == null ? "sin comparación" : `×${(Math.round(v * 10) / 10).toFixed(1)}`);
const pct = (v: number | null | undefined) => (v == null ? "sin dato" : `${v > 0 ? "+" : ""}${n(v)} %`);

function piecesOf(o: Output | undefined): Piece[] {
  return (o?.piezas as Piece[] | undefined) ?? [];
}

/** Ideas que propondría el modelo a partir de lo que leyó (solo para "¿qué publico?"). */
export function fakeIdeaCalls(question: string, outputs: Output[], today: string): FakeCall[] {
  if (classifyQuestion(question) !== "publicar") return [];
  const ranking = outputs.find((o) => Array.isArray(o.tipos));
  const best = (ranking?.tipos as HookRow[] | undefined)?.[0];
  const top = piecesOf(outputs.find((o) => Array.isArray(o.piezas)));
  const net = detectNetwork(question);
  const redes = net ? [net.key.toUpperCase()] : ["INSTAGRAM", "TIKTOK"];
  const calls: FakeCall[] = [];
  const base = top[0];
  if (base) {
    calls.push({
      name: "proponer_idea",
      input: {
        titulo: `Segunda parte: ${base.texto.slice(0, 60)}`,
        idea: `Retoma el tema de tu pieza que más rindió (${x(base.x_mediana)} tu mediana) y lleva la promesa un paso más allá, con un ejemplo nuevo.`,
        gancho: base.texto.slice(0, 120),
        formato: "REEL",
        redes,
        fecha: addDays(today, 1),
        por_que: `Es tu pieza con mejor rendimiento reciente [${base.ref}].`,
      },
    });
  }
  if (best && best.mejor_pieza) {
    calls.push({
      name: "proponer_idea",
      input: {
        titulo: `Gancho de ${best.tipo.toLowerCase()} sobre tu tema principal`,
        idea: `Usa un gancho de ${best.tipo.toLowerCase()}, tu tipo que más rinde (${x(best.mediana_x)} en ${best.piezas} piezas), con la estructura de [${best.mejor_pieza.ref}].`,
        formato: "REEL",
        redes,
        fecha: addDays(today, 3),
        por_que: `Los ganchos de ${best.tipo.toLowerCase()} son los que más te rinden.`,
      },
    });
  }
  return calls.slice(0, 2);
}

/** Respuesta en texto, con las cifras que devolvieron las herramientas y sus referencias. */
export function composeFakeAnswer(question: string, outputs: Output[]): string {
  const kind = classifyQuestion(question);
  const net = detectNetwork(question);
  const note = "\n\n_(Respuesta simulada: modo de prueba sin IA. Las cifras y las piezas citadas son reales.)_";

  if (kind === "retencion") {
    const top = piecesOf(outputs[0]);
    const igOnly = net?.key === "instagram";
    const lines = top.slice(0, 3).map((p) =>
      `- [${p.ref}] ${p.texto.slice(0, 70)}: ${x(p.x_mediana)} tu mediana${p.pct_visto_prom != null ? `, ${n(p.pct_visto_prom)} % visto` : p.seg_vistos_prom != null ? `, ${n(p.seg_vistos_prom)} s vistos en promedio` : ", sin dato de tiempo visto"}${p.pct_salta_3s != null ? `, ${n(p.pct_salta_3s)} % salta en 3 s` : ""}.`,
    );
    return `${igOnly ? "**Instagram no da la curva de retención ni el porcentaje visto** de cada reel." : "La retención completa solo la da YouTube; Instagram da el tiempo medio visto y TikTok no da ningún dato de retención."} Lo más cercano que sí tienes:\n\n${lines.join("\n") || "- Todavía no hay piezas con esos datos."}${note}`;
  }

  if (kind === "ganchos") {
    const r = outputs[0] ?? {};
    const tipos = (r.tipos as HookRow[] | undefined) ?? [];
    if (tipos.length === 0) return `Todavía no hay suficientes piezas con el gancho clasificado${net ? ` en ${net.label}` : ""} (hace falta un mínimo de 3 por tipo). Clasifícalas en Métricas → Ganchos y vuelve a preguntar.${note}`;
    const [a, b] = tipos;
    const last = tipos[tipos.length - 1]!;
    return `Tu gancho que mejor funciona${net ? ` en ${net.label}` : ""} es el de **${a!.tipo.toLowerCase()}**: rinde ${x(a!.mediana_x)} tu mediana en ${a!.piezas} piezas [${r.ref}].\n\n${[
      a!.mejor_pieza ? `- Tu mejor ejemplo: «${a!.mejor_pieza.texto.slice(0, 80)}» con ${x(a!.mejor_pieza.x_mediana)} [${a!.mejor_pieza.ref}].` : null,
      b ? `- Le sigue ${b.tipo.toLowerCase()} con ${x(b.mediana_x)} (${b.piezas} piezas).` : null,
      tipos.length > 2 ? `- El que menos te rinde es ${last.tipo.toLowerCase()} (${x(last.mediana_x)}): úsalo menos o cámbiale la forma.` : null,
      "- Para tu próximo guion, abre con un gancho del primer tipo y mide si se repite.",
    ]
      .filter(Boolean)
      .join("\n")}${note}`;
  }

  if (kind === "meta") {
    const g = outputs[0] ?? {};
    if (!g.meta) return `Todavía no definiste una meta de seguidores [${g.ref}]. Hoy tienes ${n(g.seguidores_hoy as number | null)} y ganaste ${n(g.ganados_28_dias as number | null)} en 28 días. Defínela en Inicio → Tu camino a la meta (te sugerimos ${n(g.meta_sugerida as number | null)}).${note}`;
    const meta = g.meta as { seguidores: number };
    return `${g.llegada_estimada ? `Al ritmo de hoy llegarías a ${n(meta.seguidores)} seguidores el **${g.llegada_estimada}**` : `A este ritmo todavía no se ve cuándo llegarías a ${n(meta.seguidores)} seguidores`} [${g.ref}].\n\n- Hoy tienes ${n(g.seguidores_hoy as number | null)} y sumas unos ${n(g.ritmo_por_semana as number | null)} por semana.\n${g.necesarios_por_semana ? `- Para llegar a tu fecha límite necesitas ${n(g.necesarios_por_semana as number)} por semana.\n` : ""}- Llevas ${n(g.racha_semanas_cumplidas as number)} semanas seguidas cumpliendo tu meta de publicación.${g.patron ? `\n- ${g.patron}` : ""}${note}`;
  }

  if (kind === "informe") {
    const r = outputs[0] ?? {};
    if (!r.mes) return `${String(r.nota ?? "No hay informes guardados.")}${note}`;
    const mejores = (r.mejores as { ref: string; texto: string; x_mediana: number | null }[]) ?? [];
    const concl = r.conclusiones as { headline?: string } | null;
    return `${concl?.headline ?? `Tu informe de ${r.mes}`} [${r.ref}].\n\n${mejores
      .slice(0, 3)
      .map((m) => `- [${m.ref}] ${m.texto.slice(0, 70)}: ${x(m.x_mediana)} tu mediana.`)
      .join("\n")}${note}`;
  }

  const summary = outputs.find((o) => Array.isArray(o.resumen));
  const rows = (summary?.resumen as Summary[] | undefined) ?? [];
  const main = rows.find((r) => (net ? r.red === net.label : r.red === "Total")) ?? rows[0];

  if (kind === "baja" && main) {
    const worst = piecesOf(outputs[1]).filter((p) => p.x_mediana != null);
    const worstRefs = new Set(worst.map((p) => p.ref));
    const best = piecesOf(outputs[2]).filter((p) => p.x_mediana != null && p.x_mediana >= 1.2 && !worstRefs.has(p.ref));
    const change = main.cambio_pct?.vistas ?? null;
    const fewer = (main.cambio_pct?.piezas ?? 0) < -10;
    const head =
      change == null
        ? `No hay datos para comparar las vistas de ${main.red} con el periodo anterior [${main.ref}].`
        : change < 0
          ? `${main.red} bajó **${n(Math.abs(change))} %** en vistas: ${n(main.actual.vistas)} en los últimos 28 días contra ${n(main.anterior?.vistas)} en los 28 anteriores [${main.ref}].`
          : `En realidad ${main.red} no bajó: subió ${pct(change)} en vistas en los últimos 28 días [${main.ref}].`;
    const hook = worst[0]?.gancho && worst[0].gancho !== "Sin gancho claro" ? `; la primera abre con un gancho de ${worst[0].gancho.toLowerCase()}` : "";
    return `${head}\n\n${[
      fewer ? `- Publicaste menos: ${main.actual.piezas} piezas contra ${main.anterior?.piezas}. Es la causa más probable.` : `- Publicaste parecido (${main.actual.piezas} piezas contra ${main.anterior?.piezas ?? "sin dato"}), así que no es por cantidad.`,
      worst.length ? `- Las que menos rindieron: ${worst.map((p) => `[${p.ref}] ${x(p.x_mediana)}`).join(", ")}${hook}.` : "- Las piezas de este periodo todavía no tienen 7 días para compararlas con tu mediana.",
      best[0] ? `- Lo que sí funcionó: [${best[0].ref}] con ${x(best[0].x_mediana)} tu mediana. Repite su formato.` : null,
    ]
      .filter(Boolean)
      .join("\n")}${note}`;
  }

  if (kind === "publicar") {
    const cal = outputs.find((o) => Array.isArray(o.planeado)) ?? {};
    const planned = (cal.planeado as { ref: string; titulo: string; fecha: string }[] | undefined) ?? [];
    const free = (cal.dias_sin_nada as string[] | undefined) ?? [];
    const ranking = outputs.find((o) => Array.isArray(o.tipos));
    const best = (ranking?.tipos as HookRow[] | undefined)?.[0];
    const top = piecesOf(outputs.find((o) => Array.isArray(o.piezas)));
    return `${planned.length ? `Ya tienes ${planned.length} pieza${planned.length === 1 ? "" : "s"} en el calendario esta semana` : "No tienes nada planeado para los próximos 7 días"}${free.length ? ` y ${free.length} día${free.length === 1 ? "" : "s"} libre${free.length === 1 ? "" : "s"}` : ""}. Te propongo 2 piezas que se apoyan en lo que ya te funcionó.\n\n${[
      planned[0] ? `- Lo próximo: [${planned[0].ref}] ${planned[0].titulo} (${planned[0].fecha}).` : null,
      best ? `- Tus ganchos de ${best.tipo.toLowerCase()} rinden ${x(best.mediana_x)} tu mediana [${ranking?.ref}]: úsalos en las dos.` : "- Todavía no hay suficientes ganchos clasificados para saber cuál te rinde más.",
      top[0] ? `- Tu mejor pieza reciente es [${top[0].ref}] con ${x(top[0].x_mediana)}: la primera idea es su continuación.` : null,
    ]
      .filter(Boolean)
      .join("\n")}${note}`;
  }

  // General: resumen del último mes.
  const top = piecesOf(outputs.find((o) => Array.isArray(o.piezas)));
  if (!main) return `Todavía no hay datos de tus redes para responder eso. Conecta tus cuentas en Ajustes.${note}`;
  return `En los últimos 28 días publicaste ${main.actual.piezas} piezas con ${n(main.actual.vistas)} vistas (${pct(main.cambio_pct?.vistas)} contra los 28 anteriores) [${main.ref}].\n\n${top
    .map((p) => `- [${p.ref}] ${p.texto.slice(0, 70)}: ${x(p.x_mediana)} tu mediana.`)
    .join("\n")}${note}`;
}
