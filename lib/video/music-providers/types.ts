/**
 * Catálogos externos de música detrás de una interfaz (`MusicProvider`): buscar pistas con licencia que permite uso
 * comercial, y bajarlas a la biblioteca del cliente con su atribución. Hoy hay uno (Jamendo, ver docs/musica.md); se
 * agregan otros sin tocar el Estudio. Sin servidor (tipos y reglas de licencia).
 */

export type ProviderTrack = {
  provider: "jamendo";
  /** Id en el catálogo. */
  id: string;
  title: string;
  artist: string;
  duration: number;
  /** Audio para escuchar en la vista previa (stream del catálogo). */
  previewUrl: string;
  /** Página de la pista en el catálogo (va en la atribución). */
  pageUrl: string;
  image: string | null;
  license: { url: string; label: string };
  tags: string[];
};

export interface MusicProvider {
  readonly id: ProviderTrack["provider"];
  readonly label: string;
  search(query: string, opts?: { limit?: number; instrumental?: boolean }): Promise<ProviderTrack[]>;
  /** La pista por id, con la URL de descarga (solo si el catálogo la permite y la licencia es comercial). */
  get(id: string): Promise<(ProviderTrack & { downloadUrl: string }) | null>;
}

/**
 * Licencias aceptadas para musicalizar videos de una marca: CC BY (uso comercial, con atribución) y CC0 / dominio
 * público. Se rechazan NC (no comercial), ND (sincronizar música con imagen cuenta como obra derivada en CC 4.0) y SA
 * (obligaría a licenciar el video con la misma licencia).
 */
export function commercialLicense(url: string | null | undefined): { ok: true; label: string; attribution: boolean } | { ok: false } {
  if (!url) return { ok: false };
  const u = url.toLowerCase();
  if (/creativecommons\.org\/publicdomain\/(zero|mark)/.test(u)) return { ok: true, label: "CC0 (dominio público)", attribution: false };
  const m = u.match(/creativecommons\.org\/licenses\/([a-z-]+)\/(\d(?:\.\d)?)/);
  if (!m) return { ok: false };
  if (m[1] !== "by") return { ok: false };
  return { ok: true, label: `CC BY ${m[2]}`, attribution: true };
}

/** Texto de atribución para la descripción del video. */
export function attributionText(t: Pick<ProviderTrack, "title" | "artist" | "pageUrl" | "license">, via: string): string {
  return `Música: «${t.title}» de ${t.artist} (${t.license.label}) · ${via} · ${t.pageUrl}`;
}
