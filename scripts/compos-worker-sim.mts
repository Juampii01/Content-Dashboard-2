/**
 * Worker simulado para los pedidos de animaciones del Estudio (VIDEO_COMPOS), para probar la interfaz sin el worker
 * de verdad: toma los trabajos en cola y maneja el taller paso a paso (imágenes y cuadros simulados). Desarrollo.
 *
 *   node --import tsx --env-file=.env.local scripts/compos-worker-sim.mts [segundos]
 */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../lib/db";
import { directorStep, type DirectorBody } from "../lib/video/director/service";

const until = Date.now() + Number(process.argv[2] ?? 120) * 1000;
while (Date.now() < until) {
  const [job] = await getDb().select().from(schema.jobs).where(and(eq(schema.jobs.type, "VIDEO_COMPOS"), eq(schema.jobs.status, "QUEUED"))).limit(1);
  if (!job) {
    await new Promise((r) => setTimeout(r, 1000));
    continue;
  }
  const pid = (job.input as { projectId: string }).projectId;
  await getDb().update(schema.jobs).set({ status: "RUNNING", startedAt: new Date() }).where(eq(schema.jobs.id, job.id));
  let body: DirectorBody = { step: "compos" };
  for (let i = 0; i < 40; i++) {
    const res = await directorStep(pid, body);
    const next = res.next as { step: string; items?: { taskId: string; imageId: string }[] } | null;
    console.log(`  ${body.step} → ${next?.step ?? "fin"}`);
    if (!next) break;
    if (next.step === "compos-images") body = { step: "compos-images-done", results: next.items!.map((x) => ({ taskId: x.taskId, imageId: x.imageId, error: "Simulación: sin generador." })) };
    else if (next.step === "compos-stills") body = { step: "compos-look", sheets: [] };
    else body = { step: next.step } as DirectorBody;
  }
  await getDb().update(schema.jobs).set({ status: "SUCCEEDED", finishedAt: new Date(), progress: 1 }).where(eq(schema.jobs.id, job.id));
  console.log("trabajo listo", job.id);
}
process.exit(0);
