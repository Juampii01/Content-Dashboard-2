# Instalación por cliente

Cada cliente tiene su propia instalación: un proyecto de Vercel, una base Neon, un almacenamiento Blob y sus propias claves. Las cuentas son del cliente (él paga Vercel, Neon e IA) y nosotros las habilitamos. Calcula unos **45 a 90 minutos** la primera vez.

> Regla de oro: **nunca** pegues claves en chats, documentos ni commits. Van solo en Vercel → Settings → Environment Variables, como tipo **Secret**.

## 0. Antes de empezar

Pide al cliente:

1. Una cuenta de **Vercel** en plan **Pro** (Hobby no permite uso comercial y solo deja un cron por día). Que te invite como miembro del equipo.
2. El **dominio** donde va a vivir (por ejemplo `studio.sumarca.com`) o acepta el de Vercel.
3. El **correo del dueño** (quien va a entrar primero).
4. La **zona horaria** de la marca (por ejemplo `America/Mexico_City`, `America/Bogota`, `America/Argentina/Buenos_Aires`).
5. Si va a usar videos con clon: su cuenta de **HeyGen** con saldo de **API** (va aparte del plan web; ver §7).

## 1. Proyecto en Vercel

1. Vercel → **Add New → Project** → importa `Juampii01/Content-Dashboard-2` (o un fork para el cliente).
2. Framework: Next.js. No cambies el comando de build: el proyecto usa `vercel-build` (migra la base y crea al dueño antes de compilar).
3. No hagas el primer deploy todavía: primero la base y las variables.

## 2. Base de datos (Neon) y archivos (Blob)

1. En el proyecto: **Storage → Create Database → Neon** (plan Launch o superior para producción). La integración crea sola `DATABASE_URL` y `DATABASE_URL_UNPOOLED`.
2. **Storage → Create → Blob**, acceso **público**, prefijo por defecto. Crea `BLOB_READ_WRITE_TOKEN` (solo miniaturas).
3. **Storage → Create → Blob** otra vez, acceso **privado**, y al conectarlo elige el prefijo **`VIDEO_BLOB`**. Crea `VIDEO_BLOB_READ_WRITE_TOKEN` (videos del Editor y del Clon). En Vercel Blob el acceso es del store, por eso son dos.

## 3. Variables de entorno

En **Settings → Environment Variables**, entorno **Production** (los secretos como **Secret**). Genera los secretos en tu computadora, nunca en una web:

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY
openssl rand -hex 32      # CRON_SECRET
```

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://<dominio del cliente>` (sin barra al final) |
| `NEXT_PUBLIC_APP_NAME` | Nombre que ve el cliente (por ejemplo, su marca + "Studio") |
| `APP_TIMEZONE` | Zona horaria de la marca |
| `BETTER_AUTH_SECRET` | generado |
| `TOKEN_ENCRYPTION_KEY` | generado. **Guárdalo en el gestor de contraseñas**: si se pierde, hay que reconectar todas las redes |
| `CRON_SECRET` | generado |
| `OWNER_EMAIL`, `OWNER_NAME` | correo y nombre del dueño |
| `ANTHROPIC_API_KEY` | clave de IA (guiones, carruseles, análisis, resúmenes) |
| `RESEND_API_KEY`, `EMAIL_FROM` | correo (invitaciones, recuperación, resumen semanal). `EMAIL_FROM` con un dominio verificado en Resend |
| `LEGAL_COMPANY_NAME`, `LEGAL_CONTACT_EMAIL` | datos de las páginas de privacidad y términos |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | de la app de Meta (ver `docs/apps-redes.md`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | de Google Cloud |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | de TikTok for Developers |

Las variables del editor de video (worker) están en `docs/worker.md`.

## 4. Primer deploy y dueño

1. **Deploy**. En el log del build tiene que aparecer `[preparar] Migraciones al día.` y `[preparar] Dueño creado`.
2. Con Resend configurado, el dueño recibe el correo de invitación. Sin Resend, el enlace para definir la contraseña queda en el log del build (vence en 7 días): pásaselo por un canal privado.
3. El dueño entra, define su contraseña e invita al resto del equipo desde **Ajustes → Equipo**.

## 5. Dominio

**Settings → Domains** → agrega el dominio del cliente y sigue las instrucciones de DNS. Cuando esté activo, actualiza `NEXT_PUBLIC_APP_URL` y haz **Redeploy**.

## 6. Redes sociales

1. En las consolas de Meta, Google y TikTok agrega las tres URLs de regreso de esta instalación:
   ```
   https://<dominio>/api/social/instagram/callback
   https://<dominio>/api/social/youtube/callback
   https://<dominio>/api/social/tiktok/callback
   ```
2. Mientras las apps no pasen la revisión, agrega las cuentas del cliente como **testers** (detalle en `docs/apps-redes.md`).
3. El dueño entra a **Ajustes → Redes conectadas → Conectar** en cada red. El histórico se importa solo en unos minutos.

## 7. Videos con clon (HeyGen)

- El cliente usa **su propia cuenta de HeyGen**. La API se paga aparte del plan web (recarga mínima de USD 5 en el panel de API de HeyGen).
- El dueño pega su clave en **Ajustes → Claves de servicios**. La app la valida, muestra el saldo y registra sola el webhook.
- El clon se crea en la web de HeyGen (ahí se graba el consentimiento) y después se elige en la app.

## 8. Editor de video (worker)

El editor necesita el servicio de procesamiento en Fly.io. Pasos y costos en `docs/worker.md`. Sin worker, el resto de la app funciona y el editor muestra un aviso.

## 9. Verificación final

- [ ] Entrar con el dueño, cambiar el nombre de la marca en **Mi marca** y guardar.
- [ ] **Mi marca → Prueba de voz** devuelve un guion (confirma la clave de IA).
- [ ] Conectar al menos una red y ver piezas en **Métricas** a los pocos minutos.
- [ ] Vercel → **Cron Jobs** muestra `/api/cron/sync` cada hora y la última ejecución en 200.
- [ ] Abrir `https://<dominio>/privacidad` sin sesión.
- [ ] Crear un guion, mandarlo al calendario y exportar un carrusel.
- [ ] Si usa clon: guardar la clave de HeyGen y ver el saldo.

## 10. Demo para ventas

En una instalación sin redes reales, **Ajustes → Datos de demostración → Cargar** llena 6 meses de métricas, el calendario y dos carruseles. Se borra con un clic y nunca se mezcla con cuentas reales: si ya hay una red conectada, la demo no se carga, y al conectar una red se borran los datos demo de esa red.

## Costos mensuales de referencia (por cliente)

| Servicio | Aproximado |
|---|---|
| Vercel Pro | USD 20 |
| Neon (Launch) | USD 19 |
| Vercel Blob | menos de USD 10 |
| IA (Anthropic) | USD 5 a 20 según uso |
| Fly.io (worker del editor, se apaga solo) | unos USD 2 a 10 |
| HeyGen | lo paga el cliente por uso, en su cuenta |

Un pago único no cubre estos costos: definan con el cliente un mantenimiento mensual o que la infraestructura quede a su nombre.
