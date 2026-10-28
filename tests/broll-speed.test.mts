/** Velocidad del b-roll (lib/video/broll-edit.ts): la cuenta que comparten la vista previa y el worker. pnpm test:video */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { brollEditSchema, brollRenderEdit, clipTimeAt, editSummary, isDefaultEdit, resolveEdit, speedLabel } from "../lib/video/broll-edit";

describe("velocidad del b-roll", () => {
  test("un plan viejo (sin el campo) sigue igual: velocidad 1 y edición por defecto", () => {
    const e = resolveEdit({});
    assert.equal(e.speed, 1);
    assert.equal(isDefaultEdit(e), true);
    const r = brollRenderEdit({ edit: e, format: "9:16", duration: 3, clipWidth: 1920, clipHeight: 1080, accent: "#2457f5", ground: "#000000" });
    assert.equal("speed" in r, false, "al worker no le llega nada nuevo");
  });

  test("a 2× se recorre el doble de clip; a 0,5×, la mitad", () => {
    assert.equal(clipTimeAt(1, 0, 2, 100), 2);
    assert.equal(clipTimeAt(1, 3, 0.5, 100), 3.5);
    assert.equal(clipTimeAt(4, 0, 2, 5), 3, "vuelve a empezar como el render");
  });

  test("llega al worker solo en videos y se resume en la lista", () => {
    const e = resolveEdit({ speed: 2 });
    const video = brollRenderEdit({ edit: e, format: "9:16", duration: 3, clipWidth: 1920, clipHeight: 1080, accent: "#2457f5", ground: "#000000" });
    assert.equal(video.speed, 2);
    const image = brollRenderEdit({ edit: e, format: "9:16", duration: 3, clipWidth: 1920, clipHeight: 1080, accent: "#2457f5", ground: "#000000", image: true } as never);
    assert.equal("speed" in image, false);
    assert.match(editSummary(e, "9:16") ?? "", /2×/);
    assert.equal(speedLabel(0.25), "0,25×");
  });

  test("fuera de rango no entra", () => {
    assert.equal(brollEditSchema.safeParse({ speed: 10 }).success, false);
    assert.equal(brollEditSchema.safeParse({ speed: 0 }).success, false);
  });
});
