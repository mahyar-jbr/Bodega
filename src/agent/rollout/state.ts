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
  /** When the learning lock was taken (a lock older than the learner's lease is stale). */
  learningLockedAt?: Date;
  learningPaused: boolean;
  /** The con-memory epoch: a reset starts a new one. */
  epoch: number;
  rollbacks: { from: number; to: number; at: Date }[];
}

export type VersionSource = 'v0' | 'hand-written' | 'learner' | 'gate-demo';
export type VersionStatus = 'candidate' | 'promoted' | 'rejected' | 'rolled_back';

export interface GuardrailDoc extends GuardrailVersion {
  _id: number;                     // the version number
  title: string;
  cons: string[];                  // every con its rules cover
  source: VersionSource;
  status: VersionStatus;
  createdAt: Date;
  promotedAt: Date | null;
  parentVersion: number | null;    // the version it was learned from
}

const versionCache = new Map<string, GuardrailVersion>();   // `${db}:${n}`, versions are immutable

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
}

export async function readAgentState(db: Db, session?: ClientSession): Promise<AgentStateDoc> {
  const doc = await db.collection<AgentStateDoc>(AGENT_STATE).findOne({ _id: 'agent' }, { session });
  if (!doc) throw new Error('agent_state is missing: call ensureAgentState first');
  return doc;
}

export async function loadVersion(db: Db, n: number): Promise<GuardrailVersion | null> {
  if (n === 0) return V0;
  const key = `${db.databaseName}:${n}`;
  const cached = versionCache.get(key);
  if (cached) return cached;
  const doc = await db.collection<GuardrailDoc>(GUARDRAILS).findOne({ _id: n }, { projection: { version: 1, rules: 1 } });
  if (!doc) return null;
  const version: GuardrailVersion = { version: doc.version, rules: doc.rules };
  versionCache.set(key, version);
  return version;
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

/** Makes a saved version the active one, in one transaction with its covered cons. */
export async function promoteVersion(db: Db, version: number): Promise<{ fromVersion: number; toVersion: number; changedAt: Date }> {
  return inTransaction(db, async (session) => {
    const state = await readAgentState(db, session);
    const doc = await db.collection<GuardrailDoc>(GUARDRAILS).findOne({ _id: version }, { session });
    if (!doc) throw new Error(`no version ${version}`);
    const changedAt = new Date();
    const stack = state.activeVersion === version ? state.stack : [...state.stack, state.activeVersion];
    await db.collection<AgentStateDoc>(AGENT_STATE).updateOne({ _id: 'agent' },
      { $set: { activeVersion: version, changedAt, change: 'promote', stack } }, { session });
    await db.collection<GuardrailDoc>(GUARDRAILS).updateOne({ _id: version }, { $set: { status: 'promoted', promotedAt: changedAt } }, { session });
    if (doc.cons.length) await db.collection(CONS).updateMany({ _id: { $in: doc.cons as never[] } }, { $set: { coveredBy: version } }, { session });
    return { fromVersion: state.activeVersion, toVersion: version, changedAt };
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
      $set: { activeVersion: 0, changedAt, change: 'reset', stack: [], learning: false, learningPaused: false, epoch, rollbacks: [] },
    }, { session });
    return { epoch, changedAt };
  });
  await Promise.all([db.collection(INCIDENTS).deleteMany({}), db.collection(CONS).deleteMany({}), db.collection(CONVERSATIONS).deleteMany({})]);
  return result;
}
