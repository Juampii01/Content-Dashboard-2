# App Review de Meta (Instagram)

App: **Content Dashboard** (ID `1017761717318343`), Instagram app ID `4597610377228539`, portafolio de KAVAR LLC.

Sin App Review solo pueden conectar las cuentas con rol de **Instagram Tester**. Para vender a clientes sin agregarlos uno por uno hace falta pasar la revisión.

## Ya está hecho

- Permisos: solo `instagram_business_basic` e `instagram_business_manage_insights` (sin mensajes, comentarios ni publicación).
- URL de regreso de la instalación actual en *Set up Instagram business login*.
- App settings → Basic: dominio, política de privacidad (`/privacidad`), términos (`/terminos`), instrucciones de eliminación de datos (`/eliminar-datos`) y categoría *Business and pages*.
- La cuenta @juampiiacosta_ está conectada como tester: la app ya hizo llamadas reales con los dos permisos. Meta exige al menos una llamada exitosa por permiso en los últimos 30 días antes de enviar.

## Falta (lo hace el dueño de la cuenta)

1. **Ícono de la app** (1024×1024): está en `public/brand/app-icon-1024.png`. Se sube en App settings → Basic → App icon.
2. **Become a Tech Provider** (Dashboard). Meta lo pide para enviar a revisión: incluye la **verificación del negocio** de KAVAR LLC (documentos de la empresa, dominio o teléfono). Es el paso más lento; conviene arrancarlo ya.
3. **Correo de contacto en las páginas legales**: Meta pide un contacto en la política de privacidad. Si no quieres un correo personal, usa uno genérico (por ejemplo `privacidad@` de un dominio propio) en `LEGAL_CONTACT_EMAIL`.
4. Grabar el video y enviar la revisión (abajo).

## Textos para el formulario (en inglés, como los leen los revisores)

**instagram_business_basic**

> Content Studio is a private analytics dashboard that a content creator installs for their own brand. After the creator logs in with Instagram, we use instagram_business_basic to read their profile (username, profile picture, follower count) and the list of their own media (reels, carousels and posts with caption, thumbnail, permalink and publish date). This lets the creator see all their content in one table, filter it by type and date, and link each published piece to the content plan in their calendar. We only read the account that authorized the app; we never publish, comment, message or modify anything.

**instagram_business_manage_insights**

> We use instagram_business_manage_insights to read the insights of the creator's own media and account: views, reach, likes, comments, shares, saves and average watch time for reels, plus daily follower and views totals. The dashboard compares each piece against the creator's own median, shows performance over time and suggests which hooks and formats work best. Insights are shown only to the creator and their team inside their private installation, are never sold or shared with third parties, and are deleted when the creator disconnects the account or requests deletion at /eliminar-datos.

## Guion del video (2 a 3 minutos, en inglés o con subtítulos)

1. Abrir `https://<dominio>/login` y entrar al dashboard (mostrar que es una app privada con sesión).
2. Ir a **Ajustes → Redes conectadas → Instagram → Conectar**.
3. Mostrar la pantalla de Instagram con los permisos pedidos y aceptar.
4. Volver a Ajustes: "Instagram quedó conectado" y la cuenta con su foto.
5. Ir a **Métricas**: filtrar por Instagram, mostrar la tabla con visualizaciones, alcance, guardados y compartidos por pieza (uso de `instagram_business_manage_insights`).
6. Abrir una pieza y mostrar caption, miniatura y fecha (uso de `instagram_business_basic`).
7. Mostrar **Inicio** con el resumen de la semana.
8. Volver a Ajustes y mostrar **Desconectar** (el usuario controla sus datos).

Grabar con la ventana a 1280 px o más y sin datos demo cargados.
