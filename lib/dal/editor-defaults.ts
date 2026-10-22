import "server-only";
import { getBrand } from "@/lib/ai/brand-context";
import { getCurrentUser } from "@/lib/auth";
import { listTracks, type TrackView } from "./editor-media";
import { readEditorDefaults, summarizeDefaults, type EditorDefaults } from "@/lib/video/defaults";

export type EditorDefaultsView = {
  defaults: EditorDefaults;
  /** Pistas listas de Biblioteca → Música, para elegir la música por defecto. */
  tracks: Pick<TrackView, "id" | "title" | "status" | "duration" | "url">[];
  /** La pista por defecto ya no existe o no está lista: se avisa y "Hazlo por mí" sale sin música. */
  missingTrack: boolean;
  summary: string;
  canEdit: boolean;
};

/** Valores por defecto del editor (Mi marca), con las pistas que se pueden elegir y un resumen para mostrar. */
export async function getEditorDefaults(): Promise<EditorDefaultsView> {
  const me = await getCurrentUser();
  const [brand, rows] = await Promise.all([getBrand(), listTracks({ readyOnly: true })]);
  const tracks = rows.map((t) => ({ id: t.id, title: t.title, status: t.status, duration: t.duration, url: t.url }));
  const defaults = readEditorDefaults(brand);
  const track = defaults.music.trackId ? tracks.find((t) => t.id === defaults.music.trackId) : null;
  return {
    defaults,
    tracks,
    missingTrack: Boolean(defaults.music.trackId && !track),
    summary: summarizeDefaults(defaults, track?.title ?? null),
    canEdit: me.role !== "VIEWER",
  };
}
