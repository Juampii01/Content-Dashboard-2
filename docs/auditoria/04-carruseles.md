# Carruseles en Content 2: auditoría y diseño

## 1. Auditoría de `carrusel-creator-pro`

**Flujo actual:** link de IG → `bajar.py` (ScrapeCreators `/v1/instagram/post`, toma `edge_sidecar_to_children`, la mayor `display_resources`, portada si el slide es video, todo o nada) → `ficha_ia` (Claude Code mira los slides y escribe la ficha + "TEXTO DEL ORIGINAL" literal) → `comprobar` → `generar` (Codex, **una llamada para todos los slides**, con fotos del personaje, referencias de estilo y hojas de 6 slides del original) → revisión → `corregir n "cambio"` (1 imagen, edición o `REDISENO=1`) → descripción + 5 variaciones → `cerrar`.

**Lo que pide al modelo de imagen:** el **slide completo con el texto incrustado**. Ningún texto se pone encima ("tu imagen es el slide final y no le ponemos nada encima"). Reglas clave de `PROMPT_BASE.txt`:
- "escribe solo lo que va entre comillas en el guion, exactamente igual y con todas sus tildes".
- "Nada inventado: ningún otro texto, cifra, rótulo, cartel, pantalla con letras ni logo".
- "titular y texto secundario ocupan el tercio inferior… el personaje y la escena, los dos tercios superiores".
- Azul de marca "sólido y plano, sin degradado. Ni cian ni turquesa"; Montserrat Black/ExtraBold, blanco con sombra suave, sin contorno.
- "Manos: una sola acción por slide"; misma cara y ropa, pero ángulo y expresión distintos.
- Bloque LO FIJO / LO LIBRE: el modelo es "director creativo" solo en escena, luz y metáfora.

**Ficha** (`clave: valor`, `## n` por slide). Cabecera: `carrusel, slides, cta, viral, bandera, cifras_confirmadas, estilo, mascotas`. Por slide: `texto` (corta) o `titular` ("L1" / "L2"), `azul`, `arriba`, `debajo`, `cta_grande`, `idea`, `texto_escena`, `personaje`, `manos`, `ropa`, `expresion`, `subrayado`, `caja`.

**Tipos de slide (implícitos):** portada (gancho de 5 a 10 palabras), interior numerado ("2. OLLAMA"), paso, slide sin personaje (mascota/objeto) y cierre con CTA ("Comenta REPO").

**Validaciones de `ficha.py` que vale la pena portar:** cabecera completa y número de slides; palabras prohibidas leídas de REGLAS §3; `debajo` ≤ 95 caracteres; portada y cierre con 5 a 10 palabras; `azul` contenido en el titular; el cliente aparece al menos una vez; **cifras que no están en el original** (normaliza 1.2B = 1.200 millones, 10K = 10,000); en la descripción, 5 hashtags exactos, ≤ 2.200 caracteres y sin cifras ajenas a la ficha; en las variaciones, ninguna repite la primera línea ni la misma combinación de hashtags.

**Problemas de calidad conocidos:** solo ~5 de 7 slides salen bien a la primera; de 5 a 12 min por carrusel; texto que llega al borde (#11, de ahí el tope de 95 caracteres y la orden `encoger`); la cara se degrada con cada edición; Codex rehace imágenes de más (orden `elegir`); manos dobles; texto o logos inventados; cupo de ~60 imágenes al día. Casi todas las "palabras prohibidas" (`etiqueta`, `panel`, `sugerencia`) son **parches para el modelo de imagen**, no reglas de copy. No se porta: Codex, el filesystem como base de datos, los candados por PID ni el borrado de C2PA y GPS falso.

## 2. Decisión clave: texto determinista + imagen IA sin texto

**Recomendación: un sistema híbrido.** Todo el texto se renderiza con HTML/CSS → PNG. La IA solo genera escenas o fondos **sin texto**, y solo en las plantillas que lo necesitan.

Por qué:
- Ni siquiera el mejor modelo garantiza el texto. gpt-image-2 anuncia ~99 % de precisión por carácter ([DataNorth](https://datanorth.ai/news/openai-launches-gpt-image-2-with-99-text-accuracy)), pero un carrusel tiene 600 caracteres o más, así que salen unos 6 errores, justo en tildes y ñ. Para un producto de USD 5.000 eso no sirve.
- Editar un texto cuesta USD 0 y tarda 1 s, en lugar de una imagen nueva que además puede cambiar la cara.
- Las fuentes y los colores de "Mi marca" se aplican exactos, y los 7 a 10 slides salen idénticos en estilo.

**Panorama de APIs (oct-2026):**

| Proveedor | Texto en español | Consistencia / referencias | Precio aprox. por imagen vertical | Edición |
|---|---|---|---|---|
| OpenAI **gpt-image-2** | El mejor publicado (~99 %) | Hasta 8 imágenes coherentes, multi-imagen | low $0,005 · medium $0,041 · high $0,165 ([aireiter](https://aireiter.com/blog/gpt-image-2-api-pricing)) | `/images/edits` con máscara |
| Google **Nano Banana 2** (Gemini 3.1 Flash Image) / **Pro** | Pro orientado a infografías con texto | Fusión de varias referencias | NB2 1K $0,067 · Pro $0,134; batch −50 % ([myarchitectai](https://www.myarchitectai.com/blog/nano-banana-api-pricing)) | Edición por prompt |
| **Ideogram** 4.0 | Fuerte en tipografía | Referencia de estilo | Turbo $0,03 · Default $0,06 · Quality $0,10 ([pricepertoken](https://pricepertoken.com/ideogram-pricing)) | Edit/remix |
| **FLUX.2** (BFL) | Correcto | Multirreferencia | klein $0,014 · pro $0,03 (edición $0,045) · max $0,07 ([Puter](https://developer.puter.com/tutorials/flux-api-pricing/)) | Kontext/edición |
| **Recraft** V4.1 | Bueno; también vector | **Estilos guardados** (ideal para marca) | $0,035 raster · $0,08 vector · inpainting $0,04 ([Recraft](https://www.recraft.ai/docs/api-reference/pricing)) | Inpainting, quitar fondo $0,01 |

**Latencia** (estimación propia, no publicada): de 10 a 60 s por imagen. Por eso se genera en paralelo en el worker.

**Elección:** `ImageProvider` como interfaz, con gpt-image-2 (medium) como proveedor por defecto para fondos y escenas, y FLUX.2 pro o Recraft como alternativas baratas. Para la consistencia: un prompt de estilo fijo por marca, el fondo del slide 1 como referencia para los demás y "sin texto, sin letras, sin logos" en negativo. Antes de cerrar la elección, hacer un *bake-off* de 1 día con 3 fichas reales, como pide CLAUDE.md.

**Dónde se renderiza:**
- **Satori/@vercel/og** solo admite flexbox (sin grid), fuentes ttf/otf/woff (sin woff2) y un bundle de 500 KB ([Vercel](https://vercel.com/docs/og-image-generation)). Además, CLAUDE.md prohíbe generar imágenes en funciones serverless.
- **Decisión: Chromium (Playwright) en el worker.** Las plantillas son componentes React que se usan para dos cosas:
  1. La vista previa en vivo en el navegador (DOM a 1080×1350, escalado con `transform`).
  2. Un render del worker idéntico al píxel a esa vista previa.
- El ajuste automático del texto (bajar el tamaño de la fuente hasta que no desborde) reemplaza los parches de "95 caracteres" y `encoger`.

## 3. Flujo y UX (ruta de pasos)

1. **Origen:** tema, guion (desde Guiones) o link de referencia. Se eligen la CTA (palabra a comentar) y el número de slides (de 5 a 10).
2. **Ficha con IA:** Claude con salida estructurada (esquema Zod) genera un objeto por slide con estos campos:
   - `type`: `cover | item | step | data | quote | cta`
   - `kicker`, `headline[]`, `highlight`, `body`, `cta`
   - `visual`: `none | ai_scene | creator_photo`
   - `scenePrompt`
   - `sourceFigures`

   Los prompts se guardan en `lib/ai/prompts/carousel/` y piden español neutro, o el idioma de la marca.
3. **Edición por slide:** la ficha queda a la izquierda y la vista previa en vivo a la derecha. Las validaciones portadas aparecen en línea: cifras no confirmadas, longitud, palabras prohibidas de Mi marca, `highlight` fuera del titular. Se pueden reordenar, duplicar y borrar slides.
4. **Plantilla:** colores y fuentes salen de `brand_profile`. Hay 5 plantillas premium:
   - **Editorial** (solo texto, tipografía grande).
   - **Foto + texto** (escena IA en los 2/3 superiores, texto abajo: el look actual).
   - **Tweet** (avatar, handle y texto).
   - **Lista/datos** (números grandes, ítems).
   - **Creador** (foto real del creador recortada con quitar fondo; **sin IA en la cara**).
5. **Render:** se crea un trabajo pg-boss → el worker genera las escenas IA en paralelo, renderiza con Chromium y sube los PNG a Storage. El progreso se ve en vivo.
6. **Ajuste por slide:**
   - "Editar texto": nuevo render, USD 0.
   - "Otra escena": 1 imagen nueva.
   - "Corregir zona": edición con máscara.
   - "Cambiar plantilla de este slide".
7. **Exportar:** ZIP con JPG 1080×1350 + caption + 5 hashtags. Se portan los prompts de descripción y de variaciones con sus validaciones. Los metadatos C2PA del proveedor **se conservan**.
8. **Enviar a Calendario:** se crea una pieza con estado "listo" y red Instagram.

## 4. Carrusel de referencia

- **Obtención:** ScrapeCreators `/v1/instagram/post`, portando `link_limpio`, la detección de reel o foto suelta y la descarga de todo o nada. Cuesta ~1 crédito, a unos USD 0,001–0,002 ([socialcrawl](https://www.socialcrawl.dev/blog/best-instagram-data-apis-2026)). Como respaldo, el Instagram Scraper de Apify, a ~USD 1,50 por cada 1.000 resultados.
- **Lectura:** Claude con visión, en una sola llamada con todos los slides, devuelve el texto literal (OCR), el rol de cada slide, el patrón de diseño y la idea visual. Ese texto es la fuente del chequeo de cifras.
- **Adaptación sin copiar:** se copia la *estructura* (número de slides, arco gancho → ítems → CTA, tipo de slide), nunca las frases. El prompt reescribe con el ángulo de la marca y prohíbe el @, los logos y las imágenes del original. Un control de solapamiento de n-gramas avisa si una línea queda demasiado parecida. Las imágenes del original solo sirven para el análisis y nunca se envían al generador.

## 5. MVP vs v2, esfuerzo y costo

**MVP (5 días hábiles, suponiendo que el worker y la cola ya existen):**
- Esquema de ficha, validaciones en TS y prompts de ficha y caption: 1,5 d.
- Editor por slide con vista previa en vivo: 1,5 d.
- 3 plantillas deterministas (Editorial, Tweet, Lista) con datos de Mi marca: 1 d.
- Render con Playwright en el worker, ZIP y envío a Calendario: 1 d.
- Sin imágenes IA y sin referencia. Ya resuelve el 100 % del texto legible.

Si el worker todavía no existe, hacen falta +2 d, o una excepción temporal para usar Satori en una función, **que requiere tu aprobación** porque contradice CLAUDE.md.

**v1.1 (+3 d):** plantilla Foto + texto con gpt-image-2 detrás de `ImageProvider`, "otra escena", entrada por referencia (ScrapeCreators + visión) y el bake-off de proveedores.

**v2 (+6–8 d):** plantilla Creador con recorte y escenas con referencia facial opcional, plantillas 5 y 6, edición con máscara, estilos de marca guardados (Recraft), 5 variaciones de caption, modo "slide IA completo" opcional con verificación OCR automática contra la ficha, y animación de un slide.

**Costo por carrusel (8 slides):**
- MVP: ~USD 0,05–0,10 (solo Claude; estimación, verificar tarifas vigentes de Anthropic).
- Con 4 escenas IA medium: +USD 0,16. En high: +USD 0,66.
- Con referencia: +~USD 0,05 de visión y +USD 0,002 de scraping.
- **Típico: USD 0,25–0,40. Peor caso, con reintentos: ~USD 1.**
- Tiempo total: menos de 2 min, frente a los 5–12 min actuales.

**Advertencia:** no esperes a tener las 5 plantillas ni el modo IA completo para mostrarlo. Con las 3 plantillas deterministas ya se puede hacer la demo de venta.
