/**
 * Íconos del motor (Lucide, ISC). Los trazados están en icons.data.ts (generado por scripts/motion-icons.mjs);
 * aquí van los nombres válidos y palabras en español para que la IA elija el ícono correcto.
 */
import { z } from "zod";
import { ICON_PATHS } from "./icons.data";
import { parsePath, type ParsedPath } from "./path";

export type IconName = keyof typeof ICON_PATHS;
export const ICON_NAMES = Object.keys(ICON_PATHS) as [IconName, ...IconName[]];
export const iconNameSchema = z.enum(ICON_NAMES);

/** Palabras en español de cada ícono (para el prompt y para buscar uno parecido). */
export const ICON_TAGS: Partial<Record<IconName, string>> = {
  "message-circle": "mensaje, chat, DM, conversación",
  "message-square": "mensaje, comentario",
  "messages-square": "conversaciones, chats",
  "message-circle-more": "escribiendo, respuesta, DM",
  send: "enviar, mandar",
  reply: "responder",
  inbox: "bandeja, solicitudes",
  mail: "correo, email",
  phone: "teléfono, llamada",
  "at-sign": "arroba, mención",
  bell: "notificación, alerta",
  "bell-ring": "notificación sonando",
  megaphone: "anuncio, campaña, publicidad",
  "circle-alert": "atención, error, cuidado",
  sparkles: "magia, IA, nuevo",
  zap: "rayo, rápido, energía",
  flame: "fuego, viral, tendencia",
  magnet: "imán, atraer clientes",
  user: "persona, cliente",
  users: "personas, comunidad, seguidores, audiencia",
  "user-plus": "nuevo seguidor, sumar",
  "user-check": "cliente confirmado",
  handshake: "trato, acuerdo, cierre",
  crown: "corona, premium, el mejor",
  bot: "bot, automatización, IA",
  "dollar-sign": "dinero, dólar, precio",
  banknote: "billete, pago",
  coins: "monedas, ingresos",
  wallet: "billetera, ahorro",
  "piggy-bank": "alcancía, ahorro",
  "credit-card": "tarjeta, pago",
  receipt: "recibo, factura",
  "shopping-cart": "carrito, compra",
  store: "tienda, negocio",
  gift: "regalo, bono",
  percent: "porcentaje, descuento",
  "trending-up": "sube, crecimiento",
  "trending-down": "baja, caída",
  "chart-line": "gráfico de línea, evolución",
  "chart-column": "gráfico de barras",
  "chart-no-axes-column": "barras, métricas",
  "chart-pie": "torta, proporción",
  funnel: "embudo, filtro, ventas",
  target: "objetivo, diana, meta",
  layers: "capas, niveles",
  infinity: "infinito, para siempre",
  calendar: "calendario, fecha",
  "calendar-check": "agenda, cita confirmada",
  clock: "reloj, hora",
  "alarm-clock": "despertador, urgente",
  timer: "cronómetro, tiempo",
  hourglass: "reloj de arena, espera",
  check: "listo, sí, correcto",
  "circle-check": "aprobado, hecho",
  "badge-check": "verificado",
  x: "no, error, mal",
  "circle-x": "rechazado, incorrecto",
  "arrow-right": "flecha, siguiente",
  "arrow-up-right": "crecimiento, salida",
  "arrow-up": "arriba, sube",
  "arrow-down": "abajo, baja",
  repeat: "repetir, ciclo",
  workflow: "flujo, proceso, sistema",
  play: "reproducir, video",
  video: "video, grabar",
  camera: "cámara, foto",
  image: "imagen, foto",
  mic: "micrófono, podcast, voz",
  scissors: "tijera, edición, cortar",
  heart: "me gusta, amor",
  "thumbs-up": "aprobación, bien",
  star: "estrella, reseña, destacado",
  "share-2": "compartir",
  bookmark: "guardar",
  hash: "hashtag, número",
  eye: "vistas, ver, alcance",
  "mouse-pointer-click": "clic, botón",
  link: "enlace, link",
  rocket: "cohete, lanzamiento, despegar",
  trophy: "trofeo, logro, ganar",
  medal: "medalla, premio",
  "party-popper": "celebración, festejo",
  brain: "cerebro, estrategia, mente",
  lightbulb: "idea, bombilla",
  "graduation-cap": "curso, aprender",
  "book-open": "libro, guía",
  "pen-line": "escribir, guion",
  "file-text": "documento, texto",
  "clipboard-list": "lista, tareas",
  "list-checks": "checklist, pasos",
  briefcase: "trabajo, negocio",
  "building-2": "empresa, edificio",
  smartphone: "teléfono, app",
  laptop: "computadora",
  wrench: "herramienta, arreglar",
  settings: "ajustes, engranaje, sistema",
  "sliders-horizontal": "ajustes, optimizar",
  search: "buscar, lupa",
  lock: "candado, seguro, privado",
  key: "llave, acceso",
  "shield-check": "escudo, garantía, seguridad",
  globe: "mundo, internet",
  "map-pin": "ubicación, lugar",
};

const cache = new Map<string, ParsedPath[]>();

/** Trazados del ícono, ya leídos (grilla de 24×24). */
export function iconPaths(name: IconName): ParsedPath[] {
  let hit = cache.get(name);
  if (!hit) {
    hit = (ICON_PATHS[name] ?? ICON_PATHS.sparkles).map((d) => parsePath(d));
    cache.set(name, hit);
  }
  return hit;
}

export function isIconName(name: unknown): name is IconName {
  return typeof name === "string" && name in ICON_PATHS;
}
