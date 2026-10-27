# Checklist de despliegue (una marca nueva)

Marca cada punto antes de entregar. El detalle de cada paso está en `INSTALACION.md`.

## Antes
- [ ] Cuenta de Vercel **Pro** del cliente, con nosotros invitados como miembros.
- [ ] Dominio (o el de Vercel), correo del dueño y zona horaria de la marca.
- [ ] El cliente tiene su clave de **Anthropic** con saldo (y, si quiere imágenes, la de **OpenAI**). Nadie la manda por chat.

## Repo y Vercel
- [ ] Repo del cliente creado desde esta plantilla (privado).
- [ ] Proyecto de Vercel importado desde ese repo; comando de build sin tocar (`vercel-build`).
- [ ] Neon conectado (`DATABASE_URL` y `DATABASE_URL_UNPOOLED`).
- [ ] Dos stores de Blob: público (`BLOB_READ_WRITE_TOKEN`) y **privado** con prefijo `VIDEO_BLOB`.
- [ ] Variables de Production cargadas como **Secret**: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_APP_NAME`, `APP_TIMEZONE`, `BETTER_AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`, `OWNER_EMAIL`, `OWNER_NAME`, `RESEND_API_KEY`, `EMAIL_FROM`, `LEGAL_COMPANY_NAME`, `LEGAL_CONTACT_EMAIL`, `WORKER_SECRET`, `FLY_API_TOKEN`, `FLY_WORKER_APP`, `FLY_WORKER_MACHINE_ID` y las de las redes.
- [ ] `TOKEN_ENCRYPTION_KEY` guardada en el gestor de contraseñas del equipo (si se pierde, hay que reconectar todo).
- [ ] `AI_MONTHLY_CREDIT_USD` acordado con el cliente (por defecto 50 por persona y por mes).
- [ ] Primer deploy: el log dice `[preparar] Migraciones al día.` y `[preparar] Dueño creado`.

## Worker (editor de video)
- [ ] App de Fly propia (`content2-worker-<marca>`), volumen `work` creado, secretos cargados (`docs/worker.md`).
- [ ] En el repo del cliente: secreto `FLY_API_TOKEN` y variable `FLY_WORKER_APP` para el deploy automático.
- [ ] **Ajustes → Estado del sistema** muestra el servicio de procesamiento sin errores.

## Redes
- [ ] URLs de regreso de esta instalación agregadas en Meta, Google y TikTok.
- [ ] Cuentas del cliente como testers mientras las apps no pasen la revisión.
- [ ] Instagram y YouTube conectados; **Métricas** muestra piezas.

## Claves del cliente (BYOK)
- [ ] El dueño pegó su clave de Anthropic en **Ajustes → Claves de servicios** (o está en `ANTHROPIC_API_KEY`).
- [ ] Si quiere imágenes: su clave de OpenAI en Ajustes.
- [ ] Le recomendamos un tope de gasto en su consola de Anthropic.

## Prueba final
- [ ] **Mi marca → Prueba de voz** devuelve un guion.
- [ ] Un video corto subido al Editor: se transcribe, se pide una animación y se exporta.
- [ ] **Ajustes → Consumo** muestra el gasto de esas pruebas por video y por paso.
- [ ] Vercel → Cron Jobs: `/api/cron/sync` cada hora en 200.
- [ ] `https://<dominio>/privacidad` abre sin sesión.
- [ ] Videos con clon **no** aparecen en ninguna pantalla.
- [ ] El workflow **Actualizar desde la plantilla** está activo (ver `ACTUALIZAR.md`).
