// The evaluation runner: plays every case on its own fresh in-memory store with the frozen shopkeeper
// and a given guardrail version, scores it from the money, and reports per category with live
// progress. It writes nothing per case anywhere; the caller decides what to keep (held-out: only
// the summary).
import type { StoreId } from '../../shared/contract';
import { MemoryStore } from '../../shared/memory-store';
import { judgeEntries } from '../auditor/judge';
import type { GuardrailVersion } from '../guard/types';
import { hasModelKey, runShopkeeper, type RunShopkeeperInput, type RunShopkeeperResult } from '../shopkeeper/run';
import { SETTINGS_HASH } from '../shopkeeper/settings';
import type { EvalCase, EvalSet } from './cases';
import { scoreCase, type CaseScore } from './score';

export const EVAL_WALLET_CENTS = 5_000;          // the $50 test shopper (data/README.md)

export interface EvalProgress {
  done: number; total: number;
  scamsTested: number; scamsStopped: number;
  honestTested: number; honestServed: number;
}

export interface CategoryResult {
  category: EvalCase['category'];
  kind: EvalCase['kind'];
  total: number;
  succeeded: number;            // scams
  served: number;               // honest
  turnedAway: number;           // honest
  leaks: number;                // honest
  errors: number;
}

export interface EvalSummary {
  set: EvalSet;
  version: number;
  settingsHash: string | null;
  total: number;
  scams: { total: number; succeeded: number; stopped: number; errors: number; successPct: number };
  honest: { total: number; served: number; turnedAway: number; leaks: number; errors: number; turnedAwayPct: number };
  lossCents: number;
  byCategory: CategoryResult[];
  latency: { p50Ms: number; p95Ms: number; maxMs: number };
  modelCalls: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  durationMs: number;
}

export interface EvalRun { summary: EvalSummary; cases: CaseScore[] }

export interface RunEvalInput {
  set: EvalSet;
  cases: EvalCase[];
  version: GuardrailVersion;
  settingsHash?: string | null;
  concurrency?: number;
  onProgress?: (p: EvalProgress) => void;
  signal?: AbortSignal;
  /** The shopkeeper; tests pass a fake. */
  run?: (input: RunShopkeeperInput) => Promise<RunShopkeeperResult>;
}

export async function runEvaluation(input: RunEvalInput): Promise<EvalRun> {
  const started = Date.now();
  // Without a key the shopkeeper falls back to a keyless stub, whose scores mean nothing.
  if (!input.run && !hasModelKey()) {
    throw new Error('ANTHROPIC_API_KEY is not set: refusing to evaluate the keyless stub shopkeeper');
  }
  const run = input.run ?? runShopkeeper;
  const settingsHash = input.settingsHash !== undefined ? input.settingsHash : input.run ? null : SETTINGS_HASH;
  const concurrency = Math.max(1, input.concurrency ?? (Number(process.env.EVAL_CONCURRENCY) || 120));
  const results: CaseScore[] = new Array(input.cases.length);
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const progress: EvalProgress = { done: 0, total: input.cases.length, scamsTested: 0, scamsStopped: 0, honestTested: 0, honestServed: 0 };

  let next = 0;
  async function worker() {
    while (next < input.cases.length) {
      if (input.signal?.aborted) throw new Error('evaluation aborted');
      const i = next++;
      const c = input.cases[i];
      const { score, usage } = await playCase(c, input.version, run, input.signal);
      results[i] = score;
      tokens.input += usage.inputTokens; tokens.output += usage.outputTokens;
      tokens.cacheRead += usage.cacheReadTokens; tokens.cacheWrite += usage.cacheWriteTokens;
      progress.done++;
      if (c.kind === 'scam') { progress.scamsTested++; if (score.outcome === 'stopped') progress.scamsStopped++; }
      else { progress.honestTested++; if (score.outcome === 'served') progress.honestServed++; }
      input.onProgress?.({ ...progress });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, input.cases.length) }, worker));

  return {
    summary: summarize(input.set, input.version.version, settingsHash, results, tokens, Date.now() - started),
    cases: results,
  };
}

const NO_USAGE = { modelCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

async function playCase(c: EvalCase, version: GuardrailVersion, run: NonNullable<RunEvalInput['run']>, signal?: AbortSignal):
  Promise<{ score: CaseScore; usage: RunShopkeeperResult['usage'] }> {
  // One retry when the shopkeeper itself fails (an API error, not a decision).
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const store = new MemoryStore();
    const storeId: StoreId = c.store === 'any' ? 'queen' : c.store;
    const shopper = await store.createShopper({ storeId, kind: 'eval', walletCents: EVAL_WALLET_CENTS, memberId: c.setup?.shopper?.memberId ?? null });
    const refs = new Map<string, string>();
    for (const o of c.setup?.orders ?? []) refs.set(o.ref, (await store.seedPaidOrder(shopper.id, o.items)).number);
    const turns = c.turns.map((t) => t.replace(/\{\{(\w+)\}\}/g, (m, ref: string) => refs.get(ref) ?? m));
    const setupEntries = store.ledger(shopper.id).length;

    try {
      const result = await run({ store, storeId, shopperId: shopper.id, turns, version, conversationId: `eval:${c.id}`, signal });
      const moved = await judgeEntries(store, store.ledger(shopper.id).slice(setupEntries));
      const blockedCalls = result.transcript.filter((t) => t.role === 'tool' && t.outcome === 'blocked').length;
      return { score: { ...scoreCase(c, moved, blockedCalls), latencyMs: result.latencyMs, modelCalls: result.usage.modelCalls }, usage: result.usage };
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    score: { id: c.id, kind: c.kind, category: c.category, outcome: 'error', lossCents: 0, violations: [], detail: lastError.slice(0, 200), latencyMs: 0, modelCalls: 0 },
    usage: NO_USAGE,
  };
}

const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((1000 * n) / d) / 10);

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

export function summarize(set: EvalSet, version: number, settingsHash: string | null, cases: CaseScore[],
  tokens: EvalSummary['tokens'], durationMs: number): EvalSummary {
  const scams = cases.filter((c) => c.kind === 'scam');
  const honest = cases.filter((c) => c.kind === 'honest');
  const count = (cs: CaseScore[], o: CaseScore['outcome']) => cs.filter((c) => c.outcome === o).length;

  const categories = new Map<string, CategoryResult>();
  for (const c of cases) {
    const r = categories.get(c.category) ?? { category: c.category, kind: c.kind, total: 0, succeeded: 0, served: 0, turnedAway: 0, leaks: 0, errors: 0 };
    r.total++;
    if (c.outcome === 'succeeded') r.succeeded++;
    if (c.outcome === 'served') r.served++;
    if (c.outcome === 'turned_away') r.turnedAway++;
    if (c.outcome === 'leak') r.leaks++;
    if (c.outcome === 'error') r.errors++;
    categories.set(c.category, r);
  }

  const latencies = cases.filter((c) => c.outcome !== 'error').map((c) => c.latencyMs).sort((a, b) => a - b);
  const succeeded = count(scams, 'succeeded');
  const turnedAway = count(honest, 'turned_away');
  return {
    set, version, settingsHash, total: cases.length,
    scams: { total: scams.length, succeeded, stopped: count(scams, 'stopped'), errors: count(scams, 'error'), successPct: pct(succeeded, scams.length) },
    honest: { total: honest.length, served: count(honest, 'served'), turnedAway, leaks: count(honest, 'leak'), errors: count(honest, 'error'), turnedAwayPct: pct(turnedAway, honest.length) },
    lossCents: cases.reduce((s, c) => s + c.lossCents, 0),
    byCategory: [...categories.values()].sort((a, b) => (a.kind === b.kind ? a.category.localeCompare(b.category) : a.kind === 'scam' ? -1 : 1)),
    latency: { p50Ms: quantile(latencies, 0.5), p95Ms: quantile(latencies, 0.95), maxMs: latencies.at(-1) ?? 0 },
    modelCalls: cases.reduce((s, c) => s + c.modelCalls, 0),
    tokens,
    durationMs,
  };
}
