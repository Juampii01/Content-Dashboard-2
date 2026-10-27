#!/usr/bin/env bash
# Arma el repo instalable (una instalación por cliente) desde este repo, sin lo interno y sin datos ni claves de nadie.
#
#   scripts/armar-instalable.sh <carpeta del repo instalable clonado>
#
# 1. Copia el código del commit actual (solo lo que está en git: nunca .env.local ni archivos sueltos).
# 2. Saca lo de instalable/excluir.txt y pone los documentos y workflows de instalable/.
# 3. Cambia lo que es de esta instalación por algo neutro (nombre del worker, empresa de las páginas legales, URLs).
# 4. Se frena si encuentra algo de instalable/prohibido.txt o si gitleaks encuentra un secreto.
# No hace commit ni push: eso lo hace el workflow «Sincronizar repo instalable» (o tú, a mano).
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
DEST="${1:?Uso: scripts/armar-instalable.sh <carpeta del repo instalable>}"
SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"
[ "$DEST" != "$ROOT" ] || { echo "El destino no puede ser este repo."; exit 1; }

# 1. Limpiar el destino (menos su .git) y copiar el código del commit actual.
find "$DEST" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git -C "$ROOT" archive --format=tar HEAD | tar -x -C "$DEST"

# 2. Sacar lo interno y poner los documentos de la plantilla.
grep -vE '^\s*(#|$)' "$ROOT/instalable/excluir.txt" | while read -r path; do rm -rf "${DEST:?}/${path}"; done
(cd "$ROOT/instalable" && find . -type f ! -name excluir.txt ! -name prohibido.txt -print0 | while IFS= read -r -d '' f; do mkdir -p "$DEST/$(dirname "$f")"; cp "$f" "$DEST/$f"; done)
rm -f "$DEST/docs/instalacion.md" # reemplazado por INSTALACION.md en la raíz

# 3. Lo de esta instalación, por algo neutro (solo en la copia: el repo principal no cambia).
sed -i 's/^app = ".*"/app = "content2-worker-CAMBIAR"/' "$DEST/worker/fly.toml"
sed -i 's/process\.env\.LEGAL_COMPANY_NAME ?? "KAVAR LLC"/process.env.LEGAL_COMPANY_NAME ?? (process.env.NEXT_PUBLIC_APP_NAME || "la empresa que administra esta instalación")/' "$DEST/components/legal/legal-page.tsx"
sed -i 's/^LEGAL_COMPANY_NAME=.*/LEGAL_COMPANY_NAME="Nombre legal de la empresa del cliente"/' "$DEST/.env.example"
sed -i -E 's#https://content-dashboard-2-three\.vercel\.app#https://<dominio>#g; s/a nombre de KAVAR LLC/a nombre de tu empresa/g; s/portafolio comercial de KAVAR LLC/portafolio comercial de tu empresa/g; s/KAVAR LLC/tu empresa/g' "$DEST/docs/apps-redes.md"
# Paleta «Medianoche»: el nombre de la marca original solo en etiquetas y comentarios (la clave interna no se ve).
grep -rlE 'MaestrIA' "$DEST" --include='*.ts' --include='*.tsx' --include='*.mts' --include='*.mjs' --include='*.md' | xargs -r sed -i -E 's/Medianoche \(MaestrIA\)/Medianoche/g; s/tokens MaestrIA/tokens de la paleta Medianoche/g; s/colores MaestrIA/colores de la paleta Medianoche/g; s/de MaestrIA/de la paleta Medianoche/g; s/\(MaestrIA\)/(Medianoche)/g; s/MaestrIA/Medianoche/g'
# Datos de prueba: el nombre de una persona de ejemplo.
grep -rliE 'juampi' "$DEST/tests" | xargs -r sed -i -E 's/Juampi/Ana/g; s/juampi/ana/g'
echo "$SHA" > "$DEST/.origen"

# 4. Nada de lo prohibido ni secretos.
patterns="$(grep -vE '^\s*(#|$)' "$ROOT/instalable/prohibido.txt")"
if found="$(grep -rnE --binary-files=without-match -f <(printf '%s\n' "$patterns") "$DEST" --exclude-dir=.git --exclude-dir=node_modules | cut -c1-220)"; then
  echo "Se frena: el repo instalable tiene datos que no deberían estar:"
  echo "$found"
  exit 2
fi
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks dir "$DEST" --redact --no-banner >/dev/null || { echo "Se frena: gitleaks encontró posibles secretos."; exit 3; }
else
  echo "Aviso: gitleaks no está instalado; solo se revisaron los patrones de instalable/prohibido.txt."
fi
echo "Listo: $DEST armado desde $SHA."
