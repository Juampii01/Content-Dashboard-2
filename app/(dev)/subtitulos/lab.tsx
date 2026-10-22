"use client";

import { useEffect, useMemo, useState } from "react";
import { CaptionOverlay } from "@/components/editor/caption-overlay";
import { captionLook, isCaptionStyle } from "@/lib/video/caption-styles";
import { captionBlocks } from "@/lib/video/captions";
import type { TimedWord, VideoFormat } from "@/lib/video/types";

/** Las mismas palabras que scripts/caption-dump.mts (la comparación con el worker usa las dos). */
function sampleWords(): TimedWord[] {
  const text = "Hoy te muestro cómo ganar más dinero con tus videos sin gastar en anuncios.";
  let t = 0.3;
  return text.split(" ").map((w, i) => {
    const d = 0.18 + w.length * 0.035;
    const word = { id: i, text: w, start: +t.toFixed(3), end: +(t + d).toFixed(3), emphasis: /dinero|videos/.test(w), stop: /\.$/.test(w) };
    t += d + 0.06;
    return word;
  });
}

export function CaptionLab() {
  const [params, setParams] = useState<URLSearchParams | null>(null);
  useEffect(() => setParams(new URLSearchParams(window.location.search)), []);
  const style = params?.get("style") ?? "caja";
  const format = (params?.get("format") === "16:9" ? "16:9" : "9:16") as VideoFormat;
  const time = Number(params?.get("t") ?? "2.9");
  const accent = params?.get("accent") ?? "#0070F8";
  const words = useMemo(sampleWords, []);
  if (!params || !isCaptionStyle(style)) return null;
  const look = captionLook(style, { format, accent, brandFont: "montserrat", emoji: true });
  const blocks = captionBlocks(words, style);
  const block = blocks.find((b) => time >= b.start && time < b.end) ?? null;
  const [w, h] = format === "9:16" ? [1080, 1920] : [1920, 1080];
  return (
    <div id="frame" style={{ position: "fixed", left: 0, top: 0, width: w, height: h, overflow: "hidden", background: "linear-gradient(135deg, #35507a, #0c1528)" }}>
      <CaptionOverlay block={block} time={time} preset={style} format={format} accent={accent} height={h} look={look} />
    </div>
  );
}
