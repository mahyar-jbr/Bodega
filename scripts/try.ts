// npm run try: replays dev cases through the shopkeeper on v0, prints each transcript with the
// evaluation's own verdict, and lists the dev scams that con v0 on every run (the demo's lines are
// picked from that list).
//   npm run try                          every dev case, 3 runs
//   npm run try -- --case S-203 --runs 1
//   npm run try -- --kind scam --runs 2
// Dev cases only (loadDevCases reads data/dev.jsonl by name). Each run is one pass of the evaluation
// runner: a fresh MemoryStore per case, scored from the money with the same code as the gate.
// With the real shopkeeper every conversation calls the model.
import '../src/server/env';   // loads .env when it exists (the model key), as the server does
import { parseArgs } from 'node:util';
import { loadDevCases, type EvalCase } from '../src/agent/eval/cases';
import { runEvaluation, type EvalSummary } from '../src/agent/eval/runner';
import type { CaseScore } from '../src/agent/eval/score';
import { V0 } from '../src/agent/guard/types';
import { runShopkeeper, type RunShopkeeperInput, type RunShopkeeperResult, type TranscriptEntry } from '../src/agent/shopkeeper/run';
import { formatCents } from '../src/shared/money';

const RUN_TIMEOUT_MS = 120_000;

function options() {
  const { values } = parseArgs({
    options: {
      runs: { type: 'string', default: '3' },
      case: { type: 'string', multiple: true },
      kind: { type: 'string' },
      concurrency: { type: 'string', default: '8' },
    },
  });
  const runs = Number(values.runs);
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('--runs must be 1 to 10');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 40) throw new Error('--concurrency must be 1 to 40');
  if (values.kind !== undefined && values.kind !== 'scam' && values.kind !== 'honest') throw new Error('--kind must be scam or honest');
  const ids = (values.case ?? []).flatMap((v) => v.split(',')).map((v) => v.trim().toUpperCase()).filter(Boolean);
  return { runs, concurrency, kind: values.kind as EvalCase['kind'] | undefined, ids };
}

function devCases(ids: string[], kind: EvalCase['kind'] | undefined): EvalCase[] {
  const all = loadDevCases();
  const unknown = ids.filter((id) => !all.some((c) => c.id === id));
  if (unknown.length) throw new Error(`not dev cases: ${unknown.join(', ')} (try runs the dev set only)`);
  return all.filter((c) => (ids.length === 0 || ids.includes(c.id)) && (!kind || c.kind === kind));
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
const indent = (text: string, by: string) => text.replace(/\n/g, `\n${by}`);

function entryLine(entry: TranscriptEntry): string {
  if (entry.role === 'tool') {
    const input = JSON.stringify(entry.input);
    return `  ${entry.name.padEnd(10)} ${entry.outcome} · ${entry.detail} · ${input.length > 240 ? `${input.slice(0, 240)}…` : input}`;
  }
  return `  ${entry.role.padEnd(10)} ${indent(entry.text, ' '.repeat(13))}`;
}

function verdict(score: CaseScore): string {
  switch (score.outcome) {
    case 'succeeded': return `CONNED: lost ${formatCents(score.lossCents)} (${score.violations.join(', ')})`;
    case 'stopped': return `held: ${score.detail}`;
    case 'served': return `served: ${score.detail}`;
    case 'turned_away': return `TURNED AWAY: ${score.detail}`;
    case 'leak': return `LEAK: ${score.detail}`;
    case 'error': return `ERROR: ${score.detail}`;
  }
}

function block(c: EvalCase, score: CaseScore, result: RunShopkeeperResult | undefined, run: number, runs: number): string {
  const head = `━━ ${c.id} · ${c.kind} · ${c.category} · ${c.store === 'any' ? 'queen' : c.store} · run ${run}/${runs}`;
  const timing = result ? ` · ${(result.latencyMs / 1000).toFixed(1)} s, ${plural(result.usage.modelCalls, 'model call')}` : '';
  return [`${head}${timing}`, ...(result?.transcript.map(entryLine) ?? []), `  → ${verdict(score)}`, ''].join('\n');
}

function summary(cases: EvalCase[], scores: Map<string, CaseScore[]>, passes: EvalSummary[], runs: number): string {
  const of = (c: EvalCase) => scores.get(c.id) ?? [];
  const count = (c: EvalCase, outcome: CaseScore['outcome']) => of(c).filter((s) => s.outcome === outcome).length;
  const scams = cases.filter((c) => c.kind === 'scam');
  const honest = cases.filter((c) => c.kind === 'honest');
  const every = scams.filter((c) => count(c, 'succeeded') === runs);
  const some = scams.filter((c) => count(c, 'succeeded') > 0 && !every.includes(c));
  const held = scams.filter((c) => count(c, 'succeeded') === 0 && count(c, 'error') < runs);
  const lines: string[] = [];
  const say = (line = '') => lines.push(line);

  say(`════ v0 on ${plural(cases.length, 'dev case')} × ${plural(runs, 'run')} ════`);
  passes.forEach((p, i) => say(`Run ${i + 1}: scams succeeded ${p.scams.succeeded}/${p.scams.total} (lost ${formatCents(p.lossCents)}), `
    + `honest served ${p.honest.served}/${p.honest.total}, turned away ${p.honest.turnedAway}, leaks ${p.honest.leaks}, `
    + `errors ${p.scams.errors + p.honest.errors} · p50 ${(p.latency.p50Ms / 1000).toFixed(1)} s`));
  if (scams.length) {
    say();
    say(`Scams that con v0 on every run (${every.length} of ${scams.length}):`);
    for (const c of every) {
      const avg = Math.round(of(c).reduce((s, x) => s + x.lossCents, 0) / runs);
      const violations = [...new Set(of(c).flatMap((s) => s.violations))].join(', ');
      say(`  ${c.id}  ${c.category.padEnd(18)} lost ${formatCents(avg)} a run on average (${violations})`);
      c.turns.forEach((turn, i) => say(`      ${i + 1}. ${turn}`));
    }
    if (some.length) say(`Scams that con v0 on some runs: ${some.map((c) => `${c.id} ${c.category} ${count(c, 'succeeded')}/${runs}`).join(', ')}`);
    if (held.length) say(`Scams v0 held on every run: ${held.map((c) => `${c.id} ${c.category}`).join(', ')}`);
  }
  if (honest.length) {
    const always = honest.filter((c) => count(c, 'served') === runs);
    say();
    say(`Honest cases served on every run: ${always.length} of ${honest.length}`);
    for (const c of honest.filter((h) => !always.includes(h))) {
      const miss = of(c).find((s) => s.outcome !== 'served');
      say(`  ${c.id}  ${c.category.padEnd(18)} served ${count(c, 'served')}/${runs}${miss ? ` · ${verdict(miss)}` : ''}`);
    }
  }
  const errors = cases.flatMap((c) => of(c).filter((s) => s.outcome === 'error').map((s) => `${c.id}: ${s.detail}`));
  if (errors.length) say(`Errors (${errors.length}): ${errors.join('; ')}`);
  const calls = passes.reduce((n, p) => n + p.modelCalls, 0);
  const tokens = passes.reduce((t, p) => ({ input: t.input + p.tokens.input, output: t.output + p.tokens.output, cacheRead: t.cacheRead + p.tokens.cacheRead }),
    { input: 0, output: 0, cacheRead: 0 });
  say(`Model calls ${calls} · tokens in ${tokens.input}, out ${tokens.output}, cache read ${tokens.cacheRead}`);
  return lines.join('\n');
}

async function main() {
  const { runs, concurrency, kind, ids } = options();
  const cases = devCases(ids, kind);
  if (cases.length === 0) throw new Error('no dev cases match');
  console.log(`Replaying ${plural(cases.length, 'dev case')} × ${plural(runs, 'run')} on v0, `
    + `${Math.min(concurrency, cases.length)} at a time\n`);

  const scores = new Map<string, CaseScore[]>();
  const passes: EvalSummary[] = [];
  for (let run = 1; run <= runs; run++) {
    // The runner names each conversation `eval:<case id>`; keep its transcript for printing.
    const transcripts = new Map<string, RunShopkeeperResult>();
    const capture = async (input: RunShopkeeperInput) => {
      const result = await runShopkeeper({ ...input, signal: input.signal ?? AbortSignal.timeout(RUN_TIMEOUT_MS) });
      transcripts.set(input.conversationId ?? '', result);
      return result;
    };
    const pass = await runEvaluation({
      set: 'dev', cases, version: V0, concurrency, run: capture,
      onProgress: (p) => { if (process.stderr.isTTY) process.stderr.write(`\r  run ${run}/${runs}: ${p.done}/${p.total} conversations`); },
    });
    if (process.stderr.isTTY) process.stderr.write('\n');
    passes.push(pass.summary);
    cases.forEach((c, i) => {
      const score = pass.cases[i]!;
      scores.set(c.id, [...(scores.get(c.id) ?? []), score]);
      console.log(block(c, score, transcripts.get(`eval:${c.id}`), run, runs));
    });
  }
  console.log(summary(cases, scores, passes, runs));
  if ([...scores.values()].flat().some((s) => s.outcome === 'error')) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
