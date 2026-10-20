# Content 2 · Sistema de contenido para marca personal

Guía del proyecto para Claude Code. Léela completa antes de tocar código. Si algo de este archivo choca con un pedido puntual, pregunta antes de seguir.

## 1. Qué es y para quién

Content 2 es un sistema de contenido para **una sola marca personal**. Lo usa una persona (o su equipo chico) para medir, planear y producir todo su contenido de Instagram, YouTube y TikTok desde un solo lugar.

- **Modelo de negocio:** Juampi y Cristian (Código MaestrIA) lo venden como **desarrollo propio** a cada cliente, por un precio de entre **USD 5.000 y 6.000**. El cliente lo recibe para su marca personal. Nada más.
- **Single-tenant.** Cada cliente tiene su propia instalación: su propio deploy, su propia base de datos, sus propias claves. No hay organizaciones, ni planes, ni registro abierto, ni billing dentro de la app. No construyas nada multi-tenant.
- **Calidad sobre velocidad.** No hay fecha de entrega para hoy. La prioridad es fundar bien las bases: arquitectura limpia, módulos bien separados, diseño cuidado. Es un producto de USD 5.000: tiene que verse y sentirse así.

### Lo que NO entra
- Conversaciones, DMs, bandeja de mensajes ni respuesta a comentarios. Solo contenido y métricas.
- Ads, ventas, ingresos, CRM, tareas genéricas.
- Multi-tenant, organizaciones, roles por organización, suscripciones.

## 2. Idioma: español neutro (obligatorio)

Toda la interfaz, los textos generados por defecto, los mensajes de error, los emails y la documentación para el cliente van en **español neutro**. Ni rioplatense ni España.

- Trato de **"tú"**: "Conecta tu cuenta", "Tienes 3 videos pendientes".
- **Prohibido el voseo:** nada de "conectá", "tenés", "podés", "vos".
- **Prohibido el español de España:** nada de "vosotros", "tenéis", "vale", "ordenador", "móvil", "coger", "vídeo" (con tilde). Se escribe **"video"**.
- Evita regionalismos de cualquier país: "computadora" en lugar de "ordenador", "teléfono" en lugar de "celular" o "móvil" cuando se pueda, "subir" en lugar de "cargar", "guardar", "listo", "en curso".
- Frases cortas, claras, sin tecnicismos para el usuario final: el cliente es un creador de contenido, no un desarrollador.
- Los comentarios de código, nombres de commits y documentación interna también en español neutro. Los identificadores de código (variables, funciones, tablas) en inglés.
- Los prompts a modelos de IA deben pedir explícitamente español neutro en las salidas (guiones, captions, textos de carruseles), salvo que el cliente configure otro idioma en su marca.

## 3. Módulos (secciones de la app)

Navegación lateral, en este orden:

1. **Inicio:** resumen de la semana: rendimiento de las tres redes, lo que está programado en el calendario y los trabajos en curso (videos renderizando, carruseles generándose).
2. **Métricas:** contenido de las tres redes con sus números.
   - Instagram (reels, carruseles, posts), YouTube (videos y shorts) y TikTok (videos).
   - Por pieza: visualizaciones, me gusta, comentarios, compartidos, guardados (si la red lo da), fecha, duración, caption y miniatura.
   - **Filtros combinables:** red, tipo de contenido, rango de fechas, rango de cualquier métrica, búsqueda por texto en el caption, orden por cualquier columna. Vista de tabla y vista de cuadrícula con miniaturas.
   - Gráficos de evolución por red y por cuenta. Comparación entre periodos.
   - El histórico **nunca se borra**: si una pieza deja de venir en la API, se marca como no disponible, no se elimina.
3. **Calendario de contenido:** vista de mes y semana con todas las piezas planeadas (guiones, carruseles, videos), su estado (idea, en guion, en producción, listo, publicado) y su red de destino. Arrastrar para reprogramar. Una pieza publicada se vincula con su métrica real.
4. **Guiones:** generador de guiones con IA a partir de una idea, un tema o un video de referencia (transcripción). Acciones sobre el guion: reescribir gancho, variantes de gancho, reforzar CTA, acortar. Usa el perfil de marca. Un guion puede mandarse al editor de video o al generador con clon.
5. **Carruseles:** creador de carruseles para Instagram (1080×1350). Parte de un tema, un guion o un carrusel de referencia. Ficha de textos editable por slide, generación de imágenes, corrección de un slide, descarga en ZIP.
6. **Editor de video:** el cliente sube su video crudo (talking head) y recibe el video editado: transcripción por palabra, corte de silencios y tomas malas, gancho al inicio, subtítulos con estilo, b-roll, mezcla de audio y exportación en 9:16 o 16:9.
7. **Videos con clon:** el cliente crea su clon digital (avatar y voz) en HeyGen y genera videos con su clon a partir de un guion.
8. **Mi marca:** perfil de marca que alimenta todos los módulos: nombre, handle, nicho, público ideal, tono, palabras prohibidas, colores, tipografía, fotos del personaje, presets de subtítulos.
9. **Ajustes:** conexión de cuentas (Instagram, YouTube, TikTok), claves de servicios del cliente (HeyGen), usuarios del equipo (pocos, todos con acceso total o de solo lectura).

## 4. Repos de origen (qué se toma de cada uno)

No se copia código a ciegas. Se toma la pieza, se revisa y se adapta a esta arquitectura.

| Repo | Qué se toma | Qué se descarta |
|---|---|---|
| `Juampii01/Content-Dashboard` | OAuth de Instagram (Instagram Login), YouTube (Google) y TikTok (Login Kit v2); cifrado de tokens (`lib/crypto.ts`, arreglando el caso de clave mal formada); clientes de API; prompts de guiones; transcripción con Groq; transcripts de YouTube | DMs, comentarios con respuesta, ads, ingresos, tareas, theming multi-marca, "view-as" de admin, `console.log` con tokens |
| `Juampii01/editor-de-video` | Base del editor: transcripción (Parakeet), plan de edición en JSON con Claude (`ia.py`, `ESQUEMA_PLAN`), render con ffmpeg y subtítulos ASS, b-roll con IA | Codex CLI, OAuth de ChatGPT, `ant`/osascript, claves en `.env` del proceso |
| `eternitydevzz/crear-videos-3-0` | Mezcla de audio sin `loudnorm` y música bajo la voz (`mezclar.sh`), comparación contra guion (`tiempos.py`), corte fino de silencios (`_cortar.py`), concepto de "estilo medido" convertido en preset JSON | Dependencia de Claude Code en el chat, rutas fijas, scripts por sistema operativo |
| `eternitydevzz/carrusel-creator-pro` | Parser y validaciones de fichas (`motor/ficha.py`), prompts y reglas (`REGLAS.md`), utilidades de Pillow, la forma de llamar a Codex CLI (`llamar_codex`) para generar imágenes con la cuenta de ChatGPT del cliente | Filesystem como base de datos, candados por PID, texto dentro de la imagen (aquí la imagen va siempre sin texto), **borrado de metadatos C2PA y GPS falso (no se porta, nunca)** |
| `eternitydevzz/creatuagencia-maestria` | Estética (sección 6) | Todo lo demás |

## 5. Arquitectura

### Stack
- **App:** Next.js (App Router) + React + TypeScript estricto + Tailwind CSS.
- **Base de datos:** **Neon** (Postgres), instalada desde el Marketplace de Vercel. **Drizzle** como ORM con `node-postgres` (`pg` + `attachDatabasePool`); migraciones en SQL dentro de `drizzle/`. Una base por cliente.
- **Auth:** **Better Auth** con correo y contraseña, sin registro abierto. Invitaciones y recuperación de contraseña por correo con **Resend**.
- **Trabajos pesados:** un **worker** aparte (contenedor Docker con Python, ffmpeg con libass, Parakeet precargado, Pillow) para video y carruseles. Nunca se procesan videos ni se generan imágenes dentro de una función serverless.
- **Cola de trabajos:** la tabla `jobs` del mismo Postgres, tomada por el worker con `FOR UPDATE SKIP LOCKED` (sin Redis ni pg-boss), con la conexión sin pooler. El worker solo consulta la cola mientras está encendido, así Neon puede suspenderse. Cada trabajo tiene estado, progreso, reintentos y errores legibles.
- **Archivos:** **Vercel Blob** (un store público para miniaturas y uno **privado** para videos, `VIDEO_BLOB_READ_WRITE_TOKEN`), detrás de la interfaz `lib/storage` (se puede cambiar a R2 sin tocar los módulos). Subidas directas desde el navegador, nunca a través de la app.
- **Deploy:** app en **Vercel Pro** (Hobby no admite uso comercial y solo permite un cron diario), worker en **Fly Machines**. Cada cliente es un deploy independiente creado a partir de este repo; las cuentas son del cliente y nosotros las habilitamos.
- **Cron:** Vercel Cron, protegido con `CRON_SECRET`.

### Estructura de carpetas
```
app/                  # Next.js: rutas y páginas por módulo
  (app)/inicio, metricas, calendario, guiones, carruseles, editor, clon, marca, ajustes
  api/                # endpoints: OAuth, sync, creación de trabajos, webhooks
components/
  ui/                 # sistema de diseño (botones, campos, tarjetas, tablas, filtros)
  <modulo>/           # componentes propios de cada módulo
lib/
  social/             # instagram/, youtube/, tiktok/: cliente, auth, sync, mapeo a modelo común
  ai/                 # llamadas a Claude y prompts versionados
  jobs/               # encolar trabajos y leer su estado
  heygen/             # cliente de la API v3 de HeyGen
  db/                 # schema.ts (Drizzle) e index.ts (getDb)
  dal/                # funciones de datos por módulo; cada una empieza con getCurrentUser()
  auth/               # index.ts (getCurrentUser, requireEditor, requireOwner), server.ts (Better Auth), invitations.ts
  email.ts            # correos con Resend
  rate-limit.ts       # límite de intentos guardado en la base
  crypto.ts, env.ts   # cifrado de tokens y validación de variables de entorno con Zod
drizzle/              # migraciones SQL generadas (pnpm db:generate)
worker/               # servicio Python: video/, carruseles/, comunes/
docs/                 # decisiones y guías de instalación por cliente
```

### Reglas de arquitectura
- **Un módulo, una carpeta.** Un módulo no importa componentes internos de otro; comparten solo lo que está en `lib/` y `components/ui/`.
- **Modelo común de contenido.** Las tres redes se normalizan a una sola tabla de piezas (`ContentItem`) con su red, tipo y métricas, más una tabla de snapshots de métricas por fecha para ver la evolución. Los filtros trabajan sobre ese modelo, no sobre tablas por red.
- **Tokens:** `getValidToken(platform)` centralizado que refresca antes de vencer. El cron sincroniza métricas y refresca tokens (el de Instagram vence a los 60 días). Tokens siempre cifrados con AES-256-GCM y un contexto (AAD) por tipo de secreto (`encryptSecret(valor, "instagram.access")`); si falta o está mal la clave, la app falla al arrancar, nunca guarda texto plano.
- **Variables de entorno** validadas con Zod al iniciar. Nunca se imprimen tokens ni claves en logs.
- **IA:** Claude por la API de Anthropic con la clave del servidor. Prompts en archivos versionados dentro de `lib/ai/prompts/`, no escritos en línea dentro de las rutas. Se registra el uso de tokens por trabajo.
- **Nada depende de una CLI en la computadora del cliente** (Claude Code, Codex, `ant`). La única CLI es Codex dentro del worker, para las imágenes de carruseles con la cuenta de ChatGPT del propio cliente (ver Integraciones).
- **Seguridad:** toda lectura y escritura pasa por `lib/dal` o por una acción que llama a `getCurrentUser`/`requireEditor`/`requireOwner`; endpoints protegidos por sesión; webhooks con firma verificada; subidas con tipo y tamaño validados; cabeceras de seguridad (CSP, `frame-ancestors`) en `next.config.ts`; límite de intentos en inicio de sesión y recuperación.
- **Errores visibles y en español:** cada trabajo fallido muestra qué pasó y qué hacer, no un stack trace.

### Integraciones externas
- **Meta (Instagram):** Instagram API with Instagram Login, `graph.instagram.com`. Scopes solo de lectura de contenido e insights (`instagram_business_basic`, `instagram_business_manage_insights`). Sin permisos de mensajes ni comentarios. La app de Meta pasa por App Review una vez y cada deploy agrega su dominio a los redirect URIs.
- **YouTube:** Google OAuth con `youtube.readonly` y YouTube Analytics API (`yt-analytics.readonly`) para tiempo de visualización y retención.
- **TikTok:** Login Kit v2 + Display API (`user.info.basic`, `user.info.stats`, `video.list`). Refresh proactivo.
- **HeyGen:** API **v3** (la v1 y la v2 dejan de funcionar el 31-oct-2026). Cada cliente usa **su propia cuenta y su propia API key de HeyGen**, que guarda en Ajustes, cifrada. Así el clon y el consumo son del cliente y no revendemos HeyGen. Flujo: crear Digital Twin con video del cliente → consentimiento por el link oficial de HeyGen → generar videos con el guion. Estado por webhook firmado o polling.
- **Imágenes para carruseles:** las imágenes de carruseles usan la cuenta de ChatGPT del propio cliente vía Codex CLI en el worker, o su API key de OpenAI como respaldo. Siempre **sin texto** (el texto lo dibuja la plantilla). `ImageProvider` en `lib/carousels/images/` (`chatgpt` por defecto, `openai-api` de respaldo). El cliente conecta su ChatGPT en Ajustes con el login por código de dispositivo de Codex (trabajo `CODEX_LOGIN`; alternativa: pegar su `~/.codex/auth.json`); el `auth.json` se guarda cifrado (`chatgpt.auth`) y el worker lo escribe en un `CODEX_HOME` temporal por trabajo (600), vuelve a guardarlo si Codex refrescó los tokens y lo borra al terminar. Así el consumo es del plan del cliente y no revendemos imágenes.
- **Plantillas desde referencia:** el cliente sube las imágenes de un carrusel (o pega su link; el worker lo baja con `gallery-dl`). El worker mide con Tesseract y k-means (`worker/carruseles/medidas.py`), la app arma un borrador determinista (`lib/carousels/style/draft.ts`) y Claude con visión lo corrige (`carruseles.estilo`). Se guarda solo el diseño (`carousel_templates.spec`, Zod en `lib/carousels/template-spec.ts`); las referencias se borran al terminar y nunca se muestran ni se mandan al generador de imágenes.

## 6. Diseño: estética MaestrIA

Misma estética que **Crea tu Agencia** (`eternitydevzz/creatuagencia-maestria`): oscura, minimalista, superficies planas, bordes finos, un solo acento azul y casi sin brillos. Tiene que verse premium, legible y fácil de entender.

### Tokens
```
bg            #030a22    fondo de la app
bg-deep       #02061a    fondo profundo, barras de scroll
card          #07163f    superficies sólidas
accent        #0070f8    acento principal (botones, activo)
accent-hi     #4da3ff    acento claro (foco, iconos, progreso)
accent-glow   #8cc6ff    eyebrows y detalles
text          #dce7f7    texto principal
muted         #a7b9d4    texto secundario
line          rgba(91,156,225,.32)
line-strong   rgba(91,156,225,.8)
placeholder   #6f84a8
```
- **Tipografía:** Inter (texto y títulos, títulos en blanco con `letter-spacing: -.02em`) y JetBrains Mono (eyebrows, números de pasos, cifras técnicas). Fuentes autoalojadas, igual que en Crea tu Agencia.
- **Fondo:** degradado radial azul suave arriba (`rgba(0,112,248,.16)`) más una grilla de 48 px casi invisible.
- **Componentes base** (portar desde `src/index.css` de Crea tu Agencia): `.card`, `.card-lift`, `.hero-panel`, `.tile-hero`, `.tile-icon`, `.section-shell`, `.btn` (degradado `#2b92ff → #0070f8`), `.btn-ghost`, `.field`, `.eyebrow`, `.pill`, `.skeleton`, `.bar-shine`, `.stagger`, `.range`, y la ruta de pasos (`.step-list`, `.step`, `.step-node`) para los flujos de varios pasos (crear clon, editar video, crear carrusel).
- **Radios:** `rounded-xl` en controles, `rounded-2xl` en tarjetas y secciones.
- **Animaciones:** solo las de Crea tu Agencia (`step-in`, `pop-in`, `shimmer`, `ping-soft`, `float`) y siempre respetando `prefers-reduced-motion`.
- Iconos de `lucide-react`.

### Reglas de UX
- Cada pantalla responde una pregunta clara. Un título, una frase que explica para qué sirve, y la acción principal visible.
- Los flujos largos van en pasos numerados con la ruta de pasos, nunca en un formulario gigante.
- Todo trabajo lento muestra progreso real y se puede dejar corriendo: el usuario puede salir y volver.
- Estados vacíos útiles: qué falta y el botón para hacerlo ("Conecta Instagram para ver tus métricas").
- Números grandes y legibles en métricas; cifras con separador de miles; fechas en formato "12 oct 2026".
- Funciona bien desde 1280 px hacia arriba y se puede usar en tablet. Las métricas y el calendario deben verse bien en el teléfono.
- Accesibilidad: contraste suficiente, foco visible (`#4da3ff`), botones con texto o `aria-label`.

## 7. Orden de construcción

1. **Bases:** repo, Next.js, Tailwind con los tokens, sistema de diseño en `components/ui`, layout con navegación, auth (Better Auth + invitaciones + equipo en Ajustes), Drizzle + Neon, validación de entorno, cifrado, cabeceras de seguridad. ✅ Lista.
2. **Conexiones y Métricas:** OAuth de las tres redes, sync, modelo común, cron, pantalla de métricas con filtros. ✅ Código listo y probado con redes simuladas y datos demo; falta probar con las apps reales de Meta, Google y TikTok.
3. **Mi marca** y **Guiones.** ✅ Con prueba de voz, ganchos con puntaje, acciones de IA, versiones y modo grabación.
4. **Calendario.** ✅ Mes, semana y agenda, arrastre, plan semanal con IA y vínculo automático con métricas (`lib/calendar/`).
5. **Worker y cola** + **Editor de video.** ✅ Código y pruebas locales completas (`worker/`, `lib/video/`, `lib/jobs/`). La cola es la tabla `jobs` con `FOR UPDATE SKIP LOCKED` (sin pg-boss). Transcripción open source en el worker (Parakeet, faster-whisper de respaldo; Deepgram/Groq opcionales), estilos copiados de un video de referencia ("Edita como este", con yt-dlp, OpenCV y Tesseract) y b-roll en video (Pexels + biblioteca del cliente). Falta desplegar el worker en Fly (`docs/worker.md`), construir la imagen y probar con modelos, Blob, Pexels y links reales.
6. **Carruseles.** ✅ 6 plantillas de fábrica (incluida "Foto + texto"), plantillas propias copiadas de una referencia, imágenes sin texto por slide (ChatGPT del cliente vía Codex en el worker u OpenAI API), texto ajustado solo y exportación a ZIP en el navegador (`modern-screenshot` + `fflate`). Probado con Codex, gallery-dl y OpenAI simulados; falta una generación real con ChatGPT y OpenAI, y bajar un link real de Instagram.
7. **Videos con clon** (HeyGen v3). ✅ Probado contra un simulador (`tests/mocks/heygen-mock.mjs`); falta un render real para validar tarifas.
8. **Guía de instalación por cliente.** ✅ `docs/instalacion.md`.

**Extras ya construidos:** "¿Por qué funcionó?" por pieza, ranking de ganchos (alimenta los prompts), meta de seguidores con proyección y constancia en Inicio, resumen semanal con IA (también por correo), páginas legales públicas (`/privacidad`, `/terminos`, `/eliminar-datos`).

El diseño detallado de cada herramienta está en `docs/plan-lanzamiento.md` y `docs/auditoria/`. Léelo antes de construir un módulo.

Cada etapa se cierra con: build sin errores, tipos sin errores, revisión visual de las pantallas nuevas y textos revisados en español neutro.

## 8. Notas técnicas de la base

- **Next.js 16** con Cache Components y Partial Prefetching activados. Antes de escribir código de Next, lee la guía que corresponde en `node_modules/next/dist/docs/` (ver `AGENTS.md`): cambian APIs respecto de versiones anteriores.
- El middleware se llama **`proxy.ts`**: manda al login a quien no tiene cookie de sesión (sin consultar la base) y falla cerrado. Es un filtro rápido; la autorización real se comprueba cerca de los datos con `lib/auth`.
- Todo lo que lee la sesión (`getCurrentUser`) va detrás de un `<Suspense>`; con Cache Components, leer cookies fuera de un `<Suspense>` es un error de build.
- **Acceso:** solo entra quien tiene fila activa en `team_members`. No hay registro abierto. El primer dueño de cada instalación se crea con `pnpm crear-dueno correo@cliente.com "Nombre"` (manda la invitación y muestra el enlace). El resto del equipo se invita desde Ajustes.
- **Contraseñas:** las invitaciones (7 días) y la recuperación (1 hora) usan el mismo token de Better Auth y terminan en `/definir-contrasena`. Mínimo 10 caracteres. Al cambiarla se cierran todas las sesiones.
- No hay RLS: no existe una API pública de la base. La única puerta es la app.
- `getDb()` crea la conexión en el primer uso; el build no necesita base de datos.
- Scripts: `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm db:generate`, `pnpm db:migrate`, `pnpm crear-dueno`, `pnpm test:sync` y `pnpm test:calendar` (con `TEST_DATABASE_URL`), `pnpm test:video`, `pnpm demo cargar|borrar` (datos de demostración para ventas; el cron no los toca).
- **Deploy de producción:** `vercel-build` corre `scripts/preparar.ts` (migraciones + dueño con `OWNER_EMAIL`) antes de `next build`. En preview no toca la base.
- **Formato:** todo número y fecha pasa por `lib/format.ts` (es-419: 12,345 · 12.4 mil · 12 oct 2026). Los días se cuentan en `APP_TIMEZONE`. `crear-dueno` corre con `--conditions=react-server` para poder importar módulos `server-only`.

## 9. Reglas de trabajo

- Antes de un cambio grande, propone el plan y espera aprobación.
- Commits pequeños y descriptivos en español. Nada de secretos en el repo: `.env*` y `.claude/settings.local.json` van en `.gitignore`.
- No se borran datos de métricas ni archivos del cliente sin confirmación.
- No se agregan dependencias sin una razón clara.
- Si una función de una red no existe en su API, se dice; no se inventa ni se rellena con datos falsos.
