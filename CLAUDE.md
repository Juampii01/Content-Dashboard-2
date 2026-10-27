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
7. **Videos con clon:** el cliente crea su clon digital (avatar y voz) en HeyGen y genera videos con su clon a partir de un guion. **Apagado** (`FEATURES.clone = false` en `lib/features.ts`): no aparece en ninguna pantalla hasta probarlo con una cuenta real de HeyGen v3.
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
- **IA:** Claude por la API de Anthropic con la clave de API del cliente (Ajustes → Claves de servicios, `lib/ai/anthropic-key.ts`) o, si no cargó una, la del servidor (`ANTHROPIC_API_KEY`). Prompts en archivos versionados dentro de `lib/ai/prompts/`, no escritos en línea dentro de las rutas. Se registra el uso de tokens por trabajo.
- **Nada depende de una CLI en la computadora del cliente** (Claude Code, Codex, `ant`).
- **Nunca la suscripción del usuario:** los términos de Anthropic no permiten que un producto use los planes Free/Pro/Max de sus usuarios ni guardar sus tokens (code.claude.com/docs/en/legal-and-compliance). Lo mismo se aplica a la sesión de ChatGPT (Codex). Toda la IA va con claves de API del cliente: Anthropic para Claude y OpenAI para imágenes.
- **Seguridad:** toda lectura y escritura pasa por `lib/dal` o por una acción que llama a `getCurrentUser`/`requireEditor`/`requireOwner`; endpoints protegidos por sesión; webhooks con firma verificada; subidas con tipo y tamaño validados; cabeceras de seguridad (CSP, `frame-ancestors`) en `next.config.ts`; límite de intentos en inicio de sesión y recuperación.
- **Errores visibles y en español:** cada trabajo fallido muestra qué pasó y qué hacer, no un stack trace.

### Integraciones externas
- **Meta (Instagram):** Instagram API with Instagram Login, `graph.instagram.com`. Scopes solo de lectura de contenido e insights (`instagram_business_basic`, `instagram_business_manage_insights`). Sin permisos de mensajes ni comentarios. La app de Meta pasa por App Review una vez y cada deploy agrega su dominio a los redirect URIs.
- **YouTube:** Google OAuth con `youtube.readonly` y YouTube Analytics API (`yt-analytics.readonly`) para tiempo de visualización y retención.
- **TikTok:** Login Kit v2 + Display API (`user.info.basic`, `user.info.stats`, `video.list`). Refresh proactivo.
- **HeyGen:** API **v3** (la v1 y la v2 dejan de funcionar el 31-oct-2026). Cada cliente usa **su propia cuenta y su propia API key de HeyGen**, que guarda en Ajustes, cifrada. Así el clon y el consumo son del cliente y no revendemos HeyGen. Flujo: crear Digital Twin con video del cliente → consentimiento por el link oficial de HeyGen → generar videos con el guion. Estado por webhook firmado o polling.
- **Imágenes (carruseles, animaciones, miniaturas):** con la clave de API de OpenAI del cliente (`openai-api` en `lib/carousels/images/`), siempre **sin texto** (el texto lo dibuja la plantilla). La conexión con la cuenta de ChatGPT (Codex) y con la suscripción de Claude se quitaron del código por los términos de uso (27-oct-2026): no hay login por suscripción, ni puerta `/ia` en el worker, y el worker no expone puertos.
- **Plantillas desde referencia:** el cliente sube las imágenes de un carrusel (o pega su link; el worker lo baja con `gallery-dl`). El worker mide con Tesseract y k-means (`worker/carruseles/medidas.py`), la app arma un borrador determinista (`lib/carousels/style/draft.ts`) y Claude con visión lo corrige (`carruseles.estilo`). Se guarda solo el diseño (`carousel_templates.spec`, Zod en `lib/carousels/template-spec.ts`); las referencias se borran al terminar y nunca se muestran ni se mandan al generador de imágenes.

## 6. Diseño: estética Content Studio (clara)

Clara, limpia y premium: fondo gris muy claro, superficies blancas con bordes finos, texto en tinta casi negra, botón principal negro y un solo acento azul. Tiene que verse profesional, legible y fácil de entender.

### Tokens (`app/globals.css`)
```
bg            #f6f6f4    fondo de la app
card          #ffffff    superficies
white         #16171b    la tinta: text-white, bg-white/5 y border-white/10 dan texto, tintes y bordes sobre lo claro
paper         #ffffff    blanco de verdad (texto sobre botones negros, sobre video o fotos)
text          #2a2c31    texto principal
muted         #6a6e75    texto secundario
accent        #2457f5    acento (enlaces, foco, iconos activos)
line          #e7e6e2    bordes
success #1f7a4d · warning #8a5a00 · danger #c0362c
```
- **Tipografía:** Geist y Geist Mono (autoalojadas con el paquete `geist`).
- **Botones:** `.btn` negro con texto blanco; `.btn-ghost` blanco con borde fino. Chips activos en negro.
- **Oscuro:** `.theme-dark` vuelve a los tokens oscuros de antes dentro de un contenedor (hoy no se usa; queda para una vista oscura). Para texto blanco sobre fondos de color o video usa `text-paper`, nunca `text-white`.
- **Radios:** `rounded-xl` en controles, `rounded-2xl` en tarjetas y secciones.
- **Animaciones:** `step-in`, `pop-in`, `shimmer`, `ping-soft`, `float`, siempre respetando `prefers-reduced-motion`.
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
6. **Carruseles.** ✅ 6 plantillas de fábrica (incluida "Foto + texto"), plantillas propias copiadas de una referencia, imágenes sin texto por slide (API key de OpenAI del cliente), texto ajustado solo y exportación a ZIP en el navegador (`modern-screenshot` + `fflate`). Probado con gallery-dl y OpenAI simulados; falta una generación real con OpenAI, y bajar un link real de Instagram.
7. **Videos con clon** (HeyGen v3). ✅ Probado contra un simulador (`tests/mocks/heygen-mock.mjs`); falta un render real para validar tarifas.
8. **Guía de instalación por cliente.** ✅ `docs/instalacion.md`.

**B-roll a medida:** ✅ gráficos animados con la marca (6 plantillas, pantalla completa o sobre el video) que elige Claude sin inventar cifras, editables en la revisión y dibujados por el worker con Pillow (`lib/video/graphics.ts`, `worker/video/graphics.py`).

**Gráficos con IA:** ✅ Claude arma escenas v2 del motor de motion graphics (`lib/ai/prompts/motion.ts`, validación con reintento en `lib/video/motion-build.ts`) en el plan automático y en "Pide tu gráfico" de la revisión (ajustar, deshacer, límites claros); los planes con gráficos v1 siguen funcionando.

**Editar b-roll:** ✅ ubicación (completa, dividida, tarjeta, a un lado en 16:9), encuadre, look (duotono de la marca, B/N, cálido, frío, opacidad) y tiempo por toma, iguales en la vista previa y en el render (`lib/video/broll-edit.ts`, `worker/video/broll_edit.py`); gráficos a un lado en 16:9.

**Subtítulos animados y sonido:** ✅ galería de 6 estilos con la marca (Caja, Hormozi, Karaoke, Palabra a palabra, Minimal, Resaltador) iguales en la vista previa y en el render (`lib/video/caption-styles.ts`, `worker/video/ass.py`), emojis opcionales (Noto Emoji), efectos de sonido procedurales (Sin efectos / Sutil / Marcado) y música propia de la biblioteca con ducking bajo la voz (`lib/video/sfx.ts`, `render.mix_audio`).

**Director de edición con ojos:** ✅ el worker mide cada escena (caras y si mira a cámara, nitidez, luz, movimiento, texto quemado) y arma hojas de contacto; Opus mira el video, entiende la historia (mapa), lee el brief (opcional, o lo infiere), dirige toda la edición junta con su "por qué" y revisa cuadros del plan antes de renderizar y del MP4 después; "Edítalo así", versiones para probar y tope de IA por video con degradación ordenada (`lib/video/director/`, `worker/video/eyes.py`, `docs/worker.md`).

**Audio de estudio:** ✅ Apagado / Suave / Fuerte en la revisión (nuevos en Suave) con muestra de 10 s antes y después: ruido fuera con DeepFilterNet3 en ONNX (CPU, MIT/Apache), quita de eco tardío y zumbido, ecualización de voz, de-esser y compresión; la voz queda alineada con el video (`worker/video/studio.py`, `lib/video/studio-audio.ts`, `docs/worker.md`).

**Efectos de firma:** ✅ biblioteca de 17 efectos para reels (portada de revista, zoom digital, checklist, letras de vidrio, gráfico que crece, muro de titulares, giro 3D y 10 más) con un motor Canvas 2D único para la vista previa y el worker, recorte de la persona en CPU (MediaPipe Selfie en ONNX, elegido con datos), panel y galería en la revisión, frecuencia en Mi marca y el director que los elige y los acepta en "Edítalo así" (`lib/video/fx/`, `worker/video/fx.py`, `worker/video/fx_mask.py`, `docs/worker.md`).

**Mis efectos:** ✅ las animaciones que crea la IA se guardan solas al renderizar (sin duplicados, con versiones, muestra en bucle sacada del mismo render) o a mano desde el inspector; se arrastran desde la Biblioteca a otros videos con sus textos adaptados y el código validado otra vez, y el taller las reusa cuando encajan (más barato, con rotación) (`lib/video/compos/library*.ts`, `worker/video/efectos.py`).

**Sacar la música de un reel:** ✅ Biblioteca → Música: link (Instagram, TikTok, YouTube) o archivo; el worker (`AUDIO_SPLIT`, `worker/video/separar.py`) separa la voz con HT-Demucs en ONNX (Meta, MIT, CPU, sin PyTorch) y guarda la música con sus efectos, sin la voz, como una pista más (`lib/video/music-split.ts`). La voz y el archivo subido no se guardan.

**Animar todo el video:** ✅ «Animar todo» en el Estudio: Claude propone un estilo común y un pedido por momento (`lib/ai/prompts/compos.ts`, `planWholeVideo` en `lib/video/compos/flows.ts`), se revisan y se crean todos. Disposiciones: con tu cara (alterna), sobre tu cara, mitad y mitad, fondo blanco arriba y pantalla completa. Los pedidos de una tanda esperan (`compos_requests.status = waiting`) y entran de a 8 en el servidor (`promoteWaiting`). El Editor también acepta un audio solo: el worker arma un fondo liso (`ingest.video_from_audio`). Máximo 60 animaciones por video; el tope en USD por video protege el saldo de la cuenta de Anthropic del cliente.

**Video limpio y pestaña Edición:** ✅ al subir se elige «Sin editar» (por defecto) o «Editado por la IA» (`video_projects.edit_mode`). Sin editar llega tal cual, solo transcrito (`cleanPlan` en `lib/video/service.ts`), y la pestaña Edición del Estudio corre cada herramienta por separado: Recortar (`suggestTrim`), Subtitular, Añadir animaciones (todo el video o un momento), Añadir gráficos con un pedido, un asistente que convierte lo que pides en pedidos bien armados con su tramo (`lib/ai/prompts/asistente-edicion.ts`) y «Editar todo con IA» (`components/editor/studio/edit-panel.tsx`, `components/editor/edit-actions.ts`).

**Adjuntos para Claude:** ✅ en el asistente de pedidos de la pestaña Edición se adjunta un video propio (queda en la biblioteca de b-roll y se pone en el momento que se dice, con palabras, tema o minuto) o imágenes; en «Pide una animación aquí» y en la charla de una animación, imágenes de referencia de estilo (Claude las mira en el plan, el código y la revisión) o para usar dentro (se copian a las imágenes de la animación). Se guardan achicadas en `editor/<proyecto>/refs/` (`lib/video/refs.ts`, `components/editor/studio/attachments.tsx`).

**Mira este video y dime qué ves:** ✅ en la pestaña IA del Estudio: link o archivo de una edición que gusta → el worker la baja y la mide con cuadros densos (`VIDEO_LOOK`, `worker/video/look.py`, mismo análisis que la referencia de Copiar edición) → Claude la desarma en momentos y conversa: qué ve, dónde lo pondría en el video, qué va y qué no (`lib/video/look.ts`, `lib/ai/prompts/mirar.ts`, tabla `video_looks`) → «Crear lo elegido» pide una animación por momento con sus hojas de cuadros. El video de referencia nunca se guarda.

**Chat con la IA:** ✅ panel derecho del Estudio sin nada elegido (pestañas «Chat con la IA» y «Ajustes del video»): conversa sobre el video mirando la transcripción y lo que ya tiene, propone acciones con su tramo (animación, gráfico, tu video como b-roll, subtítulos, recortar) que se hacen con un toque o solas cuando la persona dice «edítalo» (`go`). Las animaciones que salen del chat no pasan por «¿Qué buscas?» ni por la pantalla de plan: cada etapa recibe la charla entera (`videoChatConversation` en `lib/video/chat-conversation.ts`, `task.conversation`) y, si ya hay una animación en ese tramo, se reemplaza (`autoReplace`); «Animar todo» desde el chat crea o rehace la pieza directo (`wholeFromChatAction`). También acepta adjuntos, mira los links de Instagram, TikTok o YouTube que se pegan (los baja con `VIDEO_LOOK` y contesta cuando terminan, `videoChatLookAction`) y guarda la charla por video (`compos_chats` con `comp_id = "video"`; `lib/ai/prompts/chat-video.ts`, `components/editor/studio/video-chat.tsx`, `api.tools` en el Estudio).

**Orden del Estudio:** ✅ pantalla dividida: a la izquierda un solo panel de herramientas (Editor IA, Edición, Subtítulos, Transcripción, Audio y música, Biblioteca) que arranca en la mitad y se arrastra (`components/editor/studio/panel-width.ts`); a la derecha el video (pantalla completa con F). Lo elegido en la línea de tiempo se abre en ese panel. «Editor IA» (`ai-tab.tsx`) es el chat, con accesos a Editar todo, Copiar edición y Lo que puso la IA; el chat manda cambios generales al director (`kind: "editar"`). Sin gancho, sin «Ajustes del video», sin ritmo y sin cambiar el formato después de subir. Partes del video a mano: dividir (C), mover antes o después (Mayús+Alt+← →) y quitar; el orden va en `plan.sequence` (`lib/video/sequence.ts`) y la IA nunca lo cambia. Línea de tiempo: arrastrar sobre lo vacío elige varios (se mueven o se quitan juntos), doble clic o clic derecho en lo vacío abre «Agregar aquí», y los roces de borde no abren carril aparte (`overlapsMuch` en `lib/video/layers.ts`). Sin revisión con IA después del render, y al corregir la IA no puede cortar más del 20 % de lo que quedaba (salvo que se pida acortar).

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
