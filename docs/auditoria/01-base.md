# Auditoría de la base · Content 2 (Etapa 1)

## 1. Verificación

| Comando | Resultado |
|---|---|
| `corepack enable` + `pnpm install` (pnpm 10.28.0) | OK. Aviso: scripts de build de esbuild ignorados (no afecta). |
| `pnpm typecheck` (`next typegen && tsc --noEmit`) | OK, 0 errores |
| `pnpm lint` | OK, 0 avisos |
| `pnpm build` **sin ninguna variable de entorno** | OK. 14 rutas; las del grupo `(app)` y `/login` salen como Partial Prerender (◐). El build no toca la base. |

No hay fallos. El problema está en el diseño, no en la compilación.

## 2. Hallazgos por severidad

### Crítico
1. **El dueño no puede entrar nunca.** `scripts/crear-dueno.ts:35` invita con `redirectTo: /login`, pero no existe una ruta `/auth/callback` ni una pantalla para definir la contraseña (`/auth` está en `PUBLIC_PATHS`, pero no tiene páginas). Además, el SMTP por defecto de Supabase solo entrega a miembros del equipo del proyecto (máx. ~2 correos/h), así que el correo al cliente falla. Tampoco hay "olvidé mi contraseña". **Solución:** se resuelve con la migración de auth (§4): invitación con token propio, una página `/invitacion/[token]` para definir la contraseña y otra `/restablecer`, con envío por Resend.

### Alto
2. **El proxy deja pasar a todos si faltan variables.** `proxy.ts:16` hace `return response` cuando falta la URL o la clave. **Solución:** devolver 503 o redirigir; nunca dejar pasar.
3. **La pertenencia al equipo solo se comprueba en `UserMenu`** (`components/shell/user-menu.tsx:9`). Ninguna página de `(app)` llama a `getCurrentUser`, y el shell estático se sirve antes del redirect. Un usuario desactivado sigue viendo las pantallas. **Solución:** una capa de acceso a datos en `lib/dal/*` donde cada función empieza con `await getCurrentUser()`. Las páginas leen datos solo desde ahí, dentro de su `<Suspense>`.
4. **Los errores de autorización se pierden.** `lib/auth.ts:40,48` lanzan `Error` con texto en español. En producción, Next oculta el mensaje de las Server Actions. **Solución:** devolver `{ ok: false, error }` tipado, o usar `forbidden()`/`unauthorized()` con `authInterrupts`.

### Medio
5. `lib/crypto.ts:33-34`: GCM acepta tags cortos. **Solución:** `createDecipheriv(..., { authTagLength: 16 })` y comprobar que el IV tenga 12 bytes y el tag 16. Agregar AAD con el contexto (`"social_accounts.access_token:INSTAGRAM"`) para que no se puedan intercambiar cifrados.
6. `lib/auth.ts:22`: sin `cache()` de React, cada componente repite `getClaims` y la consulta a la base. **Solución:** envolver con `cache()`. No usar `'use cache: private'` aquí: retrasaría hasta 5 min la baja de un usuario.
7. `next.config.ts`: faltan cabeceras de seguridad. **Solución:** `headers()` con CSP, `frame-ancestors 'none'`, `Referrer-Policy` y `Permissions-Policy`.
8. Faltan `app/(app)/loading.tsx`, `error.tsx`, `app/not-found.tsx` y `global-error.tsx` con textos en español.
9. **Se muestran las etapas internas al cliente:** "Disponible en la etapa 2" (`app/(app)/ajustes/page.tsx:35,45,51`) y "En construcción · etapa N" (`components/shell/module-preview.tsx:32`). En un producto de USD 5.000, reemplazar por "Muy pronto" o esconder el módulo con un flag.
10. **Menú en teléfono** (`components/shell/sidebar.tsx:77-91`): sin trampa de foco, sin Escape, sin devolver el foco y sin bloquear el scroll. **Solución:** usar el primitivo Dialog de Radix o React Aria.
11. `app/(auth)/login/page.tsx:33`: el fallback del `<Suspense>` es el formulario completo, así que lo que el usuario escribe se pierde cuando llega el stream. **Solución:** envolver solo el `<Notice>`.

### Bajo
12. `proxy.ts:30`: el `startsWith` también deja pasar `/login-x` y `/authors`. Comparar por segmento.
13. `lib/env.ts:28`: `Buffer.from(v,"base64")` es permisivo. **Solución:** validar con `/^[A-Za-z0-9+/]{43}=$/`. `SUPABASE_SERVICE_ROLE_KEY` y `DIRECT_URL` se exigen en runtime, pero la app no los usa (solo el script y las migraciones).
14. `components/ui/field.tsx:21-31`: falta `aria-describedby` y `aria-invalid`. `components/ui/feedback.tsx:23`: la barra de progreso no tiene nombre accesible. `components/ui/stat.tsx:32`: ▲▼ no tienen texto para lectores de pantalla ("subió/bajó").
15. **Copy:** `ajustes/page.tsx:22` dice "carga tus claves" → "guarda tus claves". En comentarios: "pantallas chicas" (`steps.tsx:9`, `sidebar.tsx:62`, `globals.css:127`) → "pequeñas"; "recién" (`lib/db/index.ts:10`); "no alcanza" (`lib/auth.ts:11`, `schema.ts:36`) → "no basta"; "Panel móvil" (`sidebar.tsx:76`). **No hay voseo ni "vídeo".**

## 3. Esquema de datos

El modelo común `content_items` más snapshots es correcto para filtrar las tres redes. Con el volumen de un solo cliente (miles de filas) no hacen falta índices exóticos. Esto es lo que falta:

| Tabla | Cambio |
|---|---|
| `social_accounts` | `platform UNIQUE` (`:58`) junto con `onDelete: restrict` (`:102`) impide reconectar otra cuenta sin reescribir el histórico. Usar `UNIQUE(platform, external_id)` más un índice único parcial `WHERE active`. Agregar `last_sync_error` y `token_refreshed_at`. |
| `content_items` | `thumbnail_url` (`:109`) apunta a CDNs que vencen (Instagram): guardar una copia en `thumbnail_asset_id`. Agregar `unavailable_since`, `last_seen_at` y `engagement_rate` como columna generada. Búsqueda: `tsvector` generado sobre `caption` y `title` (`simple` + `unaccent`) con índice GIN. Índices `(type, published_at)` y `(social_account_id, published_at)`. Mover `raw` a una tabla aparte. |
| `metric_snapshots` / `account_snapshots` | Índice por `captured_on` para comparar periodos. Agregar `watch_time_minutes` y, en la cuenta, `views` y `reach` diarios. Definir la zona horaria del día (ver `app_settings`). |
| `team_members` | Con Better Auth, `user_id` pasa a `text` con FK a `user.id`. El email debe ser único sin distinguir mayúsculas (`lower(email)`). Nueva tabla `team_invites` (email, rol, `token_hash`, `expires_at`, `accepted_at`). |
| `created_by` / `updated_by` (todas las tablas) | Hoy no tienen FK. Agregar FK a `team_members` con `set null`, lo que obliga a hacerlos nullable. |
| `brand_profile` | `CHECK (id='brand')`. `character_photos text[]` debe pasar a `assets`. Agregar `content_pillars`, `cta_defaults` y `logo_asset_id`. |
| **`subtitle_presets`** (nueva) | Varios presets por marca, con `is_default`. |
| **`assets`** (nueva) | kind (`RAW_VIDEO`, `RENDER`, `BRAND_PHOTO`, `SLIDE`, `THUMBNAIL`, `BROLL`, `AUDIO`), `storage_key`, mime, bytes, duración, ancho, alto, sha256 y `deleted_at`. |
| `scripts` | `format`, `source_type` (`IDEA`/`TOPIC`/`REFERENCE`), `source_transcript`, `target_duration_sec`. Tabla `script_versions` para el historial de "reescribir gancho", "variantes" y "acortar". |
| `calendar_entries` | Un solo `content_item_id` (`:226`) no alcanza para una pieza publicada en tres redes. Nueva tabla `calendar_targets` (entry, platform, `content_item_id`, `published_at`). Agregar FKs opcionales `carousel_id`, `video_project_id` y `clone_video_id`, más `position` e índice `(status, scheduled_for)`. |
| **`carousels`** y **`carousel_slides`** (nuevas) | Origen, estilo, `zip_asset_id`. Slides con `UNIQUE(carousel_id, position)`, texto, `image_prompt`, `image_asset_id` y versión. |
| **`video_projects`** (nueva) | `raw_asset_id`, `script_id`, aspecto, `subtitle_preset_id`, transcripción por palabra (jsonb), `edit_plan` (jsonb con `ESQUEMA_PLAN`), `output_asset_id`, `job_id`. |
| **`clone_avatars`** y **`clone_videos`** (nuevas) | `heygen_avatar_id`, `voice_id`, estado (`TRAINING`/`PENDING_CONSENT`/`READY`/`FAILED`), `consent_url`. Videos con `external_video_id`, estado y `output_asset_id`. |
| `jobs` | `entity_type` + `entity_id`, `idempotency_key UNIQUE`, `queue_job_id`, `heartbeat_at`. Índice parcial `WHERE status IN ('QUEUED','RUNNING')` para Inicio. |
| `ai_usage` | Tokens de caché, `cost_usd numeric`, `prompt_version`, `latency_ms`. |
| **`webhook_events`** (nueva) | `UNIQUE(provider, external_id)` para idempotencia (HeyGen). |
| **`app_settings`** (nueva) | Zona horaria y otras opciones globales. |

## 4. Migración a Vercel + Neon

**Dónde está acoplado a Supabase:**
1. `package.json`: `@supabase/ssr` y `@supabase/supabase-js`.
2. `lib/supabase/server.ts` (todo el archivo).
3. `lib/auth.ts:5,23-24` (`getClaims`).
4. `proxy.ts:1,14-29` (refresco de sesión y redirección).
5. `app/(auth)/actions.ts:5,19-20,29-30` (`signInWithPassword` y `signOut`).
6. `scripts/crear-dueno.ts` (admin API, service key, `listUsers`).
7. `lib/env.ts:19-23` y `.env.example:8-17` (`NEXT_PUBLIC_SUPABASE_*`, `SERVICE_ROLE_KEY`, `DIRECT_URL`).
8. `drizzle.config.ts:13` (`DIRECT_URL`).
9. `lib/db/index.ts` (comentario sobre el pooler de Supabase).
10. `lib/db/schema.ts:36,39,186` (`auth.users`, "rutas en Storage").
11. `drizzle/0001_rls.sql` (comentarios sobre la anon key; el SQL es Postgres estándar y se puede conservar).
12. `CLAUDE.md` §5 y §8, `.gitignore:19` (`supabase/.temp`).

Storage todavía no tiene código. No hay datos que migrar.

**Qué implica pasar a Neon:**
- La integración del Marketplace inyecta `DATABASE_URL` (con pooler) y `DATABASE_URL_UNPOOLED`, y Neon se factura en la cuenta de Vercel. Puede crear ramas por preview.
- Con Fluid compute, Neon recomienda TCP con pool (`pg` + `attachDatabasePool` de `@vercel/functions`). El driver HTTP no permite transacciones interactivas.
- **Costo oculto:** pg-boss consulta la base cada pocos segundos, así que el compute nunca se apaga. Con 0,25 CU × 730 h son unas 182 CU-h al mes. Eso supera las 100 CU-h del plan Free, por lo que la base se suspendería a mitad de mes. En Launch son unos USD 19 al mes por cliente. La otra opción es que el worker solo consulte la cola cuando la app lo despierta por HTTP.
- El worker y las migraciones deben usar `DATABASE_URL_UNPOOLED`, porque pg-boss usa advisory locks de sesión.
- Cada cliente necesita Vercel Pro: Hobby no permite uso comercial.

**Auth recomendada: Better Auth 1.7.x.** La última versión es la 1.7.10 (15-oct-2026), declara soporte para `next ^16` y `drizzle-orm ^0.45.2`, y se integra con Drizzle mediante `drizzleAdapter`. Se configura con email y contraseña (`disableSignUp: true`), restablecimiento e invitaciones por Resend, el plugin `nextCookies()`, rate limit guardado en la base, y sus tablas viven en la misma base.

Por qué no las otras:
- **Auth.js v5** sigue en beta (5.0.0-beta.32) y su provider Credentials no trae restablecimiento de contraseña.
- **Mantener Supabase solo para auth** obliga a manejar dos proveedores por cliente, sigue con las restricciones de SMTP y los proyectos gratuitos se pausan por inactividad, lo que dejaría al cliente sin poder entrar.

**Pasos:**
1. Agregar Neon desde Vercel → Storage → Neon.
2. En `env.ts`: quitar las variables de Supabase y agregar `DATABASE_URL_UNPOOLED`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM` y `BLOB_READ_WRITE_TOKEN`.
3. En `lib/db`: usar `drizzle-orm/node-postgres` con `Pool` y `attachDatabasePool`.
4. Crear `lib/auth/server.ts` con Better Auth, generar su esquema y correr `db:generate`.
5. Crear `app/api/auth/[...all]/route.ts` y agregarla a las rutas públicas.
6. `getCurrentUser` pasa a `auth.api.getSession({ headers })`, envuelto en `cache()`.
7. `proxy.ts` pasa a `getSessionCookie()` (filtro optimista) y falla cerrado.
8. Agregar `team_invites` y las páginas `/invitacion/[token]` y `/restablecer`.
9. Reescribir `crear-dueno`: crea el usuario y el miembro, y envía el enlace para definir la contraseña.
10. Quitar las dependencias de Supabase, `lib/supabase` y las menciones en la documentación.

**Archivos: Vercel Blob en modo privado, detrás de `lib/storage`.** Las subidas desde el navegador son directas y por partes (multipart), con hasta 5 TB por archivo. Se autorizan en `onBeforeGenerateToken`, con `allowedContentTypes` y un tamaño máximo. Los precios de referencia (iad1) son USD 0,023/GB-mes de almacenamiento y USD 0,05/GB de transferencia. Los archivos de más de 512 MB no se cachean y cada descarga del worker suma Fast Origin Transfer.

Para unos 100 GB y unos 40 GB descargados por el worker al mes, son menos de USD 10. R2 cuesta USD 0,015/GB y no cobra egress, pero agrega otro proveedor y otra cuenta por cliente. Conviene pasar a R2 solo si el volumen de video lo justifica: la interfaz `lib/storage` permite cambiarlo sin tocar los módulos.

## 5. Sistema de diseño

La base es buena: tokens en `@theme`, foco visible y respeto por `prefers-reduced-motion`. Para que se sienta premium falta:
- **Tokens semánticos** (`surface-1/2/3`, `border-subtle`, `text-strong`), una escala tipográfica y de elevación, y `tabular-nums` en las cifras. Hoy hay `rgba` y `#050d2b` escritos a mano (`globals.css:79`) y overrides con `!` (`button.tsx:15`, `sidebar.tsx:20,31`). Conviene un API de variantes (cva).
- **Fuentes con `next/font/local`** para precargarlas y tener un fallback ajustado sin saltos de layout. Hoy se cargan con `@font-face` sin preload (`globals.css:4-7`).
- **Componentes que faltan:** tabla ordenable con encabezado fijo, barra de filtros con chips, selector de rango de fechas, rango doble, Tabs o SegmentedControl, Dialog/Sheet, Dropdown, Tooltip, Toast, Combobox, Switch y Checkbox, badges de estado (trabajos y calendario), zona de subida con progreso, tarjetas de miniatura en 9:16, 4:5 y 16:9, gráficos con una paleta validada para las tres redes, y una grilla de calendario con arrastre (dnd-kit).
- **Marca por cliente:** logo e ícono configurables (hoy es un `Play` genérico), y estados vacíos, de carga y de error por módulo.

## Fuentes
- Vercel Blob, precios y límites: https://vercel.com/docs/vercel-blob/usage-and-pricing
- Vercel Blob, subidas desde el cliente: https://vercel.com/docs/vercel-blob/client-upload
- Neon en Vercel (variables y ramas): https://neon.com/faqs/postgres-nextjs-vercel-integration
- Neon, métodos de conexión en Vercel: https://neon.com/docs/guides/vercel-connection-methods
- Vercel, pool con Fluid compute: https://vercel.com/kb/guide/efficiently-manage-database-connection-pools-with-fluid-compute
- Drizzle con Neon (http y serverless): https://orm.drizzle.team/docs/connect-neon
- Precios de Neon: https://neon.com/pricing
- Precios de Cloudflare R2: https://developers.cloudflare.com/r2/pricing/
- SMTP de Supabase: https://supabase.com/docs/guides/auth/auth-smtp
- Better Auth en npm (1.7.10, peers): https://www.npmjs.com/package/better-auth
- Better Auth, adaptador de Drizzle: https://better-auth.com/docs/1.6/adapters/drizzle.md
- Auth.js en npm (v5 beta): https://www.npmjs.com/package/next-auth
- Guía local de Next 16: `node_modules/next/dist/docs/01-app/02-guides/authentication-with-cache-components.md`
