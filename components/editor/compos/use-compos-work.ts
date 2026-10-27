"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Composition, RefImage } from "@/lib/video/compos/schema";
import type { RequestView } from "@/lib/video/compos/requests";
import type { WorkView } from "@/lib/video/compos/work";
import { ackAnimationsAction, cancelAnimationAction, composStatusAction, requestAnimationAction } from "../compos-actions";

export type ComposRequest = { from_word: number; to_word: number; instruction: string; replace: Composition | null; at?: number | null; refs?: RefImage[]; fromChat?: boolean };

/** Un pedido como lo ve el Estudio: lo del servidor, o el que se acaba de mandar (todavía sin respuesta). */
export type LiveRequest = Pick<RequestView, "id" | "status" | "request" | "tasks" | "error" | "made" | "createdAt"> & { optimistic?: boolean };

/** Texto del progreso de un pedido ("En cola", "Escribiendo…", "Revisando…"). */
export function requestStage(r: LiveRequest): string {
  if (r.status === "waiting") return "En espera";
  if (r.status === "queued") return "En cola";
  if (r.status === "failed") return "No se pudo";
  if (r.status === "canceled") return "Cancelado";
  if (r.status === "done") return "Lista";
  const t = r.tasks[0];
  const step: Record<string, string> = { plan: "Pensando…", images: "Creando la imagen…", vision: "Mirando la imagen…", code: "Escribiendo…", look: "Dibujándola…", looking: "Revisando…" };
  return t ? (step[t.status] ?? "Escribiendo…") : "Empezando…";
}

export const isActive = (r: LiveRequest) => r.status === "waiting" || r.status === "queued" || r.status === "running";

/**
 * Pedidos de animaciones del Estudio, varios a la vez: los manda, consulta el estado cada pocos segundos mientras haya
 * alguno en curso y entrega cada uno una sola vez cuando termina (`onDeliver`). Al abrir el Estudio retoma los que
 * siguen en curso y entrega los terminados que no llegaron a entregarse. Un pedido entregado se marca en el servidor
 * después del primer guardado que ya lo incluye (`takeAcks` + `confirmAcks`), así recargar nunca lo pierde ni lo repite.
 */
export function useComposRequests(projectId: string, onDeliver: (req: LiveRequest, images: Record<string, string>) => void, onFailed: (req: LiveRequest) => void) {
  const [requests, setRequests] = useState<LiveRequest[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legacy, setLegacy] = useState<WorkView | null>(null);
  const handled = useRef<Set<string>>(new Set());
  const pendingAck = useRef<Set<string>>(new Set());
  const cbs = useRef({ onDeliver, onFailed });
  useEffect(() => {
    cbs.current = { onDeliver, onFailed };
  }, [onDeliver, onFailed]);

  const poll = useCallback(async () => {
    const r = await composStatusAction(projectId);
    if (!r.ok) return;
    setLegacy(r.data.work);
    const server = r.data.requests;
    setRequests((cur) => {
      // Los optimistas que el servidor todavía no lista se quedan (la respuesta de "pedir" puede llegar después).
      const ids = new Set(server.map((x) => x.id));
      return [...server.filter((x) => !handled.current.has(x.id) || isActive(x) || x.status === "failed"), ...cur.filter((x) => x.optimistic && !ids.has(x.id))];
    });
    for (const req of server) {
      if (handled.current.has(req.id)) continue;
      if (req.status === "done") {
        handled.current.add(req.id);
        pendingAck.current.add(req.id);
        cbs.current.onDeliver(req, r.data.images);
      } else if (req.status === "failed") {
        handled.current.add(req.id);
        cbs.current.onFailed(req);
      }
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- se consulta al servidor después de montar (retoma lo que siguió en curso).
    void poll();
  }, [poll]);

  const active = requests.some(isActive);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void poll(), 2500);
    return () => clearInterval(t);
  }, [active, poll]);

  const request = useCallback(
    async (req: ComposRequest): Promise<boolean> => {
      setSending(true);
      setError(null);
      const tempId = `tmp-${Date.now().toString(36)}`;
      const base = { request: { instruction: req.instruction, from_word: req.from_word, to_word: req.to_word, replaceId: req.replace?.id ?? null }, tasks: [], made: [], createdAt: new Date().toISOString() };
      // Aparece al instante (bloque fantasma), antes de que responda el servidor.
      setRequests((cur) => [...cur, { id: tempId, status: "queued", error: null, optimistic: true, ...base }]);
      const r = await requestAnimationAction(projectId, req);
      setSending(false);
      if (!r.ok) {
        setRequests((cur) => cur.filter((x) => x.id !== tempId));
        setError(r.error);
        return false;
      }
      setRequests((cur) => cur.map((x) => (x.id === tempId ? { ...x, id: r.workId, status: r.error ? "failed" : "queued", error: r.error, optimistic: !r.error } : x)));
      if (r.error) handled.current.add(r.workId);
      void poll();
      return !r.error;
    },
    [projectId, poll],
  );

  const cancel = useCallback(
    async (id: string) => {
      setRequests((cur) => cur.filter((x) => x.id !== id));
      handled.current.add(id);
      await cancelAnimationAction(projectId, id);
      void poll();
    },
    [projectId, poll],
  );

  /** Cierra el aviso de un pedido fallido. */
  const dismiss = useCallback(
    async (id: string) => {
      setRequests((cur) => cur.filter((x) => x.id !== id));
      handled.current.add(id);
      await ackAnimationsAction(projectId, [id]);
    },
    [projectId],
  );

  /** Al empezar un guardado: los pedidos ya entregados en el estado que se va a guardar. */
  const takeAcks = useCallback(() => {
    const ids = [...pendingAck.current];
    pendingAck.current.clear();
    return ids;
  }, []);
  /** Después de un guardado que salió bien: quedan marcados como entregados. Si falló, vuelven a la espera. */
  const confirmAcks = useCallback(
    (ids: string[], ok: boolean) => {
      if (!ids.length) return;
      if (ok) void ackAnimationsAction(projectId, ids);
      else for (const id of ids) pendingAck.current.add(id);
    },
    [projectId],
  );

  const visible = requests.filter((r) => isActive(r) || r.status === "failed");
  return { requests: visible, legacy, sending, error, request, cancel, dismiss, takeAcks, confirmAcks, refresh: poll, clearError: () => setError(null) };
}

export type ComposRequestsApi = ReturnType<typeof useComposRequests>;
