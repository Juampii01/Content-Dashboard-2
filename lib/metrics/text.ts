/** Primera frase útil del texto de una pieza: el título si lo hay, si no la primera línea con letras. Sin servidor: sirve en pruebas. */
export function firstLine(title: string | null, caption: string | null): string {
  const source = (title?.trim() || caption || "").split("\n").map((l) => l.trim()).find((l) => /\p{L}{3}/u.test(l)) ?? "";
  return source.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "").replace(/\s+/g, " ").trim().slice(0, 220);
}
