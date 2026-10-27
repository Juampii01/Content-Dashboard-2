/**
 * Lo que usa el worker (worker/motion/compos-engine.mjs, empaquetado con `pnpm motion:bundle`): el sandbox de Node
 * para correr el código de las composiciones cuadro a cuadro.
 */
export { NodeSandbox } from "./sandbox-node";
export { checkStatic } from "./static";
export { COMPOS_LIMITS, COMPOS_API_VERSION } from "./contract";
// El agente de animaciones (worker/motion/compos-check.mjs) valida igual que la app antes de guardar.
export { validateComposition } from "./validate";
