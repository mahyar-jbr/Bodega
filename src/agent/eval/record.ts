// Run an evaluation and keep it in Atlas: one document in `evaluations` with live progress (for the
// big screen, over the change bus) and, at the end, the summary. A held-out run stores aggregates
// only; a dev run also keeps each case's outcome for debugging.
import { ObjectId, type Db } from 'mongodb';
import type { EvalSet } from './cases';
import { runEvaluation, type EvalProgress, type EvalRun, type EvalSummary, type RunEvalInput } from './runner';

export interface EvaluationDoc {
  _id: ObjectId;
  set: EvalSet;
  version: number;
  settingsHash: string | null;
  purpose: string;                       // 'baseline', 'gate', 'gate-demo', 'manual'
  status: 'running' | 'done' | 'failed';
  progress: EvalProgress;
  summary: EvalSummary | null;
  cases?: { id: string; outcome: string; lossCents: number; detail: string }[];   // dev only
  error?: string;
  startedAt: Date;
  finishedAt: Date | null;
}

const PROGRESS_EVERY_MS = 400;           // at most a few writes a second, whatever the concurrency

export async function recordEvaluation(db: Db, input: RunEvalInput & { purpose: string; onStart?: (id: string) => void }): Promise<EvalRun & { evaluationId: string }> {
  const coll = db.collection<EvaluationDoc>('evaluations');
  const _id = new ObjectId();
  const total = input.cases.length;
  await coll.insertOne({
    _id, set: input.set, version: input.version.version, settingsHash: input.settingsHash ?? null, purpose: input.purpose,
    status: 'running', progress: { done: 0, total, scamsTested: 0, scamsStopped: 0, honestTested: 0, honestServed: 0 },
    summary: null, startedAt: new Date(), finishedAt: null,
  });
  input.onStart?.(_id.toHexString());

  let latest: EvalProgress | null = null;
  let writing = false;
  const flush = async () => {
    if (writing || !latest) return;
    writing = true;
    const p = latest;
    latest = null;
    try { await coll.updateOne({ _id, status: 'running' }, { $set: { progress: p } }); } finally { writing = false; }
  };
  const timer = setInterval(() => void flush().catch(() => {}), PROGRESS_EVERY_MS);

  try {
    const run = await runEvaluation({ ...input, onProgress: (p) => { latest = p; input.onProgress?.(p); } });
    clearInterval(timer);
    await coll.updateOne({ _id }, { $set: {
      status: 'done', finishedAt: new Date(), summary: run.summary,
      progress: { done: total, total,
        scamsTested: run.summary.scams.total, scamsStopped: run.summary.scams.stopped,
        honestTested: run.summary.honest.total, honestServed: run.summary.honest.served },
      ...(input.set === 'dev' ? { cases: run.cases.map((c) => ({ id: c.id, outcome: c.outcome, lossCents: c.lossCents, detail: c.detail })) } : {}),
    } });
    return { ...run, evaluationId: _id.toHexString() };
  } catch (err) {
    clearInterval(timer);
    await coll.updateOne({ _id }, { $set: { status: 'failed', finishedAt: new Date(), error: String(err).slice(0, 300) } });
    throw err;
  }
}
