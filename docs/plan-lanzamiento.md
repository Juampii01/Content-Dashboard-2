# Content 2 · Auditoría y plan de lanzamiento (18-oct-2026)

Resumen de 6 auditorías: la base del repo (Etapa 1) y el diseño de cada herramienta. El detalle de cada una está en `docs/auditoria/`.

## 1. Veredicto

- **La base compila limpia** (install, typecheck, lint y build sin errores). Los problemas son de diseño, no de compilación.
- **Hay un bloqueante:** con Supabase Auth el dueño de una instalación nueva **no puede entrar**. La invitación apunta a `/login`, no existe `/auth/callback` ni pantalla para definir la contraseña, y el correo por defecto de Supabase no llega a clientes. Como igual cambiamos a Vercel, se resuelve con el cambio de auth.
- **Ninguno de los repos de origen se puede portar tal cual.** Todos tienen bugs que, en un producto de USD 5.000, el cliente vería en la primera semana. Los peores:
  - **Métricas:** el sync de Instagram corta en 500 piezas y después **borra todo lo que no vino**, y el `user_id` pierde precisión.
  - **Guiones:** el prompt nunca usó la marca, el público ni las métricas (por eso salían genéricos), y está en voseo.
  - **Editor:** el audio sale duplicado si el plan se superpone, se cortan sílabas y no hay salida 16:9.
  - **Carruseles:** solo 5 de cada 7 slides salen bien y cada carrusel tarda de 5 a 12 minutos.

## 2. Stack nuevo (todo en Vercel donde se puede)

| Pieza | Antes | Ahora | Por qué |
|---|---|---|---|
| Base de datos | Supabase Postgres | **Neon** (Marketplace de Vercel) | Lo inyecta Vercel (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`) y se cobra en la misma cuenta. Drizzle no cambia. |
| Auth | Supabase Auth | **Better Auth 1.7** + adaptador de Drizzle | Email y contraseña, sin registro abierto, invitaciones y reset por **Resend**. Todo en la misma base. Auth.js v5 sigue en beta. |
| Archivos | Supabase Storage | **Vercel Blob** privado, detrás de `lib/storage` | Subida directa por partes, hasta 5 TB. Si el volumen de video lo pide, se cambia a R2 sin tocar los módulos. |
| Cola | pg-boss | **pg-boss** sobre Neon | Sin cambio. El worker consulta la cola solo mientras está encendido, así Neon puede suspenderse. |
| Worker (video y carruseles) | sin definir | **Fly Machines** (8 GB), una imagen para todos los clientes | Se apaga cuando no hay trabajos. Vercel lo despierta por API. |
| Cron | ninguno | **Vercel Cron** cada hora | Requiere Vercel Pro. |
| RLS | migración de Supabase | se elimina | Sin API pública de Supabase no aplica. La autorización vive en `lib/dal`. |

**Costo fijo por cliente:** Vercel Pro (USD 20) + Neon Launch (unos USD 19) + Fly (pocos dólares) + Blob (menos de USD 10) + IA por uso. **Son unos USD 50–60 por mes por cliente.** Un pago único de USD 5–6k no cubre eso: hace falta un mantenimiento mensual o que el cliente pague su propia infraestructura.

## 3. Herramientas: cómo quedan

### 3.1 Conexiones + Métricas + Inicio
- **Sync nuevo** en `lib/social/<red>/` con un runner común:
  - Backfill reanudable con cursor.
  - Por nivel: piezas de menos de 72 h cada 3 h, de hasta 30 días a diario y el resto los domingos.
  - Candado por red, sin escribir `0` cuando no hay dato y **nunca borra**: lo que no vuelve se marca como no disponible.
- **Métricas reales por red:**
  - IG reels: views, alcance, guardados, compartidos, tiempo medio de visualización y skip rate.
  - YouTube: engaged views, minutos vistos, % visto y curva de retención.
  - TikTok: solo views, likes, comentarios y compartidos. La API no da más y se dice.
- **`getValidToken`** con refresh antes del vencimiento, estados (vencido, revocado, faltan permisos), banner global "Reconecta Instagram" y email al dueño.
- **Pantalla de Métricas:**
  - KPIs con Δ% contra el periodo anterior.
  - Guardados + compartidos cada 1.000 views.
  - Heatmap de día y hora.
  - Tabla y cuadrícula con columna **×mediana**.
  - Comparación siempre a la misma edad (views a 7 días).
- **Lo que justifica el precio:**
  1. Detector de virales: `×3,2` contra la mediana, y una alerta a las 24 h.
  2. "Por qué funcionó": transcripción + métricas + Claude, con un botón **"Crear guion parecido"**.
  3. Ranking de ganchos que te funcionan.
  4. Resumen semanal con IA en Inicio y por email.

### 3.2 Mi marca
- Los campos que más mejoran la salida: **muestras de voz reales**, top contenido propio (automático desde Métricas), ofertas y CTAs, dolores y objeciones de la audiencia, pilares con % objetivo, creencias del creador, palabras prohibidas e idioma.
- **Onboarding en 4 pasos:**
  1. Pegas 3 links de tus mejores videos.
  2. Respondes 4 preguntas.
  3. La IA arma el perfil.
  4. Lo editas y recibes una **prueba de voz**.

### 3.3 Guiones
- **Salida estructurada:**
  - 5 ganchos con tipo y puntaje.
  - Beats con texto hablado, texto en pantalla y b-roll.
  - CTA de las ofertas reales.
  - Caption.
  - Duración calculada en el código.
- **Modelos:** Sonnet 5.5 genera (unos USD 0,02 por guion), Haiku 5.5 hace las ediciones chicas y Opus 5.5 adapta a otra red. El perfil de marca va en caché.
- **Entradas:** idea + pilar, video de referencia (solo la estructura, nunca el texto) o "haz otra como esta" desde un outlier propio.
- **Gestión:** versiones con deshacer, y estados Idea → Borrador → Listo → Grabado → Publicado.
- **Envíos:** a Editor (para comparar contra la toma), a Clon y a Calendario.

### 3.4 Calendario
- Vistas de mes y semana, panel "Sin fecha" y arrastre con `@dnd-kit/core`.
- Tabla `calendar_targets`: una pieza puede salir en varias redes.
- **Vínculo automático con la métrica real:** fecha ±3 días + similitud de texto. Con 0,75 o más se vincula solo; entre 0,5 y 0,75 se sugiere.
- Plan semanal automático los lunes, a partir de pilares atrasados y patrones ganadores.

### 3.5 Carruseles
- **Decisión central: el texto se dibuja con código** (plantillas React → PNG con Chromium en el worker). La IA solo genera escenas sin texto. Ni el mejor modelo de imagen escribe 600 caracteres con tildes sin errores.
- **Flujo:**
  1. Tema, guion o carrusel de referencia.
  2. Ficha con IA.
  3. Editor por slide con vista previa en vivo y validaciones (cifras sin confirmar, largo, palabras prohibidas).
  4. Plantilla con los colores y fuentes de la marca.
  5. Render.
  6. Ajustes por slide: editar texto es gratis.
  7. ZIP con caption y hashtags.
  8. Envío a Calendario.
- **Plantillas:** Editorial, Tweet, Lista o datos, Foto + texto (escena IA con gpt-image-2) y Creador (foto real, la cara no pasa por IA).
- **Resultado:** menos de 2 minutos por carrusel (antes de 5 a 12), por unos USD 0,25–0,40.
- **No se porta nunca** el borrado de C2PA ni el GPS falso.

### 3.6 Editor de video
- **Pipeline en el worker:**
  1. Ingesta: maneja VFR y HDR y genera un proxy.
  2. Transcripción por palabra.
  3. Detección de tomas repetidas y arranques en falso sin IA.
  4. Claude decide sobre esos candidatos.
  5. Plan v2 **por IDs de palabra**: el modelo nunca escribe segundos, así no hay audio duplicado.
  6. **Revisión humana en un editor por transcript:** tachas palabras para cortar y la vista previa funciona sin render.
  7. Render con fundidos de 10 ms, recorte por cara, presets de subtítulos con palabra activa, audio a -14 LUFS en dos pasadas, y salida 9:16 o 16:9.
- **Música:** el cliente sube su pista o agrega el audio de tendencia en Instagram. Sin biblioteca propia por derechos de autor.
- **Costo:** unos USD 0,30–0,45 por video (5 min crudo → reel de 60 s).

### 3.7 Videos con clon (HeyGen v3)
- **La v2 de HeyGen deja de funcionar el 31-oct-2026.** Se construye directo sobre v3.
- **Los créditos de la API no son los de la suscripción web.** Es pago por uso en USD. El cliente tiene que cargar saldo aparte, y eso va en el onboarding y en la venta.
- **Precios:** el clon cuesta USD 2,13 y no requiere Enterprise. Por minuto: Avatar III USD 0,60, Avatar IV USD 4,83 y Avatar V USD 7,20. En 1080p podría costar 3 veces más (hay que confirmarlo con un render real).
- **MVP:**
  1. Conectar la key: se valida y se muestra el saldo.
  2. Elegir un clon ya creado en HeyGen.
  3. Generar desde un guion con un **costo estimado antes de confirmar** y el motor siempre explícito ("Económico / Calidad / Premium").
  4. Seguimiento por webhook firmado.
  5. Copia en nuestro storage, porque los links de HeyGen vencen.
  6. Envío a Editor y a Calendario.
- **v1.1:** crear el clon desde la app, con el link de consentimiento (vence en 24 h).

## 4. Riesgos que no son de código

1. **Meta App Review** para `instagram_business_manage_insights`. Mientras sale, cada cliente entra como Instagram Tester (hay que probarlo hoy con una cuenta real). Se pide solo lectura: los scopes de mensajes, comentarios y publicación del repo viejo se sacan.
2. **Google:** la app no puede quedar en "Testing", porque los refresh tokens vencen a los 7 días. Se pasa a producción sin verificar (con pantalla de advertencia y tope de 100 usuarios) y se pide la verificación en paralelo.
3. **TikTok:** la Display API necesita review. Mientras tanto, sandbox con hasta 10 cuentas.
4. **Las tres apps** van a nombre de KAVAR LLC, y cada instalación en un subdominio de un dominio propio.
5. **Contrato:** las métricas dependen de cada API, HeyGen se paga aparte, y el cliente declara que tiene el consentimiento de la persona clonada.

## 5. Esfuerzo real y alcance del lanzamiento

| Bloque | Días |
|---|---|
| Migración a Neon + Better Auth + Blob + arreglos de la base | 2 |
| Componentes que faltan (tabla, filtros, fechas, diálogos, toasts, gráficos, subida) | 1,5 |
| Conexiones + Métricas + Inicio | 4 |
| Mi marca + Guiones | 3 |
| Calendario | 1,5 |
| Worker + cola | 2 |
| Carruseles MVP (3 plantillas sin IA) | 3 |
| Clon MVP | 3 |
| Editor de video MVP | 6 |
| **Total** | **unos 26 días de desarrollo** |

**Todo no entra en una semana.** Lanzar "la próxima semana" solo es real si lanzar significa **vender y hacer onboarding**, no entregar las 7 herramientas terminadas.

**Propuesta:**
- **Semana 1 (venta):** base migrada, Métricas + Inicio, Mi marca, Guiones y Calendario funcionando con datos reales, y Clon MVP. Es lo que se ve en una demo.
- **Semana 2:** Carruseles MVP + worker.
- **Semanas 3 y 4:** Editor de video (se vende como "llega en la semana 3").
- **Este lunes, en paralelo y sin código:** enviar Meta App Review, crear el proyecto de Google y la app de TikTok, y probar Instagram Tester. Son los únicos plazos que no dependen de nosotros.
