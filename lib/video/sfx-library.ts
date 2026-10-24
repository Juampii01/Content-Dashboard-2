/**
 * Biblioteca de efectos de sonido (40), todos procedurales: los genera worker/scripts/make_sfx.py con síntesis
 * propia (senos, ruido filtrado, campanas y cuerdas pulsadas), sin grabaciones ni licencias de terceros. Están en
 * worker/assets/sfx (render) y public/sfx (vista previa), normalizados igual (su ventana de 100 ms más fuerte a
 * -12 dBFS RMS, pico bajo -1 dBFS), así una misma ganancia suena parecido en todos.
 *
 * `hit`: segundo del archivo donde está su punto fuerte (lo que cae justo en el corte o en la palabra).
 * Sin servidor: lo usan la app, la vista previa, el director y las pruebas (que comparan la lista con el worker).
 */

export const SFX_CATEGORIES = ["transiciones", "golpes", "interfaz", "efectos"] as const;
export type SfxCategory = (typeof SFX_CATEGORIES)[number];
export const SFX_CATEGORY_LABELS: Record<SfxCategory, string> = { transiciones: "Transiciones", golpes: "Golpes", interfaz: "Interfaz", efectos: "Efectos" };

type Def = { label: string; category: SfxCategory; duration: number; hit: number; keywords: string };

export const SFX_LIBRARY = {
  whoosh: { label: "Whoosh", category: "transiciones", duration: 0.55, hit: 0.33, keywords: "aire paso rapido" },
  whoosh_soft: { label: "Whoosh suave", category: "transiciones", duration: 0.8, hit: 0.44, keywords: "aire suave lento" },
  swipe: { label: "Deslizar", category: "transiciones", duration: 0.32, hit: 0.16, keywords: "swipe barrido rapido" },
  swipe_up: { label: "Deslizar arriba", category: "transiciones", duration: 0.38, hit: 0.36, keywords: "swipe subir" },
  swish: { label: "Swish", category: "transiciones", duration: 0.26, hit: 0.03, keywords: "latigo corte" },
  air: { label: "Aire", category: "transiciones", duration: 0.75, hit: 0.37, keywords: "respiro suave" },
  riser: { label: "Subida", category: "transiciones", duration: 1.0, hit: 1.0, keywords: "riser tension subir" },
  riser_long: { label: "Subida larga", category: "transiciones", duration: 1.2, hit: 1.2, keywords: "riser tension" },
  downlifter: { label: "Bajada", category: "transiciones", duration: 1.1, hit: 0, keywords: "bajar caida downlifter" },
  reverse_hit: { label: "Golpe al revés", category: "transiciones", duration: 0.8, hit: 0.8, keywords: "reverso succion" },
  impact: { label: "Impacto", category: "golpes", duration: 0.97, hit: 0, keywords: "golpe grave" },
  boom: { label: "Boom", category: "golpes", duration: 1.2, hit: 0, keywords: "explosion grave cine" },
  thud: { label: "Golpe seco", category: "golpes", duration: 0.25, hit: 0, keywords: "seco caer" },
  punch: { label: "Puñetazo", category: "golpes", duration: 0.32, hit: 0, keywords: "golpe pegar" },
  slam: { label: "Portazo", category: "golpes", duration: 0.7, hit: 0, keywords: "golpe metal fuerte" },
  sub_drop: { label: "Caída grave", category: "golpes", duration: 1.2, hit: 0, keywords: "sub bajo drop" },
  pop: { label: "Pop", category: "interfaz", duration: 0.12, hit: 0, keywords: "burbuja aparecer" },
  pop_soft: { label: "Pop suave", category: "interfaz", duration: 0.1, hit: 0, keywords: "aparecer suave" },
  click: { label: "Clic", category: "interfaz", duration: 0.03, hit: 0, keywords: "boton raton" },
  tap: { label: "Toque", category: "interfaz", duration: 0.09, hit: 0, keywords: "tocar pantalla" },
  ding: { label: "Ding", category: "interfaz", duration: 1.2, hit: 0, keywords: "campana aviso" },
  ding_double: { label: "Ding doble", category: "interfaz", duration: 1.0, hit: 0, keywords: "campana timbre" },
  notification: { label: "Notificación", category: "interfaz", duration: 0.7, hit: 0, keywords: "aviso mensaje telefono" },
  success: { label: "Logrado", category: "interfaz", duration: 1.1, hit: 0, keywords: "exito correcto bien" },
  error: { label: "Error", category: "interfaz", duration: 0.5, hit: 0, keywords: "mal incorrecto" },
  typing: { label: "Tecleo", category: "interfaz", duration: 0.83, hit: 0, keywords: "teclado escribir" },
  switch: { label: "Interruptor", category: "interfaz", duration: 0.08, hit: 0, keywords: "encender apagar" },
  bubble: { label: "Burbuja", category: "interfaz", duration: 0.14, hit: 0, keywords: "bloop gota" },
  glitch: { label: "Glitch", category: "efectos", duration: 0.5, hit: 0, keywords: "error digital falla" },
  glitch_soft: { label: "Glitch suave", category: "efectos", duration: 0.3, hit: 0, keywords: "digital ruido" },
  digital: { label: "Datos", category: "efectos", duration: 0.42, hit: 0, keywords: "computadora pitidos" },
  camera: { label: "Cámara", category: "efectos", duration: 0.32, hit: 0, keywords: "foto obturador flash" },
  shimmer: { label: "Brillo", category: "efectos", duration: 1.2, hit: 0.1, keywords: "magia brillo campanitas" },
  sparkle: { label: "Destello", category: "efectos", duration: 0.7, hit: 0, keywords: "brillo estrella" },
  magic: { label: "Magia", category: "efectos", duration: 1.1, hit: 0, keywords: "arpa encanto" },
  coin: { label: "Moneda", category: "efectos", duration: 0.38, hit: 0, keywords: "dinero juego" },
  cash: { label: "Caja registradora", category: "efectos", duration: 1.0, hit: 0.05, keywords: "venta dinero cobrar" },
  heartbeat: { label: "Latido", category: "efectos", duration: 0.75, hit: 0, keywords: "corazon tension" },
  tick: { label: "Tic", category: "efectos", duration: 0.05, hit: 0, keywords: "reloj tiempo" },
  record_scratch: { label: "Disco rayado", category: "efectos", duration: 0.5, hit: 0.05, keywords: "pausa sorpresa scratch" },
} as const satisfies Record<string, Def>;

export type SfxName = keyof typeof SFX_LIBRARY;
export const SFX_NAMES = Object.keys(SFX_LIBRARY) as SfxName[];
export const isSfxName = (v: unknown): v is SfxName => typeof v === "string" && v in SFX_LIBRARY;

/** Archivo para la vista previa. */
export const sfxUrl = (name: SfxName) => `/sfx/${name}.wav`;

export function searchSfx(query: string): SfxName[] {
  const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const terms = plain(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [...SFX_NAMES];
  return SFX_NAMES.filter((n) => {
    const d = SFX_LIBRARY[n];
    const hay = plain(`${d.label} ${d.keywords} ${SFX_CATEGORY_LABELS[d.category]} ${n}`);
    return terms.every((t) => hay.includes(t));
  });
}
