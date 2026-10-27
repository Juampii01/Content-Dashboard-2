/**
 * Se ejecuta una vez al arrancar el servidor. Si la configuración está incompleta,
 * la app no arranca y el log dice qué variable falta (sin mostrar valores).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { env } = await import("@/lib/env");
    env();
  }
}
