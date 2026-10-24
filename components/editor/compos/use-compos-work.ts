"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Composition } from "@/lib/video/compos/schema";
import type { WorkView } from "@/lib/video/compos/work";
import { composStatusAction, requestAnimationAction } from "../compos-actions";

export type ComposRequest = { from_word: number; to_word: number; instruction: string; replace: Composition | null };

/**
 * Un pedido de animación desde el Estudio: lo manda, consulta el estado cada pocos segundos y, cuando termina, entrega
 * las animaciones hechas (y las URLs de sus imágenes) una sola vez. Si al abrir el Estudio había uno en curso, lo sigue.
 */
export function useComposWork(projectId: string, onDone: (made: Composition[], images: Record<string, string>, work: WorkView) => void) {
  const [work, setWork] = useState<WorkView | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watching = useRef<string | null>(null);
  const delivered = useRef<Set<string>>(new Set());
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  const poll = useCallback(async () => {
    const r = await composStatusAction(projectId);
    if (!r.ok) return;
    const w = r.data.work;
    if (!w || w.mode !== "request") return;
    setWork(w);
    if (w.done && watching.current === w.id && !delivered.current.has(w.id)) {
      delivered.current.add(w.id);
      watching.current = null;
      done.current(r.data.made, r.data.images, w);
    }
    if (!w.done) watching.current = w.id;
  }, [projectId]);

  // Un pedido que quedó en curso de antes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- se consulta al servidor después de montar.
    void poll();
  }, [poll]);

  const running = Boolean(work && !work.done);
  useEffect(() => {
    if (!running && !watching.current) return;
    const t = setInterval(() => void poll(), 2500);
    return () => clearInterval(t);
  }, [running, poll]);

  const request = useCallback(
    async (req: ComposRequest): Promise<boolean> => {
      setSending(true);
      setError(null);
      const r = await requestAnimationAction(projectId, req);
      setSending(false);
      if (!r.ok) {
        setError(r.error);
        return false;
      }
      watching.current = r.workId;
      setWork({ id: r.workId, mode: "request", done: false, cannot: "", error: null, request: { instruction: req.instruction, from_word: req.from_word, to_word: req.to_word, replaceId: req.replace?.id ?? null }, tasks: [], savedUsd: 0 });
      return true;
    },
    [projectId],
  );

  return { work, running: running || sending, sending, error, request, clearError: () => setError(null) };
}
