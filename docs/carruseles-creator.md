# Carruseles: paridad con Carrusel Creator Pro

Comparación, funcionalidad por funcionalidad, entre la app local **Carrusel Creator Pro** (`eternitydevzz/carrusel-creator-pro`: `motor/`, `mac/motor/carrusel.sh`, `windows/motor/carrusel.py`, `app/`) y el módulo **Carruseles** de Content Studio, y qué se trajo y cómo. Documento interno.

La diferencia de fondo no cambia: en el Creator, Codex dibuja **el slide entero con el texto adentro**; aquí la imagen va **siempre sin texto** y el texto lo dibuja la plantilla, exacto (ver `docs/auditoria/04-carruseles.md`, sección 2). Todo lo que se portó se adaptó a esa regla.

## Tabla de paridad

| # | Creator Pro | Antes en Content Studio | Ahora | Dónde |
|---|---|---|---|---|
| 1 | **Pegar el link de un carrusel viral** y bajar sus slides (ScrapeCreators, todo o nada, avisa si es un reel o una foto suelta) | Solo para copiar el *estilo* (plantilla), no el contenido | **Copiar un carrusel**: link (gallery-dl en el worker, sin cuenta de Instagram) o subir los slides. Si Instagram no deja bajarlo, se dice y la misma copia pasa a "sube los slides" sin perder lo elegido | `/carruseles/copiar`, `lib/carousels/copy.ts`, trabajo `CAROUSEL_COPY` |
| 2 | **`ficha_ia`**: Claude Code mira los slides y escribe la ficha de "tu versión" + el texto literal del original | No existía | Claude con visión lee **cada slide** (texto letra por letra, rol, recursos visuales, si sale una persona) y escribe tu versión con tu marca, tu tono y tu CTA, en una sola llamada | `lib/ai/prompts/carruseles-copia.ts` (`COPY_RULES`, `copySchema`) |
| 3 | Reglas del copy (`REGLAS.md`, `PROMPT_FICHA.txt`): portada y cierre de 5 a 10 palabras, interiores "2. OLLAMA", traducir salvo nombres propios, ninguna cifra que no esté en el original, nunca el @ del original, CTA con la palabra del original | Reglas generales de carrusel | Portadas en el prompt de la copia; además se guarda el texto literal del original (`sourceText`) para el chequeo de cifras | `COPY_RULES` |
| 4 | **`comprobar`**: cabecera, cifras que no están en el original (1.2B = 1.200 millones), `debajo` ≤ 95, portada/cierre 5–10 palabras, `azul` dentro del titular, el cliente sale al menos una vez, palabras prohibidas | Parte (cifras contra el origen, largos, resaltado, palabras prohibidas de Mi marca) | Se suman: **tu personaje sale al menos una vez**, **se cuela el @ del original**, **frase demasiado parecida al original** (trigramas), slide con personaje y **sin fotos** en Mi marca. El tope de 95 caracteres no hace falta: la plantilla ajusta el texto sola | `lib/carousels/validate.ts` |
| 5 | Palabras prohibidas de `REGLAS.md` §3 (`IA`, `etiqueta`, `panel`, `sugerencia`…) | — | **No se portan**: eran parches para el modelo de imagen cuando escribía el texto. Aquí rigen las palabras prohibidas de Mi marca | — |
| 6 | Revisar y editar la ficha antes de generar | Editor por slide | Igual, más el panel **"Slide N del original"** (su texto y cómo se veía) en cada slide copiado | `components/carruseles/original-panel.tsx` |
| 7 | **Tu cara**: fotos del personaje (1 a 3) en cada llamada a Codex; "misma cara, cambia ángulo y expresión" | La imagen pedía **"sin personas reconocibles"** | **Tu personaje en los slides**: interruptor "Sale / No sale" por slide, **pose sugerida por Claude** (ángulo, mirada, expresión, una sola acción de las manos), **foto de referencia elegida sola por slide** según la pose (o a mano). Las fotos van como imágenes de entrada a Codex o a `/images/edits` de OpenAI | `lib/carousels/character.ts`, `photos.ts`, `images/prompt.ts`, `components/carruseles/character-panel.tsx` |
| 8 | `personaje: no` en slides sin persona; si el original no muestra a nadie, sale en el cierre | — | Igual: "Como el original" (por defecto), "En todos los slides" o "Sin mi cara" | `copy.ts` (`faces`) |
| 9 | Manos/ropa rotando una lista fija (`MANOS`) | — | Poses de respaldo rotando (`DEFAULT_POSES`) cuando la IA no propone una; botón "Otra pose" | `character.ts` |
| 10 | **Diseño fiel al original** (`PROMPT_BASE_CLARO`, `REDISENO=1` manda el slide original al generador) | Plantillas desde referencia (aparte) | Al copiar, **"Diseño: igual al original"** crea una plantilla con su composición, jerarquía, colores y letra (Tesseract + k-means + Claude). La escena de cada slide parte de la idea visual del original. **El original nunca se manda al generador de imágenes** (regla del proyecto); los slides con tu cara sobre un diseño sin foto pasan a "Foto + texto" | `copy.ts`, `templates.ts` (`buildSpec`) |
| 11 | **`generar`**: Codex hace todos los slides en una llamada (5 a 12 min), recorta a 4:5 | Imágenes sin texto por slide, en el worker (ChatGPT del cliente vía Codex o API de OpenAI), la primera como referencia de estilo | Igual, más fotos del personaje primero en el orden de imágenes | `worker/carruseles/trabajos.py` |
| 12 | **`corregir n "cambio"`** (1 imagen; adjunta las fotos del personaje para que la cara no se degrade) | Solo "Otra imagen" (rehacer) | **Corregir**: edita la imagen actual con un único cambio y vuelve a adjuntar tus fotos; **"Volver a la anterior"** (se guarda la imagen previa) | `correctImageAction`, `images/service.ts` |
| 13 | `elegir` (Codex rehízo imágenes), `encoger`, `reestampar` | — | No hacen falta: el worker toma la última imagen de la sesión, el texto no vive en la imagen y no hay pie que quitar | — |
| 14 | **`descripcion`**: caption con gancho con palabras clave, CTA, "📌 Guárdalo para…" y 5 hashtags; rechaza ≠ 5 hashtags, > 2.200 caracteres, cifras fuera de la ficha | Caption + 5 hashtags con avisos | Igual (el caption de la copia sigue la estructura de `PROMPT_DESCRIPCION.txt`) | `copySchema`, `validate.ts` |
| 15 | **`variaciones`**: 5 descripciones con ganchos distintos (dato, pregunta, problema, promesa, curiosidad), combinaciones de hashtags distintas, comprobadas | No existía | **5 variaciones** con las mismas comprobaciones (5 hashtags, largo, cifras, primeras líneas y combinaciones repetidas); "Usar como principal"; van en `variaciones.txt` del ZIP | `lib/carousels/captions.ts`, `caption-variants.tsx` |
| 16 | **`animar`**: MP4 de un slide con ajustes a mano (oleadas, iconos, latidos) | No existía | **Animar un slide**: el slide ya dibujado con su plantilla, movimiento sutil (acercamiento, deriva o latido), **4:5 o 9:16**, 4/6/8 s, sin sonido, en el worker. Aviso si el slide cambió después de animarlo. Va en el ZIP | `worker/carruseles/animar.py`, trabajo `CAROUSEL_ANIMATE`, `slide-video-panel.tsx` |
| 17 | **`cerrar`**: JPG 1080×1350 + ZIP | ZIP de JPG 1080×1350 + caption | + MP4 de los slides animados + `variaciones.txt` | `components/carruseles/export.ts` |
| 18 | `cerrar` **borra metadatos C2PA y escribe una ubicación GPS falsa** | — | **No se porta, nunca** (regla del proyecto). Las imágenes generadas se guardan tal cual las entrega el proveedor | — |
| 19 | **`cupo`**: ~60 imágenes/día por cuenta de ChatGPT (medido), no lanza si no hay sitio | Cuenta de 24 h dentro del diálogo | **Visible** en la cabecera del editor ("Imágenes en 24 h: N de ~60") y aviso antes de generar si se pasaría. Avisa, no bloquea | `lib/carousels/quota.ts` |
| 20 | Estado en vivo de lo que corre (`en_curso.py`, una generación a la vez) | Trabajos con progreso real | Igual, para la copia y el video también (se puede salir y volver) | `/carruseles/copiar/[id]`, `useJob` |
| 21 | Ruta: link → ficha → comprobación → generar → revisión → descripción → video → cerrar | Pasos al crear | **Ruta de pasos** del carrusel en el editor (Ficha · Imágenes · Descripción · Video · Descargar) con su estado | `carousel-route.tsx` |
| 22 | Filesystem como base de datos, candados por PID, varios clientes en una app | — | **No se porta**: base de datos, cola `jobs` y una instalación por cliente | — |

## Cómo se usa la cara del personaje

1. **Fotos**: las mismas "fotos del personaje" de Mi marca que usan las miniaturas de YouTube (`brand_profile.character_photos`, `marca/fotos/…`). Se pueden subir desde el paso 2 de "Copiar un carrusel" o desde el panel "Tu personaje" del slide. Lo ideal: 2 o 3, nítidas, con buena luz y la cara completa, una de frente y otra de tres cuartos.
2. **Rasgos de cada foto**: la primera vez que se genera un slide con personaje, Claude (visión, modelo rápido) describe cada foto: ángulo (frente, tres cuartos, perfil), expresión, encuadre, si mira a cámara y qué tan buena es como referencia. Se guarda en `character_photo_traits` (una vez por foto).
3. **Pose por slide**: la escribe Claude al copiar (o al generar, si falta), con una sola acción de las manos y distinta entre slides seguidos. Se edita a mano o con "Otra pose".
4. **Foto por slide**: `pickPhotos` puntúa cada foto contra la pose (ángulo 3, expresión 2, encuadre 1, mirada 0,8 y la calidad de la foto) y manda **primero la que mejor encaja y después otra distinta** para fijar la identidad (máx. 2). Si la persona eligió una foto en el slide, esa va primero. Sin rasgos, rota entre las fotos.
5. **Llamada de imagen**: orden fijo de imágenes adjuntas = fotos del personaje → imagen a corregir (si es una corrección) → referencia de estilo del carrusel. El prompt nombra cuáles son las fotos ("la persona de las imágenes 1 y 2… misma forma de la cara, ojos, cejas, nariz, boca, mandíbula, pelo, barba, tono de piel y edad"), pide no copiar la foto tal cual, la pose del slide, una sola acción con las manos y ninguna otra persona reconocible. La referencia de estilo se marca como "solo paleta y luz: la cara sale de las fotos".
   - **ChatGPT (Codex)**: las fotos van con `-i` (igual que `llamar_codex` del Creator).
   - **API de OpenAI**: `/images/edits` con las fotos como `images` y `input_fidelity: "high"` (conserva mejor la cara). Si el modelo no acepta ese parámetro, se repite una vez sin él.
6. **Corregir**: vuelve a adjuntar las fotos (regla del Creator: sin ellas la cara pierde parecido con cada edición).

### Límites (dichos tal cual)

- **El parecido no está garantizado.** Depende del modelo de imagen del proveedor (Codex/ChatGPT o el modelo de imágenes de OpenAI). El Creator medía unos 5 de 7 slides buenos a la primera; con la cara pasa lo mismo: hay que revisar y corregir o rehacer el slide que no se parezca.
- **No se probó con un proveedor real** (la red de desarrollo no llega a OpenAI ni a ChatGPT): el flujo y el orden de las imágenes están probados con los simuladores; falta medir el parecido real con fotos de un cliente.
- `input_fidelity` existe en `gpt-image-1`; no está confirmado en el modelo configurado (`OPENAI_IMAGE_MODEL`). Por eso el reintento sin el parámetro.
- Con **una sola foto** la cara sale menos parecida: la app lo dice en el panel.
- Las fotos de un cliente son datos sensibles: se guardan en el almacenamiento privado, viajan al worker solo dentro de un trabajo en curso (rutas firmadas, `/api/worker/carruseles/storage` solo deja leer las fotos que nombra ese trabajo) y se mandan al proveedor del propio cliente.
- No hay control de consentimiento de terceros: la app asume que las fotos son del propio cliente (como el Creator).

## Lo que no se probó con proveedores reales

- **Bajar un link real de Instagram con gallery-dl** (probado con el simulador; Instagram suele pedir sesión: en ese caso se ofrece subir los slides).
- **Lectura del original con Claude real** (con `AI_FAKE=1` la respuesta es simulada; el prompt y el esquema son los de producción).
- **Generación real con ChatGPT/Codex y con la API de OpenAI** con fotos del personaje y correcciones.
- **Cupo real** de un plan de ChatGPT (60/día es la medida del Creator, no está publicado).

## Pruebas

- `pnpm test:carruseles` — elección de fotos por pose, prompts con y sin personaje, comprobaciones de la ficha copiada, variaciones y huella del video.
- `cd worker && pytest tests/test_carruseles_creator.py` — fotos en orden con Codex simulado, corrección, `input_fidelity` con el simulador de OpenAI (y el reintento), copia desde link (con texto del post) y desde imágenes subidas, falla de Instagram, video 4:5 y 9:16 (H.264, yuv420p, faststart) y el trabajo completo.
- `/home/claude/e2e/carru-copia.mjs` — el flujo entero en el navegador con el worker local y los simuladores.
