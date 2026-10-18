#!/usr/bin/env sh
# Baja las fuentes de los subtítulos (licencia SIL Open Font License) desde sus repos oficiales en GitHub.
# Uso: scripts/fetch_fonts.sh [carpeta]   (por defecto: worker/fonts)
# Se usa en el Dockerfile y para probar el worker en local.
set -eu

DEST="${1:-$(dirname "$0")/../fonts}"
MONTSERRAT_TAG="v7.222"
INTER_VERSION="4.1"
mkdir -p "$DEST"

for weight in ExtraBold Black Bold; do
  curl -fsSL -o "$DEST/Montserrat-$weight.ttf" \
    "https://raw.githubusercontent.com/JulietaUla/Montserrat/$MONTSERRAT_TAG/fonts/ttf/Montserrat-$weight.ttf"
done
curl -fsSL -o "$DEST/OFL-Montserrat.txt" "https://raw.githubusercontent.com/JulietaUla/Montserrat/$MONTSERRAT_TAG/OFL.txt"

TMP="$(mktemp -d)"
curl -fsSL -o "$TMP/inter.zip" "https://github.com/rsms/inter/releases/download/v$INTER_VERSION/Inter-$INTER_VERSION.zip"
unzip -q -j -o "$TMP/inter.zip" "extras/ttf/Inter-Bold.ttf" "extras/ttf/Inter-ExtraBold.ttf" "extras/ttf/Inter-Black.ttf" "LICENSE.txt" -d "$TMP"
cp "$TMP"/Inter-*.ttf "$DEST/"
cp "$TMP/LICENSE.txt" "$DEST/OFL-Inter.txt"
rm -rf "$TMP"

ls -1 "$DEST"
