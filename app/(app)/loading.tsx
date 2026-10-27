/** Mientras carga una sección: la estructura de la página, sin saltos. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Cargando" className="flex flex-col gap-6">
      <div className="skeleton h-36" />
      <div className="skeleton h-64" />
      <div className="skeleton h-40" />
    </div>
  );
}
