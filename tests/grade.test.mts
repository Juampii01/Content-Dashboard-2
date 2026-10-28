/**
 * Color del video principal (lib/video/grade.ts): la matriz que comparten la vista previa (filtro SVG) y el render (LUT).
 *   pnpm test:color
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cleanGrade, GRADE_PRESETS, gradeMatrix, matchingGradePreset, NEUTRAL_GRADE, presetGrade } from "../lib/video/grade";
import { applyReview } from "../lib/video/review";
import { assemblePlan } from "../lib/video/plan";

const apply = (m: number[], rgb: [number, number, number]) => [0, 1, 2].map((r) => m[r * 4]! * rgb[0] + m[r * 4 + 1]! * rgb[1] + m[r * 4 + 2]! * rgb[2] + m[r * 4 + 3]!);

describe("color del video", () => {
  test("sin ajustes no hay matriz ni campo en el plan", () => {
    assert.equal(gradeMatrix(NEUTRAL_GRADE, "#2457f5"), null);
    assert.equal(gradeMatrix(null, "#2457f5"), null);
    assert.equal(cleanGrade({}), null);
    assert.equal(cleanGrade({ brightness: 0, saturation: 0 }), null);
  });

  test("cálido sube el rojo y baja el azul; frío al revés", () => {
    const gris: [number, number, number] = [0.5, 0.5, 0.5];
    const [r1, , b1] = apply(gradeMatrix(presetGrade("calido"), "#000000")!, gris);
    assert.ok(r1! > 0.5 && b1! < 0.5, `cálido: ${r1} ${b1}`);
    const [r2, , b2] = apply(gradeMatrix(presetGrade("frio"), "#000000")!, gris);
    assert.ok(r2! < 0.5 && b2! > 0.5, `frío: ${r2} ${b2}`);
  });

  test("blanco y negro deja los tres canales iguales", () => {
    const [r, g, b] = apply(gradeMatrix(presetGrade("bn"), "#000000")!, [0.8, 0.3, 0.1]);
    assert.ok(Math.abs(r! - g!) < 1e-6 && Math.abs(g! - b!) < 1e-6);
  });

  test("cada preset se reconoce y es válido", () => {
    for (const p of GRADE_PRESETS) {
      const g = presetGrade(p.id);
      assert.equal(matchingGradePreset(p.id === "natural" ? null : cleanGrade(g)), p.id, p.id);
    }
    assert.equal(matchingGradePreset(cleanGrade({ brightness: 0.11 })), null, "ajuste a mano");
  });

  test("valores fuera de rango no entran", () => {
    assert.equal(cleanGrade({ brightness: 5 }), null);
  });

  test("la revisión guarda, cambia y quita el color en el plan", () => {
    const words = Array.from({ length: 10 }, (_, i) => ({ id: i, text: `p${i}`, start: i * 0.5, end: i * 0.5 + 0.4 }));
    const plan = assemblePlan({ ai: null, candidates: [], words, duration: 5, format: "9:16", preset: "clasico", corrections: {}, offScript: [] } as never);
    const base = { removed: [], selectedHook: null, preset: plan.captions.preset, offsetX: 0, corrections: {} };
    const p1 = applyReview(plan, { ...base, grade: presetGrade("cine") }, words, 5, "9:16");
    assert.equal(p1.grade?.contrast, presetGrade("cine").contrast);
    const p2 = applyReview(p1, { ...base, grade: null }, words, 5, "9:16");
    assert.equal(p2.grade, undefined);
    const p3 = applyReview(p1, base, words, 5, "9:16");
    assert.deepEqual(p3.grade, p1.grade, "sin el campo se deja lo que había");
  });
});
