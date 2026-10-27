import type { Metadata } from "next";
import { Contact, LegalPage, Section, legalInfo } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Política de privacidad" };

const ext = "text-accent-hi underline underline-offset-2";

export default function PrivacidadPage() {
  const { appName, company } = legalInfo();
  return (
    <LegalPage
      title="Política de privacidad"
      intro={`Qué datos usa ${appName}, para qué, con quién se comparten y cómo puedes pedir que se borren.`}
    >
      <Section title="1. Quién es responsable">
        <p>
          {appName} es un software que {company} desarrolla e instala para cada cliente (un creador o una marca personal). Cada instalación es
          independiente: tiene su propia base de datos, sus propias claves y solo la usan las personas que el cliente invita. {company} opera la
          instalación en nombre del cliente.
        </p>
        <p>
          Para cualquier consulta sobre privacidad escribe <Contact />.
        </p>
      </Section>

      <Section title="2. Qué datos usamos">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="text-white">Tu cuenta de acceso:</strong> nombre, correo y contraseña (guardada solo como hash, nunca en texto).
          </li>
          <li>
            <strong className="text-white">Instagram</strong> (solo cuentas profesionales y solo si la conectas): nombre de usuario, foto de
            perfil, cantidad de seguidores, y de tus publicaciones el texto, la fecha, el tipo, la miniatura, el enlace y sus métricas
            (visualizaciones, alcance, me gusta, cantidad de comentarios, compartidos y guardados).
          </li>
          <li>
            <strong className="text-white">YouTube</strong> (si la conectas): datos del canal, tus videos y sus estadísticas y analíticas
            (visualizaciones, tiempo de visualización, retención y suscriptores).
          </li>
          <li>
            <strong className="text-white">TikTok</strong> (si la conectas): perfil básico, estadísticas de la cuenta y la lista de tus videos
            con sus contadores (visualizaciones, me gusta, comentarios y compartidos).
          </li>
          <li>
            <strong className="text-white">Lo que creas en la app:</strong> tu perfil de marca, guiones, calendario, carruseles, los videos que
            subes al editor y los videos que generas con tu clon.
          </li>
          <li>
            <strong className="text-white">Claves de servicios que agregas</strong> (por ejemplo, tu clave de HeyGen), guardadas cifradas.
          </li>
        </ul>
        <p>
          <strong className="text-white">No</strong> leemos tus mensajes directos, no leemos el texto de los comentarios, no publicamos nada en
          tu nombre y no accedemos a datos de otras personas. Solo pedimos los permisos de lectura necesarios para mostrar tu contenido y tus
          métricas.
        </p>
      </Section>

      <Section title="3. Para qué los usamos">
        <p>
          Solo para darte el servicio: mostrar tus métricas, comparar periodos, planear tu calendario y ayudarte a producir contenido (guiones,
          carruseles y videos). No vendemos datos, no los usamos para publicidad y no armamos perfiles para terceros.
        </p>
      </Section>

      <Section title="4. Con quién se comparten">
        <p>Usamos proveedores que procesan datos en nuestro nombre, solo para lo que hace falta:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Vercel (alojamiento de la app y de los archivos) y Neon (base de datos).</li>
          <li>
            Anthropic (inteligencia artificial): recibe el texto necesario para escribir guiones, carruseles y planes, junto con tu perfil de
            marca. Según sus términos comerciales, no usa esos datos para entrenar sus modelos.
          </li>
          <li>Resend (envío de correos de invitación y recuperación de contraseña).</li>
          <li>Fly.io y un servicio de transcripción (Deepgram o Groq), solo para los videos que subes al editor.</li>
          <li>HeyGen, solo si conectas tu propia cuenta para generar videos con tu clon.</li>
        </ul>
        <p>No compartimos datos con nadie más, salvo que la ley nos obligue.</p>
      </Section>

      <Section title="5. Datos de Google y YouTube">
        <p>
          {appName} usa los Servicios de API de YouTube. Al conectar YouTube aceptas también los{" "}
          <a className={ext} href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
            Términos del Servicio de YouTube
          </a>{" "}
          y la{" "}
          <a className={ext} href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
            Política de Privacidad de Google
          </a>
          .
        </p>
        <p>
          El uso y la transferencia a cualquier otra app de la información recibida de las API de Google se ajusta a la{" "}
          <a className={ext} href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
            Política de Datos de Usuario de los Servicios de API de Google
          </a>
          , incluidos los requisitos de Uso Limitado.
        </p>
        <p>
          Puedes quitar el acceso en cualquier momento desde la{" "}
          <a className={ext} href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
            página de permisos de tu cuenta de Google
          </a>
          .
        </p>
      </Section>

      <Section title="6. Cómo los protegemos">
        <p>
          Las conexiones van siempre cifradas (HTTPS). Los permisos de tus redes y las claves de servicios se guardan cifrados (AES-256-GCM).
          Solo entran las personas que el dueño invita, y cada una tiene un rol (dueño, editor o solo lectura).
        </p>
      </Section>

      <Section title="7. Cuánto tiempo los guardamos">
        <p>
          Mientras la instalación esté activa. Si desconectas una red, borramos sus permisos de inmediato y dejamos de actualizar sus datos. El
          histórico de métricas se conserva para que puedas comparar periodos, salvo que pidas borrarlo: el dueño puede borrarlo al instante
          desde Ajustes, o puedes pedirlo por correo y lo borramos dentro de los 7 días siguientes. Cuando termina el servicio, borramos la
          instalación completa.
        </p>
      </Section>

      <Section title="8. Tus derechos">
        <p>
          Puedes pedir ver, corregir o borrar tus datos en cualquier momento. Mira cómo en{" "}
          <a className={ext} href="/eliminar-datos">
            Eliminar mis datos
          </a>{" "}
          o escribe <Contact />.
        </p>
      </Section>

      <Section title="9. Cambios">
        <p>Si cambiamos esta política, actualizamos la fecha de arriba y te avisamos dentro de la app cuando el cambio sea importante.</p>
      </Section>
    </LegalPage>
  );
}
