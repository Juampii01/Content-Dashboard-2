# Música, sonidos y licencias del Estudio

Qué música y qué sonidos trae el Estudio, de dónde salen y qué puede hacer el cliente con ellos.

## 1. Música generada (por defecto)

- **Qué es:** un generador propio (`lib/video/music-gen/engine.ts`) que compone por síntesis: piano eléctrico FM,
  cuerdas pulsadas (Karplus-Strong), colchones y cuerdas con tablas de onda, campanas FM, bajo y 808, batería
  sintetizada, reverb de sala, sidechain y un master con saturación suave. No usa muestras, loops ni grabaciones de
  terceros.
- **Biblioteca:** 7 estilos (lo-fi, motivacional, trap suave, ambiente, acústico, electrónica tensa, épica) × 20 pistas
  = 140 pistas con nombre, semilla y tempo fijos (`lib/video/music-gen/catalog.ts`). Además, "a medida": cualquier
  estilo con el tempo que elija la persona y otra variación (otra semilla).
- **Licencia:** el código y su salida son nuestros. El cliente usa la música en sus videos (incluso con fines
  comerciales y en anuncios) sin atribución ni pagos. Como la pista se arma en cada render, no hay archivos que
  distribuir ni que puedan reclamarse. Si una plataforma (Content ID) llegara a marcar algo, no hay un titular externo:
  es un falso positivo.
- **Igual en la vista previa y en el render:** el navegador arma la pista a 32 kHz con el mismo código; el worker la
  arma a 48 kHz (`worker/motion/music.mjs` + `music-engine.mjs`, empaquetado con `pnpm motion:bundle`) y la mezcla
  bajo la voz con el ducking de siempre (`render.mix_audio`). Queda en caché por estilo, semilla, tempo, duración y
  versión del generador.

## 2. Efectos de sonido

- 40 sonidos procedurales (`worker/scripts/make_sfx.py`): transiciones (whoosh, swipe, riser…), golpes (impacto,
  boom…), interfaz (pop, clic, ding, notificación…) y efectos (glitch, cámara, magia, moneda, latido…).
- Están en `worker/assets/sfx` (render) y `public/sfx` (vista previa), normalizados igual. Licencia propia: mismo
  criterio que la música generada. Lista y nombres en español: `lib/video/sfx-library.ts`.
- Los automáticos ("Sutil" / "Marcado") siguen como antes. Los que pone la persona en la pista de Sonido y el de cada
  transición suenan siempre (también con "Sin efectos"), anclados a una palabra para que sobrevivan a los cortes.

## 3. Catálogo externo opcional: Jamendo

Interfaz `MusicProvider` (`lib/video/music-providers/types.ts`) con un proveedor, Jamendo
(`lib/video/music-providers/jamendo.ts`). El cliente guarda su **client_id** en Ajustes → Claves de servicios (cifrado
con AES-256-GCM, contexto `jamendo.client_id`). Se busca desde Estudio → Biblioteca → Música.

**Licencias que se aceptan:** solo **CC BY** (cualquier versión) y CC0. Se piden a la API sin NC, ND ni SA
(`ccnc=false&ccnd=false&ccsa=false`) y se vuelve a revisar la URL de la licencia de cada pista:

| Licencia | ¿Se usa? | Por qué |
|---|---|---|
| CC BY | Sí | Uso comercial permitido con atribución. |
| CC0 / dominio público | Sí | Sin condiciones. |
| CC BY-NC (y combinaciones NC) | No | Prohíbe el uso comercial: una marca personal vende con sus videos. |
| CC BY-ND | No | Sincronizar música con imagen cuenta como obra derivada en CC 4.0. |
| CC BY-SA | No | Obligaría a licenciar el video con la misma licencia. |

**Atribución automática:** al usar una pista se baja una vez a la biblioteca del cliente (`music_tracks` con
`source = "jamendo"`, `attribution`, `license_url`, `external_id`) y la atribución («Título» de Artista (CC BY 4.0) ·
Jamendo · link) va sola en el archivo de créditos del render, junto a los del b-roll de stock. El Estudio la muestra al
elegir la pista.

**Condiciones de la API de Jamendo (importante):** según sus términos
(https://devportal.jamendo.com/api_terms_of_use) la API es **gratis solo para uso no comercial**; para uso comercial
hay que pedir un acuerdo a Jamendo (licensing@jamendo.com). También piden nombrar a los artistas y a Jamendo con un
link a cada pista, no imitar su marca y no armar la app para guardar su catálogo. Por eso:

- La integración es **opcional** y está apagada hasta que el cliente pone su client_id.
- Ajustes avisa de esta condición antes de conectar.
- Solo se baja la pista que se usa en un video (no se guarda el catálogo).
- La música generada (sección 1) cubre el uso normal sin depender de terceros.

Para probar sin red: `JAMENDO_API_BASE` apunta a un simulador (ver `tests/mocks/jamendo-mock.mjs`).

**Otros catálogos evaluados (24-oct-2026):** Openverse (agrega Jamendo y otros, pero no garantiza las licencias ni
aclara el uso comercial de la API), Freesound (API no comercial sin acuerdo), Pixabay (su API pública no incluye
música). Ninguno tenía condiciones más claras para una app comercial.
