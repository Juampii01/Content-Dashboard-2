#!/usr/bin/env sh
# Baja las fuentes de los subtítulos y de los gráficos (licencia SIL Open Font License) desde sus repos oficiales en GitHub.
# Uso: scripts/fetch_fonts.sh [carpeta]   (por defecto: worker/fonts)
# Se usa en el Dockerfile y para probar el worker en local.
set -eu

DEST="${1:-$(dirname "$0")/../fonts}"
MONTSERRAT_TAG="v7.222"
INTER_VERSION="4.1"
GOOGLE_FONTS_COMMIT="45e3d5269e4a17d823f6d84470bc084dc5ae46f6"
JETBRAINS_MONO_VERSION="2.304"
mkdir -p "$DEST"

# Medium y SemiBold: textos secundarios de los gráficos animados (worker/motion).
for weight in ExtraBold Black Bold SemiBold Medium; do
  curl -fsSL -o "$DEST/Montserrat-$weight.ttf" \
    "https://raw.githubusercontent.com/JulietaUla/Montserrat/$MONTSERRAT_TAG/fonts/ttf/Montserrat-$weight.ttf"
done
curl -fsSL -o "$DEST/OFL-Montserrat.txt" "https://raw.githubusercontent.com/JulietaUla/Montserrat/$MONTSERRAT_TAG/OFL.txt"

TMP="$(mktemp -d)"
curl -fsSL -o "$TMP/inter.zip" "https://github.com/rsms/inter/releases/download/v$INTER_VERSION/Inter-$INTER_VERSION.zip"
unzip -q -j -o "$TMP/inter.zip" "extras/ttf/Inter-Medium.ttf" "extras/ttf/Inter-SemiBold.ttf" "extras/ttf/Inter-Bold.ttf" "extras/ttf/Inter-ExtraBold.ttf" "extras/ttf/Inter-Black.ttf" "LICENSE.txt" -d "$TMP"
cp "$TMP"/Inter-*.ttf "$DEST/"
cp "$TMP/LICENSE.txt" "$DEST/OFL-Inter.txt"
rm -rf "$TMP"

# Efectos del editor (worker/fx): Instrument Serif (portada de revista, titulares), Caveat (garabatos a mano), Anton
# (letras recortadas) y JetBrains Mono (rótulos chicos). Todas OFL; las de Google Fonts, fijadas a un commit.
GF="https://raw.githubusercontent.com/google/fonts/$GOOGLE_FONTS_COMMIT/ofl"
curl -fsSL -o "$DEST/InstrumentSerif-Regular.ttf" "$GF/instrumentserif/InstrumentSerif-Regular.ttf"
curl -fsSL -o "$DEST/InstrumentSerif-Italic.ttf" "$GF/instrumentserif/InstrumentSerif-Italic.ttf"
curl -fsSL -o "$DEST/OFL-InstrumentSerif.txt" "$GF/instrumentserif/OFL.txt"
curl -fsSL -o "$DEST/Caveat.ttf" "$GF/caveat/Caveat%5Bwght%5D.ttf"
curl -fsSL -o "$DEST/OFL-Caveat.txt" "$GF/caveat/OFL.txt"
curl -fsSL -o "$DEST/Anton-Regular.ttf" "$GF/anton/Anton-Regular.ttf"
curl -fsSL -o "$DEST/OFL-Anton.txt" "$GF/anton/OFL.txt"
TMP="$(mktemp -d)"
curl -fsSL -o "$TMP/jbm.zip" "https://github.com/JetBrains/JetBrainsMono/releases/download/v$JETBRAINS_MONO_VERSION/JetBrainsMono-$JETBRAINS_MONO_VERSION.zip"
unzip -q -j -o "$TMP/jbm.zip" "fonts/ttf/JetBrainsMono-Medium.ttf" "fonts/ttf/JetBrainsMono-Bold.ttf" "OFL.txt" -d "$TMP"
cp "$TMP"/JetBrainsMono-*.ttf "$DEST/"
cp "$TMP/OFL.txt" "$DEST/OFL-JetBrainsMono.txt"
rm -rf "$TMP"

ls -1 "$DEST"
