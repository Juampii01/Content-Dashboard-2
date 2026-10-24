/**
 * Lo que se trajo de carrusel-creator-pro (sin base de datos ni IA): elección de la foto de tu cara por slide,
 * comprobaciones de la ficha de un carrusel copiado, variaciones del caption, prompts de imagen y huella del video.
 *   pnpm test:carruseles
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEFAULT_POSES, defaultPose, pickPhotos, scorePhoto, wantedTraits, type CharacterPhoto } from "../lib/carousels/character";
import { cleanTags, variantWarnings, variantsText } from "../lib/carousels/captions";
import { correctionPrompt, imagePrompt } from "../lib/carousels/images/prompt";
import { slideHash } from "../lib/carousels/slide-hash";
import { looksCopied, validateCarousel } from "../lib/carousels/validate";
import type { CarouselSlide, CaptionVariant } from "../lib/db/schema";

const photos: CharacterPhoto[] = [
  { key: "marca/fotos/aaaaaaaaaaaaaaaa.jpg", url: null, traits: { angle: "frontal", expression: "smile", framing: "close", gaze: "camera", quality: 0.9 } },
  { key: "marca/fotos/bbbbbbbbbbbbbbbb.jpg", url: null, traits: { angle: "three_quarter", expression: "thinking", framing: "medium", gaze: "away", quality: 0.8 } },
  { key: "marca/fotos/cccccccccccccccc.jpg", url: null, traits: { angle: "profile", expression: "serious", framing: "wide", gaze: "away", quality: 0.7 } },
];

function slide(over: Partial<CarouselSlide> = {}): CarouselSlide {
  return { id: Math.random().toString(36).slice(2, 10), type: "item", kicker: "", headline: "Un titular claro", highlight: "", body: "", cta: "", ...over };
}

describe("tu personaje: qué foto se manda", () => {
  test("lee la pose en español", () => {
    assert.deepEqual(wantedTraits("De perfil, mirando a lo lejos, serio"), { angle: "profile", expression: "serious", gaze: "away" });
    assert.equal(wantedTraits("tres cuartos, mano en la barbilla, pensativo").angle, "three_quarter");
    assert.equal(wantedTraits("tres cuartos, mano en la barbilla, pensativo").expression, "thinking");
    assert.equal(wantedTraits("primer plano, sonrisa cómplice, mirando a cámara").framing, "close");
    assert.deepEqual(wantedTraits(""), {});
  });

  test("elige la foto que mejor encaja y suma otra para fijar la cara", () => {
    assert.deepEqual(pickPhotos(photos, "de perfil, serio, mirando a lo lejos", 0), [photos[2]!.key, photos[1]!.key]);
    assert.equal(pickPhotos(photos, "tres cuartos, pensativo", 3)[0], photos[1]!.key);
    assert.equal(pickPhotos(photos, "de frente, sonriendo, señala a cámara", 5)[0], photos[0]!.key);
  });

  test("la foto elegida a mano va primero; una que ya no existe se ignora", () => {
    assert.equal(pickPhotos(photos, "de perfil", 0, photos[0]!.key)[0], photos[0]!.key);
    assert.equal(pickPhotos(photos, "de perfil", 0, "marca/fotos/borrada00000000.jpg")[0], photos[2]!.key);
  });

  test("sin rasgos, rota entre fotos para que los slides seguidos no repitan", () => {
    const plain = photos.map((p) => ({ ...p, traits: null }));
    const firsts = [0, 1, 2].map((i) => pickPhotos(plain, "lo que sea", i, null, 1)[0]);
    assert.equal(new Set(firsts).size, 3);
  });

  test("sin pedido, prefiere la cara de frente y nítida", () => {
    assert.ok(scorePhoto(photos[0]!.traits, {}) > scorePhoto(photos[2]!.traits, {}));
  });

  test("poses de respaldo distintas entre slides seguidos", () => {
    for (let i = 0; i < 10; i++) assert.notEqual(defaultPose(i), defaultPose(i + 1));
    assert.equal(defaultPose(-1), DEFAULT_POSES[DEFAULT_POSES.length - 1]);
  });
});

describe("prompts de imagen", () => {
  const brand = { niche: "clínicas dentales", colors: { primary: "#0070f8" } };
  test("con personaje: su cara de las fotos, la pose y nadie más", () => {
    const p = imagePrompt({ scene: "Oficina luminosa", slide: { type: "cover", headline: "Titular" }, textPlacement: "below", brand, withReference: true, character: { photos: 2, pose: "de frente, señala a cámara" } });
    assert.match(p, /las imágenes 1 y 2/);
    assert.match(p, /POSE: de frente, señala a cámara\./);
    assert.match(p, /Una sola acción con las manos/);
    assert.match(p, /La cara sale de las fotos/);
    assert.doesNotMatch(p, /Sin personas reconocibles/);
    assert.match(p, /PROHIBIDO: cualquier texto/);
  });
  test("sin personaje: sin personas", () => {
    const p = imagePrompt({ scene: "Escritorio", slide: { type: "item", headline: "x" }, textPlacement: "over", brand, withReference: false });
    assert.match(p, /Sin personas reconocibles/);
    assert.doesNotMatch(p, /PERSONAJE/);
  });
  test("corrección: edita la imagen que va después de las fotos", () => {
    assert.match(correctionPrompt({ instruction: "que mire a cámara", character: { photos: 2 } }), /Edita la imagen 3/);
    assert.match(correctionPrompt({ instruction: "más luz.", character: null }), /Edita la imagen 1[\s\S]*Único cambio: más luz\./);
  });
});

describe("comprobación de la ficha (copiar un carrusel)", () => {
  const base = { caption: "Caption con CTA", hashtags: ["#a", "#b", "#c", "#d", "#e"], bannedWords: [] as string[] };

  test("avisa si el texto repite frases del original", () => {
    assert.ok(looksCopied("These 5 AI tools replace a whole marketing team for you", "THESE 5 AI TOOLS REPLACE A WHOLE MARKETING TEAM FOR YOU"));
    assert.ok(!looksCopied("5 herramientas de AI que trabajan por todo tu equipo", "5 AI TOOLS THAT REPLACE A $3,000/MONTH TEAM"));
    assert.ok(!looksCopied("2. GAMMA", "2. GAMMA Decks in 30 seconds"));
  });

  test("cifras: valen las del original aunque cambie el formato; las nuevas se marcan", () => {
    const slides = [slide({ type: "cover", headline: "5 herramientas de AI que hacen todo tu trabajo" }), slide({ headline: "2. GAMMA", body: "Ya la usan 50M de personas y cuesta 3.000 al mes" }), slide({ type: "cta", headline: "¿Quieres la lista completa con todos los links?", cta: "Comenta AI" })];
    const w = validateCarousel({ ...base, slides, sourceText: "SLIDE 1: 5 AI TOOLS\nSLIDE 2: 2. GAMMA Decks in 30 seconds. 50M users. $3,000/month" });
    assert.ok(!w.some((x) => /Cifras/.test(x.message)), JSON.stringify(w));
    const w2 = validateCarousel({ ...base, slides: [...slides.slice(0, 2), slide({ type: "cta", headline: "Más de 900 clientes ya lo usan cada día", cta: "Comenta AI" })], sourceText: "50M users" });
    assert.ok(w2.some((x) => /Cifras que no están/.test(x.message) && /900/.test(x.message)));
  });

  test("avisa si se cuela el @ del original", () => {
    const slides = [slide({ type: "cover", headline: "Sígueme como @cuentaviral para más" }), slide({ type: "cta", headline: "x", cta: "Comenta AI" })];
    const w = validateCarousel({ ...base, slides, sourceText: null, copy: { handle: "@cuentaviral" } });
    assert.ok(w.some((x) => /cuenta del original/.test(x.message)));
  });

  test("tu cara al menos una vez, y avisa si no hay fotos", () => {
    const slides = [slide({ type: "cover", character: false }), slide({ type: "cta", character: false, cta: "Comenta AI" })];
    const w = validateCarousel({ ...base, slides, sourceText: null, copy: { handle: null }, characterPhotos: 2 });
    assert.ok(w.some((x) => x.field === "character" && /no sale en ningún slide/.test(x.message)));
    const w2 = validateCarousel({ ...base, slides: [slide({ type: "cover", character: true }), slides[1]!], sourceText: null, characterPhotos: 0 });
    assert.ok(w2.some((x) => /no subiste fotos/.test(x.message)));
  });
});

describe("variaciones del caption", () => {
  const v = (hook: CaptionVariant["hook"], first: string, tags: string[]): CaptionVariant => ({ hook, caption: `${first}\n\nCuerpo.\n\n💬 Comenta AI`, hashtags: tags });
  const tags = (n: number) => ["#ai", `#tema${n}`, "#negocios", `#otro${n}`, "#marketing"];

  test("5 distintas no tienen avisos", () => {
    const list = (["dato", "pregunta", "problema", "promesa", "curiosidad"] as const).map((h, i) => v(h, `Primera ${i}`, tags(i)));
    const r = variantWarnings(list, "carrusel", 7);
    assert.deepEqual(r.all, []);
    assert.ok(r.byIndex.every((x) => x.length === 0));
  });

  test("marca hashtags que no son 5, primeras líneas y combinaciones repetidas, y cifras inventadas", () => {
    const list = [v("dato", "Igual", tags(1)), v("pregunta", "Igual", tags(1)), { ...v("promesa", "Gana 900 clientes", tags(2)), hashtags: ["#a"] }];
    const r = variantWarnings(list, "El carrusel dice 50M", 7);
    assert.ok(r.all.some((m) => /tienen que ser 5/.test(m)));
    assert.ok(r.all.some((m) => /empiezan igual/.test(m)));
    assert.ok(r.all.some((m) => /mismos hashtags/.test(m)));
    assert.ok(r.byIndex[2]!.some((m) => /1 hashtags/.test(m)));
    assert.ok(r.byIndex[2]!.some((m) => /900/.test(m)));
  });

  test("hashtags en minúscula, sin tildes y sin repetir", () => {
    assert.deepEqual(cleanTags(["#Automatización", "automatizacion", "#AI ", "#Marketing-Digital", "#ñandú"]), ["#automatizacion", "#ai", "#marketingdigital", "#ñandu"]);
  });

  test("variaciones.txt numerado con su tipo de gancho", () => {
    const t = variantsText([v("dato", "Hola", tags(1))]);
    assert.match(t, /^=== VARIACIÓN 1 · Con un dato ===/);
    assert.match(t, /#ai #tema1/);
  });
});

describe("video de un slide", () => {
  test("la huella cambia si cambia lo que se ve", () => {
    const s = slide({ headline: "Hola", imageUrl: null });
    const h = slideHash(s, "editorial", { palette: "marca" });
    assert.match(h, /^[0-9a-f]{8}$/);
    assert.equal(h, slideHash({ ...s, pose: "otra pose", scenePrompt: "otra escena" }, "editorial", { palette: "marca" }));
    assert.notEqual(h, slideHash({ ...s, headline: "Hola!" }, "editorial", { palette: "marca" }));
    assert.notEqual(h, slideHash(s, "foto", { palette: "marca" }));
    assert.notEqual(h, slideHash(s, "editorial", { palette: "papel" }));
  });
});
