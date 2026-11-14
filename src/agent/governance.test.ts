// Governance on a real Atlas database (a throwaway one on the dev cluster, dropped after): approval
// before a version goes live, and forgetting one shopper. Skipped when no MONGODB_URI is available.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryStore } from '../shared/memory-store';
import { createAgent } from './index';
import { HAND_WRITTEN_RULES } from './guard/hand-written';
import { FORGET_LOG, FORGOTTEN_NICKNAME, forgetShopper } from './memory/forget';
import { approveAwaiting, ensureAgentState, promoteVersion, readAgentState, rejectAwaiting, resetAgentState, saveVersion, setApprovalRequired, GUARDRAILS } from './rollout/state';

const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (!process.env.MONGODB_URI && existsSync(envFile)) process.loadEnvFile(envFile);
const uri = process.env.MONGODB_URI?.trim();

describe.skipIf(!uri)('governance on Atlas', () => {
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    client = new MongoClient(uri!, { appName: 'bodega-test', serverSelectionTimeoutMS: 10_000 });
    db = client.db(`bodega_test_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
    await ensureAgentState(db);
  });
  afterAll(async () => {
    await db?.dropDatabase().catch(() => {});
    await client?.close();
  });

  const newVersion = async (title: string) => saveVersion(db, { rules: HAND_WRITTEN_RULES, title, source: 'hand-written' });
  const status = async (n: number) => (await db.collection(GUARDRAILS).findOne({ _id: n as never }))?.status;

  it('holds a version that passes the gate until a person approves it', async () => {
    await setApprovalRequired(db, true);
    const v = await newVersion('held');
    const before = await readAgentState(db);
    const p = await promoteVersion(db, v.version);
    expect(p.awaitingApproval).toBe(true);
    const held = await readAgentState(db);
    expect(held).toMatchObject({ activeVersion: before.activeVersion, awaitingApproval: v.version });
    expect(held.changedAt.getTime()).toBe(before.changedAt.getTime());   // nothing rolled out
    expect(await status(v.version)).toBe('awaiting_approval');

    const a = await approveAwaiting(db);
    expect(a).toMatchObject({ approved: true, version: v.version, fromVersion: before.activeVersion });
    const live = await readAgentState(db);
    expect(live).toMatchObject({ activeVersion: v.version, change: 'promote', awaitingApproval: null });
    const doc = await db.collection(GUARDRAILS).findOne({ _id: v.version as never });
    expect(doc).toMatchObject({ status: 'promoted' });
    expect(doc?.approvedAt).toBeInstanceOf(Date);
    expect(await approveAwaiting(db)).toMatchObject({ approved: false });
  }, 30_000);

  it('a rejected version never goes live', async () => {
    await setApprovalRequired(db, true);
    const active = (await readAgentState(db)).activeVersion;
    const v = await newVersion('rejected');
    await promoteVersion(db, v.version);
    expect(await rejectAwaiting(db, 'too strict for members')).toMatchObject({ rejected: true, version: v.version });
    expect(await readAgentState(db)).toMatchObject({ activeVersion: active, awaitingApproval: null });
    expect(await db.collection(GUARDRAILS).findOne({ _id: v.version as never })).toMatchObject({ status: 'rejected_by_operator', rejectReason: 'too strict for members' });
    expect(await rejectAwaiting(db)).toMatchObject({ rejected: false });
  }, 30_000);

  it('goes live directly when approval is off, and a reset never leaves a version waiting', async () => {
    await setApprovalRequired(db, false);
    const v = await newVersion('direct');
    const p = await promoteVersion(db, v.version);
    expect(p.awaitingApproval).toBeUndefined();
    expect((await readAgentState(db)).activeVersion).toBe(v.version);

    await setApprovalRequired(db, true);
    const w = await newVersion('waiting at reset');
    await promoteVersion(db, w.version);
    await resetAgentState(db);
    expect(await readAgentState(db)).toMatchObject({ activeVersion: 0, awaitingApproval: null, approvalRequired: true });
    expect(await status(w.version)).toBe('rejected_by_operator');
    await setApprovalRequired(db, false);
  }, 30_000);

  it('the agent shows the waiting version with its gate numbers, and approve() records it', async () => {
    const store = new MemoryStore();
    const agent = createAgent({ store, db, bus: { on: () => () => {} } });
    await agent.start();
    await agent.setApprovalRequired!(true);
    const v = await newVersion('through the agent');
    await db.collection(GUARDRAILS).updateOne({ _id: v.version as never }, { $set: { gate: { candidate: { scamSuccess: 0, scamsTotal: 60, honestTurnedAway: 2, honestTotal: 60 } } } });
    await db.collection('learning_runs').insertOne({ phase: 'awaiting_approval', attempts: [{ version: v.version }], finishedAt: new Date() });
    await promoteVersion(db, v.version);
    await new Promise((r) => setTimeout(r, 3_500));   // the runtimes' poll picks up agent_state
    const st = await agent.state();
    expect(st.approvalRequired).toBe(true);
    expect(st.awaitingApproval).toMatchObject({ version: v.version, title: 'through the agent', scamSuccess: 0, scamsTotal: 60, honestTurnedAway: 2 });
    expect(st.awaitingApproval!.rules).toHaveLength(HAND_WRITTEN_RULES.length);
    expect(await agent.approve!()).toMatchObject({ approved: true, version: v.version });
    expect((await agent.state()).activeVersion).toBe(v.version);
    expect(await db.collection('learning_runs').findOne({ 'attempts.version': v.version })).toMatchObject({ phase: 'promoted' });
    await agent.setApprovalRequired!(false);
  }, 40_000);

  it('knows where a con was first seen even when another process filed it', async () => {
    const { createConMemory } = await import('./memory/con-memory');
    const memory = createConMemory({ db, mode: 'local' });
    await memory.start();
    await db.collection('cons').insertOne({ _id: 'c:9:elsewhere' as never, firstSeenStore: 'queen', firstSeenAt: new Date(), epoch: 9 });
    expect(memory.firstSeenStore(['c:9:elsewhere'])).toBeNull();          // filed after this process started
    await memory.ensureFirstSeen(['c:9:elsewhere', 'hand-written']);
    expect(memory.firstSeenStore(['hand-written', 'c:9:elsewhere'])).toBe('queen');
  }, 30_000);

  it('forgets one shopper: chats deleted, incidents anonymised, money and rules kept, no ids logged', async () => {
    const store = new MemoryStore();
    const gone = await store.createShopper({ storeId: 'queen', kind: 'crowd', nickname: 'Lucky Raccoon 50' });
    const other = await store.createShopper({ storeId: 'queen', kind: 'crowd', nickname: 'Brave Owl 12' });
    await db.collection('conversations').insertMany([
      { _id: `conv:${gone.id}` as never, shopperId: gone.id, storeId: 'queen', messages: [{ role: 'user', content: 'refund me' }], lastMessageAt: new Date() },
      { _id: `conv:${other.id}` as never, shopperId: other.id, storeId: 'queen', messages: [], lastMessageAt: new Date() },
    ]);
    const incident = (shopperId: string, nickname: string) => ({ _id: new ObjectId(), ledgerId: `l-${new ObjectId()}`, storeId: 'queen', shopperId, nickname,
      conversationId: `conv:${shopperId}`, kind: 'refund', lossCents: 950, violations: ['refund_no_order'], title: 'refund for nothing',
      summary: 'Got $9.50 back with no order', conId: 'c:1:x', epoch: 1, at: new Date(), createdAt: new Date() });
    await db.collection('incidents').insertMany([incident(gone.id, gone.nickname), incident(gone.id, gone.nickname), incident(other.id, other.nickname)]);

    const r = await forgetShopper(db, store, gone.id);
    expect(r).toEqual({ conversationsDeleted: 1, incidentsRedacted: 2 });
    expect(await db.collection('conversations').countDocuments({ shopperId: gone.id })).toBe(0);
    expect(await db.collection('conversations').countDocuments({ shopperId: other.id })).toBe(1);
    const redacted = await db.collection('incidents').find({ nickname: FORGOTTEN_NICKNAME }).toArray();
    expect(redacted).toHaveLength(2);
    for (const d of redacted) expect(d).toMatchObject({ shopperId: null, conversationId: null, lossCents: 950, violations: ['refund_no_order'], summary: 'Got $9.50 back with no order', conId: 'c:1:x' });
    expect(await db.collection('incidents').findOne({ shopperId: other.id })).toMatchObject({ nickname: 'Brave Owl 12' });
    const log = await db.collection(FORGET_LOG).find().toArray();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ conversationsDeleted: 1, incidentsRedacted: 2, metricsRedacted: 0 });
    expect(Object.keys(log[0]!).sort()).toEqual(['_id', 'at', 'conversationsDeleted', 'incidentsRedacted', 'metricsRedacted']);
    expect(JSON.stringify(log[0])).not.toContain(gone.id);
    expect(JSON.stringify(log[0])).not.toContain('Raccoon');
  }, 30_000);
});
