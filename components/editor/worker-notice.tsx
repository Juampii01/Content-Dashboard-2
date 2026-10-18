import { Notice } from "@/components/ui/feedback";

/**
 * Aviso cuando el servicio de procesamiento (worker) no está encendido.
 * Con Fly configurado, la app lo enciende sola: solo se avisa si un trabajo lleva minutos sin arrancar.
 */
export function WorkerNotice({ online, autoStart, waiting }: { online: boolean; autoStart: boolean; waiting: boolean }) {
  if (online) return null;
  if (autoStart && !waiting) return null;
  if (autoStart) {
    return (
      <Notice tone="warning" title="El servicio de procesamiento está tardando en encender">
        Tus videos están en cola y no se pierde nada. Suele tardar menos de un minuto; si en 5 minutos no arranca, avísale a soporte.
      </Notice>
    );
  }
  return (
    <Notice tone="warning" title="El servicio de procesamiento está apagado">
      Puedes subir y revisar videos; los que mandes a procesar quedan en cola y arrancan apenas se encienda. Si en unos minutos
      no arranca, avísale a soporte.
    </Notice>
  );
}
