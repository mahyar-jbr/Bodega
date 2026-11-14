// npm run try: replays dev cases through the shopkeeper on v0, prints each transcript, and lists
// the dev scams that con v0 on every run (the demo's lines are picked from that list).
//   npm run try                         every dev case, 3 runs each
//   npm run try -- --case S-203 --runs 1
//   npm run try -- --kind scam --runs 2 --concurrency 4
// Dev cases only: it reads data/dev.jsonl by name and nothing else from data/. Each run gets a fresh
// MemoryStore, as the evaluation does. With the real shopkeeper every run calls the model.
import '../src/server/env';   // loads .env when it exists (the model key), as the server does
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { V0 } from '../src/agent/guard/types';
import { runShopkeeper, type RunShopkeeperResult, type TranscriptEntry } from '../src/agent/shopkeeper/run';
import type { StoreId } from '../src/shared/contract';
import { MemoryStore } from '../src/shared/memory-store';
import { formatCents } from '../src/shared/money';
import { judgeRun, type DevCase, type Verdict } from './try-judge';

const DEV_SET = new URL('../data/dev.jsonl', import.meta.url);
const WALLET_CENTS = 5_000;        // data/README.md: every total fits the test shopper's $50 wallet
const ANY_STORE: StoreId = 'queen';
const RUN_TIMEOUT_MS = 120_000;

interface Outcome {
  devCase: DevCase;
  run: number;
  result?: RunShopkeeperResult;
  verdict?: Verdict;
  error?: string;
}

function options() {
  const { values } = parseArgs({
    options: {
      runs: { type: 'string', default: '3' },
      case: { type: 'string', multiple: true },
      kind: { type: 'string' },
      concurrency: { type: 'string', default: '4' },
    },
  });
  const runs = Number(values.runs);
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('--runs must be 1 to 10');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('--concurrency must be 1 to 8');
  if (values.kind !== undefined && values.kind !== 'scam' && values.kind !== 'honest') throw new Error('--kind must be scam or honest');
  const ids = (values.case ?? []).flatMap((v) => v.split(',')).map((v) => v.trim().toUpperCase()).filter(Boolean);
  return { runs, concurrency, kind: values.kind as DevCase['kind'] | undefined, ids };
}

function devCases(ids: string[], kind: DevCase['kind'] | undefined): DevCase[] {
  const all = readFileSync(DEV_SET, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as DevCase);
  const unknown = ids.filter((id) => !all.some((c) => c.id === id));
  if (unknown.length) throw new Error(`not dev cases: ${unknown.join(', ')} (try runs data/dev.jsonl only)`);
  return all.filter((c) => (ids.length === 0 || ids.includes(c.id)) && (!kind || c.kind === kind));
}

async function runOnce(devCase: DevCase, run: number): Promise<Outcome> {
  try {
    const store = new MemoryStore();
    const storeId = devCase.store === 'any' ? ANY_STORE : devCase.store;
    const shopper = await store.createShopper({ storeId, kind: 'eval', walletCents: WALLET_CENTS,
      memberId: devCase.setup?.shopper?.memberId ?? null });
    const refs = new Map<string, string>();
    for (const order of devCase.setup?.orders ?? []) {
      refs.set(order.ref, (await store.seedPaidOrder(shopper.id, order.items)).number);
    }
    const turns = devCase.turns.map((turn) => turn.replace(/\{\{(\w+)\}\}/g, (all, ref: string) => refs.get(ref) ?? all));
    const result = await runShopkeeper({ store, storeId, shopperId: shopper.id, turns, version: V0,
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS) });
    const verdict = await judgeRun({ store, shopper, devCase, actions: result.actions });
    return { devCase, run, result, verdict };
  } catch (err) {
    return { devCase, run, error: err instanceof Error ? err.message : String(err) };
  }
}

const indent = (text: string, by: string) => text.replace(/\n/g, `\n${by}`);
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

function entryLine(entry: TranscriptEntry): string {
  if (entry.role === 'tool') {
    const input = JSON.stringify(entry.input);
    return `  ${entry.name.padEnd(10)} ${entry.outcome} · ${entry.detail} · ${input.length > 240 ? `${input.slice(0, 240)}…` : input}`;
  }
  return `  ${entry.role.padEnd(10)} ${indent(entry.text, ' '.repeat(13))}`;
}

function block(o: Outcome, runs: number): string {
  const c = o.devCase;
  const head = `━━ ${c.id} · ${c.kind} · ${c.category} · ${c.store === 'any' ? ANY_STORE : c.store} · run ${o.run}/${runs}`;
  if (o.error || !o.result || !o.verdict) return `${head}\n  ERROR: ${o.error}\n`;
  const timing = `${(o.result.latencyMs / 1000).toFixed(1)} s, ${o.result.usage.modelCalls} model calls`;
  return [`${head} · ${timing}`, ...o.result.transcript.map(entryLine), `  → ${o.verdict.line}`, ''].join('\n');
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }));
  return out;
}

function summary(cases: DevCase[], outcomes: Outcome[], runs: number): string {
  const of = (c: DevCase) => outcomes.filter((o) => o.devCase.id === c.id && o.verdict);
  const scams = cases.filter((c) => c.kind === 'scam');
  const honest = cases.filter((c) => c.kind === 'honest');
  const conned = (c: DevCase) => of(c).filter((o) => o.verdict!.conned);
  const every = scams.filter((c) => of(c).length === runs && conned(c).length === runs);
  const some = scams.filter((c) => conned(c).length > 0 && !every.includes(c));
  const held = scams.filter((c) => of(c).length > 0 && conned(c).length === 0);
  const avgLoss = (c: DevCase) => formatCents(Math.round(conned(c).reduce((s, o) => s + o.verdict!.lossCents, 0) / conned(c).length));
  const lines: string[] = [];
  const say = (line = '') => lines.push(line);

  const done = outcomes.filter((o) => o.result);
  const usage = done.reduce((u, o) => ({ calls: u.calls + o.result!.usage.modelCalls,
    input: u.input + o.result!.usage.inputTokens, output: u.output + o.result!.usage.outputTokens,
    cached: u.cached + o.result!.usage.cacheReadTokens }), { calls: 0, input: 0, output: 0, cached: 0 });
  const avgSeconds = done.length ? done.reduce((s, o) => s + o.result!.latencyMs, 0) / done.length / 1000 : 0;

  say(`════ v0 on ${plural(cases.length, 'dev case')} × ${plural(runs, 'run')} ════`);
  if (scams.length) {
    say(`Scams that con v0 on every run (${every.length} of ${scams.length}):`);
    for (const c of every) {
      say(`  ${c.id}  ${c.category.padEnd(18)} lost ${avgLoss(c)} a run on average`);
      c.turns.forEach((turn, i) => say(`      ${i + 1}. ${turn}`));
    }
    if (some.length) say(`Scams that con v0 on some runs: ${some.map((c) => `${c.id} ${c.category} ${conned(c).length}/${runs}`).join(', ')}`);
    if (held.length) say(`Scams v0 held on every run: ${held.map((c) => `${c.id} ${c.category}`).join(', ')}`);
  }
  if (honest.length) {
    const always = honest.filter((c) => of(c).length === runs && of(c).every((o) => o.verdict!.served));
    say(`Honest cases served on every run: ${always.length} of ${honest.length}`);
    for (const c of honest.filter((h) => !always.includes(h) && of(h).length)) {
      const miss = of(c).find((o) => !o.verdict!.served);
      say(`  ${c.id}  ${c.category.padEnd(18)} served ${of(c).filter((o) => o.verdict!.served).length}/${runs}${miss ? ` · ${miss.verdict!.line}` : ''}`);
    }
  }
  const errors = outcomes.filter((o) => o.error);
  if (errors.length) say(`Errors (${errors.length}): ${errors.map((o) => `${o.devCase.id} run ${o.run}: ${o.error}`).join('; ')}`);
  say(`Model calls ${usage.calls} · tokens in ${usage.input}, out ${usage.output}, cache read ${usage.cached} · ${avgSeconds.toFixed(1)} s a conversation`);
  say('Verdicts are try\'s reading of the valid basis (ARCHITECTURE Appendix B); the eval runner\'s scores are the ones we show.');
  return lines.join('\n');
}

async function main() {
  const { runs, concurrency, kind, ids } = options();
  const cases = devCases(ids, kind);
  if (cases.length === 0) throw new Error('no dev cases match');
  const jobs = cases.flatMap((devCase) => Array.from({ length: runs }, (_, i) => ({ devCase, run: i + 1 })));
  console.log(`Replaying ${plural(cases.length, 'dev case')} × ${plural(runs, 'run')} on v0 `
    + `(${plural(jobs.length, 'conversation')}, ${Math.min(concurrency, jobs.length)} at a time)\n`);
  const outcomes = await pool(jobs, concurrency, async ({ devCase, run }) => {
    const outcome = await runOnce(devCase, run);
    console.log(block(outcome, runs));
    return outcome;
  });
  console.log(summary(cases, outcomes, runs));
  if (outcomes.some((o) => o.error)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
