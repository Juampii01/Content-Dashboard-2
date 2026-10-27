import "server-only";
import { env } from "@/lib/env";
import { commercialLicense, type MusicProvider, type ProviderTrack } from "./types";

/**
 * Jamendo (API v3.0): música independiente con licencias Creative Commons. Se piden solo pistas sin NC, sin ND y sin
 * SA (ccnc/ccnd/ccsa=false) y, por las dudas, se vuelve a revisar la URL de la licencia de cada una (solo CC BY).
 *
 * Condiciones (docs/musica.md): la API es gratis solo para uso no comercial; para una marca que vende con sus videos,
 * el cliente necesita un acuerdo comercial con Jamendo. La atribución (artista, Jamendo y el link a la pista) es
 * obligatoria: la app la guarda con la pista y la muestra al exportar.
 */
type JamendoTrack = {
  id: string;
  name: string;
  duration: number;
  artist_name: string;
  audio: string;
  audiodownload: string;
  audiodownload_allowed: boolean;
  license_ccurl: string;
  shareurl: string;
  image?: string;
  musicinfo?: { tags?: { genres?: string[]; vartags?: string[] } };
};

export class JamendoError extends Error {}

export function jamendoProvider(clientId: string, opts: { fetcher?: typeof fetch; base?: string } = {}): MusicProvider {
  const fetcher = opts.fetcher ?? fetch;
  const base = (opts.base ?? env().JAMENDO_API_BASE).replace(/\/$/, "");
  async function call(params: Record<string, string>): Promise<JamendoTrack[]> {
    const qs = new URLSearchParams({ client_id: clientId, format: "json", include: "licenses musicinfo", audioformat: "mp32", audiodlformat: "mp32", ccnc: "false", ccnd: "false", ccsa: "false", ...params });
    const res = await fetcher(`${base}/tracks/?${qs}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) }).catch(() => null);
    if (!res) throw new JamendoError("Jamendo no responde. Prueba de nuevo en un rato.");
    const data = (await res.json().catch(() => null)) as { headers?: { status?: string; code?: number; error_message?: string }; results?: JamendoTrack[] } | null;
    if (!res.ok || !data || data.headers?.status === "failed") {
      const code = data?.headers?.code;
      if (res.status === 401 || code === 5) throw new JamendoError("Jamendo rechazó tu client_id. Revísalo en Ajustes → Claves de servicios.");
      throw new JamendoError("Jamendo no pudo responder la búsqueda. Prueba de nuevo.");
    }
    return Array.isArray(data.results) ? data.results : [];
  }
  const toTrack = (t: JamendoTrack): ProviderTrack | null => {
    const lic = commercialLicense(t.license_ccurl);
    if (!lic.ok) return null;
    return {
      provider: "jamendo",
      id: String(t.id),
      title: String(t.name).slice(0, 120),
      artist: String(t.artist_name).slice(0, 120),
      duration: Number(t.duration) || 0,
      previewUrl: t.audio,
      pageUrl: t.shareurl,
      image: t.image || null,
      license: { url: t.license_ccurl, label: lic.label },
      tags: [...(t.musicinfo?.tags?.genres ?? []), ...(t.musicinfo?.tags?.vartags ?? [])].slice(0, 6),
    };
  };
  return {
    id: "jamendo",
    label: "Jamendo",
    async search(query, opts = {}) {
      const params: Record<string, string> = { limit: String(Math.min(40, opts.limit ?? 24)), order: "relevance", boost: "popularity_month" };
      if (query.trim()) params.search = query.trim().slice(0, 80);
      if (opts.instrumental !== false) params.vocalinstrumental = "instrumental";
      return (await call(params)).map(toTrack).filter((t): t is ProviderTrack => Boolean(t));
    },
    async get(id) {
      if (!/^\d{1,12}$/.test(id)) return null;
      const [t] = await call({ id });
      if (!t || !t.audiodownload_allowed || !t.audiodownload) return null;
      const track = toTrack(t);
      return track ? { ...track, downloadUrl: t.audiodownload } : null;
    },
  };
}
