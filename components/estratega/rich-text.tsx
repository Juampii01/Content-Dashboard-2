import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import type { StrategistCitation } from "@/lib/db/schema";

/**
 * Texto de una respuesta del estratega: párrafos, viñetas ("- "), **negritas**, _cursivas_ y referencias
 * [P3] / [C1] / [E2] convertidas en enlaces a la pieza, la cifra o el calendario. Sin HTML crudo.
 */
const CHIP =
  "mx-0.5 inline-flex items-center rounded-md border border-accent-hi/40 bg-accent/15 px-1.5 py-px align-[1px] font-mono text-[11px] leading-4 font-semibold text-accent-glow no-underline transition hover:border-accent-hi hover:text-white";

function inline(text: string, cites: Map<string, StrategistCitation>, key: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|_[^_]+_|\[[PCE]\d{1,3}\])/g).map((part, i) => {
    const k = `${key}-${i}`;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={k} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    if (/^_[^_]+_$/.test(part)) return <em key={k} className="text-placeholder">{part.slice(1, -1)}</em>;
    const ref = /^\[([PCE]\d{1,3})\]$/.exec(part)?.[1];
    if (ref) {
      const c = cites.get(ref);
      return c ? (
        <Link key={k} href={c.href} className={CHIP} aria-label={`Fuente ${ref}: ${c.label}`} title={c.detail ? `${c.label} · ${c.detail}` : c.label}>
          {ref}
        </Link>
      ) : (
        <span key={k} className={`${CHIP} opacity-60`}>
          {ref}
        </span>
      );
    }
    return <Fragment key={k}>{part}</Fragment>;
  });
}

/** Una línea con referencias y negritas (sin párrafos ni viñetas): las ideas propuestas. */
export function InlineText({ text, citations }: { text: string; citations: StrategistCitation[] }) {
  return <>{inline(text, new Map(citations.map((c) => [c.ref, c])), "i")}</>;
}

export function RichText({ text, citations }: { text: string; citations: StrategistCitation[] }) {
  const cites = new Map(citations.map((c) => [c.ref, c]));
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-text">
      {blocks.map((block, b) => {
        const lines = block.split("\n").filter((l) => l.trim());
        if (lines.length && lines.every((l) => /^\s*[-•*]\s+/.test(l))) {
          return (
            <ul key={b} className="flex flex-col gap-1.5 pl-1">
              {lines.map((l, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-[0.6em] h-1.5 w-1.5 flex-none rounded-full bg-accent-hi" aria-hidden />
                  <span className="min-w-0">{inline(l.replace(/^\s*[-•*]\s+/, ""), cites, `${b}-${i}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={b}>
            {lines.map((l, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                {inline(l, cites, `${b}-${i}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
