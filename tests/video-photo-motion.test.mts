/**
 * Fotos con movimiento: esquema (planes de antes sin el campo), "Automático" determinista, recorridos, la cuenta de la
 * cámara (la misma que repite el worker en worker/video/broll_edit.py y prueba worker/tests/test_photo_motion.py), lo
 * que se manda al worker y lo que reciben las fotos nuevas al entrar al plan.
 *   pnpm test:video
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  AUTO_MOTIONS,
  brollEditSchema,
  brollRenderEdit,
  containSize,
  DEFAULT_EDIT,
  editSummary,
  isDefaultEdit,
  motionAt,
  motionEase,
  motionMaxScale,
  motionPath,
  motionSchema,
  motionTransform,
  PHOTO_DEFAULTS,
  photoRender,
  resolveEdit,
  resolveMotionKind,
  seedHash,
  type MotionPath,
} from "../lib/video/broll-edit";
import { withLibraryStart } from "../lib/video/library-ficha";
import type { BrollItem, BrollOption } from "../lib/video/types";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const motion = (kind: string, amount = 0.15, ease: "linear" | "smooth" = "linear") => motionSchema.parse({ kind, amount, ease });

describe("esquema", () => {
  test("un plan de antes (sin motion ni fit) queda sin movimiento y recortado, igual que antes", () => {
    const edit = resolveEdit({ layout: "card" });
    assert.equal(edit.motion, undefined);
    assert.equal(edit.fit, undefined);
    assert.equal(photoRender(edit, "b1"), null);
    assert.ok(isDefaultEdit(resolveEdit({})));
    // Lo que va al worker para una foto de antes no cambia: no lleva `photo`.
    const before = brollRenderEdit({ edit: resolveEdit({}), format: "9:16", duration: 3, clipWidth: 1600, clipHeight: 900, accent: "#0070F8", ground: "#030A22", image: true, seed: "b1" });
    assert.equal("photo" in before, false);
    const video = brollRenderEdit({ edit: resolveEdit({}), format: "9:16", duration: 3, clipWidth: 1600, clipHeight: 900, accent: "#0070F8", ground: "#030A22" });
    assert.deepEqual(before, video);
  });

  test("valores por defecto y límites", () => {
    const m = motionSchema.parse({});
    assert.deepEqual(m, { kind: "none", amount: 0.15, ease: "smooth" });
    assert.equal(brollEditSchema.safeParse({ motion: { kind: "zoom_in", amount: 0.5 } }).success, false);
    assert.equal(brollEditSchema.safeParse({ motion: { kind: "girar" } }).success, false);
    assert.equal(brollEditSchema.safeParse({ fit: "contain" }).success, false);
    assert.deepEqual(PHOTO_DEFAULTS, { motion: { kind: "auto", amount: 0.15, ease: "smooth" }, fit: "blur" });
  });

  test("el resumen dice que la foto se mueve", () => {
    const edit = resolveEdit({ ...PHOTO_DEFAULTS });
    assert.equal(editSummary(edit, "9:16"), "Con movimiento · Fondo desenfocado");
    assert.equal(editSummary(resolveEdit({ motion: { kind: "none" } }), "9:16"), null);
  });
});

describe("Automático", () => {
  test("es determinista según el id y reparte entre los seis movimientos", () => {
    assert.equal(seedHash("abc"), seedHash("abc"));
    assert.equal(resolveMotionKind("auto", "b-123"), resolveMotionKind("auto", "b-123"));
    const seen = new Set(Array.from({ length: 60 }, (_, i) => resolveMotionKind("auto", `broll-${i}`)));
    assert.equal(seen.size, AUTO_MOTIONS.length);
    assert.equal(resolveMotionKind("zoom_out", "x"), "zoom_out");
    // FNV-1a conocido: "a" → 0xe40c292c.
    assert.equal(seedHash("a"), 0xe40c292c);
  });
});

describe("recorridos", () => {
  test("acercar, alejar y los cuatro recorridos", () => {
    const s = 1.15;
    const near = 0.5 / s;
    assert.equal(motionPath(motion("none"), "x"), null);
    assert.equal(motionPath(undefined, "x"), null);
    assert.deepEqual(motionPath(motion("zoom_in"), "x"), { from: { scale: 1, x: 0.5, y: 0.5 }, to: { scale: s, x: 0.5, y: 0.5 }, ease: "linear" });
    assert.deepEqual(motionPath(motion("zoom_out"), "x"), { from: { scale: s, x: 0.5, y: 0.5 }, to: { scale: 1, x: 0.5, y: 0.5 }, ease: "linear" });
    const left = motionPath(motion("pan_left"), "x")!;
    close(left.from.x, 1 - near);
    close(left.to.x, near);
    const right = motionPath(motion("pan_right"), "x")!;
    close(right.from.x, near);
    close(right.to.x, 1 - near);
    const up = motionPath(motion("pan_up"), "x")!;
    close(up.from.y, 1 - near);
    close(up.to.y, near);
    assert.equal(up.from.x, 0.5);
    const down = motionPath(motion("pan_down"), "x")!;
    close(down.from.y, near);
    close(down.to.y, 1 - near);
    assert.equal(motionMaxScale(down), s);
    assert.equal(motionMaxScale(null), 1);
  });

  test("la intensidad cambia cuánto se acerca o cuánto recorre", () => {
    assert.equal(motionPath(motion("zoom_in", 0.35), "x")!.to.scale, 1.35);
    const soft = motionPath(motion("pan_right", 0.05), "x")!;
    const strong = motionPath(motion("pan_right", 0.35), "x")!;
    assert.ok(strong.to.x - strong.from.x > soft.to.x - soft.from.x);
  });
});

describe("la cámara (misma cuenta que el worker)", () => {
  const zoom: MotionPath = { from: { scale: 1, x: 0.5, y: 0.5 }, to: { scale: 1.2, x: 0.5, y: 0.5 }, ease: "smooth" };

  test("curvas", () => {
    assert.equal(motionEase("linear", 0.3), 0.3);
    close(motionEase("smooth", 0.5), 0.5);
    assert.equal(motionEase("smooth", 0), 0);
    assert.equal(motionEase("smooth", 1), 1);
    assert.equal(motionEase("linear", 2), 1);
    assert.equal(motionEase("linear", -1), 0);
  });

  test("escala geométrica y centro en línea recta (números que prueba también el worker)", () => {
    close(motionAt(zoom, 0.5).scale, Math.sqrt(1.2));
    close(motionAt(zoom, 0).scale, 1);
    close(motionAt(zoom, 1).scale, 1.2);
    close(motionAt(zoom, 0.25).scale, Math.pow(1.2, (1 - Math.cos(Math.PI * 0.25)) / 2));
    const s = 1.15;
    const pan: MotionPath = { from: { scale: s, x: 1 - 0.5 / s, y: 0.5 }, to: { scale: s, x: 0.5 / s, y: 0.5 }, ease: "linear" };
    close(motionAt(pan, 0.5).x, 0.5);
    close(motionAt(pan, 0.25).x, 1 - 0.5 / s + (0.5 / s - (1 - 0.5 / s)) * 0.25);
    close(motionAt(pan, 2).x, 0.5 / s);
  });

  test("nunca deja ver fuera de la foto ni baja de escala 1", () => {
    const out = motionPath(motion("zoom_out", 0.15), "x")!;
    for (let i = 0; i <= 100; i++) {
      const m = motionAt(out, i / 100);
      assert.ok(m.scale >= 1);
      const half = 0.5 / m.scale;
      assert.ok(m.x - half >= -1e-12 && m.x + half <= 1 + 1e-12);
      assert.ok(m.y - half >= -1e-12 && m.y + half <= 1 + 1e-12);
    }
    // Un recorrido roto (centro afuera) se acota.
    const bad: MotionPath = { from: { scale: 1.1, x: 0, y: 1 }, to: { scale: 1.1, x: 0, y: 1 }, ease: "linear" };
    const m = motionAt(bad, 0.5);
    close(m.x, 0.5 / 1.1);
    close(m.y, 1 - 0.5 / 1.1);
  });

  test("la transformación lleva el centro de la cámara al centro del marco", () => {
    const st = { scale: 1.3, x: 0.4, y: 0.6 };
    const tr = motionTransform(st);
    // Un punto p del cuadro base cae en p·scale + t.
    close(st.x * tr.scale + tr.tx, 0.5);
    close(st.y * tr.scale + tr.ty, 0.5);
    // Sin movimiento, identidad.
    assert.deepEqual(motionTransform({ scale: 1, x: 0.5, y: 0.5 }), { scale: 1, tx: 0, ty: 0 });
  });

  test("pasos parejos entre cuadros (sin saltos) a 30 fps", () => {
    const path = motionPath(motion("pan_right", 0.15, "linear"), "x")!;
    const frames = 90;
    const xs = Array.from({ length: frames }, (_, i) => motionAt(path, i / frames).x * 1080);
    const steps = xs.slice(1).map((x, i) => x - xs[i]!);
    for (const d of steps) close(d, steps[0]!, 1e-9);
  });
});

describe("fondo desenfocado", () => {
  test("la foto entera dentro del marco", () => {
    assert.deepEqual(containSize(1600, 900, 1080, 1920), { w: 1080, h: 607.5 });
    assert.deepEqual(containSize(900, 1600, 1080, 1920), { w: 1080, h: 1920 });
    assert.deepEqual(containSize(0, 0, 1080, 1920), { w: 1080, h: 1920 });
  });

  test("lo que se manda al worker: encaje, recorrido resuelto y desenfoque", () => {
    const edit = resolveEdit({ ...PHOTO_DEFAULTS });
    const r = brollRenderEdit({ edit, format: "9:16", duration: 3, clipWidth: 1600, clipHeight: 900, accent: "#0070F8", ground: "#030A22", image: true, seed: "b-7" });
    assert.ok(r.photo);
    assert.equal(r.photo.fit, "blur");
    assert.deepEqual(r.photo.motion, motionPath({ ...edit.motion!, kind: resolveMotionKind("auto", "b-7") }, "b-7"));
    assert.deepEqual(r.photo.blur, { sigma: 0.05, overscan: 1.2, dim: 0.78 });
    // Un video con los mismos campos no lleva movimiento (solo fotos).
    const video = brollRenderEdit({ edit, format: "9:16", duration: 3, clipWidth: 1600, clipHeight: 900, accent: "#0070F8", ground: "#030A22", seed: "b-7" });
    assert.equal(video.photo, undefined);
    // Solo fondo desenfocado (sin movimiento) también va.
    const still = brollRenderEdit({ edit: resolveEdit({ fit: "blur" }), format: "9:16", duration: 3, clipWidth: 1600, clipHeight: 900, accent: "#0070F8", ground: "#030A22", image: true, seed: "b-7" });
    assert.deepEqual(still.photo?.motion, null);
  });
});

describe("fotos nuevas en el plan", () => {
  const image: BrollOption = { source: "library", id: "11111111-1111-1111-1111-111111111111", duration: 0, width: 1600, height: 900, key: "editor/biblioteca/x/original.jpg", kind: "image" };
  const video: BrollOption = { ...image, duration: 12, kind: undefined };
  const item = (choice: BrollOption, edit?: BrollItem["edit"]): BrollItem => ({ id: "b1", from_word: 0, to_word: 4, query_en: "", keywords: [], choice, options: [choice], ...(edit ? { edit } : {}) });

  test("una imagen que entra al plan lleva movimiento automático y fondo desenfocado", () => {
    const out = withLibraryStart(item(image), 3);
    assert.deepEqual(out.edit?.motion, PHOTO_DEFAULTS.motion);
    assert.equal(out.edit?.fit, "blur");
    assert.equal(out.edit?.clip_start, 0);
  });

  test("respeta lo que ya eligió la persona y no toca los videos", () => {
    const chosen = withLibraryStart(item(image, { motion: { kind: "pan_up", amount: 0.2, ease: "linear" }, fit: "cover" }), 3);
    assert.deepEqual(chosen.edit?.motion, { kind: "pan_up", amount: 0.2, ease: "linear" });
    assert.equal(chosen.edit?.fit, "cover");
    const keepFit = withLibraryStart(item(image, { fit: "cover", layout: "card" }), 3);
    assert.equal(keepFit.edit?.fit, "cover");
    assert.equal(keepFit.edit?.layout, "card");
    const v = withLibraryStart(item(video), 3);
    assert.equal(v.edit?.motion, undefined);
    assert.equal(v.edit?.fit, undefined);
  });

  test("DEFAULT_EDIT no trae movimiento (Restablecer en un video sigue igual)", () => {
    assert.equal(DEFAULT_EDIT.motion, undefined);
    assert.equal(DEFAULT_EDIT.fit, undefined);
  });
});
