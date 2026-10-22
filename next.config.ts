import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Cabeceras de seguridad para todas las rutas.
 * La CSP permite imágenes y video de HTTPS porque las miniaturas y previsualizaciones vienen
 * de las redes y del almacenamiento de archivos. `frame-ancestors 'none'` impide incrustar la app.
 */
/**
 * HeyGen sirve los previews de avatares y voces desde sus CDN por https (files.heygen.ai, files.heygen.com,
 * resource.heygen.ai): ya entran en `https:`. Los videos generados no se cargan desde HeyGen sino desde
 * /api/clon/[id]/archivo (mismo origen). Solo en desarrollo se suma el servidor simulado de HeyGen
 * (HEYGEN_API_BASE=http://localhost:…), que sirve sus archivos por http.
 */
const heygenMock = isDev && process.env.HEYGEN_API_BASE?.startsWith("http://") ? ` ${new URL(process.env.HEYGEN_API_BASE).origin}` : "";
/** Igual con el simulador de Pexels del Editor (PEXELS_API_BASE=http://localhost:…): los de verdad ya son https. */
const pexelsMock = isDev && process.env.PEXELS_API_BASE?.startsWith("http://") ? ` ${new URL(process.env.PEXELS_API_BASE).origin}` : "";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https:${heygenMock}${pexelsMock}`,
  `media-src 'self' blob: https:${heygenMock}${pexelsMock}`,
  "font-src 'self'",
  "connect-src 'self' https:",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Fuentes del informe mensual en PDF: se leen del disco al dibujarlo, así que viajan con estas funciones.
  outputFileTracingIncludes: {
    "/api/cron/sync": ["./lib/reports/fonts/**"],
    "/inicio/informes": ["./lib/reports/fonts/**"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
