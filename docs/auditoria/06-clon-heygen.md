# Módulo "Videos con clon": HeyGen API v3 (investigación al 18-oct-2026)

## 0. Lo urgente
- **Confirmado:** v1/v2 dejan de funcionar el **31-oct-2026**. Desde el 1-nov solo queda v3. Las respuestas legacy ya traen el header `Sunset: Sat, 31 Oct 2026`. Studio y Template siguen en v2 hasta que salga su equivalente. **Hay que construir directo sobre v3, sin nada de v2.** ([comparación v2/v3](https://developers.heygen.com/endpoint-version-comparison.md), [changelog](https://developers.heygen.com/changelog.md))
- **Créditos de la API ≠ suscripción web.** La API es pay-as-you-go en USD, con recarga mínima de $5, sin plan y sin créditos gratis desde feb-2026. Los créditos vencen a los 12 meses. Un cliente que paga HeyGen Creator/Pro **igual tiene que cargar saldo en la API**. Esto va en el onboarding, porque si no es el ticket de soporte n.º 1. ([help HeyGen](https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained))

## 1. API v3: endpoints y flujo
Base: `https://api.heygen.com`, header `X-Api-Key`.

**a) Crear Digital Twin**
1. Subir el video de entrenamiento con `POST /v3/assets` (hasta 200 MB). Por URL el límite es 32 MB y en base64 es 16 MB.
2. `POST /v3/avatars` con `{type:"digital_twin", name, file:{type:"asset_id", asset_id}}`. Devuelve `avatar_item.id` (el avatar_id), `avatar_group.id` y `avatar_item.default_voice_id`: **la voz se clona automáticamente a partir del mismo video**.
3. Seguir el entrenamiento con `GET /v3/avatars/looks/{look_id}` hasta que deje de estar en `processing`, o con los webhooks `instant_avatar.success|fail`. Los errores posibles son `training_failed` y `moderation_failed`, y traen `error.message`.
4. Requisitos del video: 15–600 s (lo ideal es ~2 min), 1080p, mp4, una sola persona mirando a cámara todo el tiempo, la cara en cuadro de principio a fin y audio limpio sin música.
- Costo: **$2.13 (43 créditos) por cada creación en PAYG** y $1.32 para un Photo Avatar. **No es exclusivo de Enterprise**: con PAYG se puede.
([avatar-from-video](https://developers.heygen.com/docs/avatar-from-video.md))

**b) Consentimiento** (solo para digital twin)
- `POST /v3/avatars/{group_id}/consent` con `reroute_url` opcional. Devuelve un `url` alojado por HeyGen donde la persona graba su declaración por webcam. **El link vence en 24 h**, así que hay que poder pedir otro. No hay webhook de consentimiento: el estado se consulta con `GET /v3/avatars/{group_id}` → `consent_status: pending|accepted|rejected`. La revisión tarda unos minutos.
- Subir un video de consentimiento ya grabado (<35 s), o saltear el paso con un contrato de indemnidad, es **solo Enterprise**.
- Cómo mostrarlo en la app: un botón "Grabar consentimiento" que abre el `url` en otra pestaña o en el móvil (con un QR), y `reroute_url` vuelve a `/clon/estado`. Con `rejected`, mostrar `error.message` y botón "Reintentar". Mandar siempre `Idempotency-Key`.
([avatar-consent](https://developers.heygen.com/docs/avatar-consent.md))

**c) Listar:** `GET /v3/avatars` y `GET /v3/voices`, con paginación por cursor. Los avatares creados en la web de HeyGen aparecen en la misma cuenta.

**d) Voz:** se usa la `default_voice_id` del twin, o `POST /v3/voices/clone` (clon instantáneo). La voz del grupo se cambia con `PATCH /v3/avatars/{group_id}`. El clon "profesional" ocupa un slot pago (5 entrenamientos por mes) y la síntesis cuesta 0,6 créditos por minuto. Los motores TTS que se pueden elegir en `voice_settings.engine_settings` son ElevenLabs, Fish y Starfish. No hace falta integrar ElevenLabs por separado.

**e) Generar:** `POST /v3/videos`
- `type:"avatar"`, `avatar_id`, `script` + `voice_id`, o `audio_url` para lipsync con audio propio.
- `voice_settings`: `speed` 0.5–1.5, `pitch`, `volume`, `locale`. **No hay parámetro de emoción.** `expressiveness` existe solo para photo avatar con Avatar IV, y `motion_prompt` solo con Avatar V.
- `resolution: "1080p"` + `aspect_ratio: "9:16"` da 1080×1920. `background` puede ser `{type:"color"|"image"}` o `remove_background`. `output_format: webm` da fondo transparente.
- `caption: {style:"default"}` las quema en el video, y siempre devuelve el SRT en `subtitle_url`.
- `engine.type`: `avatar_iv` (es el default **si no se manda**), `avatar_v` o `avatar_iii`. Mandarlo siempre explícito.
- Asíncrono: la respuesta trae `video_id` y `status:"waiting"`. Para seguirlo: `GET /v3/videos/{id}` o webhooks.
- No documentan un largo máximo: la duración la marca el audio.
- Webhooks: se registran con `POST /v3/webhooks/endpoints` y los eventos son `avatar_video.success|fail`. Verificación: **HMAC-SHA256 en hex del body crudo con el `secret`, que llega en el header `signature`**. Comparar en tiempo constante y no re-serializar (en Next.js, `await req.text()`). Deduplicar por `video_id` + `event_type`. Alternativa: `callback_url` + `callback_id` por video.
([create-video](https://developers.heygen.com/reference/create-video.md), [webhooks](https://developers.heygen.com/docs/webhooks.md))

**f) Photo avatar:** `POST /v3/avatars` con `type:"photo"`. No tiene consentimiento de HeyGen, así que **el registro de consentimiento queda a cargo nuestro o del cliente**.

**Precios PAYG por minuto** ([help](https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained))

| Motor | USD/min |
|---|---|
| Avatar III Digital Twin | $0.60 |
| Avatar IV Digital Twin | $4.83 |
| Avatar V Digital Twin | $7.20 |
| Avatar IV Photo | $2.31 |

- Se cobra por segundo generado. Ojo: el changelog de oct-2026 dice que **"1080p/2K se cobra 3× la tarifa de 768p"**. Hay que validarlo con un render real, comparando `remaining_credits` antes y después.
- Saldo: `GET /v3/users/me` devuelve `remaining_credits`.
- Concurrencia en PAYG: 10 videos. Con 429 llega `Retry-After`. Los límites altos (30 escrituras por segundo) son de Enterprise.

## 2. ¿Es válido usar la API key del cliente? (ToS)
- **Sí, con matices.** El cliente es el titular de la cuenta y paga su propio consumo. La herramienta es single-tenant y de él, con la key guardada en su backend y nunca en el cliente. Nova no revende créditos ni salidas de HeyGen. Los ToS prohíben "redistribución/republicación de los Servicios", "autorizar a terceros a usar los Servicios" y construir productos competidores ([terms](https://heygen.com/terms)). No hay cláusula explícita sobre keys en herramientas de terceros, y la propia doc muestra keys usadas en herramientas externas ([api-key](https://docs.heygen.com/docs/api-key)).
- **Riesgos:** (1) que vendamos el módulo como "HeyGen incluido". No hacerlo: tiene que ser "conecta tu HeyGen". (2) Que Nova opere la cuenta del cliente.
- **Para escalar:** la vía oficial para apps que actúan por cuenta de usuarios es **OAuth**, que requiere aprobación de Partnerships por formulario ([oauth](https://docs.heygen.com/docs/heygen-oauth)). Conviene aplicar ya, sin que bloquee el MVP.
- **Contrato:** cláusula donde el cliente declara que tiene el consentimiento de la persona clonada y acepta los ToS de HeyGen.

## 3. UX por pasos (`/videos-clon/[paso]`)
1. **Conectar HeyGen**
   - Pegar la key, que se valida contra `GET /v3/users/me` y se guarda cifrada.
   - Mostrar saldo en USD/créditos y el link "Cargar saldo API".
   - Error: key inválida, o saldo 0 con el aviso "tu plan web no incluye API".
2. **Elegir camino:** "Ya tengo clon en HeyGen" (salta al paso 5) o "Crear clon".
3. **Crear clon**
   - Checklist: luz frontal, fondo limpio, cámara a la altura de los ojos, plano medio, 2–5 min hablando natural con pausas, sin música, 1080p.
   - Grabar en el navegador (MediaRecorder) o subir el archivo.
   - Antes de crear, aviso de costo: $2.13.
4. **Consentimiento + entrenamiento**
   - Link o QR al consentimiento, con un contador de 24 h y botón para regenerarlo.
   - Barra de estados: subido → entrenando → consentimiento pendiente → listo.
   - Errores: `moderation_failed`, `training_failed` o consentimiento `rejected`, cada uno con el motivo y la opción de reintentar.
5. **Generar video**
   - Elegir un guion de Guiones.
   - Elegir avatar y voz de la lista, con preview.
   - Motor: Económico (III), Calidad (IV) o Premium (V).
   - Formato: 9:16, 1:1 o 16:9. Fondo: color o imagen. Velocidad. Subtítulos quemados (sí/no).
   - **Estimación:** palabras ÷ 150 wpm × tarifa × multiplicador de 1080p, comparada con el saldo. Bloquear si no alcanza.
6. **Seguimiento:** lista de jobs con su estado (webhook + polling de respaldo), visible al volver a la app.
7. **Resultado**
   - Reproducir y descargar el MP4 y el SRT.
   - Botones "Enviar a Editor" (subtítulos y b-roll) y "Programar en Calendario".
   - Guardar una copia en nuestro storage, porque las URLs de HeyGen vencen.
- **Errores transversales:** 402 o saldo insuficiente, 429 con reintento, 409 (`resource_not_ready`, avatar no listo) y key revocada (vuelve al paso 1).

## 4. ¿Fallback "crear el clon en la web de HeyGen y elegirlo en la app"?
- Es el MVP pragmático, aunque **no por un tema de plan**: en PAYG el twin se puede crear por API. Conviene porque evita, en la primera semana, el flujo de consentimiento, la carga de archivos grandes y los estados de entrenamiento.
- Además, los clientes con suscripción web ya pueden tener su twin creado ahí.
- **Recomendación:** lanzar con el fallback (pasos 1, 2, 5, 6 y 7) y sumar "Crear clon por API" en la versión 1.1.

## 5. Alternativas
- **Mirage/Captions API:** $0.15/s (≈$9/min) para Avatar X, y subtítulos a $0.15/min ([pricing](https://captions.ai/help/docs/api/pricing.md)). Más cara que HeyGen.
- **Tavus:** API con réplicas o digital twins, desde ~$29/mes más uso. Tarifa por minuto sin verificar.
- **D-ID:** a partir de una foto, desde $4.70/mes (Pro $49 y Advanced $299). Menos realista para un clon en video.
- **Synthesia:** API en beta, desde ~$22.50/mes en Business. Avatares personales con un proceso pesado. No es prioridad.
- **Fish Audio:** solo voz (clon y TTS barato) más video de avatar parlante por créditos. Sirve como plan B de voz, ya que HeyGen ya usa Fish como motor.

(Precios de [VEED](https://www.veed.io/learn/best-talking-head-video-apis), abr-2026. Confirmar en cada sitio antes de citarlos a un cliente.)

## 6. MVP para la semana próxima

| Bloque | Días |
|---|---|
| Conectar: key cifrada, `users/me`, saldo | 0,5 |
| Listar avatares y voces con preview | 0,5 |
| Generar: form, estimación de costo, `POST /v3/videos`, tabla de jobs | 1,5 |
| Webhook con HMAC, polling de respaldo, copia a storage | 1 |
| Resultado: descarga y envío a Editor/Calendario | 0,5 |
| Prueba real de costos a 1080p en 9:16, ajuste de la estimación | 0,5 |
| **Total MVP** | **~4,5 días** |
| v1.1: crear twin por API, consentimiento, estados de entrenamiento | +2,5 días |

**Riesgo principal:** la estimación de costo. Avatar IV a $4.83/min, y posiblemente ×3 en 1080p, puede comerse el saldo del cliente sin que se dé cuenta. Por eso el default tiene que ser explícito, y dejar Avatar III como "Económico".
