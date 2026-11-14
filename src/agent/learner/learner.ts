// The learner (M3-05): turns cons no version covers yet into the next guardrail version.
// - Automatic learning starts 10 s after the first new uncovered con and takes every uncovered con that
//   has landed by then; one cycle at a time (agent_state.learning is the lock). A rollback pauses it
//   (agent_state.learningPaused) until Learn now or Reset.
// - Opus writes the complete next version (rules only) as strict structured output from the current
//   version, the facts and the cons' summaries; never raw customer text, never held-out cases.
// - The candidate is validated (one repair round), saved, and sent through the gate. If the gate
//   rejects it, the learner retries once with only the gate's aggregate numbers.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { ObjectId, type Db } from 'mongodb';
import { validateVersion } from '../guard/rules';
import type { GuardrailVersion, Rule } from '../guard/types';
import type { ConDoc, ConMemory } from '../memory/con-memory';
import { AGENT_STATE, loadVersion, readAgentState, saveVersion, type AgentStateDoc } from '../rollout/state';
import { LEARNER_SYSTEM } from './prompt';
import { LearnedVersion, shapeProblems, toRules } from './schema';

import type { GateResult } from '../gate/gate';
export type { GateResult };

export type GateFn = (version: number, opts: { attempt: 1 | 2 }) => Promise<GateResult>;

export type LearningPhase = 'learning' | 'gating' | 'promoted' | 'rejected' | 'failed' | 'skipped';

export interface LearningRunDoc {
  _id: ObjectId;
  epoch: number;
  trigger: 'auto' | 'now';
  cons: string[];
  phase: LearningPhase;
  attempts: { attempt: 1 | 2; version: number; title: string; rules: string[]; verdict: GateResult['verdict'] | null;
    reasons: string[]; evaluationId: string | null; learnMs: number }[];
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
}

export const LEARNING_RUNS = 'learning_runs';
export const LEARN_DELAY_MS = 10_000;

export interface LearnerDeps {
  db: Db;
  conMemory: ConMemory;
  gate: GateFn;
  delayMs?: number;
}

let client: Anthropic | undefined;
const anthropic = () => (client ??= new Anthropic({ maxRetries: 3, timeout: 120_000 }));
const learnerModel = () => process.env.LEARNER_MODEL?.trim() || 'claude-opus-5-5';
export const hasLearnerKey = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim());

function describeVersion(v: GuardrailVersion): string {
  if (v.rules.length === 0) return `The current version is v${v.version}: no rules at all.`;
  return `The current version is v${v.version}. Its rules, as the guard runs them:\n${JSON.stringify(v.rules, null, 1)}`;
}

function describeCons(cons: ConDoc[]): string {
  return cons.map((c) => `- con ${c._id}: violation ${c.violation}, "${c.title}": ${c.summary} (seen ${c.incidents} time${c.incidents === 1 ? '' : 's'}, at ${c.stores.join(', ')}, $${(c.lostCents / 100).toFixed(2)} lost)`).join('\n');
}

export function describeGate(version: number, r: GateResult): string {
  const c = r.candidate, b = r.baseline;
  const cats = Object.entries(c.perCategory).filter(([, x]) => x.failed > 0).map(([k, x]) => `${k} ${x.failed}/${x.n}`).join(', ');
  return [`The evaluation rejected v${version}.`, ...r.reasons.map((x) => `- ${x}`),
    `Candidate: scams that still worked ${c.scamSuccess}/${c.scamsTotal}, honest customers turned away ${c.honestTurnedAway}/${c.honestTotal}, unearned discounts ${c.leaks}.`,
    `Current version: scams that worked ${b.scamSuccess}/${b.scamsTotal}, honest turned away ${b.honestTurnedAway}/${b.honestTotal}.`,
    cats ? `Categories with failures (failed/cases): ${cats}.` : '',
    'You only get these aggregate numbers. Write a corrected complete version: keep what stops scams, and loosen whatever turns honest customers away.'].filter(Boolean).join('\n');
}

/** One proposal from Opus, validated (with one repair round). Throws when it stays invalid. */
export async function proposeVersion(input: { active: GuardrailVersion; cons: ConDoc[]; knownCons: Set<string>; nextVersion: number; feedback?: string | null }):
  Promise<{ title: string; rules: Rule[]; learnMs: number }> {
  const started = Date.now();
  const messages: Anthropic.MessageParam[] = [{
    role: 'user',
    content: [describeVersion(input.active), '', 'New cons the current version does not cover (screen-safe summaries):', describeCons(input.cons),
      ...(input.feedback ? ['', input.feedback] : []), '', 'Write the complete next version.'].join('\n'),
  }];
  for (let round = 1; round <= 2; round++) {
    const response = await anthropic().messages.parse({
      model: learnerModel(),
      max_tokens: 16_000,
      system: LEARNER_SYSTEM,
      output_config: { effort: 'medium', format: zodOutputFormat(LearnedVersion) },
      messages,
    });
    if (response.stop_reason === 'refusal') throw new Error('the learner model declined');
    const parsed = response.parsed_output;
    let problems: string[];
    let rules: Rule[] = [];
    if (!parsed) {
      problems = [`the output did not parse (stop reason ${response.stop_reason})`];
    } else {
      rules = toRules(parsed).map((r) => ({ ...r, cons: r.cons.filter((id) => input.knownCons.has(id)) }));
      problems = [...shapeProblems(parsed), ...validateVersion({ version: input.nextVersion, rules })];
      const covered = new Set(rules.flatMap((r) => r.cons));
      const missed = input.cons.filter((c) => !covered.has(c._id)).map((c) => c._id);
      if (missed.length) problems.push(`these new cons are not covered by any rule: ${missed.join(', ')}`);
      // The model doesn't know the version number it will get: drop a "v1:" it may have guessed.
      const title = parsed.title.trim().replace(/^v\d+\s*[:\-–—]\s*/i, '').slice(0, 120);
      if (problems.length === 0) return { title, rules, learnMs: Date.now() - started };
    }
    if (round === 2) throw new Error(`invalid version after a repair round: ${problems.slice(0, 4).join('; ')}`);
    messages.push({ role: 'assistant', content: response.content }, { role: 'user', content: `That version has problems:\n${problems.map((p) => `- ${p}`).join('\n')}\nWrite the complete corrected version.` });
  }
  throw new Error('unreachable');
}

export function createLearner({ db, conMemory, gate, delayMs = LEARN_DELAY_MS }: LearnerDeps) {
  const runs = db.collection<LearningRunDoc>(LEARNING_RUNS);
  const state = db.collection<AgentStateDoc>(AGENT_STATE);
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  const attempted = new Set<string>();    // cons an automatic cycle already tried (no endless re-learning)

  function scheduleSoon() {
    if (timer || running) return;
    timer = setTimeout(() => { timer = undefined; void cycle('auto'); }, delayMs);
    timer.unref?.();
  }

  async function cycle(trigger: LearningRunDoc['trigger']): Promise<void> {
    if (running) return;
    running = true;
    let locked = false;
    let run: LearningRunDoc | null = null;
    try {
      const lock = await state.updateOne({ _id: 'agent', learning: false }, { $set: { learning: true } });
      if (lock.modifiedCount === 0) return;           // another cycle (or process) holds the lock
      locked = true;
      const st = await readAgentState(db);
      if (trigger === 'auto' && st.learningPaused) return;
      const all = await conMemory.uncovered(st.epoch);
      const cons = trigger === 'auto' ? all.filter((c) => !attempted.has(c._id)) : all;
      if (cons.length === 0) return;
      cons.forEach((c) => attempted.add(c._id));

      run = { _id: new ObjectId(), epoch: st.epoch, trigger, cons: cons.map((c) => c._id), phase: 'learning', attempts: [],
        startedAt: new Date(), finishedAt: null, error: null };
      await runs.insertOne(run);
      const active = (await loadVersion(db, st.activeVersion)) ?? { version: st.activeVersion, rules: [] };
      const knownCons = new Set([...cons.map((c) => c._id), ...active.rules.flatMap((r) => r.cons)]);
      let feedback: string | null = null;

      for (const attempt of [1, 2] as const) {
        const proposal = await proposeVersion({ active, cons, knownCons, nextVersion: 1, feedback });
        const saved = await saveVersion(db, { rules: proposal.rules, title: proposal.title, source: 'learner', parentVersion: active.version });
        const entry = { attempt, version: saved.version, title: saved.title, rules: saved.rules.map((r) => r.title),
          verdict: null, reasons: [], evaluationId: null, learnMs: proposal.learnMs };
        await runs.updateOne({ _id: run._id }, { $set: { phase: 'gating' }, $push: { attempts: entry } });
        const result = await gate(saved.version, { attempt });
        await runs.updateOne({ _id: run._id, 'attempts.version': saved.version },
          { $set: { 'attempts.$.verdict': result.verdict, 'attempts.$.reasons': result.reasons, 'attempts.$.evaluationId': result.evaluationId } });
        if (result.verdict === 'promoted') {
          await runs.updateOne({ _id: run._id }, { $set: { phase: 'promoted', finishedAt: new Date() } });
          return;
        }
        feedback = describeGate(saved.version, result);
      }
      await runs.updateOne({ _id: run._id }, { $set: { phase: 'rejected', finishedAt: new Date() } });
    } catch (error) {
      console.error('learner:', error);
      if (run) await runs.updateOne({ _id: run._id }, { $set: { phase: 'failed', finishedAt: new Date(), error: String((error as Error).message ?? error).slice(0, 300) } }).catch(() => {});
    } finally {
      if (locked) await state.updateOne({ _id: 'agent' }, { $set: { learning: false } }).catch((e) => console.error('learner: unlock failed:', e));
      running = false;
      // Cons that landed during the cycle start the next one.
      void (async () => {
        const st = await readAgentState(db).catch(() => null);
        if (st && !st.learningPaused && (await conMemory.uncovered(st.epoch)).some((c) => !attempted.has(c._id))) scheduleSoon();
      })();
    }
  }

  return {
    /** The con memory calls this for every new con. */
    onNewCon(con: ConDoc) {
      if (con.coveredBy !== null || !hasLearnerKey()) return;
      void readAgentState(db).then((st) => { if (!st.learningPaused) scheduleSoon(); }).catch(() => {});
    },

    /** Learn now: resumes learning after a rollback and starts a cycle right away on every uncovered con. */
    async learnNow(): Promise<{ started: boolean; reason?: string }> {
      if (!hasLearnerKey()) return { started: false, reason: 'Learning needs ANTHROPIC_API_KEY.' };
      const st = await readAgentState(db);
      if (running || st.learning) return { started: false, reason: 'Already learning.' };
      await state.updateOne({ _id: 'agent' }, { $set: { learningPaused: false } });
      if ((await conMemory.uncovered(st.epoch)).length === 0) return { started: false, reason: 'No new cons to learn from.' };
      if (timer) { clearTimeout(timer); timer = undefined; }
      void cycle('now');
      return { started: true };
    },

    /** After a reset. */
    reset() {
      if (timer) { clearTimeout(timer); timer = undefined; }
      attempted.clear();
    },

    isRunning: () => running,
  };
}

export type Learner = ReturnType<typeof createLearner>;
