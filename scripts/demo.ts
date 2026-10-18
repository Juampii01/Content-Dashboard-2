/**
 * Datos de demostración desde la terminal (lo mismo que el botón de Ajustes).
 *   pnpm demo cargar   → crea las cuentas demo y su contenido (reemplaza la demo anterior)
 *   pnpm demo borrar   → borra todo lo de la demo (las cuentas reales no se tocan)
 */
import { clearDemo, loadDemo } from "../lib/demo";

const action = process.argv[2];
(async () => {
  if (action === "cargar") console.log((await loadDemo()).join("\n") || "No se cargó nada: todas las redes tienen una cuenta real.");
  else if (action === "borrar") console.log(`Demo borrada (${await clearDemo()} cuentas).`);
  else {
    console.log("Uso: pnpm demo cargar | pnpm demo borrar");
    process.exit(1);
  }
  process.exit(0);
})().catch((error: unknown) => {
  console.error("Falló:", error instanceof Error ? error.message : error);
  process.exit(1);
});
