import "server-only";
import { desc, eq, inArray, sql, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import type { ScriptContent } from "@/lib/db/schema";
import { getScoreHistory } from "@/lib/dal/score";
import { computeScore, type HookKind, type ScoreResult } from "@/lib/scripts/score";
import type { ReelCopyAnalysis, ReelCopyStatus } from "@/lib/scripts/reel-copy";
import { stylePresetSchema, styleMetricsSchema, type StyleMetrics, type StylePreset } from "@/lib/video/style";

/** Datos de "Copia este reel". Cada función empieza con getCurrentUser(). */
type JobInfo = { progress: number; stage: string | null; status: string } | null;

async function latestJobs(ids: string[]): Promise<Map<string, JobInfo>> {
  const map = new Map<string, JobInfo>();
  if (!ids.length) return map;
  const rows = await getDb()
    .select({ ref: sql<string>`${schema.jobs.input}->>'reelCopyId'`, progress: schema.jobs.progress, stage: schema.jobs.stage, status: schema.jobs.status })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.type, "REEL_COPY"), inArray(sql<string>`${schema.jobs.input}->>'reelCopyId'`, ids)))
    .orderBy(desc(schema.jobs.createdAt));
  for (const r of rows) if (!map.has(r.ref)) map.set(r.ref, { progress: r.progress, stage: r.stage, status: r.status });
  return map;
}

export type CopyListItem = {
  id: string;
  status: ReelCopyStatus;
  platform: string | null;
  topic: string | null;
  scriptId: string | null;
  scriptTitle: string | null;
  job: JobInfo;
  createdAt: Date;
};

export async function listCopies(limit = 30): Promise<CopyListItem[]> {
  await getCurrentUser();
  const rows = await getDb()
    .select({
      id: schema.reelCopies.id,
      status: schema.reelCopies.status,
      platform: schema.reelCopies.platform,
      topic: schema.reelCopies.topic,
      scriptId: schema.reelCopies.scriptId,
      scriptTitle: schema.scripts.title,
      createdAt: schema.reelCopies.createdAt,
    })
    .from(schema.reelCopies)
    .leftJoin(schema.scripts, eq(schema.scripts.id, schema.reelCopies.scriptId))
    .orderBy(desc(schema.reelCopies.createdAt))
    .limit(limit);
  const jobs = await latestJobs(rows.filter((r) => r.status === "ANALYZING" || r.status === "WRITING").map((r) => r.id));
  return rows.map((r) => ({ ...r, job: jobs.get(r.id) ?? null }));
}

export type HookScore = { text: string; type: string; score: number | null; verdict: ScoreResult["verdict"] };

export type CopyView = {
  id: string;
  status: ReelCopyStatus;
  sourceKind: "upload" | "link";
  sourceUrl: string | null;
  platform: string | null;
  topic: string | null;
  objective: string | null;
  analysis: ReelCopyAnalysis | null;
  errorMessage: string | null;
  job: JobInfo;
  createdAt: Date;
  /** Se puede reintentar: link, o archivo subido que todavía está guardado. */
  canRetry: boolean;
  script: { id: string; title: string; format: "REEL" | "SHORT" | "YT_LONG" | "STORY"; estimatedSeconds: number | null; content: ScriptContent } | null;
  style: { id: string; name: string; status: string; metrics: StyleMetrics | null; preset: StylePreset | null } | null;
  /** Puntaje antes de publicar de cada gancho (el mismo cálculo que en el guion). */
  hookScores: HookScore[];
  scoreConfidence: ScoreResult["confidence"] | null;
};

const HOOK_KINDS = new Set(["contraste", "curiosidad", "dolor", "resultado", "historia", "pregunta", "lista"]);

export async function getCopy(id: string): Promise<CopyView | null> {
  await getCurrentUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = getDb();
  const [copy] = await db.select().from(schema.reelCopies).where(eq(schema.reelCopies.id, id)).limit(1);
  if (!copy) return null;
  const [scriptRow] = copy.scriptId ? await db.select().from(schema.scripts).where(eq(schema.scripts.id, copy.scriptId)).limit(1) : [];
  const [styleRow] = copy.styleId ? await db.select().from(schema.videoStyles).where(eq(schema.videoStyles.id, copy.styleId)).limit(1) : [];
  const job = copy.status === "ANALYZING" || copy.status === "WRITING" ? ((await latestJobs([id])).get(id) ?? null) : null;

  const script = scriptRow?.content ? { id: scriptRow.id, title: scriptRow.title, format: scriptRow.format, estimatedSeconds: scriptRow.estimatedSeconds, content: scriptRow.content } : null;
  let hookScores: HookScore[] = [];
  let scoreConfidence: ScoreResult["confidence"] | null = null;
  if (script) {
    const history = await getScoreHistory();
    hookScores = script.content.hooks.map((h) => {
      const result = computeScore(history, {
        hook: h.text,
        hookType: HOOK_KINDS.has(h.type) ? (h.type as HookKind) : null,
        estimatedSeconds: script.estimatedSeconds ?? 30,
        format: script.format,
      });
      scoreConfidence = result.confidence;
      return { text: h.text, type: h.type, score: result.hook.score, verdict: result.verdict };
    });
  }

  const metrics = styleRow?.metrics ? styleMetricsSchema.safeParse(styleRow.metrics) : null;
  const preset = styleRow?.preset ? stylePresetSchema.safeParse(styleRow.preset) : null;
  return {
    id: copy.id,
    status: copy.status,
    sourceKind: copy.sourceKind === "link" ? "link" : "upload",
    sourceUrl: copy.sourceUrl,
    platform: copy.platform,
    topic: copy.topic,
    objective: copy.objective,
    analysis: copy.analysis ?? null,
    errorMessage: copy.errorMessage,
    job,
    createdAt: copy.createdAt,
    canRetry: copy.sourceKind === "link" ? Boolean(copy.sourceUrl) : Boolean(styleRow?.sourceKey),
    script,
    style: styleRow ? { id: styleRow.id, name: styleRow.name, status: styleRow.status, metrics: metrics?.success ? metrics.data : null, preset: preset?.success ? preset.data : null } : null,
    hookScores,
    scoreConfidence,
  };
}
