// The crowd bot (M2-08): replays dev cases at one store through agent.handleMessage, in-process.
// - Each case gets a new bot shopper: setup.shopper sets its memberId, and setup.orders become past
//   orders through store.seedPaidOrder, with {{o1}} replaced by the real order number.
// - Turns go in order, 2 seconds apart; at most 3 cases at once, a new one every 3 seconds, looping
//   until stopped. Model calls cost real money: run it only when needed.
// - The opening sends three chosen dev scams at once at one store (Queen St by default): a discount, a
//   refund and a free item, each one that conned the frozen v0 on every dev run.
// Only data/dev.jsonl, never the held-out set. bot_runs keeps case ids, categories, nicknames and
// money, never chat text.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ObjectId, type Db } from 'mongodb';
import { AgentError, type AgentApi, type StoreApi, type StoreId } from '../shared/contract';

export interface DevCase {
  id: string;
  kind: 'scam' | 'honest';
  category: string;
  store: 'any' | StoreId;
  setup?: { shopper?: { memberId?: string }; orders?: { ref: string; items: { sku: string; qty: number }[] }[] };
  turns: string[];
}

/** Picked Nov 14 from `npm run try` on the frozen v0 (2 of 2 runs each): a fake 25% code, a refund
 *  for an order that doesn't exist, and a free Nanaimo bar. Spare free item: S-213. */
export const OPENING_CASES = ['S-201', 'S-209', 'S-218'] as const;

export const CROWD_LIMITS = Object.freeze({ maxActive: 3, startEveryMs: 3_000, turnGapMs: 2_100, walletCents: 5_000 });

const DEV_FILE = fileURLToPath(new URL('../../data/dev.jsonl', import.meta.url));
let devCases: DevCase[] | null = null;
export function loadDevCases(): DevCase[] {
  devCases ??= readFileSync(DEV_FILE, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as DevCase);
  return devCases;
}

export interface CaseResult {
  caseId: string; kind: DevCase['kind']; category: string; nickname: string;
  orders: number; refunds: number; movedCents: number; blocked: number; error: string | null; at: Date;
}

export interface BotRunDoc {
  _id: ObjectId;
  kind: 'crowd' | 'opening';
  storeId: StoreId;
  status: 'running' | 'stopped' | 'done';
  cases: string[];               // case ids started, in order
  started: number;
  finished: number;
  results: CaseResult[];
  startedAt: Date;
  stoppedAt: Date | null;
}

export const BOT_RUNS = 'bot_runs';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CrowdDeps { agent: AgentApi; store: StoreApi; db: Db }

export function createCrowdBot({ agent, store, db }: CrowdDeps) {
  const runs = db.collection<BotRunDoc>(BOT_RUNS);
  let crowd: { runId: ObjectId; storeId: StoreId; stopping: boolean; active: Set<Promise<void>>; loop: Promise<void> } | null = null;

  async function playCase(c: DevCase, storeId: StoreId, runId: ObjectId): Promise<void> {
    const result: CaseResult = { caseId: c.id, kind: c.kind, category: c.category, nickname: '', orders: 0, refunds: 0, movedCents: 0, blocked: 0, error: null, at: new Date() };
    try {
      const shopper = await store.createShopper({ storeId, kind: 'bot', walletCents: CROWD_LIMITS.walletCents, memberId: c.setup?.shopper?.memberId ?? null });
      result.nickname = shopper.nickname;
      const refs: Record<string, string> = {};
      for (const o of c.setup?.orders ?? []) refs[o.ref] = (await store.seedPaidOrder(shopper.id, o.items)).number;
      for (const [i, turn] of c.turns.entries()) {
        if (i > 0) await sleep(CROWD_LIMITS.turnGapMs);
        const text = turn.replace(/\{\{(\w+)\}\}/g, (_, ref: string) => refs[ref] ?? ref);
        const reply = await agent.handleMessage({ shopperId: shopper.id, storeId, text });
        for (const a of reply.actions) {
          if (a.kind === 'order') { result.orders++; result.movedCents += a.totalCents; } else { result.refunds++; result.movedCents += a.amountCents; }
        }
        result.blocked += reply.blocked.length;
      }
    } catch (error) {
      result.error = error instanceof AgentError ? error.code : String((error as Error).message ?? error).slice(0, 120);
    }
    result.at = new Date();
    await runs.updateOne({ _id: runId }, { $inc: { finished: 1 }, $push: { results: result } }).catch((e) => console.error('crowd: record failed:', e));
  }

  function eligible(storeId: StoreId): DevCase[] {
    return loadDevCases().filter((c) => c.store === 'any' || c.store === storeId);
  }

  async function crowdLoop(state: NonNullable<typeof crowd>): Promise<void> {
    const cases = eligible(state.storeId);
    let next = Math.floor(Math.random() * cases.length);
    while (!state.stopping) {
      if (state.active.size < CROWD_LIMITS.maxActive && cases.length > 0) {
        const c = cases[next % cases.length]!;
        next++;
        await runs.updateOne({ _id: state.runId }, { $inc: { started: 1 }, $push: { cases: c.id } });
        const p = playCase(c, state.storeId, state.runId).finally(() => state.active.delete(p));
        state.active.add(p);
      }
      await sleep(CROWD_LIMITS.startEveryMs);
    }
    await Promise.allSettled([...state.active]);
    await runs.updateOne({ _id: state.runId }, { $set: { status: 'stopped', stoppedAt: new Date() } });
  }

  return {
    /** Starts the crowd at one store (one crowd at a time). */
    async startCrowd({ storeId }: { storeId: StoreId }): Promise<{ runId: string; storeId: StoreId; alreadyRunning: boolean }> {
      if (crowd && !crowd.stopping) return { runId: crowd.runId.toHexString(), storeId: crowd.storeId, alreadyRunning: true };
      const doc: BotRunDoc = { _id: new ObjectId(), kind: 'crowd', storeId, status: 'running', cases: [], started: 0, finished: 0, results: [], startedAt: new Date(), stoppedAt: null };
      await runs.insertOne(doc);
      const state = { runId: doc._id, storeId, stopping: false, active: new Set<Promise<void>>(), loop: Promise.resolve() };
      crowd = state;
      state.loop = crowdLoop(state).catch((e) => console.error('crowd:', e)).finally(() => { if (crowd === state) crowd = null; });
      return { runId: doc._id.toHexString(), storeId, alreadyRunning: false };
    },

    /** Stops the crowd: no new cases start, and the ones in flight finish. */
    async stopCrowd(): Promise<{ stopped: boolean; runId?: string }> {
      if (!crowd) return { stopped: false };
      const state = crowd;
      state.stopping = true;
      return { stopped: true, runId: state.runId.toHexString() };
    },

    /** The opening: three dev scams at once at one store. Resolves once they've started. */
    async opening({ storeId = 'queen', caseIds = [...OPENING_CASES] }: { storeId?: StoreId; caseIds?: string[] } = {}): Promise<{ runId: string; storeId: StoreId; cases: string[] }> {
      const cases = caseIds.map((id) => loadDevCases().find((c) => c.id === id)).filter((c): c is DevCase => Boolean(c));
      const doc: BotRunDoc = { _id: new ObjectId(), kind: 'opening', storeId, status: 'running', cases: cases.map((c) => c.id), started: cases.length,
        finished: 0, results: [], startedAt: new Date(), stoppedAt: null };
      await runs.insertOne(doc);
      void Promise.allSettled(cases.map((c) => playCase(c, storeId, doc._id)))
        .then(() => runs.updateOne({ _id: doc._id }, { $set: { status: 'done', stoppedAt: new Date() } }));
      return { runId: doc._id.toHexString(), storeId, cases: doc.cases };
    },

    status() {
      return crowd ? { running: !crowd.stopping, runId: crowd.runId.toHexString(), storeId: crowd.storeId, active: crowd.active.size } : { running: false };
    },
  };
}

export type CrowdBot = ReturnType<typeof createCrowdBot>;
