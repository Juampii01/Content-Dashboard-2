# Apps de Meta, Google y TikTok

Una sola app por red, a nombre de KAVAR LLC, sirve para todas las instalaciones. Cada instalación nueva solo agrega su URL de regreso (redirect URI) en las tres consolas.

**URLs de regreso de la instalación actual** (cambian por cliente: `https://<dominio>/api/social/<red>/callback`):

```
https://content-dashboard-2-three.vercel.app/api/social/instagram/callback
https://content-dashboard-2-three.vercel.app/api/social/youtube/callback
https://content-dashboard-2-three.vercel.app/api/social/tiktok/callback
```

Las claves van en Vercel → proyecto → Settings → Environment Variables, entorno **Production**. Los secretos van como tipo **Secret**. Después de guardarlas hay que hacer **Redeploy**.

## 1. Instagram (Meta)

1. En developers.facebook.com → **My Apps → Create App**. Caso de uso: el de administrar contenido y mensajes de Instagram. Tipo: **Business**, ligada al portafolio comercial de KAVAR LLC.
2. En la app → **Instagram → API setup with Instagram login**.
3. En **Set up Instagram business login → Business login settings**, agregar la URL de regreso de Instagram en **OAuth redirect URIs**.
4. Copiar el **Instagram app ID** y el **Instagram app secret** de esa misma pantalla. No sirven los de la app de Facebook.
5. Permisos: solo `instagram_business_basic` e `instagram_business_manage_insights`. No pedir mensajes, comentarios ni publicación.
6. Mientras no pase App Review: **App roles → Roles → Instagram Testers**, agregar la cuenta de Instagram del cliente. El cliente acepta en Instagram → Configuración → Apps y sitios web → Invitaciones de tester.
7. App Review (para cuentas sin rol): pasos, textos y guion del video en `docs/meta-app-review.md`.

Variables: `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` (Secret).

> La cuenta de Instagram tiene que ser **profesional** (creador o empresa). La app avisa si es personal.

## 2. YouTube (Google)

1. En console.cloud.google.com → **proyecto nuevo** ("Content Studio").
2. **APIs & Services → Library**: habilitar **YouTube Data API v3** y **YouTube Analytics API**.
3. **OAuth consent screen** (Google Auth Platform):
   - Tipo **External**, con nombre de la app, correo de soporte y dominio.
   - Scopes: `.../auth/youtube.readonly` y `.../auth/yt-analytics.readonly`.
4. **Audience → Publish app → In production**. No dejarla en *Testing*: ahí los permisos vencen a los 7 días y hay que reconectar cada semana. En producción sin verificar aparece una pantalla de advertencia ("Google no verificó esta app"), hay un tope de 100 usuarios y se puede seguir con **Avanzado → Ir a…**. Pedir la verificación en paralelo.
5. **Credentials → Create credentials → OAuth client ID → Web application** y agregar en **Authorized redirect URIs** la URL de regreso de YouTube.
6. Copiar **Client ID** y **Client secret**.

Variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (Secret).

## 3. TikTok

1. En developers.tiktok.com → **Manage apps → Connect an app** (organización KAVAR LLC).
2. Datos de la app: nombre, ícono, categoría, descripción, y URLs de **términos** y **política de privacidad**.
3. Agregar productos **Login Kit** (plataforma **Web**) y **Display API**.
4. Scopes: `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`.
5. En Login Kit → **Redirect URI**: agregar la URL de regreso de TikTok (tiene que ser https).
6. Mientras no esté aprobada: crear un **Sandbox** y agregar la cuenta de TikTok del cliente en **Target users** (hasta 10 por sandbox). El cliente tiene que iniciar sesión para aceptarlo.
7. Copiar **Client key** y **Client secret** (los del sandbox mientras se prueba; los de producción después de la revisión).

Variables: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` (Secret).

> TikTok solo da visualizaciones, me gusta, comentarios y compartidos por video. No da guardados, alcance ni retención. Hay que decirlo en la venta.

## Cómo probar

1. Redeploy en Vercel con las variables nuevas.
2. Ajustes → Redes conectadas → **Conectar** en cada red.
3. Se vuelve a Ajustes con "quedó conectado". El histórico se importa solo en unos minutos y Métricas se llena.
4. Si algo falla, la pantalla dice el motivo. El detalle técnico queda en Vercel → Logs (buscar `[oauth]` o `[sync]`).

## Páginas públicas para App Review

Ya existen y no piden sesión:

- Política de privacidad: `https://<dominio>/privacidad`
- Términos: `https://<dominio>/terminos`
- Eliminación de datos (Meta → *Data deletion instructions URL*): `https://<dominio>/eliminar-datos`

Antes de enviar a revisión, configura en Vercel `LEGAL_COMPANY_NAME` (por defecto "KAVAR LLC") y **`LEGAL_CONTACT_EMAIL`** (sin correo, las páginas dicen "el contacto indicado en tu contrato", y Meta y Google piden un correo). El texto es un borrador razonable, no asesoría legal: conviene que lo revise un abogado.
