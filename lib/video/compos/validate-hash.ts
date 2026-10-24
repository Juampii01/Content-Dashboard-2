/** Huella del código (FNV-1a de 52 bits en base 36): marca lo que ya pasó la validación. Sin servidor ni sandbox. */
export function codeHash(code: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < code.length; i++) {
    const c = code.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return `${h1.toString(36)}${(h2 & 0xfffff).toString(36)}`;
}
