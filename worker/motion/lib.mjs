/**
 * Utilidades comunes de los scripts del motor en el worker: carga del motor empaquetado y registro de fuentes.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FontLibrary } from "skia-canvas";

const here = dirname(fileURLToPath(import.meta.url));

/** El motor (lib/video/motion empaquetado con `pnpm motion:bundle`). MOTION_ENGINE apunta a otro, para pruebas. */
export async function loadEngine() {
  const file = process.env.MOTION_ENGINE || join(here, "engine.mjs");
  return import(pathToFileURL(file).href);
}

const FILES = {
  Inter: ["Inter-Medium", "Inter-SemiBold", "Inter-Bold", "Inter-ExtraBold", "Inter-Black"],
  Montserrat: ["Montserrat-Medium", "Montserrat-SemiBold", "Montserrat-Bold", "Montserrat-ExtraBold", "Montserrat-Black"],
};

/** Registra Inter y Montserrat (TTF por grosor, del worker) y devuelve las familias para el motor. */
export function registerFonts(dir) {
  const fontsDir = dir || process.env.FONTS_DIR || join(here, "..", "fonts");
  for (const [family, names] of Object.entries(FILES)) {
    const files = names.map((n) => join(fontsDir, `${n}.ttf`)).filter((f) => existsSync(f));
    if (!files.length) throw new Error(`Faltan las fuentes ${family} en ${fontsDir}`);
    // (sin la forma FontLibrary.use(...) para que el linter no lo confunda con un hook de React)
    const register = FontLibrary.use.bind(FontLibrary);
    register(family, files);
  }
  return { inter: "Inter", montserrat: "Montserrat", body: "Inter" };
}

/** El motor de efectos (lib/video/fx/engine empaquetado en fx-engine.mjs). FX_ENGINE apunta a otro, para pruebas. */
export async function loadFxEngine() {
  const file = process.env.FX_ENGINE || join(here, "fx-engine.mjs");
  return import(pathToFileURL(file).href);
}

/** El sandbox de las composiciones (lib/video/compos empaquetado en compos-engine.mjs). */
export async function loadComposEngine() {
  const file = process.env.COMPOS_ENGINE || join(here, "compos-engine.mjs");
  return import(pathToFileURL(file).href);
}

const FX_FILES = {
  "Instrument Serif": ["InstrumentSerif-Regular", "InstrumentSerif-Italic"],
  "JetBrains Mono": ["JetBrainsMono-Medium", "JetBrainsMono-Bold"],
  Caveat: ["Caveat"],
  Anton: ["Anton-Regular"],
};

/** Registra las fuentes de los gráficos y las de los efectos (serif, mono, a mano y recortada). */
export function registerFxFonts(dir) {
  const fontsDir = dir || process.env.FONTS_DIR || join(here, "..", "fonts");
  registerFonts(fontsDir);
  const missing = [];
  for (const [family, names] of Object.entries(FX_FILES)) {
    const files = names.map((n) => join(fontsDir, `${n}.ttf`)).filter((f) => existsSync(f));
    if (!files.length) {
      missing.push(family);
      continue;
    }
    const register = FontLibrary.use.bind(FontLibrary);
    register(family, files);
  }
  if (missing.length) throw new Error(`Faltan las fuentes de los efectos (${missing.join(", ")}) en ${fontsDir}`);
}
