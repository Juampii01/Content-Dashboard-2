// Para pruebas que importan módulos del servidor fuera de Next: `server-only` no hace nada y `after` de next/server
// corre enseguida (no hay petición en curso).
// eslint-disable-next-line @typescript-eslint/no-require-imports -- se carga con node --require (CommonJS)
const Module = require("node:module");
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === "server-only") return {};
  const m = load.call(this, request, ...rest);
  if (request === "next/server") return { ...m, after: (fn) => void Promise.resolve().then(fn).catch(() => undefined) };
  return m;
};
