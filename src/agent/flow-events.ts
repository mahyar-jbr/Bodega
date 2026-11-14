// The pipeline as it happens, for the big screen's Flow scene: one short event per step a message,
// a con or a guardrail goes through (shopper, shopkeeper, guard, transaction, change stream, auditor,
// incident, memory, learner, gate, guardrail, rollout, block, rollback). Written to a capped Atlas
// collection, so every instance (two are alive during a deploy) and the screen see one list.
// Summaries only: nicknames, tool names, rule and incident titles, amounts and timings, never what a
// customer typed or said. Only the live path writes events: evaluation cases never do.
import { ObjectId, type Db } from 'mongodb';
import type { ChangeBus, LedgerEntry, StoreId } from '../shared/contract';
import { formatCents } from '../shared/money';
import type { GuardrailVersion } from './guard/types';
import type { AgentStateDoc } from './rollout/state';
import type { MoneyStepResult } from './shopkeeper/money-step';
import { STORE_NAMES } from './shopkeeper/prompt';

export const FLOW_EVENTS = 'flow_events';
/** About 1 MB and 2,000 events (an event is about 250 bytes); the oldest drop off on their own. */
export const FLOW_CAP = Object.freeze({ size: 1_048_576, max: 2_000 });
export const MAX_FLOW_VALUE = 80;

export type FlowNode = 'shopper' | 'shopkeeper' | 'guard' | 'transaction' | 'changeStream' | 'auditor' | 'incident'
  | 'memory' | 'learner' | 'gate' | 'guardrail' | 'rollout' | 'block' | 'rollback';

export interface FlowEventDoc {
  /** A source key when the event comes from shared data (a ledger entry, an incident, a rollout row),
   *  so the same event from two instances is written once; otherwise an ObjectId. */
  _id: string | ObjectId;
  epoch: number;
  at: Date;
  node: FlowNode;
  storeId: StoreId | null;
  /** At most 80 characters, a summary. */
  value: string;
  /** Ties one con's journey together: its con id once known (memory onwards, and the block it causes). */
  loop: string | null;
  /** The ledger entry id, on the events that come from one (changeStream, auditor, incident, memory). */
  ref: string | null;
  /** rollout and rollback: time to immunity or to forget; changeStream: source time to delivery. */
  ms: number | null;
  /** memory: the Agent Memory similarity when an incident matched a known con. */
  score: number | null;
  /** The guardrail version involved (guard, guardrail, gate, rollout, block, rollback). */
  version: number | null;
  /** transaction: the amount; auditor and incident: the loss; block: what it would have cost. */
  cents: number | null;
  /** block: the store that saw this trick first. */
  firstSeenStore: StoreId | null;
}

export interface FlowEventInput {
  node: FlowNode;
  value: string;
  at?: Date;
  storeId?: StoreId | null;
  loop?: string | null;
  ref?: string | null;
  ms?: number | null;
  score?: number | null;
  version?: number | null;
  cents?: number | null;
  firstSeenStore?: StoreId | null;
  /** Dedupes across instances: the same key is written once. */
  key?: string;
}

export interface Flow {
  /** Fire and forget: never throws, never waits, never slows a reply. */
  emit(event: FlowEventInput): void;
  /** Resolves when every event emitted so far is written (tests). */
  flushed(): Promise<void>;
}

export const NO_FLOW: Flow = { emit() {}, async flushed() {} };

export const flowValue = (text: string) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_FLOW_VALUE ? `${clean.slice(0, MAX_FLOW_VALUE - 1)}…` : clean;
};

/** The capped collection and its index. Never fatal: without it, events go to a plain collection. */
export async function ensureFlowEvents(db: Db): Promise<void> {
  try {
    await db.createCollection(FLOW_EVENTS, { capped: true, size: FLOW_CAP.size, max: FLOW_CAP.max });
  } catch (error) {
    if ((error as { codeName?: string }).codeName !== 'NamespaceExists') console.error(`flow events: no capped collection (${(error as Error).message})`);
  }
  await db.collection(FLOW_EVENTS).createIndex({ epoch: 1, at: -1 }).catch((e) => console.error('flow events: index failed:', (e as Error).message));
}

export function createFlow({ db, epoch, now = () => new Date() }: { db: Db; epoch: () => number; now?: () => Date }): Flow {
  const events = db.collection<FlowEventDoc>(FLOW_EVENTS);
  const pending = new Set<Promise<void>>();
  let lastLog = 0;
  return {
    emit(e) {
      try {
        const doc: FlowEventDoc = {
          _id: e.key ?? new ObjectId(), epoch: epoch(), at: e.at ?? now(), node: e.node, storeId: e.storeId ?? null,
          value: flowValue(e.value), loop: e.loop ?? null, ref: e.ref ?? null, ms: e.ms ?? null, score: e.score ?? null,
          version: e.version ?? null, cents: e.cents ?? null, firstSeenStore: e.firstSeenStore ?? null,
        };
        const write: Promise<void> = events.insertOne(doc).then(() => {}, (error) => {
          if ((error as { code?: number }).code === 11000) return;       // another instance wrote it first
          if (Date.now() - lastLog > 30_000) { lastLog = Date.now(); console.error(`flow events: write failed (${(error as Error).message})`); }
        }).finally(() => pending.delete(write));
        pending.add(write);
      } catch (error) {
        console.error(`flow events: ${(error as Error).message}`);
      }
    },
    async flushed() {
      while (pending.size) await Promise.all([...pending]);
    },
  };
}

/** The last `limit` events of an epoch, oldest first (what the screen shows). */
export async function recentFlow(db: Db, epoch: number, limit = 60): Promise<FlowEventDoc[]> {
  const docs = await db.collection<FlowEventDoc>(FLOW_EVENTS).find({ epoch }).sort({ at: -1, _id: -1 }).limit(limit).toArray();
  return docs.reverse();
}

/** A change the bus delivers this long after it was made is an old one (a boot, a heartbeat), not news. */
const FRESH_CHANGE_MS = 60_000;

/** changeStream events: sales and refunds reaching the agent, and a new active version reaching the stores. */
export function watchFlowBus(bus: ChangeBus, flow: Flow): () => void {
  let lastChange = 0;
  const offLedger = bus.on<LedgerEntry & { _id?: unknown }>('ledger', (e) => {
    const doc = e.doc;
    if (e.op !== 'insert' || !doc || (doc.kind !== 'sale' && doc.kind !== 'refund')) return;
    const id = doc.id ?? String(doc._id);
    flow.emit({ node: 'changeStream', at: e.at, storeId: doc.storeId, value: `ledger insert: ${doc.kind}`, ref: id,
      ms: Math.max(0, e.at.getTime() - new Date(doc.at).getTime()), key: `cs:${id}` });
  });
  const offState = bus.on<AgentStateDoc>('agent_state', (e) => {
    const doc = e.doc;
    if (!doc || doc._id !== 'agent' || !doc.changedAt) return;
    const changedAt = new Date(doc.changedAt).getTime();
    const ms = e.at.getTime() - changedAt;
    if (changedAt <= lastChange || ms > FRESH_CHANGE_MS) return;
    lastChange = changedAt;
    flow.emit({ node: 'changeStream', at: e.at, value: `agent_state: v${doc.activeVersion} (${doc.change})`, version: doc.activeVersion,
      ms: Math.max(0, ms), key: `cs:agent:${changedAt}` });
  });
  return () => { offLedger(); offState(); };
}

/** The con a rule was learned from (the journey a block belongs to). */
export function conOfRule(version: GuardrailVersion, ruleId: string): string | null {
  return version.rules.find((r) => r.id === ruleId)?.cons[0] ?? null;
}

/** One money call in a live chat: the shopkeeper's tool call, the guard's decision, the money that
 *  moved (or why not), and, when a learned rule stopped it, the block. */
export function emitMoneyStep(flow: Flow, step: MoneyStepResult, startedAt: Date,
  ctx: { storeId: StoreId; version: GuardrailVersion; now?: () => Date }): void {
  const { storeId, version } = ctx;
  const t = startedAt.getTime();
  const { name, outcome, detail } = step.entry;
  flow.emit({ node: 'shopkeeper', at: new Date(t), storeId, value: name, version: version.version });
  const decided = new Date(t + 1);
  if (outcome === 'blocked' || outcome === 'capped') {
    flow.emit({ node: 'guard', at: decided, storeId, version: version.version,
      value: `${outcome === 'blocked' ? 'blocked' : 'capped'}: ${step.blocked?.title ?? detail}` });
  } else {
    flow.emit({ node: 'guard', at: decided, storeId, version: version.version, value: 'pass' });
  }
  const after = new Date(Math.max(t + 2, (ctx.now?.() ?? new Date()).getTime()));
  const action = step.action;
  if (action?.kind === 'order') {
    flow.emit({ node: 'transaction', at: after, storeId, value: `order ${action.orderNumber} ${formatCents(action.totalCents)}`, cents: action.totalCents });
  } else if (action?.kind === 'refund') {
    flow.emit({ node: 'transaction', at: after, storeId, value: `refund ${formatCents(action.amountCents)}`, cents: action.amountCents });
  } else if (outcome === 'failed') {
    flow.emit({ node: 'transaction', at: after, storeId, value: `declined: ${detail}` });
  }
  const b = step.blocked;
  if (b && version.version > 0) {
    const what = name === 'refund' ? 'refund' : outcome === 'capped' ? 'discount' : 'checkout';
    flow.emit({ node: 'block', at: new Date(after.getTime() + 1), storeId, version: version.version, cents: b.cents,
      firstSeenStore: b.firstSeenStore, loop: conOfRule(version, b.ruleId),
      value: `${what} ${outcome === 'capped' ? 'capped' : 'blocked'}${b.firstSeenStore ? ` (first seen ${STORE_NAMES[b.firstSeenStore]})` : ''}` });
  }
}
