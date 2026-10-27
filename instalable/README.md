# Content Studio · instalación por cliente

Sistema de contenido para una marca personal: métricas de Instagram, YouTube y TikTok, calendario, guiones, carruseles y un editor de video con IA. Cada cliente tiene **su propia instalación**: su deploy, su base de datos, sus archivos y **sus propias claves** (BYOK: la IA corre con la clave de Anthropic del cliente y las imágenes con su clave de OpenAI).

- **Instalar una marca nueva:** [`INSTALACION.md`](INSTALACION.md) (paso a paso) y [`CHECKLIST-DESPLIEGUE.md`](CHECKLIST-DESPLIEGUE.md) (para no olvidar nada).
- **Recibir mejoras sin copiar a mano:** [`ACTUALIZAR.md`](ACTUALIZAR.md).
- **Variables de entorno:** [`.env.example`](.env.example) (todas, con qué es cada una).
- **Editor de video (worker en Fly.io):** [`docs/worker.md`](docs/worker.md).
- **Apps de Meta, Google y TikTok:** [`docs/apps-redes.md`](docs/apps-redes.md).

## Qué trae y qué no

- **Trae:** todo el sistema y el **registro de costos de IA visible para el cliente** (Ajustes → Consumo: gasto por video, por paso y créditos del mes).
- **No trae:** videos con clon (HeyGen). Están apagados (`FEATURES.clone = false` en `lib/features.ts`) y no aparecen en ninguna pantalla.
- **Sin secretos ni datos de nadie:** el repo no tiene claves, tokens ni contenido de otra instalación. Las claves van solo en las variables de entorno del deploy o en Ajustes (cifradas).

## Desarrollo

```bash
pnpm install
cp .env.example .env.local   # y completa los valores
pnpm db:migrate
pnpm dev
```

Comprobaciones antes de entregar: `pnpm typecheck`, `pnpm lint`, `pnpm build`.
