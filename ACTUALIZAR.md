# Recibir mejoras sin copiar a mano

Hay tres niveles y ninguno se copia a mano:

1. **Repo principal** (privado, donde se desarrolla). Ahí vive todo, también lo interno.
2. **Esta plantilla** (`content-studio-instalable`). Se arma sola desde el principal con `scripts/armar-instalable.sh`: copia el código, saca lo interno (`instalable/excluir.txt`), pone estos documentos y **se frena si encuentra datos o claves que no deberían estar** (`instalable/prohibido.txt` y gitleaks). En el principal se corre con el workflow **Sincronizar repo instalable** (manual) y queda un commit nuevo aquí con el commit de origen.
3. **El repo de cada cliente** (creado con *Use this template*). Trae el workflow **Actualizar desde la plantilla** (`.github/workflows/actualizar.yml`): una vez por semana (o a mano) trae los cambios de la plantilla a una rama `actualizacion` y abre un **PR**. Nada llega a producción sin que alguien lo revise y lo mergee.

## Al mergear el PR de actualización
- Vercel despliega solo. Las migraciones de la base corren en el build de producción (`vercel-build`) y solo agregan: nunca borran datos.
- Si el PR toca `worker/`, el workflow **Desplegar worker** lo publica en la app de Fly del cliente. Antes de mergear, mira en **Ajustes → Estado del sistema** que no haya trabajos en curso.
- Si algo sale mal: en Vercel, **Promote** el deploy anterior; en el repo, revierte el merge.

## Cambios propios de un cliente
Hazlos en su repo, en archivos que la plantilla no toque (por ejemplo, variables de entorno o `public/` propio). Si chocan con una actualización, el PR lo muestra como conflicto y se resuelve ahí.

## Requisitos del repo del cliente
- Settings → Actions → General → **Workflow permissions: Read and write** y **Allow GitHub Actions to create pull requests**.
- Variable de repo `PLANTILLA_REPO` con el dueño y el nombre de la plantilla (por ejemplo `tu-cuenta/content-studio-instalable`).
- Si la plantilla es privada: secreto `PLANTILLA_TOKEN` (un token de solo lectura de la plantilla, de una cuenta del equipo).
