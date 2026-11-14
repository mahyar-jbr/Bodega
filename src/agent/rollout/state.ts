// Guardrail versions and the active pointer, in Atlas. Versions are immutable documents (their rules
// never change; only their status does). Promotion, rollback and reset each move `activeVersion` in
// one transaction, so two versions are never active at once; every store runtime then applies the
// change on its own (./runtimes.ts).
import type { ClientSession, Db } from 'mongodb';
import { CONVERSATIONS } from '../conversations';
import { validateVersion } from '../guard/rules';
import { V0, type GuardrailVersion, type Rule } from '../guard/types';

export const AGENT_STATE = 'agent_state';
export const GUARDRAILS = 'guardrails';
export const STORE_RUNTIME = 'store_runtime';
export const ROLLOUTS = 'rollouts';
export const INCIDENTS = 'incidents';
export const CONS = 'cons';

export type StateChange = 'init' | 'promote' | 'rollback' | 'reset';

export interface AgentStateDoc {
  _id: 'agent';
  activeVersion: number;
  /** When activeVersion last moved (time to immunity and time to forget are measured from it). */
  changedAt: Date;
  change: StateChange;
  /** Versions active before the current one, oldest first: a rollback returns to the last. */
  stack: number[];
  learning: boolean;
  /** The learning lock's heartbeat and owner: a lock whose heartbeat is older than the learner's lease is stale. */
  learningLockedAt?: Date;
  learningOwner?: string;
  learningPaused: boolean;
  /** When true, a version that passes the gate waits for a person before any store applies it. */
  approvalRequired?: boolean;
  /** The version waiting for approval, if any (one at a time). */
  awaitingApproval?: number | null;
  /** The con-memory epoch: a reset starts a new one. */
  epoch: number;
  rollbacks: { from: number; to: number; at: Date }[];
}

export type VersionSource = 'v0' | 'hand-written' | 'learner' | 'gate-demo';
export type VersionStatus = 'candidate' | 'promoted' | 'rejected' | 'rolled_back' | 'awaiting_approval' | 'rejected_by_operator';

export interface GuardrailDoc extends GuardrailVersion {
  _id: number;                     // the version number
  title: string;
  cons: string[];                  // every con its rules cover
  source: VersionSource;
  status: VersionStatus;
  createdAt: Date;
  promotedAt: Date | null;
  parentVersion: number | null;    // the version it was learned from
  awaitingSince?: Date;            // passed the gate while approval was required
  approvedAt?: Date;
  rejectedAt?: Date;
  rejectReason?: string | null;
}


export async function ensureAgentState(db: Db): Promise<void> {
  const now = new Date();
  await db.collection<AgentStateDoc>(AGENT_STATE).updateOne(
    { _id: 'agent' },
    { $setOnInsert: { activeVersion: 0, changedAt: now, change: 'init', stack: [], learning: false, learningPaused: false, epoch: 1, rollbacks: [] } },
    { upsert: true },
  );
  await db.collection<GuardrailDoc>(GUARDRAILS).updateOne(
    { _id: 0 },
    { $setOnInsert: { version: 0, rules: [], title: 'v0: no guardrails', cons: [], source: 'v0', status: 'promoted', createdAt: now, promotedAt: now, parentVersion: null } },
    { upsert: true },
  );
  await db.collection(ROLLOUTS).createIndex({ changedAt: -1, storeId: 1 });
  await ensureUniqueRollouts(db);
}

const ROLLOUT_KEY = { storeId: 1, version: 1, change: 1, changedAt: 1 } as const;

/** One rollouts row per (storeId, version, change, changedAt), enforced by a unique index. Rows a
 *  second process wrote before the index existed are removed first (the earliest is kept). */
async function ensureUniqueRollouts(db: Db): Promise<void> {
  const coll = db.collection(ROLLOUTS);
  try {
    await coll.createIndex(ROLLOUT_KEY, { unique: true, name: 'one_row_per_store_and_change' });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const dupes = await coll.aggregate<{ ids: unknown[] }>([
      { $sort: { appliedAt: 1 } },
      { $group: { _id: { storeId: '$storeId', version: '$version', change: '$change', changedAt: '$changedAt' }, ids: { $push: '$_id' }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ]).toArray();
    const extra = dupes.flatMap((d) => d.ids.slice(1));
    if (extra.length) await coll.deleteMany({ _id: { $in: extra as never[] } });
    console.log(`rollouts: removed ${extra.length} duplicate rows`);
    await coll.createIndex(ROLLOUT_KEY, { unique: true, name: 'one_row_per_store_and_change' });
  }
}

export async function readAgentState(db: Db, session?: ClientSession): Promise<AgentStateDoc> {
  const doc = await db.collection<AgentStateDoc>(AGENT_STATE).findOne({ _id: 'agent' }, { session });
  if (!doc) throw new Error('agent_state is missing: call ensureAgentState first');
  return doc;
}

/** Read from Atlas every time (no cache): a version is loaded only when the active version changes,
 *  and version numbers start again at v1 after `npm run fresh-show` archives a show. */
export async function loadVersion(db: Db, n: number): Promise<GuardrailVersion | null> {
  if (n === 0) return V0;
  const doc = await db.collection<GuardrailDoc>(GUARDRAILS).findOne({ _id: n }, { projection: { version: 1, rules: 1 } });
  return doc ? { version: doc.version, rules: doc.rules } : null;
}

export async function nextVersionNumber(db: Db): Promise<number> {
  const top = await db.collection<GuardrailDoc>(GUARDRAILS).find({}, { projection: { _id: 1 } }).sort({ _id: -1 }).limit(1).next();
  return (top?._id ?? 0) + 1;
}

/** Saves a new version as a candidate. Throws when its rules are invalid. */
export async function saveVersion(db: Db, input: { version?: number; rules: Rule[]; title: string; source: VersionSource;
  parentVersion?: number | null }): Promise<GuardrailDoc> {
  const version = input.version ?? (await nextVersionNumber(db));
  const errors = validateVersion({ version, rules: input.rules });
  if (errors.length) throw new Error(`invalid version: ${errors.join('; ')}`);
  const doc: GuardrailDoc = {
    _id: version, version, rules: input.rules, title: input.title,
    cons: [...new Set(input.rules.flatMap((r) => r.cons))],
    source: input.source, status: 'candidate', createdAt: new Date(), promotedAt: null,
    parentVersion: input.parentVersion ?? null,
  };
  await db.collection<GuardrailDoc>(GUARDRAILS).insertOne(doc);
  return doc;
}

async function inTransaction<T>(db: Db, fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = db.client.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => { result = await fn(session); });
    return result as T;
  } finally {
    await session.endSession();
  }
}

/** Makes a saved version the active one, in one transaction with its covered cons. While approval is
 *  required, a version that isn't approved yet is held instead: it waits as 'awaiting_approval', and
 *  nothing rolls out until approveAwaiting(). */
export async function promoteVersion(db: Db, version: number, opts: { approved?: boolean } = {}):
  Promise<{ fromVersion: number; toVersion: number; changedAt: Date; awaitingApproval?: boolean }> {
  return inTransaction(db, async (session) => {
    const state = await readAgentState(db, session);
    const doc = await db.collection<GuardrailDoc>(GUARDRAILS).findOne({ _id: version }, { session });
    if (!doc) throw new Error(`no version ${version}`);
    if (state.approvalRequired && !opts.approved) {
      await db.collection<GuardrailDoc>(GUARDRAILS).updateOne({ _id: version }, { $set: { status: 'awaiting_approval', awaitingSince: new Date() } }, { session });
      await db.collection<AgentStateDoc>(AGENT_STATE).updateOne({ _id: 'agent' }, { $set: { awaitingApproval: version } }, { session });
      return { fromVersion: state.activeVersion, toVersion: state.activeVersion, changedAt: state.changedAt, awaitingApproval: true };
    }
    const changedAt = new Date();
    const stack = state.activeVersion === version ? state.stack : [...state.stack, state.activeVersion];
    await db.collection<AgentStateDoc>(AGENT_STATE).updateOne({ _id: 'agent' },
      { $set: { activeVersion: version, changedAt, change: 'promote', stack, ...(opts.approved ? { awaitingApproval: null } : {}) } }, { session });
    await db.collection<GuardrailDoc>(GUARDRAILS).updateOne({ _id: version },
      { $set: { status: 'promoted', promotedAt: changedAt, ...(opts.approved ? { approvedAt: changedAt } : {}) } }, { session });
    if (doc.cons.length) await db.collection(CONS).updateMany({ _id: { $in: doc.cons as never[] } }, { $set: { coveredBy: version } }, { session });
    return { fromVersion: state.activeVersion, toVersion: version, changedAt };
  });
}

export async function setApprovalRequired(db: Db, on: boolean): Promise<void> {
  await db.collection<AgentStateDoc>(AGENT_STATE).updateOne({ _id: 'agent' }, { $set: { approvalRequired: on } });
}

/** The waiting version goes live: promoted through the usual transaction, so every store applies it
 *  from the change bus and records its time to immunity (from the approval). */
export async function approveAwaiting(db: Db): Promise<{ approved: boolean; version?: number; fromVersion?: number; reason?: string }> {
  const state = await readAgentState(db);
  const n = state.awaitingApproval ?? null;
  if (n === null) return { approved: false, reason: 'No version is waiting for approval.' };
  const doc = await db.collection<GuardrailDoc>(GUARDRAILS).findOne({ _id: n });
  if (doc?.status !== 'awaiting_approval') {
    await db.collection<AgentStateDoc>(AGENT_STATE).updateOne({ _id: 'agent', awaitingApproval: n }, { $set: { awaitingApproval: null } });
    return { approved: false, reason: `v${n} is no longer waiting (${doc?.status ?? 'missing'}).` };
  }
  const r = await promoteVersion(db, n, { approved: true });
  return { approved: true, version: n, fromVersion: r.fromVersion };
}

/** The waiting version never goes live: a person rejected it. Its cons stay uncovered. */
export async function rejectAwaiting(db: Db, reason?: string): Promise<{ rejected: boolean; version?: number; reason?: string }> {
  return inTransaction(db, async (session) => {
    const state = await readAgentState(db, session);
    const n = state.awaitingApproval ?? null;
    if (n === null) return { rejected: false, reason: 'No version is waiting for approval.' };
    await db.collection<GuardrailDoc>(GUARDRAILS).updateOne({ _id: n, status: 'awaiting_approval' },
      { $set: { status: 'rejected_by_operator', rejectedAt: new Date(), rejectReason: reason?.slice(0, 200) ?? null } }, { session });
    await db.collection<AgentStateDoc>(AGENT_STATE).updateOne({ _id: 'agent' }, { $set: { awaitingApproval: null } }, { session });
    return { rejected: true, version: n };
  });
}

/** Takes back the active version: back to the one before it (or v0). Learning pauses until Learn now or Reset. */
export async function rollbackActive(db: Db): Promise<{ fromVersion: number; toVersion: number; changedAt: Date }> {
  return inTransaction(db, async (session) => {
    const state = await readAgentState(db, session);
    const changedAt = new Date();
    const from = state.activeVersion;
    if (from === 0) {
      await db.collection<AgentStateDoc>(AGENT_STATE).updateOne({ _id: 'agent' }, { $set: { learningPaused: true } }, { session });
      return { fromVersion: 0, toVersion: 0, changedAt: state.changedAt };
    }
    const stack = [...state.stack];
    const to = stack.pop() ?? 0;
    await db.collection<AgentStateDoc>(AGENT_STATE).updateOne({ _id: 'agent' }, {
      $set: { activeVersion: to, changedAt, change: 'rollback', stack, learningPaused: true },
      $push: { rollbacks: { from, to, at: changedAt } },
    }, { session });
    await db.collection<GuardrailDoc>(GUARDRAILS).updateOne({ _id: from }, { $set: { status: 'rolled_back' } }, { session });
    await db.collection(CONS).updateMany({ coveredBy: from }, { $set: { coveredBy: null } }, { session });
    return { fromVersion: from, toVersion: to, changedAt };
  });
}

/** Every store back to v0, learning resumes, and a new con-memory epoch. Keeps the version history,
 *  evaluations and rollouts; clears incidents, cons and conversations (the store-side reset clears every
 *  shopper, so their chats would be orphaned raw text). */
export async function resetAgentState(db: Db): Promise<{ epoch: number; changedAt: Date }> {
  const result = await inTransaction(db, async (session) => {
    const state = await readAgentState(db, session);
    const changedAt = new Date();
    const epoch = state.epoch + 1;
    await db.collection<AgentStateDoc>(AGENT_STATE).updateOne({ _id: 'agent' }, {
      $set: { activeVersion: 0, changedAt, change: 'reset', stack: [], learning: false, learningPaused: false, epoch, rollbacks: [], awaitingApproval: null },
    }, { session });
    // A version still waiting for approval never goes live after a reset.
    await db.collection<GuardrailDoc>(GUARDRAILS).updateMany({ status: 'awaiting_approval' },
      { $set: { status: 'rejected_by_operator', rejectedAt: changedAt, rejectReason: 'reset' } }, { session });
    return { epoch, changedAt };
  });
  await Promise.all([db.collection(INCIDENTS).deleteMany({}), db.collection(CONS).deleteMany({}), db.collection(CONVERSATIONS).deleteMany({})]);
  return result;
}
