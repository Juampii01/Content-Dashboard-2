import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Boleto de una subida reservada: la acción que reserva la ruta lo firma (ruta, usuario y vencimiento) y la ruta que
 * firma la subida lo exige. Así solo se sube a una ruta que reservó la app para ese usuario, aunque no haya fila en la
 * base (por ejemplo, el video para traducir del clon).
 */
const TTL_MS = 3 * 3600_000;

function sign(key: string, userId: string, exp: number): string {
  return createHmac("sha256", env().BETTER_AUTH_SECRET).update(`upload|${key}|${userId}|${exp}`).digest("base64url");
}

export function uploadTicket(key: string, userId: string): string {
  const exp = Date.now() + TTL_MS;
  return `${exp}.${sign(key, userId, exp)}`;
}

export function validUploadTicket(ticket: string | null, key: string, userId: string): boolean {
  const [expText, sig] = (ticket ?? "").split(".");
  const exp = Number(expText);
  if (!sig || !Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = Buffer.from(sign(key, userId, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
