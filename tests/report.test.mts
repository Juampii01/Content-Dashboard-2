/**
 * Prueba de los cálculos del informe mensual (sin base de datos): meses, rangos, ritmo por semana,
 * comparaciones, cuándo toca el envío automático, destinatarios y colores de la marca.
 *   pnpm test:report
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  addMonths,
  carryForward,
  change,
  daysOf,
  dueReportMonth,
  isMonth,
  monthLabel,
  monthRange,
  parseRecipients,
  reportFileName,
  reportRange,
  sumKnown,
  sumSeries,
  weeklyRhythm,
} from "../lib/reports/month";
import { contrast, reportColors } from "../lib/reports/colors";

describe("meses", () => {
  test("valida y nombra meses", () => {
    assert.equal(isMonth("2026-10"), true);
    assert.equal(isMonth("2026-13"), false);
    assert.equal(isMonth("2026-1"), false);
    assert.equal(isMonth("../etc"), false);
    assert.equal(monthLabel("2026-10"), "Octubre 2026");
    assert.equal(monthLabel("2026-09", { lower: true }), "septiembre 2026");
    assert.equal(monthLabel("2026-01", { lower: true, withYear: false }), "enero");
  });

  test("suma y resta meses cruzando el año", () => {
    assert.equal(addMonths("2026-01", -1), "2025-12");
    assert.equal(addMonths("2026-12", 1), "2027-01");
    assert.equal(addMonths("2026-10", -13), "2025-09");
  });

  test("rango del mes con años bisiestos", () => {
    assert.deepEqual(monthRange("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
    assert.deepEqual(monthRange("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
    assert.deepEqual(monthRange("2026-10"), { from: "2026-10-01", to: "2026-10-31" });
    assert.equal(daysOf("2026-10-30", "2026-11-02").length, 4);
  });

  test("mes cerrado, en curso y futuro", () => {
    assert.deepEqual(reportRange("2026-09", "2026-10-22"), { from: "2026-09-01", to: "2026-09-30", monthEnd: "2026-09-30", partial: false });
    assert.deepEqual(reportRange("2026-10", "2026-10-22"), { from: "2026-10-01", to: "2026-10-22", monthEnd: "2026-10-31", partial: true });
    // El último día del mes todavía está en curso.
    assert.equal(reportRange("2026-10", "2026-10-31")!.partial, true);
    assert.equal(reportRange("2026-11", "2026-10-22"), null);
  });
});

describe("ritmo por semana", () => {
  test("semanas de lunes a domingo con las de los bordes prorrateadas", () => {
    // Octubre 2026 empieza en jueves y termina en sábado.
    const pieces: Record<string, number> = { "2026-10-01": 1, "2026-10-03": 2, "2026-10-05": 3, "2026-10-08": 2, "2026-10-31": 1 };
    const weeks = weeklyRhythm(pieces, "2026-10-01", "2026-10-31", 7);
    assert.equal(weeks.length, 5);
    assert.deepEqual(weeks[0], { weekStart: "2026-10-01", weekEnd: "2026-10-04", pieces: 3, target: 4, hit: false, partial: true });
    assert.deepEqual(weeks[1], { weekStart: "2026-10-05", weekEnd: "2026-10-11", pieces: 5, target: 7, hit: false, partial: false });
    assert.equal(weeks[4]!.weekStart, "2026-10-26");
    assert.equal(weeks[4]!.weekEnd, "2026-10-31");
    assert.equal(weeks[4]!.target, 6); // 6 de 7 días → ceil(7 × 6 / 7)
    assert.equal(weeks.reduce((a, w) => a + w.pieces, 0), 9);
  });

  test("cumple la meta con justo la cantidad pedida", () => {
    const weeks = weeklyRhythm({ "2026-10-12": 4 }, "2026-10-12", "2026-10-18", 4);
    assert.deepEqual(weeks.map((w) => w.hit), [true]);
  });
});

describe("comparaciones y series", () => {
  test("variación porcentual sin base no se inventa", () => {
    assert.equal(change({ current: 120, previous: 100 }), 20);
    assert.equal(change({ current: 80, previous: 100 }), -20);
    assert.equal(change({ current: 10, previous: 0 }), null);
    assert.equal(change({ current: null, previous: 10 }), null);
    assert.equal(change({ current: 10, previous: null }), null);
  });

  test("sumas que distinguen 'cero' de 'sin dato'", () => {
    assert.equal(sumSeries([null, null]), null);
    assert.equal(sumSeries([0, null, 5]), 5);
    assert.equal(sumKnown([null, undefined]), null);
    assert.equal(sumKnown([1000, null, 250]), 1250);
  });

  test("seguidores: arrastra el último dato y no rellena antes del primero", () => {
    assert.deepEqual(carryForward([null, 10, null, null, 12, null]), [null, 10, 10, 10, 12, 12]);
  });
});

describe("envío automático", () => {
  const tz = "America/Mexico_City"; // UTC−6 todo el año
  test("el día 1 espera a las 9:00 hora de la marca", () => {
    assert.equal(dueReportMonth(new Date("2026-11-01T14:59:00Z"), tz), null); // 8:59
    assert.equal(dueReportMonth(new Date("2026-11-01T15:00:00Z"), tz), "2026-10"); // 9:00
  });
  test("reintenta hasta el día 3 y después ya no", () => {
    assert.equal(dueReportMonth(new Date("2026-11-03T20:00:00Z"), tz), "2026-10");
    assert.equal(dueReportMonth(new Date("2026-11-04T15:00:00Z"), tz), null);
    assert.equal(dueReportMonth(new Date("2026-10-22T15:00:00Z"), tz), null);
  });
  test("enero manda el informe de diciembre del año anterior", () => {
    assert.equal(dueReportMonth(new Date("2027-01-01T18:00:00Z"), tz), "2026-12");
  });
  test("usa la zona de la marca, no la del servidor", () => {
    // 1 nov 02:00 UTC es todavía 31 oct en Ciudad de México: no toca.
    assert.equal(dueReportMonth(new Date("2026-11-01T02:00:00Z"), tz), null);
  });
});

describe("destinatarios", () => {
  test("normaliza, quita repetidos y separa los inválidos", () => {
    const { valid, invalid } = parseRecipients([" Ana@Empresa.com ", "ana@empresa.com", "sponsor@marca.co", "no-es-correo", "a@b", ""]);
    assert.deepEqual(valid, ["ana@empresa.com", "sponsor@marca.co"]);
    assert.deepEqual(invalid, ["no-es-correo", "a@b"]);
  });
  test("nombre del archivo sin tildes", () => {
    assert.equal(reportFileName("2026-10", "Valentina Ríos"), "informe-octubre-2026-valentina-rios.pdf");
    assert.equal(reportFileName("2026-09", null), "informe-septiembre-2026.pdf");
  });
});

describe("colores de la marca", () => {
  test("sin colores usa los de MaestrIA", () => {
    assert.deepEqual(reportColors({ primary: null, accent: null }), { cover: "#030a22", accent: "#0070f8" });
  });
  test("principal oscuro va a la portada; el acento se oscurece hasta leerse sobre blanco", () => {
    const c = reportColors({ primary: "#0f2a22", accent: "#f2c14e" });
    assert.equal(c.cover, "#0f2a22");
    assert.ok(contrast(c.accent, "#ffffff") >= 3.2, `contraste ${contrast(c.accent, "#ffffff")}`);
  });
  test("principal claro no va de fondo de portada: pasa a ser el acento", () => {
    const c = reportColors({ primary: "#ffd6e0", accent: null });
    assert.equal(c.cover, "#030a22");
    assert.ok(contrast(c.accent, "#ffffff") >= 3.2);
  });
});
