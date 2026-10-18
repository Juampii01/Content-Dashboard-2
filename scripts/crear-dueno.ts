/**
 * Crea el dueño de la cuenta en una instalación nueva.
 *
 * Uso:
 *   pnpm crear-dueno correo@cliente.com "Nombre Apellido"
 *
 * Crea el usuario y su fila en team_members con rol OWNER, y le manda la invitación por correo
 * para que defina su contraseña. También muestra el enlace aquí, por si el correo tarda.
 * Se puede volver a ejecutar: si el usuario ya existe, solo renueva el rol y manda un enlace nuevo.
 */
import { inviteMember } from "../lib/auth/invitations";

async function main() {
  const [email, name] = process.argv.slice(2);
  if (!email || !email.includes("@")) {
    console.error('Uso: pnpm crear-dueno correo@cliente.com "Nombre Apellido"');
    process.exit(1);
  }
  const { url } = await inviteMember({ email, name: name ?? null, role: "OWNER" });
  console.log(`Listo: ${email} es dueño de la cuenta.`);
  console.log(`Enlace para definir la contraseña (vence en 7 días):\n${url}`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("No se pudo crear el dueño:", error instanceof Error ? error.message : error);
  process.exit(1);
});
