// npm run compare -- 0 3 [--set heldout|dev] [--archive [--epoch N]]
// Prints two guardrail versions' latest recorded evaluations side by side, overall and per
// category, with both shopkeeper settings hashes: the proof that only the rules changed.
// --archive reads versions other than v0 from evaluations_archive (what `npm run fresh-show` set aside),
// newest first, or from one show with --epoch; v0's baselines always stay live.
import '../src/server/env';
import { parseArgs } from 'node:util';
import type { EvaluationDoc } from '../src/agent/eval/record';
import type { CategoryResult, EvalSummary } from '../src/agent/eval/runner';
import { closeDb, dbName, getDb } from '../src/shared/db';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  set: { type: 'string', default: 'heldout' }, archive: { type: 'boolean', default: false }, epoch: { type: 'string' },
} });
const [a, b] = positionals.map(Number);
if (positionals.length !== 2 || [a, b].some((n) => !Number.isInteger(n) || n < 0)) {
  console.error('usage: npm run compare -- <version> <version> [--set heldout|dev] [--archive [--epoch N]]');
  process.exit(1);
}

type Stored = EvaluationDoc & { summary: EvalSummary; archivedAt?: Date; epoch?: number };
const evaluations = getDb().collection<Stored>('evaluations');
const archive = getDb().collection<Stored>('evaluations_archive');
async function latest(version: number): Promise<Stored & { from: string }> {
  const filter = { set: values.set as EvaluationDoc['set'], version, status: 'done' as const };
  if (values.archive && version !== 0) {
    const epochFilter = values.epoch ? { epoch: Number(values.epoch) } : {};
    const doc = await archive.findOne({ ...filter, ...epochFilter }, { sort: { archivedAt: -1, finishedAt: -1 } });
    if (doc?.summary) return { ...doc, from: `archive${doc.epoch != null ? `, epoch ${doc.epoch}` : ''}` };
  }
  const doc = await evaluations.findOne(filter, { sort: { finishedAt: -1 } });
  if (!doc?.summary) throw new Error(`no finished ${values.set} evaluation of v${version} in ${dbName()}.evaluations${values.archive ? ' or its archive' : ''}`);
  return { ...doc, from: 'live' };
}

const [before, after] = await Promise.all([latest(a), latest(b)]);
const sb = before.summary, sa = after.summary;
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const pad = (s: string | number, n: number) => String(s).padStart(n);
const when = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') : '?');

console.log(`v${a} against v${b} on the ${values.set} set (${sa.total} cases), ${dbName()}`);
console.log(`  v${a}: settings ${before.settingsHash ?? 'none'}  commit ${before.commit ?? '?'}  ${when(before.finishedAt)}  (${before.from})`);
console.log(`  v${b}: settings ${after.settingsHash ?? 'none'}  commit ${after.commit ?? '?'}  ${when(after.finishedAt)}  (${after.from})`);
const same = !!before.settingsHash && before.settingsHash === after.settingsHash;
console.log(same
  ? '  Same model, same prompt: the settings hashes match. Only the guardrail rules changed.'
  : '  WARNING: the settings hashes differ, so these runs are not comparable.');

console.log(`\n                          ${pad(`v${a}`, 10)} ${pad(`v${b}`, 10)}`);
console.log(`  Scams that worked        ${pad(`${sb.scams.succeeded}/${sb.scams.total}`, 10)} ${pad(`${sa.scams.succeeded}/${sa.scams.total}`, 10)}   ${sb.scams.successPct}% -> ${sa.scams.successPct}%`);
console.log(`  Honest turned away       ${pad(`${sb.honest.turnedAway}/${sb.honest.total}`, 10)} ${pad(`${sa.honest.turnedAway}/${sa.honest.total}`, 10)}   ${sb.honest.turnedAwayPct}% -> ${sa.honest.turnedAwayPct}%`);
console.log(`  Honest leaks             ${pad(sb.honest.leaks, 10)} ${pad(sa.honest.leaks, 10)}`);
console.log(`  Money lost               ${pad(money(sb.lossCents), 10)} ${pad(money(sa.lossCents), 10)}`);
console.log(`  Latency p50              ${pad(`${(sb.latency.p50Ms / 1000).toFixed(1)}s`, 10)} ${pad(`${(sa.latency.p50Ms / 1000).toFixed(1)}s`, 10)}`);

const cats = new Map<string, [CategoryResult | undefined, CategoryResult | undefined]>();
for (const c of sb.byCategory) cats.set(c.category, [c, undefined]);
for (const c of sa.byCategory) cats.set(c.category, [cats.get(c.category)?.[0], c]);
const cell = (c: CategoryResult | undefined) => !c ? '-' : c.kind === 'scam' ? `${c.succeeded}/${c.total}` : `${c.served}/${c.total}`;

console.log(`\n  Scams that worked, by category`);
for (const [name, [x, y]] of cats) if ((x ?? y)!.kind === 'scam') console.log(`    ${name.padEnd(22)} ${pad(cell(x), 7)} ${pad(cell(y), 7)}`);
console.log(`\n  Honest customers served, by category`);
for (const [name, [x, y]] of cats) if ((x ?? y)!.kind === 'honest') console.log(`    ${name.padEnd(22)} ${pad(cell(x), 7)} ${pad(cell(y), 7)}`);

await closeDb();
if (!same) process.exitCode = 2;
