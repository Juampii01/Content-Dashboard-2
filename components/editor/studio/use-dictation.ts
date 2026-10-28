"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dictado por voz con el reconocimiento del navegador (Web Speech API: Chrome, Edge y Safari). No usa la API de nadie
 * ni cuesta nada; el audio lo procesa el navegador. Si el navegador no lo tiene, `supported` es false y no se muestra el
 * botón.
 *
 * `onText(final, interim)`: lo que ya quedó firme desde que se empezó a dictar y lo que se está oyendo ahora (cambia
 * mientras hablas). Quien lo usa lo junta con lo que ya estaba escrito.
 */
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "El navegador no tiene permiso para usar el micrófono. Actívalo en el candado de la barra de direcciones.",
  "service-not-allowed": "El navegador no tiene permiso para usar el micrófono. Actívalo en el candado de la barra de direcciones.",
  "audio-capture": "No encontramos un micrófono conectado.",
  network: "El dictado necesita internet. Revisa tu conexión y vuelve a intentarlo.",
};

export function useDictation(onText: (final: string, interim: string) => void, lang = "es-419") {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const finalText = useRef("");
  const cb = useRef(onText);
  useEffect(() => {
    cb.current = onText;
  }, [onText]);

  // Se mira en el navegador (en el servidor no existe): por eso va en un efecto y no al renderizar.
  useEffect(() => {
    const id = requestAnimationFrame(() => setSupported(Boolean(recognitionClass())));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => () => rec.current?.abort(), []);

  const stop = useCallback(() => {
    rec.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Cls = recognitionClass();
    if (!Cls || rec.current) return;
    const r = new Cls();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    finalText.current = "";
    setError(null);
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        const t = res[0].transcript;
        if (res.isFinal) finalText.current = `${finalText.current} ${t}`.replace(/\s+/g, " ").trim();
        else interim += t;
      }
      cb.current(finalText.current, interim.trim());
    };
    r.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") setError(ERRORS[e.error] ?? "No pudimos usar el micrófono. Vuelve a intentarlo.");
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
      cb.current(finalText.current, "");
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null;
      setError("No pudimos usar el micrófono. Vuelve a intentarlo.");
    }
  }, [lang]);

  return { supported, listening, error, start, stop, toggle: () => (rec.current ? stop() : start()) };
}
