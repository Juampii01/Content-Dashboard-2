/** Mis efectos: huella del código normalizado (sin servidor; usa acorn, así que no va en el navegador). */
import { tokenizer } from "acorn";
import { codeHash } from "./validate-hash";

/**
 * Huella del código normalizado: los mismos tokens dan la misma huella aunque cambien los espacios, los saltos de
 * línea o los comentarios. Si el código no se puede leer (no debería: ya pasó la validación), se quitan los espacios.
 */
export function normalizedHash(code: string): string {
  try {
    const parts: string[] = [];
    for (const tok of tokenizer(code, { ecmaVersion: "latest", sourceType: "module" })) {
      parts.push(code.slice(tok.start, tok.end));
    }
    return `n${codeHash(parts.join("\u0001"))}`;
  } catch {
    return `n${codeHash(code.replace(/\s+/g, ""))}`;
  }
}
