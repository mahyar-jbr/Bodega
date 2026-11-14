// Run an evaluation and keep it in Atlas: one document in `evaluations` with live progress (for the
// big screen, over the change bus) and, at the end, the summary. A held-out run stores aggregates
// only; a dev run also keeps each case's outcome for debugging.
import { execFileSync } from 'node:child_process';
import { ObjectId, type Db } from 'mongodb';
import type { EvalSet } from './cases';
import { hasModelKey } from '../shopkeeper/run';
import { SETTINGS_HASH } from '../shopkeeper/settings';
import { runEvaluation, type EvalProgress, type EvalRun, type EvalSummary, type RunEvalInput } from './runner';

export interface EvaluationDoc {
  _id: ObjectId;
  set: EvalSet;
  version: number;
  settingsHash: string | null;
  purpose: string;                       // 'baseline', 'gate', 'gate-demo', 'manual'
  commit: string | null;                 // the code it ran (npm run eval records it)
  status: 'running' | 'done' | 'failed';
  progress: EvalProgress;
  summary: EvalSummary | null;
  cases?: { id: string; outcome: string; lossCents: number; detail: string }[];   // dev only
  error?: string;
  heartbeatAt?: Date;                    // refreshed every few seconds while the run's process is alive
  startedAt: Date;
  finishedAt: Date | null;
}

const PROGRESS_EVERY_MS = 400;
const HEARTBEAT_MS = 5_000;
const STALE_HEARTBEAT_MS = 30_000;       // a running evaluation silent this long lost its process
const STALE_START_MS = 2 * 60_000;       // older runs from before heartbeats existed

/** The code a run used: Render's deploy commit (it has no .git), else the local checkout's. */
let localCommit: string | null | undefined;
export function currentCommit(): string | null {
  const render = process.env.RENDER_GIT_COMMIT?.trim();
  if (render) return render.slice(0, 7);
  if (localCommit === undefined) {
    try { localCommit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; }
    catch { localCommit = null; }
  }
  return localCommit;
}           // at most a few writes a second, whatever the concurrency

export async function recordEvaluation(db: Db, input: RunEvalInput & { purpose: string; commit?: string; onStart?: (id: string) => void }): Promise<EvalRun & { evaluationId: string }> {
  if (!input.run && !hasModelKey()) throw new Error('ANTHROPIC_API_KEY is not set: refusing to evaluate the keyless stub shopkeeper');
  const settingsHash = input.settingsHash !== undefined ? input.settingsHash : input.run ? null : SETTINGS_HASH;
  const coll = db.collection<EvaluationDoc>('evaluations');
  const _id = new ObjectId();
  const total = input.cases.length;
  await coll.insertOne({
    _id, set: input.set, version: input.version.version, settingsHash, purpose: input.purpose, commit: input.commit ?? currentCommit(),
    status: 'running', heartbeatAt: new Date(), progress: { done: 0, total, scamsTested: 0, scamsStopped: 0, honestTested: 0, honestServed: 0 },
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
  const heartbeat = setInterval(() => void coll.updateOne({ _id, status: 'running' }, { $set: { heartbeatAt: new Date() } }).catch(() => {}), HEARTBEAT_MS);

  try {
    const run = await runEvaluation({ ...input, settingsHash, onProgress: (p) => { latest = p; input.onProgress?.(p); } });
    clearInterval(timer); clearInterval(heartbeat);
    await coll.updateOne({ _id }, { $set: {
      status: 'done', finishedAt: new Date(), summary: run.summary,
      progress: { done: total, total,
        scamsTested: run.summary.scams.total, scamsStopped: run.summary.scams.stopped,
        honestTested: run.summary.honest.total, honestServed: run.summary.honest.served },
      ...(input.set === 'dev' ? { cases: run.cases.map((c) => ({ id: c.id, outcome: c.outcome, lossCents: c.lossCents, detail: c.detail })) } : {}),
    } });
    return { ...run, evaluationId: _id.toHexString() };
  } catch (err) {
    clearInterval(timer); clearInterval(heartbeat);
    await coll.updateOne({ _id }, { $set: { status: 'failed', finishedAt: new Date(), error: String(err).slice(0, 300) } });
    throw err;
  }
}

/** Marks evaluations whose process died mid-run (a redeploy or a crash) as failed, so the screen never
 *  shows a test that will never finish. Returns how many it marked. */
export async function sweepInterruptedEvaluations(db: Db, now = new Date()): Promise<number> {
  const res = await db.collection<EvaluationDoc>('evaluations').updateMany(
    { status: 'running', $or: [
      { heartbeatAt: { $lt: new Date(now.getTime() - STALE_HEARTBEAT_MS) } },
      { heartbeatAt: { $exists: false }, startedAt: { $lt: new Date(now.getTime() - STALE_START_MS) } },
    ] },
    { $set: { status: 'failed', error: 'interrupted by a restart', finishedAt: now } },
  );
  return res.modifiedCount;
}
