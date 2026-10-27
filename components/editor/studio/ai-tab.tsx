"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Bot, Copy, History, Wand2 } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { VideoChat } from "./video-chat";
import { aiItems } from "./studio-panels";
import { VersionsPanel } from "./versions-panel";
import type { StudioApi } from "./types";

/**
 * Pestaña «Editor IA»: el chat es el editor (le hablas, te dice qué va a hacer y cuando le dices «edítalo», lo hace).
 * Arriba, los accesos a lo demás de la IA: editar todo, copiar la edición de un video, revisar lo que puso y volver a
 * una versión anterior (antes de cada cambio de la IA queda guardada).
 */
export function AiTab({ api, tools }: { api: StudioApi; tools: ReactNode }) {
  const pending = useMemo(() => aiItems(api).length, [api]);
  const [view, setView] = useState<"chat" | "tools" | "versions">("chat");
  if (view === "versions") {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-white/10 bg-card/95 px-3 py-2 backdrop-blur">
          <button type="button" onClick={() => setView("chat")} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-white hover:bg-white/[0.06]">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Volver al chat
          </button>
        </div>
        <VersionsPanel projectId={api.props.projectId} busy={false} />
      </div>
    );
  }
  if (view === "tools") {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-white/10 bg-card/95 px-3 py-2 backdrop-blur">
          <button type="button" onClick={() => setView("chat")} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-white hover:bg-white/[0.06]">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Volver al chat
          </button>
        </div>
        {tools}
      </div>
    );
  }
  const chip = "inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-card px-3 py-1.5 text-xs font-semibold text-text transition hover:border-white/25 hover:text-white";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
        <button type="button" className={chip} onClick={() => setView("tools")} title="La IA corta, subtitula y agrega todo de una vez (sin cambiar el orden)">
          <Wand2 className="h-3.5 w-3.5" aria-hidden /> Editar todo con IA
        </button>
        <button type="button" className={chip} onClick={() => setView("tools")} title="Haz la misma edición que un video de referencia">
          <Copy className="h-3.5 w-3.5" aria-hidden /> Copiar edición
        </button>
        <button type="button" className={chip} onClick={() => setView("tools")} title="Revisa, acepta o quita lo que puso la IA">
          <Bot className="h-3.5 w-3.5" aria-hidden /> Lo que puso la IA{pending > 0 ? ` · ${formatNumber(pending)}` : ""}
        </button>
        <button type="button" className={chip} onClick={() => setView("versions")} title="Vuelve a cómo estaba el video antes de un cambio de la IA">
          <History className="h-3.5 w-3.5" aria-hidden /> Versiones
        </button>
      </div>
      <VideoChat api={api} />
    </div>
  );
}
