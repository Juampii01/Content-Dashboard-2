/**
 * Biblioteca de efectos de sonido (135). Los 65 procedurales los genera worker/scripts/make_sfx.py con síntesis propia
 * (los 40 de siempre y 25 de cine: braam, golpes de tráiler con sala, explosión, espada, vidrio, gore, risers…). Los
 * otros 70 son de packs CC0 (dominio público) de Kenney: voces de anunciador (procesadas: más graves y con eco de
 * arena), interfaz, sci-fi, digital, objetos y casino (ver worker/assets/sfx/LICENCIAS.md). Están en
 * worker/assets/sfx (render) y public/sfx (vista previa), normalizados igual (su ventana de 100 ms más fuerte a
 * -12 dBFS RMS, pico bajo -1 dBFS), así una misma ganancia suena parecido en todos.
 *
 * `hit`: segundo del archivo donde está su punto fuerte (lo que cae justo en el corte o en la palabra).
 * Sin servidor: lo usan la app, la vista previa, el director y las pruebas (que comparan la lista con el worker).
 */

export const SFX_CATEGORIES = ["transiciones", "golpes", "cine", "voces", "interfaz", "efectos"] as const;
export type SfxCategory = (typeof SFX_CATEGORIES)[number];
export const SFX_CATEGORY_LABELS: Record<SfxCategory, string> = { transiciones: "Transiciones", golpes: "Golpes", cine: "Cine", voces: "Voces", interfaz: "Interfaz", efectos: "Efectos" };

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
  vo_fight: { label: "«¡Fight!»", category: "voces", duration: 1.17, hit: 0.19, keywords: "pelea luchar anunciador arena" },
  vo_flawless: { label: "«Flawless victory»", category: "voces", duration: 2.2, hit: 0.14, keywords: "victoria perfecta anunciador fatality" },
  vo_combo: { label: "«Combo»", category: "voces", duration: 1.44, hit: 0.22, keywords: "combo anunciador" },
  vo_combo_breaker: { label: "«Combo breaker»", category: "voces", duration: 1.89, hit: 0.08, keywords: "rompe combo anunciador" },
  vo_final_round: { label: "«Final round»", category: "voces", duration: 2.01, hit: 0.2, keywords: "ronda final anunciador" },
  vo_round_1: { label: "«Round 1»", category: "voces", duration: 1.64, hit: 0.14, keywords: "ronda uno empezar anunciador" },
  vo_game_over: { label: "«Game over»", category: "voces", duration: 2.1, hit: 0.08, keywords: "fin juego terminado anunciador" },
  vo_you_win: { label: "«You win»", category: "voces", duration: 1.53, hit: 0.09, keywords: "ganaste victoria anunciador" },
  vo_you_lose: { label: "«You lose»", category: "voces", duration: 1.67, hit: 0.12, keywords: "perdiste derrota anunciador" },
  vo_winner: { label: "«Winner»", category: "voces", duration: 1.72, hit: 0.14, keywords: "ganador anunciador" },
  vo_loser: { label: "«Loser»", category: "voces", duration: 1.74, hit: 0.18, keywords: "perdedor anunciador" },
  vo_ready: { label: "«Ready?»", category: "voces", duration: 1.29, hit: 0.07, keywords: "listo preparado anunciador" },
  vo_prepare: { label: "«Prepare yourself»", category: "voces", duration: 2.0, hit: 0.13, keywords: "preparate anunciador" },
  vo_sudden_death: { label: "«Sudden death»", category: "voces", duration: 1.73, hit: 0.12, keywords: "muerte subita anunciador" },
  vo_multi_kill: { label: "«Multi kill»", category: "voces", duration: 1.72, hit: 0.09, keywords: "racha anunciador" },
  vo_kill_him: { label: "«Kill him»", category: "voces", duration: 1.4, hit: 0.12, keywords: "terminalo fatality anunciador" },
  vo_mission_completed: { label: "«Mission completed»", category: "voces", duration: 1.55, hit: 0.05, keywords: "mision cumplida logrado" },
  vo_mission_failed: { label: "«Mission failed»", category: "voces", duration: 1.35, hit: 0.03, keywords: "mision fallida error" },
  vo_new_highscore: { label: "«New highscore»", category: "voces", duration: 1.51, hit: 0.03, keywords: "record puntaje nuevo" },
  vo_level_up: { label: "«Level up»", category: "voces", duration: 1.04, hit: 0.14, keywords: "subir nivel mejorar" },
  vo_congratulations: { label: "«Congratulations»", category: "voces", duration: 1.84, hit: 0.09, keywords: "felicitaciones" },
  vo_correct: { label: "«Correct»", category: "voces", duration: 0.88, hit: 0.09, keywords: "correcto bien" },
  vo_wrong: { label: "«Wrong»", category: "voces", duration: 0.93, hit: 0.09, keywords: "incorrecto mal" },
  vo_go: { label: "«Go!»", category: "voces", duration: 0.88, hit: 0.06, keywords: "vamos ya" },
  vo_time_over: { label: "«Time over»", category: "voces", duration: 1.21, hit: 0.02, keywords: "se acabo el tiempo" },
  vo_objective: { label: "«Objective achieved»", category: "voces", duration: 1.72, hit: 0.06, keywords: "objetivo cumplido" },
  braam: { label: "Braam de tráiler", category: "cine", duration: 3.5, hit: 0.03, keywords: "trailer epico grave metales" },
  trailer_hit: { label: "Golpe de tráiler", category: "cine", duration: 3.5, hit: 0.0, keywords: "impacto epico cine sala" },
  explosion: { label: "Explosión", category: "cine", duration: 3.5, hit: 0.0, keywords: "bomba estallido" },
  thunder: { label: "Trueno", category: "cine", duration: 4.0, hit: 0.0, keywords: "tormenta rayo" },
  sword: { label: "Espada", category: "cine", duration: 1.5, hit: 0.01, keywords: "corte filo cuchillo fatality" },
  glass_break: { label: "Vidrio roto", category: "cine", duration: 2.2, hit: 0.0, keywords: "romper cristal" },
  bone_crack: { label: "Hueso que cruje", category: "cine", duration: 0.5, hit: 0.0, keywords: "crack romper fatality" },
  splat: { label: "Salpicadura", category: "cine", duration: 0.9, hit: 0.0, keywords: "gore sangre fatality golpe humedo" },
  riser_epic: { label: "Subida épica", category: "cine", duration: 3.0, hit: 3.0, keywords: "riser tension shepard" },
  reverse_cymbal: { label: "Platillo al revés", category: "cine", duration: 1.5, hit: 1.5, keywords: "succion reverso" },
  tape_stop: { label: "Cinta que se frena", category: "cine", duration: 0.9, hit: 0.0, keywords: "parar frenar" },
  bass_808: { label: "Bajo 808", category: "cine", duration: 1.4, hit: 0.0, keywords: "drop grave bajo" },
  whoosh_slowmo: { label: "Whoosh lento", category: "cine", duration: 2.2, hit: 0.68, keywords: "camara lenta aire" },
  whoosh_double: { label: "Whoosh doble", category: "transiciones", duration: 0.9, hit: 0.33, keywords: "ida y vuelta aire" },
  heartbeat_fast: { label: "Latido rápido", category: "cine", duration: 1.6, hit: 0.0, keywords: "corazon tension miedo" },
  clock: { label: "Reloj", category: "cine", duration: 2.0, hit: 0.0, keywords: "tic tac tiempo" },
  laser: { label: "Láser", category: "efectos", duration: 0.45, hit: 0.0, keywords: "rayo disparo" },
  power_up: { label: "Cargar energía", category: "efectos", duration: 0.9, hit: 0.85, keywords: "subir encender" },
  power_down: { label: "Apagar energía", category: "efectos", duration: 0.9, hit: 0.0, keywords: "bajar apagar" },
  camera_flash: { label: "Flash", category: "efectos", duration: 1.0, hit: 0.8, keywords: "foto carga disparo" },
  vinyl_stop: { label: "Disco que se frena", category: "efectos", duration: 0.8, hit: 0.0, keywords: "parar musica" },
  stadium_kick: { label: "Bombo de estadio", category: "cine", duration: 2.0, hit: 0.0, keywords: "golpe cifra grave" },
  gong: { label: "Gong", category: "cine", duration: 3.0, hit: 0.0, keywords: "campana epica" },
  glitch_long: { label: "Glitch largo", category: "efectos", duration: 0.9, hit: 0.05, keywords: "digital error falla" },
  falling: { label: "Caída silbando", category: "cine", duration: 1.4, hit: 1.4, keywords: "bomba cae silbido" },
  ui_confirm: { label: "Confirmar", category: "interfaz", duration: 0.54, hit: 0.0, keywords: "listo ok aceptar" },
  ui_confirm_2: { label: "Confirmar 2", category: "interfaz", duration: 0.49, hit: 0.04, keywords: "listo ok" },
  ui_error: { label: "Error 2", category: "interfaz", duration: 0.5, hit: 0.04, keywords: "mal incorrecto" },
  ui_glass: { label: "Cristal", category: "interfaz", duration: 0.69, hit: 0.0, keywords: "brillo tintineo" },
  ui_maximize: { label: "Abrir", category: "interfaz", duration: 0.53, hit: 0.45, keywords: "agrandar aparecer" },
  ui_minimize: { label: "Cerrar", category: "interfaz", duration: 0.53, hit: 0.01, keywords: "achicar desaparecer" },
  ui_question: { label: "Pregunta", category: "interfaz", duration: 0.49, hit: 0.04, keywords: "duda signo" },
  ui_switch: { label: "Interruptor 2", category: "interfaz", duration: 0.61, hit: 0.0, keywords: "cambiar" },
  ui_drop: { label: "Soltar", category: "interfaz", duration: 0.28, hit: 0.0, keywords: "caer gota" },
  ui_pluck: { label: "Pulsar", category: "interfaz", duration: 0.16, hit: 0.0, keywords: "cuerda" },
  ui_bong: { label: "Bong", category: "interfaz", duration: 0.12, hit: 0.0, keywords: "campanita" },
  ui_scroll: { label: "Desplazar", category: "interfaz", duration: 1.0, hit: 0.0, keywords: "lista ruedita" },
  ui_scratch: { label: "Raspar", category: "interfaz", duration: 0.33, hit: 0.0, keywords: "rayar" },
  sci_explosion: { label: "Explosión crujiente", category: "efectos", duration: 1.98, hit: 0.02, keywords: "estallido romper" },
  sci_explosion_short: { label: "Explosión corta", category: "efectos", duration: 0.78, hit: 0.0, keywords: "estallido" },
  sci_metal_hit: { label: "Golpe de metal", category: "golpes", duration: 0.78, hit: 0.0, keywords: "metal choque" },
  sci_metal_hit_2: { label: "Golpe de metal 2", category: "golpes", duration: 0.63, hit: 0.0, keywords: "metal choque" },
  sci_laser_big: { label: "Láser grande", category: "efectos", duration: 0.68, hit: 0.0, keywords: "rayo disparo" },
  sci_laser_retro: { label: "Láser retro", category: "efectos", duration: 0.24, hit: 0.0, keywords: "videojuego disparo" },
  sci_forcefield: { label: "Campo de fuerza", category: "efectos", duration: 0.95, hit: 0.04, keywords: "escudo energia" },
  sci_low_boom: { label: "Boom grave", category: "golpes", duration: 2.0, hit: 0.08, keywords: "explosion grave" },
  sci_door_open: { label: "Puerta que se abre", category: "efectos", duration: 0.53, hit: 0.0, keywords: "abrir puerta" },
  sci_door_close: { label: "Puerta que se cierra", category: "efectos", duration: 0.53, hit: 0.25, keywords: "cerrar puerta" },
  sci_computer: { label: "Computadora", category: "efectos", duration: 4.0, hit: 0.0, keywords: "datos procesando ambiente" },
  dig_phaser_up: { label: "Phaser arriba", category: "efectos", duration: 0.45, hit: 0.04, keywords: "subir digital" },
  dig_phaser_down: { label: "Phaser abajo", category: "efectos", duration: 0.42, hit: 0.07, keywords: "bajar digital" },
  dig_powerup: { label: "Power up", category: "efectos", duration: 1.15, hit: 0.04, keywords: "mejorar juego" },
  dig_zap: { label: "Zap", category: "efectos", duration: 0.97, hit: 0.06, keywords: "electricidad" },
  dig_three_tone: { label: "Tres tonos", category: "interfaz", duration: 1.7, hit: 0.04, keywords: "aviso" },
  dig_high_up: { label: "Sube agudo", category: "efectos", duration: 0.5, hit: 0.1, keywords: "subir" },
  dig_low_down: { label: "Baja grave", category: "efectos", duration: 0.73, hit: 0.09, keywords: "bajar" },
  dig_space: { label: "Espacio", category: "efectos", duration: 1.91, hit: 0.04, keywords: "nave espacial" },
  knife_slice: { label: "Cuchillo que corta", category: "golpes", duration: 0.6, hit: 0.08, keywords: "cortar filo fatality" },
  chop: { label: "Hachazo", category: "golpes", duration: 0.24, hit: 0.05, keywords: "cortar golpe fatality" },
  draw_knife: { label: "Desenvainar", category: "efectos", duration: 0.4, hit: 0.09, keywords: "sacar cuchillo espada" },
  coins: { label: "Monedas", category: "efectos", duration: 0.85, hit: 0.15, keywords: "dinero plata" },
  book_flip: { label: "Pasar páginas", category: "efectos", duration: 0.77, hit: 0.59, keywords: "libro hoja" },
  footstep: { label: "Paso", category: "efectos", duration: 0.25, hit: 0.03, keywords: "caminar pisada" },
  creak: { label: "Crujido de madera", category: "efectos", duration: 0.66, hit: 0.18, keywords: "puerta vieja" },
  metal_pot: { label: "Olla de metal", category: "golpes", duration: 1.46, hit: 0.09, keywords: "metal golpe" },
  card_shuffle: { label: "Barajar cartas", category: "efectos", duration: 3.06, hit: 0.2, keywords: "naipes mezclar" },
  card_slide: { label: "Deslizar carta", category: "efectos", duration: 0.6, hit: 0.15, keywords: "naipe" },
  chips: { label: "Fichas", category: "efectos", duration: 0.28, hit: 0.08, keywords: "casino apuesta" },
  dice: { label: "Dados", category: "efectos", duration: 0.63, hit: 0.03, keywords: "tirar suerte" },
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

/** La biblioteca en texto, por categoría (para que la IA elija sonidos por lo que son, no solo por el nombre). */
export function sfxCatalogText(): string {
  return SFX_CATEGORIES.map((c) => {
    const items = (Object.entries(SFX_LIBRARY) as [SfxName, Def][]).filter(([, d]) => d.category === c).map(([n, d]) => `${n} (${d.label})`);
    return `${SFX_CATEGORY_LABELS[c]}: ${items.join(", ")}`;
  }).join("\n");
}
