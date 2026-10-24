/**
 * Simulación de "Copiar edición" (o de un pedido de animación) de punta a punta sin worker: hace de worker contra el
 * director en el mismo proceso (las imágenes y los cuadros se simulan). Con AI_FAKE=1 no gasta IA. Para desarrollo.
 *
 *   node --conditions=react-server --import tsx --env-file=.env.local scripts/compos-sim.mts <proyecto> [copiar|pedido "texto"|variedad]
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "../lib/db";
import { directorStep, requestEdit, type DirectorBody } from "../lib/video/director/service";
import { readDirector } from "../lib/video/director/types";

const [pid, mode = "copiar", text = ""] = process.argv.slice(2);
if (!pid) throw new Error("Falta el id del proyecto.");
const [row] = await getDb().select().from(schema.videoProjects).where(eq(schema.videoProjects.id, pid));
if (!row) throw new Error("No existe el proyecto.");

if (mode === "copiar") {
  await requestEdit(pid, "Copia la edición de este video: efectos, animaciones, transiciones, textos y ritmo.", "edit", null, { link: "https://www.instagram.com/reel/DEMO123/", copy: true });
  const d = readDirector((await getDb().select().from(schema.videoProjects).where(eq(schema.videoProjects.id, pid)))[0]!.director);
  const ref = d.reference!;
  // La referencia "medida" por el worker: cuadros densos con cortes cada ~2,5 s.
  const moments = Array.from({ length: 40 }, (_, i) => ({ t: Math.round(i * 0.4 * 100) / 100, frame: i + 1, cut: i % 6 === 0, face: i % 5 !== 3, text: i % 6 === 0 ? ["EL ERROR", "3 PASOS", "+240%", "NADIE TE LO DICE", "SÍGUEME", "LA CLAVE"][(i / 6) % 6] ?? "" : "", said: "" }));
  await directorStep(pid, { step: "reference", id: ref.id, ok: true, moments, transcript: "Este es el error que más me costó y cómo lo arreglé en tres pasos.", sheets: [], dense: true } as DirectorBody);
} else if (mode === "pedido") {
  await requestEdit(pid, text || "Crea con IA una imagen de un mapa del mundo, haz foco en Francia y trae una flecha que diga 'el mejor país del mundo'", "edit", null, {});
} else {
  await getDb().update(schema.videoProjects).set({ status: "PROCESSING" }).where(eq(schema.videoProjects.id, pid));
}

let body: DirectorBody = { step: mode === "variedad" ? "direct" : "edit" } as DirectorBody;
for (let i = 0; i < 200; i++) {
  const res = await directorStep(pid, body);
  const next = res.next as { step: string; label?: string; round?: number; items?: { taskId: string; imageId: string }[] } | null;
  console.log(`${String(i).padStart(3)} ${body.step.padEnd(20)} → ${next ? `${next.step}${next.label ? ` (${next.label})` : ""}` : `fin (${res.status})`}`);
  if (!next) break;
  if (next.step === "preview") body = { step: "critique", round: next.round!, sheets: [] };
  else if (next.step === "compos-images") body = { step: "compos-images-done", results: next.items!.map((x) => ({ taskId: x.taskId, imageId: x.imageId, error: "Simulación: sin generador." })) };
  else if (next.step === "compos-stills") body = { step: "compos-look", sheets: [] };
  else body = { step: next.step } as DirectorBody;
}
const [after] = await getDb().select().from(schema.videoProjects).where(eq(schema.videoProjects.id, pid));
const plan = after!.plan as { compositions?: { name: string; from_word: number; to_word: number; source: string }[] };
const dir = after!.director as { copy?: { report?: { total: number; copied: number; approx: number; missed: number } }; compos?: { tasks: { status: string; error?: string }[] } };
console.log("estado:", after!.status);
console.log("composiciones:", (plan.compositions ?? []).map((c) => `${c.name} [${c.from_word}–${c.to_word}] (${c.source})`));
console.log("informe:", dir.copy?.report ? { ...dir.copy.report, moments: undefined } : null);
console.log("tareas:", dir.compos?.tasks.map((t) => `${t.status}${t.error ? `: ${t.error}` : ""}`));
const usage = await getDb().select().from(schema.aiUsage).where(eq(schema.aiUsage.videoProjectId, pid));
const by = new Map<string, number>();
for (const u of usage) by.set(u.feature, (by.get(u.feature) ?? 0) + Number(u.costUsd));
console.log("costo simulado por etapa:", Object.fromEntries([...by.entries()].map(([k, v]) => [k, Math.round(v * 1000) / 1000])));
process.exit(0);
