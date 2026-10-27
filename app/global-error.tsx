"use client";

/** Último recurso: si falla el layout raíz. Sin dependencias, con estilos en línea. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#f6f6f4", color: "#16171b", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 20, color: "#fff" }}>No pudimos cargar la aplicación</h1>
          <p style={{ color: "#6a6e75" }}>Recarga la página en unos segundos.</p>
          <button onClick={reset} style={{ marginTop: 12, background: "#16171b", color: "#fff", border: 0, borderRadius: 12, padding: "10px 18px", fontWeight: 600, cursor: "pointer" }}>
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
