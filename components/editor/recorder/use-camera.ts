"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoFormat } from "@/lib/video/types";

/**
 * Cámara y micrófono para grabar en el navegador: permisos, elección de dispositivos y el stream en vivo.
 * Los errores salen en español con qué hacer (permiso negado, sin cámara, cámara ocupada, sin HTTPS).
 */
export type CameraState =
  | { status: "idle" }
  | { status: "asking" }
  | { status: "ready"; stream: MediaStream; width: number; height: number }
  | { status: "error"; title: string; message: string };

export type Device = { id: string; label: string };

function cameraError(error: unknown): { title: string; message: string } {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return { title: "La cámara necesita una conexión segura", message: "Abre la app desde su dirección con https:// para poder grabar." };
  }
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        title: "No tenemos permiso para usar tu cámara y tu micrófono",
        message:
          "Toca el ícono de la cámara (o del candado) junto a la dirección de la página, permite cámara y micrófono y vuelve a intentarlo. En iPhone: Ajustes → Safari → Cámara y Micrófono → Preguntar o Permitir.",
      };
    case "NotFoundError":
    case "OverconstrainedError":
      return { title: "No encontramos una cámara o un micrófono", message: "Conecta una cámara y un micrófono (o elige otros en la lista) y vuelve a intentarlo." };
    case "NotReadableError":
    case "AbortError":
      return { title: "Tu cámara está ocupada", message: "Otra app la está usando (Zoom, Meet, FaceTime…). Ciérrala y vuelve a intentarlo." };
    default:
      return { title: "No pudimos encender la cámara", message: "Recarga la página y vuelve a intentarlo. Si sigue pasando, prueba con otro navegador." };
  }
}

/** En teléfonos la cámara ya entrega vertical u horizontal según cómo lo sostienes; en computadoras, horizontal. */
function videoConstraints(format: VideoFormat, cameraId: string | null): MediaTrackConstraints {
  const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const base: MediaTrackConstraints = cameraId ? { deviceId: { exact: cameraId } } : { facingMode: "user" };
  if (touch && format === "9:16") return { ...base, width: { ideal: 1080 }, height: { ideal: 1920 }, aspectRatio: { ideal: 9 / 16 }, frameRate: { ideal: 30 } };
  return { ...base, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
}

export function useCamera(format: VideoFormat) {
  const [state, setState] = useState<CameraState>({ status: "idle" });
  const [cameras, setCameras] = useState<Device[]>([]);
  const [mics, setMics] = useState<Device[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [micId, setMicId] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(
    async (next?: { cameraId?: string | null; micId?: string | null }) => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setState({ status: "error", ...cameraError(new DOMException("", typeof window !== "undefined" && !window.isSecureContext ? "SecurityError" : "NotSupportedError")) });
        return;
      }
      const cam = next?.cameraId !== undefined ? next.cameraId : cameraId;
      const mic = next?.micId !== undefined ? next.micId : micId;
      setState({ status: "asking" });
      stop();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints(format, cam),
          audio: { ...(mic ? { deviceId: { exact: mic } } : {}), echoCancellation: true, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
        });
        streamRef.current = stream;
        const settings = stream.getVideoTracks()[0]?.getSettings() ?? {};
        // Las etiquetas de los dispositivos solo aparecen después de dar permiso.
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        setCameras(devices.filter((d) => d.kind === "videoinput").map((d, i) => ({ id: d.deviceId, label: d.label || `Cámara ${i + 1}` })));
        setMics(devices.filter((d) => d.kind === "audioinput").map((d, i) => ({ id: d.deviceId, label: d.label || `Micrófono ${i + 1}` })));
        setCameraId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? cam ?? null);
        setMicId(stream.getAudioTracks()[0]?.getSettings().deviceId ?? mic ?? null);
        setState({ status: "ready", stream, width: settings.width ?? 0, height: settings.height ?? 0 });
      } catch (error) {
        setState({ status: "error", ...cameraError(error) });
      }
    },
    [cameraId, micId, format, stop],
  );

  useEffect(() => stop, [stop]);

  return { state, cameras, mics, cameraId, micId, start, stop };
}

/** Formatos que puede grabar este navegador, en orden de preferencia (MP4 en Safari y Chrome nuevo, WebM si no). */
export function pickRecorderType(): { mimeType: string; base: "video/mp4" | "video/webm"; ext: "mp4" | "webm" } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates: { mimeType: string; base: "video/mp4" | "video/webm"; ext: "mp4" | "webm" }[] = [
    { mimeType: "video/mp4;codecs=avc1.640028,mp4a.40.2", base: "video/mp4", ext: "mp4" },
    { mimeType: "video/mp4;codecs=avc1,mp4a", base: "video/mp4", ext: "mp4" },
    { mimeType: "video/mp4", base: "video/mp4", ext: "mp4" },
    { mimeType: "video/webm;codecs=vp9,opus", base: "video/webm", ext: "webm" },
    { mimeType: "video/webm;codecs=vp8,opus", base: "video/webm", ext: "webm" },
    { mimeType: "video/webm", base: "video/webm", ext: "webm" },
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported?.(c.mimeType)) ?? null;
}

/**
 * Nivel del micrófono (0 a 1) y si estás hablando, sin servicios externos: energía de la señal con un piso de ruido
 * que se adapta. Sirve para el medidor y para que el teleprompter se detenga cuando haces una pausa.
 */
export function useVoiceActivity(stream: MediaStream | null): { level: number; speaking: boolean } {
  const [value, setValue] = useState({ level: 0, speaking: false });
  useEffect(() => {
    if (!stream || !stream.getAudioTracks().length || typeof AudioContext === "undefined") return;
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let floor = -60;
    let lastVoice = 0;
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const db = 10 * Math.log10(sum / buf.length + 1e-12);
      // El piso baja rápido y sube despacio: sigue al ruido de la habitación, no a la voz.
      floor = db < floor ? db : floor + 0.05;
      const now = performance.now();
      if (db > Math.max(floor + 12, -50)) lastVoice = now;
      setValue({ level: Math.max(0, Math.min(1, (db + 60) / 50)), speaking: now - lastVoice < 700 });
    }, 100);
    void ctx.resume().catch(() => undefined);
    return () => {
      clearInterval(timer);
      source.disconnect();
      void ctx.close().catch(() => undefined);
    };
  }, [stream]);
  return value;
}
