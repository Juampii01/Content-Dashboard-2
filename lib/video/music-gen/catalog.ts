/**
 * Biblioteca de música generada: 20 pistas por estilo (140), cada una con su semilla y su tempo fijos, así "Café de
 * madrugada" suena siempre igual en la vista previa, en el render y en otro proyecto. Como el audio sale del
 * generador (sin muestras de terceros), la licencia es nuestra: el cliente la usa en sus videos sin atribución ni
 * reclamos de derechos. Sin servidor.
 */
import { MUSIC_STYLE_INFO, MUSIC_STYLES, type MusicGenSpec, type MusicStyle } from "./spec";

export type LibraryTrack = MusicGenSpec & { id: string; title: string };

const NAMES: Record<MusicStyle, [string[], string[]]> = {
  lofi: [
    ["Café", "Lluvia", "Cuaderno", "Ventana", "Tarde"],
    ["de madrugada", "en la ciudad", "sin apuro", "con vinilo"],
  ],
  corporativo: [
    ["Primer paso", "Nuevo día", "Impulso", "Meta clara", "Arranque"],
    ["hacia arriba", "en marcha", "sin frenos", "con todo"],
  ],
  trap: [
    ["Noche", "Calle", "Sombra", "Neón", "Asfalto"],
    ["lenta", "de cristal", "en loop", "sin filtro"],
  ],
  ambiente: [
    ["Bruma", "Horizonte", "Marea", "Silencio", "Altura"],
    ["suave", "abierta", "de mañana", "lejana"],
  ],
  acustico: [
    ["Ruta", "Fogata", "Patio", "Domingo", "Cuerdas"],
    ["de pueblo", "al sol", "con amigos", "de verano"],
  ],
  tension: [
    ["Código", "Pulso", "Señal", "Radar", "Circuito"],
    ["en alerta", "oculto", "nocturno", "al límite"],
  ],
  epica: [
    ["Cumbre", "Legado", "Travesía", "Coraje", "Batalla"],
    ["final", "del norte", "sin miedo", "de hierro"],
  ],
};

/** Las 20 pistas de un estilo (tempo repartido en su rango, semillas fijas). */
export function tracksOf(style: MusicStyle): LibraryTrack[] {
  const [a, b] = NAMES[style];
  const [lo, hi] = MUSIC_STYLE_INFO[style].bpm;
  const out: LibraryTrack[] = [];
  for (let i = 0; i < 20; i++) {
    const title = `${a[i % a.length]} ${b[Math.floor(i / a.length) % b.length]}`;
    const bpm = Math.round(lo + ((hi - lo) * ((i * 7) % 20)) / 19);
    const seed = (MUSIC_STYLES.indexOf(style) + 1) * 1000 + i * 37 + 11;
    out.push({ id: `${style}-${String(i + 1).padStart(2, "0")}`, style, seed, bpm, title });
  }
  return out;
}

export const MUSIC_LIBRARY: LibraryTrack[] = MUSIC_STYLES.flatMap(tracksOf);

export function libraryTrack(id: string): LibraryTrack | null {
  return MUSIC_LIBRARY.find((t) => t.id === id) ?? null;
}

/** La pista de la biblioteca que corresponde a una música generada del plan (o null si es una a medida). */
export function trackOfSpec(spec: MusicGenSpec): LibraryTrack | null {
  return MUSIC_LIBRARY.find((t) => t.style === spec.style && t.seed === spec.seed && t.bpm === spec.bpm) ?? null;
}

/** Nombre para mostrar: el de la biblioteca o "Lo-fi a medida · 84 BPM". */
export function musicGenLabel(spec: MusicGenSpec): string {
  return trackOfSpec(spec)?.title ?? spec.title ?? `${MUSIC_STYLE_INFO[spec.style].label} a medida · ${spec.bpm} BPM`;
}
