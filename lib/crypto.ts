import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Cifrado de tokens de redes y claves de servicios con AES-256-GCM.
 *
 * Formato guardado: `v1.<iv>.<tag>.<datos>` (cada parte en base64url).
 * No hay modo de compatibilidad con texto plano: si la clave falta o está mal, `env()` falla
 * y no se guarda ni se lee nada.
 */
const VERSION = "v1";
const IV_BYTES = 12;

function key(): Buffer {
  return Buffer.from(env().TOKEN_ENCRYPTION_KEY, "base64");
}

export function encryptSecret(plain: string): string {
  if (!plain) throw new Error("No se puede cifrar un valor vacío.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !data) {
    throw new Error("El valor guardado no tiene el formato cifrado esperado.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
