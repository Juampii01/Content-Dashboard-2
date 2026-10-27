import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Cifrado de tokens de redes y claves de servicios con AES-256-GCM.
 *
 * Formato guardado: `v1.<iv>.<tag>.<datos>` (cada parte en base64url).
 * `context` se usa como dato autenticado (AAD): un valor cifrado para "instagram.access" no se puede
 * descifrar como si fuera "heygen.apiKey", aunque alguien copie la columna de una fila a otra.
 * No hay modo de compatibilidad con texto plano: si la clave falta o está mal, `env()` falla
 * y no se guarda ni se lee nada.
 */
const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
  return Buffer.from(env().TOKEN_ENCRYPTION_KEY, "base64");
}

export function encryptSecret(plain: string, context: string): string {
  if (!plain) throw new Error("No se puede cifrar un valor vacío.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, context: string): string {
  const [version, ivPart, tagPart, dataPart, ...rest] = payload.split(".");
  if (version !== VERSION || !ivPart || !tagPart || !dataPart || rest.length > 0) {
    throw new Error("El valor guardado no tiene el formato cifrado esperado.");
  }
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("El valor guardado no tiene el formato cifrado esperado.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]).toString("utf8");
}
