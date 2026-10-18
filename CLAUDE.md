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
| `eternitydevzz/carrusel-creator-pro` | Parser y validaciones de fichas (`motor/ficha.py`), prompts y reglas (`REGLAS.md`), utilidades de Pillow, scraping de referencias con ScrapeCreators | Codex CLI y sesión de ChatGPT (se reemplaza por API de imágenes), filesystem como base de datos, candados por PID, **borrado de metadatos C2PA y GPS falso (no se porta, nunca)** |
| `eternitydevzz/creatuagencia-maestria` | Estética (sección 6) | Todo lo demás |

## 5. Arquitectura

### Stack
- **App:** Next.js (App Router) + React + TypeScript estricto + Tailwind CSS.
- **Base de datos y auth:** Supabase (Postgres + Auth + Storage). Prisma como ORM. Una base por cliente.
- **Trabajos pesados:** un **worker** aparte (contenedor Docker con Python, ffmpeg con libass, Parakeet precargado, Pillow) para video y carruseles. Nunca se procesan videos ni se generan imágenes dentro de una función serverless.
- **Cola de trabajos:** pg-boss sobre el mismo Postgres de Supabase (sin Redis extra). Cada trabajo tiene estado, progreso, reintentos y errores legibles.
- **Archivos:** Supabase Storage (o R2 si el volumen lo pide) con URLs firmadas. Subidas directas desde el navegador, nunca a través de la app.
- **Deploy:** app en Vercel, worker en un servicio de contenedores (Fly.io, Render o Railway). Cada cliente es un deploy independiente creado a partir de este repo.

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
  crypto.ts, env.ts   # cifrado de tokens y validación de variables de entorno con Zod
prisma/
worker/               # servicio Python: video/, carruseles/, comunes/
docs/                 # decisiones y guías de instalación por cliente
```

### Reglas de arquitectura
- **Un módulo, una carpeta.** Un módulo no importa componentes internos de otro; comparten solo lo que está en `lib/` y `components/ui/`.
- **Modelo común de contenido.** Las tres redes se normalizan a una sola tabla de piezas (`ContentItem`) con su red, tipo y métricas, más una tabla de snapshots de métricas por fecha para ver la evolución. Los filtros trabajan sobre ese modelo, no sobre tablas por red.
- **Tokens:** `getValidToken(platform)` centralizado que refresca antes de vencer. Un cron diario sincroniza métricas y refresca tokens (el de Instagram vence a los 60 días). Tokens siempre cifrados con AES-256-GCM; si falta o está mal la clave, la app falla al arrancar, nunca guarda texto plano.
- **Variables de entorno** validadas con Zod al iniciar. Nunca se imprimen tokens ni claves en logs.
- **IA:** Claude por la API de Anthropic con la clave del servidor. Prompts en archivos versionados dentro de `lib/ai/prompts/`, no escritos en línea dentro de las rutas. Se registra el uso de tokens por trabajo.
- **Nada depende de una CLI local** (Claude Code, Codex, `ant`). Todo corre por API.
- **Seguridad:** RLS activado en todas las tablas aunque sea single-tenant; endpoints protegidos por sesión; webhooks con firma verificada; subidas con tipo y tamaño validados.
- **Errores visibles y en español:** cada trabajo fallido muestra qué pasó y qué hacer, no un stack trace.

### Integraciones externas
- **Meta (Instagram):** Instagram API with Instagram Login, `graph.instagram.com`. Scopes solo de lectura de contenido e insights (`instagram_business_basic`, `instagram_business_manage_insights`). Sin permisos de mensajes ni comentarios. La app de Meta pasa por App Review una vez y cada deploy agrega su dominio a los redirect URIs.
- **YouTube:** Google OAuth con `youtube.readonly` y YouTube Analytics API (`yt-analytics.readonly`) para tiempo de visualización y retención.
- **TikTok:** Login Kit v2 + Display API (`user.info.basic`, `user.info.stats`, `video.list`). Refresh proactivo.
- **HeyGen:** API **v3** (la v2 se retira el 1-nov-2026). Cada cliente usa **su propia cuenta y su propia API key de HeyGen**, que carga en Ajustes y se guarda cifrada. Así el clon y el consumo son del cliente y no revendemos HeyGen. Flujo: crear Digital Twin con video del cliente → consentimiento por el link oficial de HeyGen → generar videos con el guion. Estado por webhook firmado o polling.
- **Imágenes para carruseles:** proveedor por API (a definir tras una prueba de calidad contra el motor actual). Encapsulado detrás de una interfaz para poder cambiarlo.

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

1. **Bases:** repo, Next.js, Tailwind con los tokens, sistema de diseño en `components/ui`, layout con navegación, auth, Prisma + Supabase, validación de entorno, cifrado.
2. **Conexiones y Métricas:** OAuth de las tres redes, sync, modelo común, cron, pantalla de métricas con filtros.
3. **Mi marca** y **Guiones.**
4. **Calendario.**
5. **Worker y cola** + **Editor de video.**
6. **Carruseles** (después de la prueba de calidad del proveedor de imágenes).
7. **Videos con clon** (HeyGen v3).
8. **Guía de instalación por cliente** en `docs/`: crear Supabase, deploy, variables, agregar redirect URIs, conectar redes.

Cada etapa se cierra con: build sin errores, tipos sin errores, revisión visual de las pantallas nuevas y textos revisados en español neutro.

## 8. Reglas de trabajo

- Antes de un cambio grande, propone el plan y espera aprobación.
- Commits chicos y descriptivos en español. Nada de secretos en el repo: `.env*`, `supabase/.temp` y `.claude/settings.local.json` van en `.gitignore`.
- No se borran datos de métricas ni archivos del cliente sin confirmación.
- No se agregan dependencias sin una razón clara.
- Si una función de una red no existe en su API, se dice; no se inventa ni se rellena con datos falsos.
