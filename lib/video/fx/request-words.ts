/**
 * Cómo nombra la persona los efectos, las transiciones y la música en "Edítalo así" (texto sin tildes y en minúsculas).
 *
 * Una lista a mano y no los nombres de la galería: con 100 efectos, muchos nombres son palabras comunes que en un pedido
 * quieren decir otra cosa ("subtítulos estilo resaltador", "quita el eco", "cita de un cliente"). Aquí cada efecto se
 * reconoce por frases que no se confunden con subtítulos, audio ni transiciones.
 */
import type { FxCategory, FxKind } from "./catalog";
import type { TransitionKind } from "./transitions";
import type { MusicStyle } from "../music-gen/spec";

const FX_WORDS: [RegExp, FxKind][] = [
  // De firma
  [/revista|portada/, "cover_story"],
  [/zoom digital/, "digital_zoom"],
  [/checklist|lista de (tareas|pasos)|lista que se tild/, "checklist"],
  [/letras de vidrio|vidrio|cristal/, "glass_type"],
  [/telefono con tareas|iphone/, "iphone"],
  [/grafico que crece|curva que sube/, "chart_grow"],
  [/titulares|muro de/, "headline_wall"],
  [/giro 3d|orbita/, "orbit"],
  [/pared de capturas/, "couch_wall"],
  [/ventana de (tu|la) app/, "ui_world"],
  [/sales? del cuadro|salir del cuadro/, "frame_break"],
  [/corte con zoom/, "zoom_cut"],
  [/zoom out/, "zoom_out"],
  [/pantalla verde|temporizador|pomodoro/, "green_screen"],
  [/recorte de papel|nota de rescate/, "paper_cut"],
  [/garabato|doodle/, "doodle_boil"],
  [/vertigo|dolly/, "vertigo"],
  // Texto
  [/maquina de escribir|tipeo|como si (lo )?escribier/, "typewriter"],
  [/palabras? que salt|texto que salta/, "word_pop"],
  [/subrayado|subraya/, "underline_draw"],
  [/marcador fluo|resaltado fluo|fluor/, "highlighter"],
  [/contador|numero que sube|cifra que sube/, "counter"],
  [/texto 3d|letras 3d|en 3d/, "text_3d"],
  [/neon/, "neon_text"],
  [/letra (a|por) letra/, "letter_build"],
  [/bloque de palabras|palabras apiladas/, "word_stack"],
  [/golpe de palabra|palabra que (cae|golpea)/, "word_slam"],
  [/decodific|estilo hacker|letras revueltas|matrix/, "scramble"],
  [/texto (en|que hace) ola|letras en ola/, "wave_text"],
  [/titulo de seccion|separador|capitulo/, "title_card"],
  [/contorno que se llena|texto que se llena/, "outline_fill"],
  // Atención
  [/flecha/, "arrow_draw"],
  [/circulo a mano|un circulo|encierra/, "circle_hand"],
  [/lupa/, "magnifier"],
  [/marco que destella|borde que destella/, "flash_frame"],
  [/emoji que salta|un emoji|emojis? grandes?/, "emoji_bounce"],
  [/estallido|confeti/, "sticker_burst"],
  [/si ?\/ ?no|check y cruz|palomita|tachado/, "check_cross"],
  [/antes y despues/, "before_after"],
  [/reflector|un foco|efecto foco/, "spotlight"],
  [/encuadre de camara|visor de camara|\brec\b/, "focus_brackets"],
  [/globo de dialogo|globo de texto|burbuja de (dialogo|texto)/, "speech_bubble"],
  [/\bsello\b|insignia/, "badge_stamp"],
  // Tarjetas
  [/tercio inferior|rotulo|cartel con (mi|tu) nombre|(mi|tu) nombre y (mi|tu) cargo/, "lower_third"],
  [/tarjeta de cita|una cita|frase entre comillas/, "quote_card"],
  [/cifra grande|numero grande|dato grande/, "big_stat"],
  [/lista numerada/, "numbered_list"],
  [/pros y contras|ventajas y desventajas/, "pros_cons"],
  [/linea de tiempo|linea del tiempo/, "timeline_steps"],
  [/barra de progreso/, "progress_bar"],
  [/encuesta/, "poll"],
  [/comentario de (un )?seguidor|responder (a )?un comentario|tarjeta de comentario/, "social_comment"],
  [/notificacion/, "notification"],
  [/caja de preguntas/, "question_box"],
  [/estrellas|resena|calificacion/, "rating_stars"],
  [/etiqueta de precio|el precio en pantalla|precio tachado/, "price_tag"],
  [/buscador|barra de busqueda|como en google/, "search_bar"],
  [/definicion|diccionario/, "definition"],
  // Looks
  [/vineta/, "vignette"],
  [/grano/, "film_grain"],
  [/fuga de luz|light leak/, "light_leak"],
  [/polvo|rayas de pelicula|pelicula vieja/, "dust"],
  [/\bvhs\b|casete|look noventero|retro/, "vhs"],
  [/glitch/, "glitch"],
  [/aberracion|separacion de color/, "chroma"],
  [/monocromo/, "bw_accent"],
  [/duotono/, "duotone"],
  [/fondo desenfocado|desenfoca el fondo|bokeh/, "bg_blur"],
  [/destellos|brillitos|magia/, "sparkles"],
  [/franjas de cine|look de cine|cinematografic/, "letterbox"],
  [/pelicula calida|look calido|vintage|sepia/, "warm_film"],
  [/brillo suave|look de sueno|onirico/, "dreamy_glow"],
  // Cámara
  [/sacudida|temblor|terremoto/, "shake"],
  [/efecto (de )?impacto|un impacto/, "impact"],
  [/pulso|al ritmo de la musica|\bbeat\b/, "beat_pulse"],
  [/paneo|ken burns/, "slow_pan"],
  [/zoom con rebote|rebote/, "bounce_zoom"],
  [/inclinacion|plano holandes/, "tilt"],
  [/camara en mano|camara al hombro/, "handheld"],
  [/acercamiento lento|push in/, "push_in"],
  [/zoom seco|zoom de reaccion/, "snap_zoom"],
  [/giro de entrada/, "roll_in"],
  // Marcos
  [/marco de telefono|dentro de un telefono|pantalla de celular/, "phone_frame"],
  [/polaroid|foto instantanea/, "polaroid"],
  [/foto con cinta|cinta adhesiva/, "tape_frame"],
  [/papel rasgado/, "paper_frame"],
  [/cuaderno/, "notebook"],
  [/pantalla de (la )?computadora|monitor/, "computer_screen"],
  [/pantalla dividida|dividir la pantalla/, "split_two"],
  [/tres paneles/, "split_three"],
  [/tira de pelicula|negativo/, "film_strip"],
  [/navegador|ventana (del|de) navegador|pagina web/, "browser_window"],
  // Recorte
  [/texto detras|detras de (mi|ti)/, "text_behind"],
  [/contorno brillante|silueta brillante/, "glow_outline"],
  [/sombra/, "drop_shadow"],
  [/efecto eco|copias que siguen|estela/, "echo"],
  [/fondo de (la |mi |tu )?marca|fondo de color/, "bg_brand"],
  [/fondo en blanco y negro|fondo blanco y negro/, "bg_bw"],
  [/clones|tres de mi|tres de ti/, "clone_trio"],
  [/sticker/, "sticker_cutout"],
];

/** El efecto que nombra el texto (sin tildes, en minúsculas), o null. */
export function fxFromText(t: string): FxKind | null {
  return FX_WORDS.find(([re]) => re.test(t))?.[1] ?? null;
}

const CATEGORY_WORDS: [RegExp, FxCategory][] = [
  [/efectos? de texto|texto animado|letras animadas/, "texto"],
  [/efectos? de atencion|llamadas? de atencion/, "atencion"],
  [/tarjetas?/, "tarjetas"],
  [/\blooks?\b|filtros?|efectos? de color/, "looks"],
  [/efectos? de camara|movimientos? de camara/, "camara"],
  [/marcos?\b/, "marcos"],
  [/efectos? de recorte|recortarme|recortame/, "recorte"],
];

/** "Un efecto de texto", "algún look": la categoría que nombra el texto sin decir cuál efecto. */
export function fxCategoryFromText(t: string): FxCategory | null {
  return CATEGORY_WORDS.find(([re]) => re.test(t))?.[1] ?? null;
}

const TRANSITION_WORDS: [RegExp, TransitionKind][] = [
  [/barrido vertical|whip (hacia )?arriba/, "tr_whip_up"],
  [/barrido diagonal|diagonal/, "tr_diagonal"],
  [/barrido|whip|latigazo/, "tr_whip"],
  [/zoom de salida|zoom out|alej/, "tr_zoom_out"],
  [/zoom/, "tr_zoom_in"],
  [/desenfoque|blur/, "tr_blur"],
  [/destello de (la |mi |tu )?marca|flash de (la |mi |tu )?marca/, "tr_flash_brand"],
  [/destello|flash/, "tr_flash"],
  [/fundido a negro|a negro/, "tr_fade_black"],
  [/fundido/, "tr_dip_brand"],
  [/deslizamiento vertical|deslizar hacia arriba/, "tr_slide_up"],
  [/desliz|slide/, "tr_slide"],
  [/giro|spin/, "tr_spin"],
  [/glitch/, "tr_glitch"],
  [/fuga de luz|light leak/, "tr_light_leak"],
  [/circul|iris/, "tr_iris"],
  [/persiana/, "tr_blinds"],
  [/pixel/, "tr_pixelate"],
  [/sacudida|temblor/, "tr_shake"],
  [/rgb|color separado/, "tr_rgb_split"],
];

/** La transición que nombra el texto (ya se sabe que habla de transiciones), o null. */
export function transitionFromText(t: string): TransitionKind | null {
  return TRANSITION_WORDS.find(([re]) => re.test(t))?.[1] ?? null;
}

const MUSIC_WORDS: [RegExp, MusicStyle][] = [
  [/lo-?fi|chill|relajad/, "lofi"],
  [/motivacional|corporativ|inspirador|positiv/, "corporativo"],
  [/trap|urbana|hip ?hop/, "trap"],
  [/ambient|de fondo suave|tranquila|calma/, "ambiente"],
  [/acustic|guitarra/, "acustico"],
  [/tens|suspenso|misterio|electronic/, "tension"],
  [/epic|de cine|cinematografic|de pelicula/, "epica"],
];

/** El estilo de música generada que nombra el texto, o null. */
export function musicStyleFromText(t: string): MusicStyle | null {
  return MUSIC_WORDS.find(([re]) => re.test(t))?.[1] ?? null;
}
