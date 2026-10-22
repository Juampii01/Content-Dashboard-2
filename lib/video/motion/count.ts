/**
 * Números que cuentan: se lee cómo está escrita la cifra final ("x2", "+40%", "10K", "6/10", "12,345", "US$ 1.5M")
 * y se arma cada cuadro con el mismo formato. Al terminar se muestra el texto exacto que se escribió.
 * Por defecto, es-419: coma de miles y punto decimal (12,345.5); si la cifra trae otro formato, se respeta.
 */
import type { CountFormat } from "./nodes";

/** Lee una cifra escrita. `from` es desde dónde cuenta (0 por defecto). */
export function parseCount(text: string, from = 0): CountFormat {
  const final = text.replace(/\s+/g, " ").trim();
  const m = final.match(/^(.*?)(\d+(?:[.,]\d+)*)(.*)$/);
  if (!m) return { prefix: final, suffix: "", from: 0, to: 0, decimals: 0, thousands: "", decimal: ".", final };
  const prefix = m[1] ?? "";
  const num = m[2]!;
  const suffix = m[3] ?? "";
  let to = 0;
  let decimals = 0;
  let thousands: CountFormat["thousands"] = "";
  let decimal: CountFormat["decimal"] = ".";
  const groups = num.match(/^\d{1,3}(([.,])\d{3})+$/);
  const mixed = num.match(/^(\d{1,3}(?:([.,])\d{3})+)([.,])(\d+)$/);
  if (mixed && mixed[2] !== mixed[3]) {
    // 12,345.5 o 12.345,5
    thousands = mixed[2] as "," | ".";
    decimal = mixed[3] as "," | ".";
    decimals = mixed[4]!.length;
    to = Number(`${mixed[1]!.replace(/[.,]/g, "")}.${mixed[4]}`);
  } else if (groups && !/^0/.test(num)) {
    thousands = groups[2] as "," | ".";
    to = Number(num.replace(/[.,]/g, ""));
  } else if (/^\d+[.,]\d+$/.test(num)) {
    decimal = num.includes(",") ? "," : ".";
    decimals = num.split(/[.,]/)[1]!.length;
    to = Number(num.replace(",", "."));
  } else to = Number(num.replace(/[.,]/g, ""));
  return { prefix, suffix, from, to: Number.isFinite(to) ? to : 0, decimals, thousands, decimal, final };
}

/** El número formateado en el progreso p (0–1). */
export function formatCount(f: CountFormat, p: number): { prefix: string; digits: string; suffix: string } {
  if (p >= 1) {
    const m = f.final.match(/^(.*?)(\d+(?:[.,]\d+)*)(.*)$/);
    return m ? { prefix: m[1] ?? "", digits: m[2]!, suffix: m[3] ?? "" } : { prefix: f.final, digits: "", suffix: "" };
  }
  const v = f.from + (f.to - f.from) * Math.max(0, p);
  let digits: string;
  if (f.decimals > 0) {
    const [int, dec] = Math.abs(v).toFixed(f.decimals).split(".");
    digits = `${group(int!, f.thousands)}${f.decimal}${dec}`;
  } else digits = group(String(Math.round(Math.abs(v))), f.thousands);
  return { prefix: f.prefix, digits, suffix: f.suffix };
}

function group(int: string, sep: string): string {
  return sep ? int.replace(/\B(?=(\d{3})+(?!\d))/g, sep) : int;
}

/** Si un texto tiene una cifra que se pueda contar. */
export const hasCount = (text: string) => /\d/.test(text);
