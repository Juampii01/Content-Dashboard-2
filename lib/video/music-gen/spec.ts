/**
 * Música generada (licencia nuestra): una pista es su estilo, su semilla y su tempo. Con eso el generador
 * (lib/video/music-gen/engine) arma siempre el mismo audio, en la vista previa y en el worker. Sin servidor.
 */
import { z } from "zod";

export const MUSIC_STYLES = ["lofi", "corporativo", "trap", "ambiente", "acustico", "tension", "epica"] as const;
export type MusicStyle = (typeof MUSIC_STYLES)[number];

export const MUSIC_STYLE_INFO: Record<MusicStyle, { label: string; description: string; bpm: [number, number]; mood: string }> = {
  lofi: { label: "Lo-fi", description: "Piano eléctrico con acordes de jazz, batería suave con swing y crujido de vinilo.", bpm: [72, 90], mood: "relajado estudio chill" },
  corporativo: { label: "Motivacional", description: "Pulso de piano y guitarra limpia, bombo constante y una melodía que levanta.", bpm: [100, 120], mood: "corporativo positivo emprendimiento" },
  trap: { label: "Trap suave", description: "Bajo 808, hi-hats en tresillos y un arpegio de campanas oscuro.", bpm: [130, 150], mood: "urbano moderno energia" },
  ambiente: { label: "Ambiente", description: "Colchones lentos y campanas lejanas, sin batería.", bpm: [60, 76], mood: "calma reflexivo fondo" },
  acustico: { label: "Acústico", description: "Guitarras pulsadas, palmas y un bajo cálido.", bpm: [92, 112], mood: "cálido cercano historia" },
  tension: { label: "Electrónica tensa", description: "Arpegio de sintetizador, bajo pulsante y golpes que suben.", bpm: [118, 132], mood: "suspenso misterio datos" },
  epica: { label: "Épica", description: "Cuerdas, tambores grandes y metales sintetizados en tono menor.", bpm: [84, 100], mood: "cine épico logro" },
};

export const musicGenSchema = z.object({
  style: z.enum(MUSIC_STYLES),
  seed: z.number().int().min(0).max(2 ** 31 - 1),
  bpm: z.number().int().min(50).max(180),
  title: z.string().max(80).optional(),
});
export type MusicGenSpec = z.infer<typeof musicGenSchema>;
