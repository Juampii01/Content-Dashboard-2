# Content Studio · guía técnica para Claude Code

Instalación de una sola marca personal (single-tenant): su deploy, su base, sus archivos y sus claves. Antes de tocar código, lee `AGENTS.md` (Next.js 16 cambia APIs) y los documentos de `docs/`.

- **Idioma:** toda la interfaz, los mensajes de error y los textos para el cliente en **español neutro**, con «tú» (sin voseo ni español de España; «video» sin tilde).
- **IA:** Claude por la API de Anthropic con la clave del cliente (Ajustes → Claves de servicios o `ANTHROPIC_API_KEY`). Nunca la suscripción de Claude ni la sesión de ChatGPT de nadie. Todo el consumo pasa por `recordUsage` (`lib/ai/usage.ts`) y se ve en Ajustes → Consumo; los créditos del mes están en `lib/ai/credits.ts`.
- **Videos con clon:** apagados (`FEATURES.clone = false` en `lib/features.ts`).
- **Seguridad:** toda lectura y escritura pasa por `lib/dal` o por acciones con `requireEditor`/`requireOwner`. Tokens y claves cifrados (AES-256-GCM). Nunca se imprimen claves en logs. Nada de secretos en el repo.
- **Datos:** las migraciones solo agregan. No se borran métricas ni archivos del cliente.
- **Antes de entregar:** `pnpm typecheck`, `pnpm lint`, `pnpm build`.
