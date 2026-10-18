# Conexiones + Métricas + Inicio: diseño definitivo

## 1. Auditoría del repo viejo (`juampii01/content-dashboard`)

**No hay cron.** `vercel.json` tiene `"crons": []`. Todo se sincroniza solo cuando el usuario toca el botón (`hooks/use*Data.ts`). Tampoco hay historial por pieza: solo existe el valor actual.

| Archivo:línea | Problema | Decisión |
|---|---|---|
| `app/api/social/[platform]/connect/route.ts:59-65` | Pide scopes de mensajes, comentarios y publicación: más fricción en App Review | Corregir: solo `instagram_business_basic,instagram_business_manage_insights` |
| `callback/route.ts:60-62,102` | `user_id` de IG llega como número JSON (~1.78e16 > 2^53): **pierde precisión** y el `accountId` queda mal | Corregir: tomar `user_id` como string desde `/me` |
| `callback/route.ts:133` | Los scopes salen del intercambio long-lived, que no los trae: siempre `''` | Corregir: usar `permissions` del token corto y detectar insights negados |
| `callback/route.ts:283-298` | TikTok: solo mira `res.ok`; los errores vienen en el body (`error`, `log_id`). No guarda `refresh_expires_in` | Corregir |
| `app/api/instagram/sync/route.ts:184,292` | Corta en 500 piezas y después **`deleteMany` borra todo lo que no vino**: las cuentas con más de 500 publicaciones pierden histórico en cada sync | Reescribir |
| `instagram/sync:240-245` | Lanza ~500 llamadas de insights en paralelo sin límite (rate limit). Guarda solo `views` y **descarta reach, saved y shares** | Reescribir |
| `instagram/sync:132` | No pide `media_product_type` (no distingue reel de video de feed). Guarda URLs del CDN que vencen | Reescribir |
| `instagram/sync:110-122` | El refresh del token solo corre en el sync manual, no respeta la regla de 24 h y falla en silencio | Reescribir dentro de `getValidToken` |
| `lib/instagram/client.ts:70` | Carruseles e imágenes: solo `views,reach`, aunque FEED también da `saved,shares,likes,comments,total_interactions` | Corregir |
| `app/api/youtube/sync/route.ts:22` | `MAX_VIDEOS=25`, sin paginar, sin Analytics, sin detección de Shorts | Reescribir |
| `app/api/tiktok/sync/route.ts:18-19,64-66,82` | Máximo 60 videos. Refresca solo cuando el token ya venció. Si falla el descifrado, manda el **ciphertext** como refresh token | Reescribir |
| `tiktok/sync:215,284` | Guarda `cover_image_url` (vence en 6 h); la tasa de interacción divide todo el histórico por los seguidores | Reescribir |

**Se porta adaptado:** CSRF con estado en base, intercambio de IG en dos pasos, `lib/youtube/auth.ts` (más un candado), mapeo de errores de Graph y esquemas Zod. **Se reescribe** el sync en `lib/social/<red>/` con un runner común.

## 2. Qué da cada API (verificado en oct-2026)

**Instagram (Instagram Login, `graph.instagram.com`)** [media insights](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/) · [user insights](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights)
- REELS: `views, reach, likes, comments, saved, shares, total_interactions, ig_reels_avg_watch_time, ig_reels_video_view_total_time, reels_skip_rate` (skip en 3 s, "en desarrollo").
- FEED (imagen o carrusel): `views, reach, saved, shares, likes, comments, total_interactions, follows, profile_visits`. Los hijos de un carrusel no tienen insights.
- `impressions` está deprecado (media desde el 2-jul-2024; cuenta desde el 21-abr-2025). Los insights tardan hasta 48 h, se guardan 2 años y, sin dato, vuelve un set vacío (no `0`).
- Cuenta (`period=day`): `reach, views, accounts_engaged, total_interactions, profile_links_taps, follows_and_unfollows`. `follower_count` y las demografías exigen al menos 100 seguidores.
- Token long-lived de 60 días. Se refresca solo si tiene más de 24 h y todavía no venció ([doc](https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token/)).

**YouTube** [métricas](https://developers.google.com/youtube/analytics/metrics) · [historial de cambios](https://developers.google.com/youtube/analytics/revision_history)
- Data API v3: `channels/playlistItems/videos.list` cuestan 1 unidad cada uno (10.000/día): sobra.
- Analytics: `views, engagedViews, estimatedMinutesWatched, averageViewDuration, averageViewPercentage, subscribersGained/Lost, likes, shares, comments` por `dimensions=video` (1 query paginada para todo el canal). La retención sale de `audienceWatchRatio` con `elapsedVideoTimeRatio` (1 query por video). Para detectar Shorts se usa `creatorContentType` (con duración ≤ 180 s como respaldo). Los datos tardan 48-72 h.
- Impresiones y CTR de miniatura (`video_thumbnail_impressions[_ctr]`) llegaron en los Reach reports de ene-2026, por Reporting API (jobs masivos). Va en v2, no en el lanzamiento.
- **Cambio del 27-ago-2026:** las views públicas cuentan desde que arranca la reproducción. Para comparar a través de esa fecha, usar `engagedViews`.

**TikTok Display API v2** [video object](https://developers.tiktok.com/doc/tiktok-api-v2-video-object) · [tokens](https://developers.tiktok.com/doc/oauth-user-access-token-management) · [sandbox](https://developers.tiktok.com/doc/add-a-sandbox)
- Solo `view_count, like_count, comment_count, share_count`, más `duration, title, video_description, create_time, cover_image_url` (TTL de 6 h), `share_url` y `embed_link`. `max_count` va hasta 20 por página, solo videos públicos.
- **No da:** guardados, alcance, tiempo de visualización, retención, fuentes de tráfico ni demografía. `user.info.stats` da `follower_count, following_count, likes_count, video_count`.
- Access token de 24 h, refresh de 365 días, y el refresh puede rotar.

## 3. Diseño

### Datos (extiende `lib/db/schema.ts`)
- `content_items`: agregar `productType`, `thumbnailPath` (copia en Storage, porque las URLs de IG y TikTok vencen), `avgWatchSec`, `totalWatchSec`, `skipRate`, `engagedViews`, `avgViewPct`, `subsGained`, `follows`, `profileVisits`, `views24h/72h/7d` (checkpoints fijos), `perfScore`, `lastSeenAt`, `unavailableSince` y `insightsStatus` (`OK|PENDING|NOT_SUPPORTED`).
- `metric_snapshots`: agregar `capturedAt`, `ageHours` y métricas de reproducción.
- `account_snapshots`: agregar `reach, views, accountsEngaged, profileLinksTaps, follows, unfollows, subsGained, subsLost, watchMinutes` (las métricas diarias de cada red).
- Tablas nuevas: `sync_runs` (`platform, kind BACKFILL|INCREMENTAL|DEEP|TOKEN, status, cursor jsonb, startedAt, finishedAt, apiCalls, itemsUpserted, errorCode, errorMessageEs, leaseUntil`), `retention_curves` (`contentItemId, points jsonb`), `content_analyses` (transcripción, gancho, etiquetas, "por qué funcionó") y `weekly_reports`.

### Sincronización
- **Vercel Pro es obligatorio**: Hobby solo permite un cron por día ([Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing)) y además no es para uso comercial. El cron va en `/api/cron/sync` cada hora, protegido con `CRON_SECRET`.
- **Niveles:** las piezas de menos de 72 h se actualizan cada 3 h, las de 3 a 30 días a diario y las más viejas los domingos. La cuenta se actualiza a diario. La retención de YouTube corre una vez a los 7 días y otra a los 30.
- **Backfill reanudable:** usa un presupuesto de tiempo de 240 s, guarda el `cursor` en `sync_runs` y el siguiente tick sigue desde ahí. Concurrencia de 4 con backoff cuando IG devuelve 4/17/32 o lee `X-Business-Use-Case-Usage`.
- **Idempotencia:** upsert por `(platform, externalId)` y `(item, capturedOn)`. Un candado por red (`leaseUntil` o `pg_try_advisory_lock`) impide que se pisen el cron y el botón "Sincronizar ahora".
- Si la API devuelve un valor nulo, se conserva el anterior. Nunca se escribe `0` en lugar de "sin dato".
- **No disponible:** solo después de un listado completo, sin cortes ni errores, se pone `available=false` en lo que no apareció. Si la pieza vuelve, se reactiva. Nunca se borra nada.
- Las miniaturas se copian a Storage la primera vez que se ve la pieza.

### Tokens
`getValidToken(platform)` hace un `SELECT … FOR UPDATE` (así un refresh de TikTok que rota no corre dos veces a la vez) y sigue estas reglas:
- **IG:** refresca si el token tiene más de 24 h y le quedan menos de 30 días.
- **YouTube:** refresca si le quedan menos de 5 min; `invalid_grant` pasa la cuenta a `REVOKED`.
- **TikTok:** refresca si le queda menos de 1 h y guarda el nuevo refresh token junto con `refreshTokenExpiresAt`.

El sync diario hace un paso `TOKEN` para todas las redes. Errores: IG 190 (subcode 460/463/467) → `EXPIRED`/`REVOKED`; TikTok `access_token_invalid` → `EXPIRED`; scope faltante → `ERROR` con "Faltan permisos". Se muestra un **banner global** en el layout: "Tu conexión con Instagram venció. Reconéctala para seguir midiendo. [Reconectar]". Además se manda un email al dueño. En Ajustes, cada red tiene una tarjeta con estado, última sincronización, próxima sincronización y el último error en español.

### Métricas (pantalla)
- **Barra superior:** periodo (7/28/90 días o personalizado), "comparar con periodo anterior" y chips de red y de tipo.
- **KPIs con Δ%:** visualizaciones, alcance (IG), seguidores netos, tasa de interacción (interacciones/views), **guardados + compartidos cada 1.000 views**, retención media (IG y YouTube) y piezas publicadas.
- **Gráficos:** views diarias por red, seguidores, duración contra retención, heatmap de día y hora de publicación (mediana de views a 7 días) y frecuencia semanal contra rendimiento.
- **Tabla y cuadrícula** con los filtros del CLAUDE.md y una columna **"×mediana"**.
- **Panel por pieza:** curva de views por edad, curva de retención (YouTube), comparación con la mediana de su tipo y "Por qué funcionó".
- **Regla de comparación:** siempre a la misma edad (`views7d`), nunca el total contra una pieza de hace 2 años.

### Inicio
"Tu semana": 4 KPIs con Δ contra la semana pasada, resumen de IA, las 3 mejores piezas, alertas (pieza viral, conexión vencida), los próximos 7 días del calendario, trabajos en curso y racha de publicación contra la meta.

### Funciones "wow" (de 1 a 2 días cada una)
1. **Detector de virales:** `perfScore = views7d / mediana(views7d del mismo tipo, últimos 90 días)`. Un badge "×3,2" y una alerta cuando a las 24 h la pieza ya supera el doble de su mediana a esa misma edad ("va camino a ser tu mejor reel del mes").
2. **"Por qué funcionó":** junta la transcripción (subtítulos de YouTube, o Groq sobre `media_url` del reel propio) con las métricas y la mediana, y Claude explica el gancho, la estructura, el CTA y por qué retuvo. Botón **"Crear guion parecido"** que lo manda a Guiones. Así se conectan los módulos.
3. **Ranking de ganchos:** la primera frase de cada reel o short, ordenada por `reels_skip_rate`, watch time o retención a los 3 s. Es la biblioteca de "ganchos que te funcionan".
4. **Resumen semanal de IA** cada lunes en Inicio y por email: qué funcionó, qué no y 3 acciones concretas. Todo sale de agregados calculados, nunca de números inventados.

## 4. Riesgos de lanzamiento y cómo vender igual la semana próxima
- **Dominio:** las instalaciones van en subdominios de un dominio propio (`cliente.<dominio>`), con una sola app de Meta, un solo proyecto de Google y una sola app de TikTok a nombre de KAVAR LLC. Cada deploy agrega su redirect URI.
- **Meta:** `instagram_business_manage_insights` necesita App Review (Advanced Access) para cuentas sin rol en la app. Mientras tanto, la app queda en modo desarrollo y cada cliente se agrega como **Instagram Tester**: acepta la invitación en Instagram, en Configuración → Apps y sitios web. Eso habilita los permisos sin review (validarlo hoy con una cuenta real). Hay que enviar ya la review (screencast en inglés, política de privacidad y verificación del negocio) y sacar los scopes de mensajes, comentarios y publicación.
- **Google:** `youtube.readonly` y `yt-analytics.readonly` son scopes sensibles, no restringidos (no hay auditoría CASA). **No dejar la app en "Testing"**, porque ahí los refresh tokens vencen a los 7 días. Hay que pasarla a "In production" sin verificar: aparece la pantalla de advertencia y hay un tope de 100 usuarios en total ([Google](https://support.google.com/cloud/answer/7454865)), suficiente para los primeros clientes. La verificación (dominio, privacidad, video demo) se pide en paralelo y puede tardar semanas.
- **TikTok:** la Display API necesita app review ([guía](https://developers.tiktok.com/doc/app-review-guidelines): web oficial, política de privacidad y términos visibles, video demo). Hasta que la aprueben se usa un sandbox: hasta 10 cuentas objetivo por sandbox y 5 sandboxes, y para agregar una cuenta el cliente tiene que iniciar sesión en la llamada de onboarding. Si la review se demora, TikTok sale como "en revisión" sin frenar la venta.
- **En el contrato:** las métricas dependen de cada API; TikTok no da guardados ni retención.
