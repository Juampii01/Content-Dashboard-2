import type { Metadata } from "next";
import { Contact, LegalPage, Section, legalInfo } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Términos del servicio" };

export default function TerminosPage() {
  const { appName, company } = legalInfo();
  return (
    <LegalPage title="Términos del servicio" intro={`Las reglas de uso de ${appName}. Si firmaste un contrato con ${company}, ese contrato prevalece.`}>
      <Section title="1. El servicio">
        <p>
          {appName} es un sistema de contenido para una marca personal: mide tus redes, te ayuda a planear y a producir contenido. {company} lo
          instala y lo mantiene para ti. No hay registro abierto: solo entran las personas que invita el dueño de la instalación.
        </p>
      </Section>
      <Section title="2. Tu cuenta">
        <p>
          Cuida tu contraseña y no la compartas. El dueño de la instalación decide quién entra y con qué rol, y puede quitar el acceso en
          cualquier momento.
        </p>
      </Section>
      <Section title="3. Tu contenido es tuyo">
        <p>
          Todo lo que creas o subes (guiones, carruseles, videos y tu perfil de marca) es tuyo. Nos das permiso solo para guardarlo y procesarlo
          para darte el servicio.
        </p>
      </Section>
      <Section title="4. Inteligencia artificial">
        <p>
          Los textos y videos que genera la IA son propuestas. Pueden tener errores o cifras que tienes que confirmar: revísalos antes de
          publicarlos. Tú decides qué publicas y eres responsable de lo que publicas.
        </p>
      </Section>
      <Section title="5. Redes y servicios de terceros">
        <p>
          Al conectar Instagram, YouTube o TikTok aceptas también sus términos. Si una red cambia su API o deja de dar un dato, la app lo va a
          mostrar como no disponible; no inventamos datos.
        </p>
        <p>
          Los videos con clon usan <strong className="text-white">tu propia cuenta de HeyGen</strong>: el consumo lo paga tu cuenta y tienes que
          cumplir sus términos. Solo puedes crear un clon de ti mismo o de alguien que te dio su consentimiento.
        </p>
      </Section>
      <Section title="6. Uso permitido">
        <p>
          No uses la app para infringir derechos de terceros, suplantar a otra persona, publicar contenido ilegal ni intentar acceder a datos
          que no son tuyos.
        </p>
      </Section>
      <Section title="7. Disponibilidad y responsabilidad">
        <p>
          Hacemos lo posible para que el servicio funcione siempre, pero puede haber cortes por mantenimiento o por fallas de los proveedores.
          En la medida que la ley lo permita, no respondemos por pérdidas indirectas, como alcance o ventas que no se dieron.
        </p>
      </Section>
      <Section title="8. Contacto">
        <p>
          Para cualquier consulta escribe <Contact />.
        </p>
      </Section>
    </LegalPage>
  );
}
