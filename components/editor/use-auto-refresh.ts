"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refresca la página del servidor cada `ms` mientras haya algo en curso (y la pestaña esté a la vista). */
export function useAutoRefresh(active: boolean, ms = 3000) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => !document.hidden && router.refresh(), ms);
    return () => clearInterval(timer);
  }, [active, ms, router]);
}
