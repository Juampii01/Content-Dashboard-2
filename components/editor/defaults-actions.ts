"use server";

import { refresh } from "next/cache";
import { sql } from "drizzle-orm";
import { isDenied, requireEditor } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { editorDefaultsSchema, storedEditorDefaults, type EditorDefaults } from "@/lib/video/defaults";
import { loadTrack } from "@/lib/video/music";

/** Guarda los valores por defecto del editor en Mi marca (los usan "Hazlo por mí" y los proyectos nuevos). */
export async function saveEditorDefaultsAction(input: EditorDefaults): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = editorDefaultsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Revisa los valores: alguno no es válido." };
  const d = parsed.data;
  if (d.music.trackId) {
    const track = await loadTrack(d.music.trackId);
    if (track?.status !== "READY") return { ok: false, error: "Esa pista ya no está en tu biblioteca. Elige otra o deja el video sin música." };
  }
  const values = storedEditorDefaults(d);
  await getDb()
    .insert(schema.brandProfile)
    .values({ id: "brand", ...values })
    .onConflictDoUpdate({ target: schema.brandProfile.id, set: { ...values, version: sql`${schema.brandProfile.version} + 1` } });
  refresh();
  return { ok: true };
}
