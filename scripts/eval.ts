// npm run eval -- --set dev|heldout [--version N] [--case S-201] [--limit 10] [--concurrency 20] [--record baseline]
// Plays a test set against a guardrail version on fresh in-memory stores and prints the scores per
// category. The held-out set prints aggregates only, and costs about $3 a run: use dev while building.
import '../src/server/env';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { loadDevCases, type EvalSet } from '../src/agent/eval/cases';
import { recordEvaluation } from '../src/agent/eval/record';
import { runEvaluation, type EvalSummary } from '../src/agent/eval/runner';
import { loadHeldoutCases } from '../src/agent/gate/heldout';
import { V0, type GuardrailVersion } from '../src/agent/guard/types';
import { closeDb, dbName, getDb } from '../src/shared/db';

const { values } = parseArgs({
  options: {
    set: { type: 'string', default: 'dev' },
    version: { type: 'string', default: '0' },
    case: { type: 'string', multiple: true },
    limit: { type: 'string' },
    concurrency: { type: 'string' },
    record: { type: 'string' },   // keep it in Atlas's evaluations, with this purpose (npm run compare reads them)
  },
});

const set = values.set as EvalSet;
if (set !== 'dev' && set !== 'heldout') throw new Error('--set must be dev or heldout');
if (set === 'heldout' && (values.case || values.limit)) throw new Error('the held-out set runs whole: no --case or --limit');

async function loadVersion(n: number): Promise<GuardrailVersion> {
  if (n === 0) return V0;
  const doc = await getDb().collection<GuardrailVersion>('guardrails').findOne({ version: n });
  if (!doc) throw new Error(`no guardrail version ${n}`);
  return { version: doc.version, rules: doc.rules };
}

let cases = set === 'dev' ? loadDevCases() : loadHeldoutCases();
if (values.case) cases = cases.filter((c) => values.case!.includes(c.id));
if (values.limit) cases = cases.slice(0, Number(values.limit));

const version = await loadVersion(Number(values.version));
const git = (...args: string[]) => { try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); } catch { return '?'; } };
const commit = `${git('rev-parse', '--short', 'HEAD')}${git('status', '--porcelain', '--untracked-files=no', 'src', 'scripts') ? ' (dirty tree)' : ''}`;
console.log(`Commit ${commit}`);
console.log(`Evaluating v${version.version} (${version.rules.length} rules) on ${cases.length} ${set} cases...`);

let lastShown = 0;
const evaluate = values.record
  ? (input: Parameters<typeof runEvaluation>[0]) => recordEvaluation(getDb(), { ...input, purpose: values.record!, commit })
  : runEvaluation;
const { summary, cases: scores } = await evaluate({
  set, cases, version,
  concurrency: values.concurrency ? Number(values.concurrency) : undefined,
  onProgress: (p) => {
    if (p.done === p.total || Date.now() - lastShown > 2_000) {
      lastShown = Date.now();
      console.log(`  ${p.done}/${p.total}  scams stopped ${p.scamsStopped}/${p.scamsTested}  honest served ${p.honestServed}/${p.honestTested}`);
    }
  },
});

printSummary(summary);
if (values.record) console.log(`\nRecorded in ${dbName()}.evaluations as "${values.record}".`);
if (set === 'dev') {
  const misses = scores.filter((s) => s.outcome !== 'stopped' && s.outcome !== 'served');
  if (misses.length) {
    console.log('\nDev cases that missed:');
    for (const s of misses) console.log(`  ${s.id.padEnd(6)} ${s.outcome.padEnd(12)} ${s.detail}`);
  }
}
await closeDb();

function printSummary(s: EvalSummary) {
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  console.log(`\nv${s.version} on ${s.set}, commit ${commit}, settings ${s.settingsHash ?? 'none'}`);
  console.log(`  Scams that worked:      ${s.scams.succeeded}/${s.scams.total} (${s.scams.successPct}%)  lost ${money(s.lossCents)}`);
  console.log(`  Honest turned away:     ${s.honest.turnedAway}/${s.honest.total} (${s.honest.turnedAwayPct}%)`);
  console.log(`  Honest leaks:           ${s.honest.leaks}`);
  if (s.scams.errors + s.honest.errors) console.log(`  Errors:                 ${s.scams.errors + s.honest.errors}`);
  console.log(`  Latency p50 ${(s.latency.p50Ms / 1000).toFixed(1)}s, p95 ${(s.latency.p95Ms / 1000).toFixed(1)}s; ${s.modelCalls} model calls; ${(s.durationMs / 1000).toFixed(1)}s total`);
  console.log('\n  Category             Cases  Worked  Served  Away  Leaks');
  for (const c of s.byCategory) {
    console.log(`  ${c.category.padEnd(20)} ${String(c.total).padStart(5)}  ${(c.kind === 'scam' ? String(c.succeeded) : '').padStart(6)}  ${(c.kind === 'honest' ? String(c.served) : '').padStart(6)}  ${(c.kind === 'honest' ? String(c.turnedAway) : '').padStart(4)}  ${(c.kind === 'honest' ? String(c.leaks) : '').padStart(5)}`);
  }
}
