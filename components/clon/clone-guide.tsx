import { Camera, ChevronDown, ExternalLink, ShieldAlert } from "lucide-react";

const checklist = [
  "Luz de frente a la cara, sin sombras fuertes",
  "Fondo limpio y sin movimiento",
  "Cámara a la altura de los ojos, en plano medio",
  "Solo tú en cuadro, mirando a cámara todo el tiempo",
  "Entre 2 y 5 minutos hablando natural, con pausas",
  "Audio limpio: sin música ni ruido de fondo",
  "Archivo MP4 en 1080p",
];

/**
 * "¿Todavía no tienes tu clon?": cómo crearlo en la web de HeyGen (MVP: el clon se crea allá y se elige aquí).
 * Plegable, para no ocupar la pantalla de quien ya lo tiene.
 */
export function CloneGuide({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <details className="section-shell group" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-3">
          <span className="tile-icon h-10 w-10 flex-none">
            <Camera className="h-5 w-5" aria-hidden />
          </span>
          <span>
            <span className="block font-semibold text-white">¿Todavía no tienes tu clon?</span>
            <span className="block text-sm text-muted">Lo creas una sola vez en HeyGen y después lo eliges aquí.</span>
          </span>
        </span>
        <ChevronDown className="h-5 w-5 flex-none text-muted transition group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <ol className="flex flex-col gap-4">
          {[
            { title: "Graba tu video de entrenamiento", text: "Con la lista de la derecha. Un buen video de entrenamiento es lo que más mejora el resultado." },
            { title: "Crea tu clon en HeyGen", text: "En app.heygen.com crea un avatar de tipo Digital Twin y sube ese video. HeyGen también clona tu voz con el mismo video." },
            { title: "Autoriza el uso de tu imagen", text: "HeyGen te pide grabar una declaración corta con la webcam. El enlace vence a las 24 horas: si se vence, pide otro desde HeyGen." },
            { title: "Espera a que esté listo", text: "El entrenamiento y la revisión del consentimiento tardan unos minutos. Cuando esté listo, aparece en «Mis avatares» al crear un video aquí." },
          ].map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className="step-node flex-none" aria-hidden>
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-semibold text-white">{step.title}</p>
                <p className="mt-0.5 text-sm text-muted">{step.text}</p>
              </div>
            </li>
          ))}
          <li>
            <a href="https://app.heygen.com" target="_blank" rel="noreferrer" className="btn-ghost !text-sm">
              Abrir HeyGen
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">(se abre en otra pestaña)</span>
            </a>
          </li>
        </ol>

        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <p className="eyebrow mb-3">Checklist de grabación</p>
            <ul className="flex flex-col gap-2 text-sm">
              {checklist.map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span aria-hidden className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-accent-hi" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex gap-3 rounded-2xl border border-warning/35 bg-warning/10 p-4 text-sm">
            <ShieldAlert className="mt-0.5 h-4 w-4 flex-none text-warning" aria-hidden />
            <p className="text-text/90">
              <span className="font-semibold text-warning">Solo con consentimiento.</span> Clona únicamente a la persona que aparece en el video y que
              autoriza el uso de su imagen y su voz. Usar la cara o la voz de otra persona sin su permiso está prohibido por HeyGen y puede ser ilegal.
            </p>
          </div>
        </div>
      </div>
    </details>
  );
}
