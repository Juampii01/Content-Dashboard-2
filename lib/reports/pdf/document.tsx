import { Document, Image as PdfImage, Link, Page, Text, View } from "@react-pdf/renderer";
import type { Styles } from "@react-pdf/renderer";

type Style = Styles[string];
import type { ReactNode } from "react";
import { formatCompact, formatDate, formatDuration, formatMultiplier, formatNumber, formatPercent } from "@/lib/format";
import { typeLabel } from "@/lib/metrics/labels";
import { todayIn } from "@/lib/metrics/params";
import { platformLabel } from "@/lib/social/types";
import { addMonths, change, monthLabel, sumSeries } from "../month";
import type { MonthlyReportData, Pair, ReportPiece, ReportPlatform } from "../types";
import { DailyBars, FollowersLine, WeekBars } from "./charts";
import type { PdfTheme } from "./theme";

/**
 * El informe mensual en PDF (carta, 612 × 792 pt). Editorial y sobrio: portada con el color de la marca,
 * páginas blancas con cifras grandes, un solo acento y gráficos vectoriales. Todo sale de `data`;
 * lo que una red no da se dice en la página de esa red.
 */
export type ReportImages = { brand: Buffer | null; pieces: Record<string, Buffer | null> };

const W = 612;
const MARGIN = 44;
const CONTENT = W - MARGIN * 2;

// ─── Utilidades de texto ───────────────────────────────────────────────────

/**
 * Texto apto para las fuentes del PDF (subconjunto latino): quita emojis y símbolos que se verían como
 * cuadros o letras sueltas ("=G"). Respeta tildes, ñ, ¿¡, comillas tipográficas, guiones, ×, · y €.
 */
export function pdfText(text: string): string {
  return text
    .replace(/[^\u0009\u000a\u0020-\u007e\u00a0-\u00ff\u2013\u2014\u2018-\u201e\u2022\u2026\u20ac\u2212]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function clip(text: string, max: number): string {
  const t = pdfText(text).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function initials(name: string): string {
  const parts = name.replace(/^@/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "•";
}

type Delta = { text: string; tone: "up" | "down" | "flat" | "none" };

function delta(p: Pair): Delta {
  const c = change(p);
  if (c == null) return { text: "Sin dato del mes anterior", tone: "none" };
  if (Math.abs(c) < 0.5) return { text: "Igual que el mes anterior", tone: "flat" };
  return { text: `${formatPercent(c, { signed: true, digits: Math.abs(c) < 10 ? 1 : 0 })} vs. mes anterior`, tone: c > 0 ? "up" : "down" };
}

/** Para tasas (puntos porcentuales): la diferencia en puntos, no en porcentaje. */
function deltaPoints(p: Pair): Delta {
  if (p.current == null || p.previous == null) return { text: "Sin dato del mes anterior", tone: "none" };
  const d = p.current - p.previous;
  if (Math.abs(d) < 0.05) return { text: "Igual que el mes anterior", tone: "flat" };
  return { text: `${d > 0 ? "+" : "−"}${formatNumber(Math.abs(d), { digits: 1 })} pts vs. mes anterior`, tone: d > 0 ? "up" : "down" };
}

function signed(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatNumber(Math.abs(v))}`;
}

const localDay = (iso: string, tz: string) => todayIn(tz, new Date(iso));

// ─── Piezas comunes ────────────────────────────────────────────────────────

function Eyebrow({ children, color, style }: { children: ReactNode; color: string; style?: Style }) {
  return <Text style={{ fontFamily: "JetBrains Mono", fontSize: 7.5, fontWeight: 600, letterSpacing: 1.6, textTransform: "uppercase", color, ...style }}>{children}</Text>;
}

function SectionTitle({ number, eyebrow, title, description, theme }: { number: string; eyebrow: string; title: string; description?: string; theme: PdfTheme }) {
  return (
    <View style={{ marginBottom: 22 }}>
      <Eyebrow color={theme.accent}>{`${number} · ${eyebrow}`}</Eyebrow>
      <Text style={{ fontFamily: theme.heading.family, fontWeight: theme.heading.weight, fontSize: 25, letterSpacing: -0.6, color: theme.ink, marginTop: 7 }}>{title}</Text>
      {description && <Text style={{ fontSize: 9.5, color: theme.muted, marginTop: 5, lineHeight: 1.45, maxWidth: 440 }}>{description}</Text>}
    </View>
  );
}

function DeltaText({ d, theme, size = 7.5 }: { d: Delta; theme: PdfTheme; size?: number }) {
  const color = d.tone === "up" ? theme.positive : d.tone === "down" ? theme.negative : theme.faint;
  return <Text style={{ fontSize: size, color, marginTop: 4 }}>{d.text}</Text>;
}

/** Tarjeta de cifra: etiqueta, número grande y variación. */
function Kpi({ label, value, d, sub, theme, width, size = 22 }: { label: string; value: string; d?: Delta; sub?: string; theme: PdfTheme; width: number; size?: number }) {
  return (
    <View style={{ width, paddingVertical: 12, paddingHorizontal: 12, borderWidth: 0.8, borderColor: theme.line, borderRadius: 8 }}>
      <Text style={{ fontSize: 8, color: theme.muted, fontWeight: 500, minHeight: size < 20 ? 20 : undefined }}>{label}</Text>
      <Text style={{ fontSize: size, fontWeight: 800, letterSpacing: -0.7, color: theme.ink, marginTop: 6 }}>{value}</Text>
      {d && <DeltaText d={d} theme={theme} />}
      {sub && <Text style={{ fontSize: 7.5, color: theme.faint, marginTop: 2 }}>{sub}</Text>}
    </View>
  );
}

function Dot({ color, size = 7 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

function Header({ data, theme }: { data: MonthlyReportData; theme: PdfTheme }) {
  return (
    <View fixed style={{ position: "absolute", top: 22, left: MARGIN, right: MARGIN, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text style={{ fontSize: 7.5, fontWeight: 600, color: theme.ink }}>{pdfText(data.brand.name)}</Text>
      <Eyebrow color={theme.faint} style={{ fontSize: 6.5, letterSpacing: 1.2 }}>{`Informe · ${monthLabel(data.month)}`}</Eyebrow>
    </View>
  );
}

function Footer({ data, theme }: { data: MonthlyReportData; theme: PdfTheme }) {
  return (
    <View fixed style={{ position: "absolute", bottom: 24, left: MARGIN, right: MARGIN, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 0.6, borderTopColor: theme.line, paddingTop: 8 }}>
      <Text style={{ fontSize: 6.5, color: theme.faint }}>
        {data.partial ? `Mes en curso: datos hasta el ${formatDate(data.to)}` : `Datos del ${formatDate(data.from)} al ${formatDate(data.to)}`} · Fuente: APIs oficiales de cada red
      </Text>
      <Text style={{ fontSize: 6.5, color: theme.faint, fontFamily: "JetBrains Mono" }} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function Avatar({ image, name, size, theme }: { image: Buffer | null; name: string; size: number; theme: PdfTheme }) {
  if (image) return <PdfImage src={{ data: image, format: "jpg" }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: size * 0.38, fontWeight: 700, color: "#ffffff" }}>{initials(name)}</Text>
    </View>
  );
}

// ─── Portada ───────────────────────────────────────────────────────────────

function Cover({ data, theme, images }: { data: MonthlyReportData; theme: PdfTheme; images: ReportImages }) {
  const [month, year] = monthLabel(data.month).split(" ");
  const figures = [
    { label: "Seguidores al cierre", value: data.totals.followers == null ? "—" : formatNumber(data.totals.followers), d: delta(data.totals.followersGained), sub: data.totals.followersGained.current == null ? null : `${signed(data.totals.followersGained.current)} en el mes` },
    { label: "Visualizaciones", value: formatCompact(data.totals.views.current), d: delta(data.totals.views), sub: "de lo publicado en el mes" },
    { label: "Interacciones", value: formatCompact(data.totals.interactions.current), d: delta(data.totals.interactions), sub: data.totals.engagementRate.current == null ? null : `${formatPercent(data.totals.engagementRate.current)} de tasa` },
    { label: "Publicaciones", value: formatNumber(data.totals.pieces.current), d: delta(data.totals.pieces), sub: `en ${data.platforms.length} ${data.platforms.length === 1 ? "red" : "redes"}` },
  ];
  const tone = (d: Delta) => (d.tone === "up" ? "#5ee0a8" : d.tone === "down" ? "#ffab85" : theme.coverMuted);
  return (
    <Page size="LETTER" style={{ backgroundColor: theme.cover, color: theme.coverText, fontFamily: "Inter", paddingHorizontal: MARGIN, paddingTop: 44, paddingBottom: 40 }}>
      {/* Grilla casi invisible, como el fondo de la app */}
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: 300, opacity: 0.06 }}>
        {Array.from({ length: 13 }, (_, i) => (
          <View key={i} style={{ position: "absolute", left: i * 48, top: 0, bottom: 0, width: 0.6, backgroundColor: "#ffffff" }} />
        ))}
        {Array.from({ length: 7 }, (_, i) => (
          <View key={`h${i}`} style={{ position: "absolute", top: i * 48, left: 0, right: 0, height: 0.6, backgroundColor: "#ffffff" }} />
        ))}
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Avatar image={images.brand} name={data.brand.name} size={40} theme={theme} />
          <View style={{ marginLeft: 11 }}>
            <Text style={{ fontSize: 12, fontWeight: 700 }}>{pdfText(data.brand.name)}</Text>
            {data.brand.handle && <Text style={{ fontSize: 8.5, color: theme.coverMuted, marginTop: 2 }}>{pdfText(data.brand.handle)}</Text>}
          </View>
        </View>
        <Eyebrow color={theme.coverMuted}>Informe mensual</Eyebrow>
      </View>

      <View style={{ marginTop: 150 }}>
        <View style={{ width: 36, height: 3, backgroundColor: theme.accent === "#0070f8" ? "#4da3ff" : theme.accent, marginBottom: 18 }} />
        <Eyebrow color="#8cc6ff">Resultados de contenido</Eyebrow>
        <Text style={{ fontFamily: theme.heading.family, fontWeight: theme.heading.weight, fontSize: 68, letterSpacing: -2.4, lineHeight: 1.02, marginTop: 12 }}>{month}</Text>
        <Text style={{ fontFamily: theme.heading.family, fontWeight: theme.heading.weight, fontSize: 68, letterSpacing: -2.4, lineHeight: 1.02, color: theme.coverMuted }}>{year}</Text>
        {data.partial && (
          <View style={{ alignSelf: "flex-start", marginTop: 14, borderWidth: 0.8, borderColor: theme.coverMuted, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ fontSize: 8, color: theme.coverMuted }}>{`Mes en curso · datos hasta el ${formatDate(data.to)}`}</Text>
          </View>
        )}
        {data.summary && <Text style={{ fontSize: 14, lineHeight: 1.45, marginTop: 22, maxWidth: 430, color: "#dce7f7" }}>{pdfText(data.summary.headline)}</Text>}
      </View>

      <View style={{ position: "absolute", left: MARGIN, right: MARGIN, bottom: 40 }}>
        <View style={{ flexDirection: "row", borderTopWidth: 0.8, borderTopColor: "rgba(255,255,255,0.22)", paddingTop: 18 }}>
          {figures.map((f, i) => (
            <View key={f.label} style={{ width: CONTENT / 4, paddingLeft: i ? 14 : 0, borderLeftWidth: i ? 0.8 : 0, borderLeftColor: "rgba(255,255,255,0.16)" }}>
              <Text style={{ fontSize: 7.5, color: theme.coverMuted }}>{f.label}</Text>
              <Text style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.8, marginTop: 6 }}>{f.value}</Text>
              <Text style={{ fontSize: 7, color: tone(f.d), marginTop: 4 }}>{f.d.text}</Text>
              {f.sub && <Text style={{ fontSize: 7, color: theme.coverMuted, marginTop: 2 }}>{f.sub}</Text>}
            </View>
          ))}
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 26 }}>
          <Text style={{ fontSize: 7.5, color: theme.coverMuted }}>{data.platforms.map((p) => platformLabel[p.platform]).join("  ·  ") || "Sin redes conectadas"}</Text>
          <Text style={{ fontSize: 7.5, color: theme.coverMuted }}>{`Preparado el ${formatDate(localDay(data.generatedAt, data.timezone))}`}</Text>
        </View>
      </View>
    </Page>
  );
}

// ─── Resumen ───────────────────────────────────────────────────────────────

function Summary({ data, theme }: { data: MonthlyReportData; theme: PdfTheme }) {
  const next = monthLabel(addMonths(data.month, 1), { lower: true, withYear: false });
  const t = data.totals;
  const kpiW = (CONTENT - 4 * 8) / 5;
  return (
    <View>
      <SectionTitle number="01" eyebrow="Resumen" title="El mes en una página" description="Los números de todas tus redes juntas y lo que dicen, contra el mes anterior." theme={theme} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 24 }}>
        <Kpi width={kpiW} size={17} theme={theme} label="Seguidores ganados" value={signed(t.followersGained.current)} d={delta(t.followersGained)} />
        <Kpi width={kpiW} size={17} theme={theme} label="Visualizaciones" value={formatCompact(t.views.current)} d={delta(t.views)} />
        <Kpi width={kpiW} size={17} theme={theme} label="Interacciones" value={formatCompact(t.interactions.current)} d={delta(t.interactions)} />
        <Kpi width={kpiW} size={17} theme={theme} label="Tasa de interacción" value={formatPercent(t.engagementRate.current)} d={deltaPoints(t.engagementRate)} />
        <Kpi width={kpiW} size={17} theme={theme} label="Publicaciones" value={formatNumber(t.pieces.current)} d={delta(t.pieces)} />
      </View>

      {data.summary ? (
        <View>
          <Text style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.4, color: theme.ink, marginBottom: 20, letterSpacing: -0.2 }}>{pdfText(data.summary.headline)}</Text>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <List title="Logros del mes" items={data.summary.wins} theme={theme} color={theme.positive} width={CONTENT * 0.54} />
            <List title="A vigilar" items={data.summary.watch} theme={theme} color={theme.negative} width={CONTENT * 0.41} />
          </View>
          <View style={{ marginTop: 22 }} wrap={false}>
            <Eyebrow color={theme.accent} style={{ marginBottom: 10 }}>{`Ideas para ${next}`}</Eyebrow>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              {data.summary.ideas.map((idea, i) => (
                <View key={i} style={{ width: (CONTENT - 20) / 3, backgroundColor: theme.soft, borderRadius: 8, padding: 12 }}>
                  <Text style={{ fontFamily: "JetBrains Mono", fontSize: 8, color: theme.accent, fontWeight: 600 }}>{String(i + 1).padStart(2, "0")}</Text>
                  <Text style={{ fontSize: 10, fontWeight: 700, color: theme.ink, marginTop: 6, lineHeight: 1.3 }}>{clip(idea.title, 70)}</Text>
                  <Text style={{ fontSize: 9, color: theme.ink, marginTop: 6, lineHeight: 1.4 }}>{`“${clip(idea.hook, 140)}”`}</Text>
                  <Text style={{ fontSize: 7.5, color: theme.muted, marginTop: 6, lineHeight: 1.4 }}>{clip(idea.why, 150)}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      ) : (
        <View style={{ backgroundColor: theme.soft, borderRadius: 8, padding: 14 }}>
          <Text style={{ fontSize: 9.5, color: theme.muted, lineHeight: 1.5 }}>
            El resumen escrito con IA no está disponible para este informe (la IA no está configurada o no hubo datos suficientes). Las cifras de las páginas siguientes están completas.
          </Text>
        </View>
      )}
    </View>
  );
}

function List({ title, items, theme, color, width }: { title: string; items: string[]; theme: PdfTheme; color: string; width: number }) {
  return (
    <View style={{ width }}>
      <Eyebrow color={color} style={{ marginBottom: 10 }}>{title}</Eyebrow>
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: "row", marginBottom: 9 }} wrap={false}>
          <Text style={{ fontFamily: "JetBrains Mono", fontSize: 8, fontWeight: 600, color, width: 18, marginTop: 1 }}>{String(i + 1).padStart(2, "0")}</Text>
          <Text style={{ fontSize: 9.5, lineHeight: 1.45, color: theme.ink, flex: 1 }}>{pdfText(item)}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Por red ───────────────────────────────────────────────────────────────

function PlatformPage({ p, index, data, theme }: { p: ReportPlatform; index: number; data: MonthlyReportData; theme: PdfTheme }) {
  const color = theme.platform[p.platform];
  const kpiW = (CONTENT - 3 * 8) / 4;
  const accountViews = sumSeries(p.dailyViews);
  return (
    <View break>
      <SectionTitle
        number={String(index + 2).padStart(2, "0")}
        eyebrow={platformLabel[p.platform]}
        title={`${platformLabel[p.platform]} · ${p.handle.startsWith("@") ? p.handle : `@${p.handle}`}`}
        description={`Seguidores, alcance y publicaciones de ${monthLabel(data.month, { lower: true })}, contra ${monthLabel(addMonths(data.month, -1), { lower: true })}.`}
        theme={theme}
      />
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 26 }}>
        <Kpi width={kpiW} theme={theme} label="Seguidores al cierre" value={p.followers == null ? "—" : formatNumber(p.followers)} d={delta(p.followersGained)} sub={p.followersGained.current == null ? "Sin dato de variación" : `${signed(p.followersGained.current)} en el mes`} />
        <Kpi width={kpiW} theme={theme} label="Visualizaciones" value={formatCompact(p.views.current)} d={delta(p.views)} sub="de lo publicado en el mes" />
        <Kpi width={kpiW} theme={theme} label="Interacciones" value={formatCompact(p.interactions.current)} d={delta(p.interactions)} sub={p.engagementRate.current == null ? undefined : `${formatPercent(p.engagementRate.current)} de tasa`} />
        <Kpi width={kpiW} theme={theme} label="Publicaciones" value={formatNumber(p.pieces.current)} d={delta(p.pieces)} />
      </View>

      <View wrap={false} style={{ marginBottom: 24 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Dot color={color} />
            <Text style={{ fontSize: 10.5, fontWeight: 700, color: theme.ink, marginLeft: 6 }}>Visualizaciones por día</Text>
          </View>
          <Text style={{ fontSize: 8, color: theme.muted }}>{accountViews == null ? "Sin datos diarios" : `${formatNumber(accountViews)} en el mes (toda la cuenta)`}</Text>
        </View>
        {accountViews == null ? (
          <EmptyChart theme={theme} text={`${platformLabel[p.platform]} no dio visualizaciones diarias en este mes.`} />
        ) : (
          <DailyBars days={data.days} values={p.dailyViews} width={CONTENT} height={150} color={color} theme={theme} />
        )}
      </View>

      <View wrap={false} style={{ marginBottom: 20 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Dot color={color} />
            <Text style={{ fontSize: 10.5, fontWeight: 700, color: theme.ink, marginLeft: 6 }}>Seguidores</Text>
          </View>
          <Text style={{ fontSize: 8, color: theme.muted }}>
            {p.followersGained.current == null ? "Sin datos del mes" : `${signed(p.followersGained.current)} en el mes`}
          </Text>
        </View>
        {p.dailyFollowers.filter((v) => v != null).length >= 2 ? (
          <FollowersLine days={data.days} values={p.dailyFollowers} width={CONTENT} height={90} color={color} theme={theme} />
        ) : (
          <EmptyChart theme={theme} text="No hay suficientes datos de seguidores en este mes para dibujar la evolución." />
        )}
      </View>

      {p.notes.length > 0 && (
        <View style={{ borderTopWidth: 0.6, borderTopColor: theme.line, paddingTop: 10 }} wrap={false}>
          <Text style={{ fontSize: 7.5, fontWeight: 600, color: theme.muted, marginBottom: 4 }}>Sobre estos datos</Text>
          {p.notes.map((n, i) => (
            <Text key={i} style={{ fontSize: 7.5, color: theme.muted, lineHeight: 1.5 }}>{`· ${pdfText(n)}`}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

function EmptyChart({ theme, text }: { theme: PdfTheme; text: string }) {
  return (
    <View style={{ height: 60, borderRadius: 8, backgroundColor: theme.soft, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 8.5, color: theme.muted }}>{text}</Text>
    </View>
  );
}

// ─── Mejores piezas ────────────────────────────────────────────────────────

function PieceRow({ piece, rank, image, theme, tz, lesson }: { piece: ReportPiece; rank: string; image: Buffer | null; theme: PdfTheme; tz: string; lesson?: string | null }) {
  const metrics = [
    { label: "visualizaciones", value: formatCompact(piece.views) },
    { label: "interacciones", value: formatCompact(piece.interactions) },
    { label: "de tasa", value: formatPercent(piece.engagementRate) },
  ];
  const note = lesson ?? piece.why;
  return (
    <View wrap={false} style={{ flexDirection: "row", paddingVertical: 8, borderBottomWidth: 0.6, borderBottomColor: theme.line }}>
      <Text style={{ width: 30, fontFamily: "JetBrains Mono", fontSize: 15, fontWeight: 600, color: theme.accent, marginTop: 1 }}>{rank}</Text>
      {image ? (
        <PdfImage src={{ data: image, format: "jpg" }} style={{ width: 45, height: 60, borderRadius: 5, objectFit: "cover" }} />
      ) : (
        <View style={{ width: 45, height: 60, borderRadius: 5, backgroundColor: theme.soft, borderWidth: 0.6, borderColor: theme.line }} />
      )}
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Dot color={theme.platform[piece.platform]} size={5} />
          <Text style={{ fontSize: 7.5, color: theme.muted, marginLeft: 5 }}>
            {`${platformLabel[piece.platform]} · ${typeLabel[piece.type]} · ${formatDate(localDay(piece.publishedAt, tz))}`}
          </Text>
        </View>
        {piece.permalink ? (
          <Link src={piece.permalink} style={{ fontSize: 10, fontWeight: 600, color: theme.ink, marginTop: 4, lineHeight: 1.35, textDecoration: "none" }}>
            {clip(piece.title, 115)}
          </Link>
        ) : (
          <Text style={{ fontSize: 10, fontWeight: 600, color: theme.ink, marginTop: 4, lineHeight: 1.35 }}>{clip(piece.title, 115)}</Text>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
          {metrics.map((m) => (
            <Text key={m.label} style={{ fontSize: 8, color: theme.muted, marginRight: 12 }}>
              <Text style={{ fontWeight: 700, color: theme.ink }}>{m.value}</Text> {m.label}
            </Text>
          ))}
          {piece.perfScore != null && (
            <View style={{ backgroundColor: theme.accentSoft, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1.5 }}>
              <Text style={{ fontSize: 7.5, fontWeight: 700, color: theme.accent }}>{`${formatMultiplier(piece.perfScore)} tu mediana`}</Text>
            </View>
          )}
        </View>
        {note && (
          <Text style={{ fontSize: 8, color: theme.muted, marginTop: 6, lineHeight: 1.45 }}>
            <Text style={{ fontWeight: 600, color: theme.ink }}>{lesson ? "Lección: " : "¿Por qué funcionó? "}</Text>
            {clip(note, 230)}
          </Text>
        )}
      </View>
    </View>
  );
}

function TopPieces({ data, theme, images }: { data: MonthlyReportData; theme: PdfTheme; images: ReportImages }) {
  const n = 2 + data.platforms.length;
  const lesson = data.summary?.worstLesson ?? data.worst?.lessons[0] ?? null;
  return (
    <View break>
      <SectionTitle
        number={String(n).padStart(2, "0")}
        eyebrow="Contenido"
        title={data.top.length === 1 ? "Tu mejor pieza del mes" : `Las ${data.top.length || 5} mejores piezas del mes`}
        description="Ordenadas por cuántas veces superaron tu mediana de visualizaciones en su red y formato (o por visualizaciones, si todavía no hay mediana)."
        theme={theme}
      />
      {data.top.length === 0 ? (
        <EmptyChart theme={theme} text="No hubo publicaciones en este mes." />
      ) : (
        <View style={{ borderTopWidth: 0.6, borderTopColor: theme.line }}>
          {data.top.map((p, i) => (
            <PieceRow key={p.id} piece={p} rank={String(i + 1).padStart(2, "0")} image={images.pieces[p.id] ?? null} theme={theme} tz={data.timezone} />
          ))}
        </View>
      )}
      {data.worst && (
        <View wrap={false} style={{ marginTop: 14, backgroundColor: theme.soft, borderRadius: 8, paddingHorizontal: 12, paddingTop: 10 }}>
          <Eyebrow color={theme.negative}>La que menos funcionó</Eyebrow>
          <PieceRow piece={data.worst} rank="—" image={images.pieces[data.worst.id] ?? null} theme={theme} tz={data.timezone} lesson={lesson ?? "Revisa el gancho y los primeros segundos: es donde se decide si la gente se queda."} />
        </View>
      )}
    </View>
  );
}

// ─── Constancia, calendario y producción ───────────────────────────────────

function Consistency({ data, theme }: { data: MonthlyReportData; theme: PdfTheme }) {
  const c = data.consistency;
  const n = 3 + data.platforms.length;
  const pct = c.planned ? Math.round((100 * c.plannedPublished) / c.planned) : null;
  const weeksHit = c.weeks.filter((w) => w.hit).length;
  const kpiW = (CONTENT - 2 * 8) / 3;
  const goal = c.goal;
  const goalPct = goal && goal.current != null ? Math.min(100, (100 * goal.current) / goal.followers) : null;
  const prod = data.production;
  const prodItems = [
    { label: "Guiones escritos", value: prod.scripts, sub: null as string | null },
    { label: "Videos editados", value: prod.videosEdited, sub: null },
    { label: "Carruseles", value: prod.carouselsCreated, sub: prod.carouselsExported ? `${prod.carouselsExported} exportados` : null },
    { label: "Videos con clon", value: prod.cloneVideos, sub: prod.cloneSeconds ? `${formatDuration(prod.cloneSeconds)} en total` : null },
  ];

  return (
    <View break>
      <SectionTitle number={String(n).padStart(2, "0")} eyebrow="Constancia" title="Lo planeado contra lo publicado" description="Tu calendario, tu ritmo de cada semana y cómo vas con tu meta de seguidores." theme={theme} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 22 }}>
        <Kpi width={kpiW} theme={theme} label="Planeadas en el calendario" value={formatNumber(c.planned)} sub={`con fecha en ${monthLabel(data.month, { lower: true, withYear: false })}`} />
        <Kpi width={kpiW} theme={theme} label="Publicadas de lo planeado" value={pct == null ? "—" : `${pct} %`} sub={c.planned ? `${c.plannedPublished} de ${c.planned}` : "Sin piezas planeadas"} />
        <Kpi width={kpiW} theme={theme} label="Publicadas en total" value={formatNumber(c.published)} sub="en todas tus redes" />
      </View>

      <View wrap={false} style={{ marginBottom: 24 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12 }}>
          <Text style={{ fontSize: 10.5, fontWeight: 700, color: theme.ink }}>Ritmo por semana</Text>
          <Text style={{ fontSize: 8, color: theme.muted }}>{`Meta: ${c.weeklyTarget} por semana · cumplida en ${weeksHit} de ${c.weeks.length} semanas`}</Text>
        </View>
        <WeekBars
          weeks={c.weeks.map((w) => ({ label: `${Number(w.weekStart.slice(8))}–${Number(w.weekEnd.slice(8))}${w.partial ? "*" : ""}`, pieces: w.pieces, target: w.target, hit: w.hit }))}
          width={CONTENT}
          height={96}
          theme={theme}
        />
        <Text style={{ fontSize: 7, color: theme.faint, marginTop: 6 }}>
          La línea punteada es la meta de cada semana.{c.weeks.some((w) => w.partial) ? " * Semana que el mes corta: la meta se ajusta a los días que caen en el mes." : ""}
          {c.streak > 1 ? ` Racha actual: ${c.streak} semanas seguidas cumpliendo la meta.` : ""}
        </Text>
      </View>

      <View wrap={false} style={{ marginBottom: 26, borderWidth: 0.8, borderColor: theme.line, borderRadius: 8, padding: 14 }}>
        <Text style={{ fontSize: 10.5, fontWeight: 700, color: theme.ink }}>Meta de seguidores</Text>
        {goal ? (
          <>
            <View style={{ flexDirection: "row", alignItems: "flex-end", marginTop: 8 }}>
              <Text style={{ fontSize: 20, fontWeight: 800, color: theme.ink, letterSpacing: -0.6 }}>{goal.current == null ? "—" : formatNumber(goal.current)}</Text>
              <Text style={{ fontSize: 9, color: theme.muted, marginLeft: 6, marginBottom: 3 }}>
                {`de ${formatNumber(goal.followers)} ${goal.platform === "TOTAL" ? "(todas las redes)" : `en ${platformLabel[goal.platform]}`}`}
              </Text>
            </View>
            <View style={{ height: 6, backgroundColor: theme.soft, borderRadius: 3, marginTop: 8 }}>
              <View style={{ height: 6, width: `${goalPct ?? 0}%`, backgroundColor: theme.accent, borderRadius: 3 }} />
            </View>
            <Text style={{ fontSize: 8.5, color: theme.muted, marginTop: 8, lineHeight: 1.45 }}>{goalText(goal)}</Text>
          </>
        ) : (
          <Text style={{ fontSize: 8.5, color: theme.muted, marginTop: 6, lineHeight: 1.45 }}>Todavía no hay una meta de seguidores. Defínela en Inicio para ver aquí cuánto falta y cuándo llegas a tu ritmo actual.</Text>
        )}
      </View>

      <View wrap={false}>
        <Eyebrow color={theme.accent} style={{ marginBottom: 10 }}>Producción del mes en la app</Eyebrow>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          {prodItems.map((item) => (
            <View key={item.label} style={{ width: (CONTENT - 3 * 8) / 4, backgroundColor: theme.soft, borderRadius: 8, padding: 12 }}>
              <Text style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.7, color: theme.ink }}>{formatNumber(item.value)}</Text>
              <Text style={{ fontSize: 8, color: theme.muted, marginTop: 4 }}>{item.label}</Text>
              {item.sub && <Text style={{ fontSize: 7, color: theme.faint, marginTop: 2 }}>{item.sub}</Text>}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function goalText(goal: NonNullable<MonthlyReportData["consistency"]["goal"]>): string {
  if (goal.current == null) return "Sin datos de seguidores para medir el avance.";
  if (goal.current >= goal.followers) return "Meta cumplida. Es buen momento para fijar la siguiente en Inicio.";
  const missing = goal.followers - goal.current;
  const pace = goal.perDay != null ? `Ritmo de los últimos 28 días: ${goal.perDay >= 0 ? "+" : "−"}${formatNumber(Math.abs(goal.perDay), { digits: 1 })} por día. ` : "";
  const eta = goal.eta ? `A ese ritmo llegas el ${formatDate(goal.eta)}.` : goal.perDay != null && goal.perDay <= 0 ? "A este ritmo la meta no se alcanza." : "Todavía no hay datos suficientes para estimar la fecha.";
  const deadline = goal.neededPerWeek != null && goal.deadline ? ` Para llegar al ${formatDate(goal.deadline)} necesitas ${formatNumber(goal.neededPerWeek)} por semana.` : "";
  return `Te faltan ${formatNumber(missing)}. ${pace}${eta}${deadline}`;
}

// ─── Documento ─────────────────────────────────────────────────────────────

export function ReportDocument({ data, theme, images }: { data: MonthlyReportData; theme: PdfTheme; images: ReportImages }) {
  const title = `Informe de ${monthLabel(data.month, { lower: true })} · ${data.brand.name}`;
  return (
    <Document title={title} author={data.brand.name} subject="Informe mensual de contenido" creator="Content Studio" producer="Content Studio" language="es">
      <Cover data={data} theme={theme} images={images} />
      <Page size="LETTER" style={{ fontFamily: "Inter", color: theme.ink, paddingHorizontal: MARGIN, paddingTop: 58, paddingBottom: 60 }}>
        <Header data={data} theme={theme} />
        <Summary data={data} theme={theme} />
        {data.platforms.map((p, i) => (
          <PlatformPage key={p.platform} p={p} index={i} data={data} theme={theme} />
        ))}
        <TopPieces data={data} theme={theme} images={images} />
        <Consistency data={data} theme={theme} />
        <Footer data={data} theme={theme} />
      </Page>
    </Document>
  );
}
