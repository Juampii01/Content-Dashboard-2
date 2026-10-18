import "server-only";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { languageRules } from "./language";

export type Brand = typeof schema.brandProfile.$inferSelect;

export async function getBrand(): Promise<Brand | null> {
  const [row] = await getDb().select().from(schema.brandProfile).limit(1);
  return row ?? null;
}

const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- (sin definir)");

/** Piezas propias que más superaron su mediana: son la mejor guía de qué funciona con esta audiencia. */
export async function topOwnPieces(limit = 8): Promise<{ text: string; views: number | null; ratio: number | null; platform: string; type: string }[]> {
  const rows = await getDb().execute<{ title: string | null; caption: string | null; views: number | null; perf_score: number | null; platform: string; type: string }>(sql`
    select title, caption, views, perf_score, platform, type
    from content_items
    where available and perf_score is not null and perf_score >= 1.3 and published_at > now() - interval '180 days'
    order by perf_score desc limit ${limit}
  `);
  return rows.rows.map((r) => ({
    text: (r.title || r.caption?.split("\n")[0] || "").slice(0, 180),
    views: r.views == null ? null : Number(r.views),
    ratio: r.perf_score == null ? null : Number(r.perf_score),
    platform: r.platform,
    type: r.type,
  }));
}

/**
 * Bloque de contexto de marca para los prompts. Va en la caché de Claude (es igual entre llamadas):
 * el orden es fijo y no lleva nada que cambie en cada pedido.
 */
export async function brandContext(brand: Brand | null): Promise<string> {
  if (!brand) return "MARCA: todavía no hay perfil de marca. Escribe para un creador de contenido latino que vende un servicio o infoproducto.";
  const top = await topOwnPieces();
  const offers = brand.offers.length
    ? brand.offers.map((o, i) => `${i + 1}. ${o.name}: ${o.promise}. CTA: ${o.cta}${o.keyword ? ` (palabra clave: ${o.keyword})` : ""}${o.when ? `. Cuándo usarla: ${o.when}` : ""}`).join("\n")
    : "(sin ofertas: usa un CTA de seguir o guardar)";
  const pillars = brand.pillars.length ? brand.pillars.map((p) => `- ${p.name}: ${p.description}`).join("\n") : "- (sin pilares)";
  const samples = brand.voiceSamples.length
    ? brand.voiceSamples.map((s, i) => `<muestra n="${i + 1}" fuente="${s.source}">\n${s.text.slice(0, 2500)}\n</muestra>`).join("\n")
    : "(sin muestras: usa un tono cercano y directo)";
  const topText = top.length ? top.map((t) => `- [${t.platform} ${t.type}, ×${t.ratio?.toFixed(1)} su mediana] ${t.text}`).join("\n") : "(todavía no hay datos de rendimiento)";

  return `MARCA
Nombre: ${brand.name ?? "(sin nombre)"} ${brand.handle ? `(${brand.handle})` : ""}
Nicho: ${brand.niche ?? "(sin definir)"}
Qué vende: ${brand.whatYouSell ?? "(sin definir)"}
Qué la diferencia: ${brand.differentiator ?? "(sin definir)"}

AUDIENCIA
${brand.audience ?? "(sin definir)"}
Dolores:
${list(brand.audiencePains)}
Deseos:
${list(brand.audienceDesires)}
Objeciones:
${list(brand.objections)}

POSTURA (creencias del creador, sirven para ganchos de contraste)
${list(brand.beliefs)}

PILARES DE CONTENIDO
${pillars}

OFERTAS Y CTAs
${offers}

VOZ
Tono: ${brand.tone ?? "cercano, directo y concreto"}
Frases propias (úsalas con moderación): ${brand.signaturePhrases.join(" · ") || "(ninguna)"}
Palabras prohibidas (nunca las uses): ${brand.bannedWords.join(", ") || "(ninguna)"}
Emojis: ${brand.emojiPolicy === "ninguno" ? "no uses emojis" : brand.emojiPolicy === "libres" ? "puedes usar emojis" : "máximo uno o dos, solo en el caption"}
${languageRules(brand.language)}

MUESTRAS DE VOZ (imita el ritmo, el largo de las frases y el vocabulario; nunca copies frases)
${samples}

LO QUE YA FUNCIONÓ CON ESTA AUDIENCIA (patrones de gancho y ángulo, no el tema)
${topText}

${brand.extraContext ? `NOTAS DEL CREADOR\n${brand.extraContext}` : ""}`.trim();
}
