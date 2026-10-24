import "server-only";
import { inArray } from "drizzle-orm";
import { AiError, generateStructured } from "@/lib/ai/client";
import { PHOTO_TRAITS_RULES, photoTraitsSchema, photoTraitsTask } from "@/lib/ai/prompts/carruseles-copia";
import { getDb, schema } from "@/lib/db";
import { readBytes } from "@/lib/storage";
import { PHOTO_KEY_RE, thumbFileUrl } from "@/lib/youtube/files";
import type { CharacterPhoto, PhotoTraits } from "./character";
import { sniffImage } from "./files";

/**
 * Fotos del personaje (Mi marca → characterPhotos, las mismas que usan las miniaturas de YouTube) y sus rasgos.
 * Los rasgos se leen una sola vez por foto con Claude (visión) y se guardan en `character_photo_traits`.
 * Quien llama comprueba la sesión.
 */
const MAX_BYTES_FOR_AI = 4_500_000; // Claude admite hasta 5 MB por imagen

export async function brandPhotoKeys(): Promise<string[]> {
  const [brand] = await getDb().select({ photos: schema.brandProfile.characterPhotos }).from(schema.brandProfile).limit(1);
  return (brand?.photos ?? []).filter((k) => PHOTO_KEY_RE.test(k));
}

export async function characterPhotos(): Promise<CharacterPhoto[]> {
  const keys = await brandPhotoKeys();
  if (!keys.length) return [];
  const rows = await getDb().select().from(schema.characterPhotoTraits).where(inArray(schema.characterPhotoTraits.photoKey, keys));
  const byKey = new Map(rows.map((r) => [r.photoKey, r]));
  return keys.map((key) => {
    const r = byKey.get(key);
    return { key, url: thumbFileUrl(key), traits: r ? { angle: r.angle, expression: r.expression, framing: r.framing, gaze: r.gaze, quality: r.quality } : null };
  });
}

/**
 * Lee los rasgos de las fotos que todavía no los tienen. Si la IA falla, las fotos quedan sin rasgos y la elección
 * por slide rota entre ellas (no se corta la generación de imágenes).
 */
export async function ensurePhotoTraits(userId: string | null, jobId?: string | null): Promise<CharacterPhoto[]> {
  const photos = await characterPhotos();
  const missing = photos.filter((p) => !p.traits);
  if (!missing.length) return photos;
  const images: { key: string; mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string }[] = [];
  for (const p of missing) {
    try {
      const bytes = await readBytes(p.key, 9 * 1024 * 1024);
      const type = sniffImage(new Uint8Array(bytes));
      if (!type || bytes.byteLength > MAX_BYTES_FOR_AI) continue;
      images.push({ key: p.key, mediaType: type as "image/jpeg" | "image/png" | "image/webp", data: bytes.toString("base64") });
    } catch (error) {
      console.error("[carruseles/fotos] leer:", error instanceof Error ? error.message : "error");
    }
  }
  if (!images.length) return photos;
  try {
    const res = await generateStructured({
      feature: "carruseles.fotos",
      model: "fast",
      context: PHOTO_TRAITS_RULES,
      task: photoTraitsTask(images.length),
      schema: photoTraitsSchema,
      images: images.map(({ mediaType, data }) => ({ mediaType, data })),
      imageSizes: images.map(() => ({ width: 1500, height: 2000 })),
      userId,
      jobId: jobId ?? null,
      // Simulado: ángulos y expresiones que rotan, para probar la elección por slide.
      fake: () => ({
        photos: images.map((_, i) => ({
          index: i + 1,
          angle: (["frontal", "three_quarter", "profile"] as const)[i % 3],
          expression: (["smile", "serious", "thinking"] as const)[i % 3],
          framing: (["close", "medium", "wide"] as const)[i % 3],
          gaze: i % 3 === 2 ? "away" : "camera",
          quality: 0.9 - i * 0.05,
          notes: "Foto simulada.",
        })),
      }),
    });
    const rows = res.photos
      .map((p) => ({ p, img: images[p.index - 1] }))
      .filter((x): x is { p: (typeof res.photos)[number]; img: (typeof images)[number] } => Boolean(x.img))
      .map(({ p, img }) => ({ photoKey: img.key, angle: p.angle, expression: p.expression, framing: p.framing, gaze: p.gaze, quality: Math.max(0, Math.min(1, p.quality)), notes: p.notes.slice(0, 300) }));
    if (rows.length) await getDb().insert(schema.characterPhotoTraits).values(rows).onConflictDoNothing();
  } catch (error) {
    console.error("[carruseles/fotos]", error instanceof AiError ? error.detail : error instanceof Error ? error.message : "error");
    return photos;
  }
  return characterPhotos();
}

export type { CharacterPhoto, PhotoTraits };
