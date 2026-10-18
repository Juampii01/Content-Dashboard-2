import type { Metadata } from "next";
import { Contact, LegalPage, Section, legalInfo } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Eliminar mis datos" };

const ext = "text-accent-hi underline underline-offset-2";

export default function EliminarDatosPage() {
  const { appName } = legalInfo();
  return (
    <LegalPage title="Eliminar mis datos" intro={`Cómo quitar el acceso de ${appName} a tus redes y cómo pedir que borremos tus datos.`}>
      <Section title="1. Desconecta la red desde la app">
        <p>
          Entra a <strong className="text-white">Ajustes → Redes conectadas</strong> y toca <strong className="text-white">Desconectar</strong>{" "}
          en la red. Borramos sus permisos al instante y dejamos de leer sus datos. Desde la misma tarjeta, el dueño puede{" "}
          <strong className="text-white">borrar todos los datos de esa red</strong>.
        </p>
      </Section>
      <Section title="2. O quita el permiso desde la red">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="text-white">Instagram:</strong> Configuración y actividad → Permisos de sitios web → Apps y sitios web → quita {appName}.
          </li>
          <li>
            <strong className="text-white">YouTube (Google):</strong>{" "}
            <a className={ext} href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
              myaccount.google.com/permissions
            </a>{" "}
            → quita {appName}.
          </li>
          <li>
            <strong className="text-white">TikTok:</strong> Configuración y privacidad → Seguridad → Apps y servicios → quita {appName}.
          </li>
        </ul>
        <p>Al quitar el permiso dejamos de leer esa red. Si además quieres que borremos lo que ya se midió, usa el paso 1 o el paso 3.</p>
      </Section>
      <Section title="3. Pide la eliminación completa">
        <p>
          Escribe <Contact /> desde el correo de tu cuenta e indica qué quieres borrar (una red, todo tu contenido o tu cuenta). Te confirmamos
          por correo cuando quede hecho, dentro de los 7 días siguientes.
        </p>
      </Section>
    </LegalPage>
  );
}
