// The Flow scene's events: what each pipeline step writes (summaries only), the capped collection,
// one row per event across instances, and the live chat path end to end. The Atlas part runs on a
// throwaway database on the dev cluster (dropped after) and is skipped without a MONGODB_URI.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient, type Db } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChangeEvent } from '../shared/contract';
import { MemoryStore } from '../shared/memory-store';
import { memoryOutcome } from './agent';
import { createFlow, emitMoneyStep, ensureFlowEvents, FLOW_CAP, FLOW_EVENTS, flowValue, recentFlow, watchFlowBus,
  type Flow, type FlowEventDoc, type FlowEventInput } from './flow-events';
import { HAND_WRITTEN_RULES } from './guard/hand-written';
import { V0, type GuardrailVersion } from './guard/types';
import { createAgent } from './index';
import type { ConDoc } from './memory/con-memory';
import { createStoreRuntimes } from './rollout/runtimes';
import { ensureAgentState, promoteVersion, readAgentState, saveVersion } from './rollout/state';
import type { MoneyStepResult } from './shopkeeper/money-step';

const recorder = (): Flow & { events: FlowEventInput[] } => {
  const events: FlowEventInput[] = [];
  return { events, emit: (e) => { events.push(e); }, flushed: async () => {} };
};

const V3: GuardrailVersion = { version: 3, rules: HAND_WRITTEN_RULES.map((r, i) => ({ ...r, cons: [`c:1:con${i}`] })) };
const rule = V3.rules[0];

describe('flow events: what each step writes', () => {
  it('keeps values short and on one line', () => {
    expect(flowValue('  a\n  b  ')).toBe('a b');
    const long = flowValue('x'.repeat(200));
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
  });

  it('a sale: the tool call, the guard passing it, then the order, in that order', () => {
    const flow = recorder();
    const step: MoneyStepResult = { content: '{}', isError: false,
      entry: { role: 'tool', name: 'ring_up', input: {}, outcome: 'done', detail: 'Q-1001' },
      action: { kind: 'order', orderNumber: 'Q-1001', totalCents: 700 } };
    const startedAt = new Date('2026-11-14T15:00:00Z');
    emitMoneyStep(flow, step, startedAt, { storeId: 'queen', version: V0, now: () => new Date(startedAt.getTime() + 300) });
    expect(flow.events.map((e) => [e.node, e.value])).toEqual([
      ['shopkeeper', 'ring_up'], ['guard', 'pass'], ['transaction', 'order Q-1001 $7.00']]);
    expect(flow.events[2].cents).toBe(700);
    const times = flow.events.map((e) => e.at!.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(new Set(times).size).toBe(3);
  });

  it('a refund a learned rule stops: the guard blocks it, and the block names the store that saw it first', () => {
    const flow = recorder();
    const step: MoneyStepResult = { content: '{}', isError: false,
      entry: { role: 'tool', name: 'refund', input: {}, outcome: 'blocked', detail: rule.id },
      blocked: { ruleId: rule.id, title: rule.title, firstSeenStore: 'queen', cents: 950 } };
    emitMoneyStep(flow, step, new Date(), { storeId: 'yonge', version: V3 });
    expect(flow.events.map((e) => e.node)).toEqual(['shopkeeper', 'guard', 'block']);
    expect(flow.events[1]).toMatchObject({ value: `blocked: ${rule.title}`.slice(0, 80), version: 3 });
    expect(flow.events[2]).toMatchObject({ node: 'block', storeId: 'yonge', value: 'refund blocked (first seen Queen St)',
      firstSeenStore: 'queen', version: 3, cents: 950, loop: 'c:1:con0' });
  });

  it('a declined sale shows why, and nothing is blocked on v0', () => {
    const flow = recorder();
    emitMoneyStep(flow, { content: '{}', isError: false, entry: { role: 'tool', name: 'ring_up', input: {}, outcome: 'failed', detail: 'out_of_stock' } },
      new Date(), { storeId: 'scarborough', version: V0 });
    expect(flow.events.map((e) => [e.node, e.value])).toEqual([['shopkeeper', 'ring_up'], ['guard', 'pass'], ['transaction', 'declined: out_of_stock']]);
  });

  it('the memory event says how the con memory filed the incident', () => {
    const con = (c: Partial<ConDoc>) => ({ incidents: 1, grouping: 'agent-memory', matchScore: null, ...c }) as ConDoc;
    expect(memoryOutcome(con({}))).toEqual({ value: 'new con', score: null });
    expect(memoryOutcome(con({ grouping: 'violation' }))).toEqual({ value: 'new con (grouped by violation)', score: null });
    expect(memoryOutcome(con({ incidents: 2, matchScore: 0.8437 }))).toEqual({ value: 'matched 0.84', score: 0.8437 });
    expect(memoryOutcome(con({ incidents: 3, grouping: 'violation' }))).toEqual({ value: 'grouped by violation', score: null });
  });

  it('the change stream: sales and refunds and fresh version changes, each once, with their delay', () => {
    const handlers = new Map<string, (e: ChangeEvent) => void>();
    const bus = { on: (coll: string, fn: (e: ChangeEvent) => void) => { handlers.set(coll, fn); return () => handlers.delete(coll); } };
    const flow = recorder();
    const off = watchFlowBus(bus as never, flow);
    const at = new Date('2026-11-14T15:00:01.000Z');
    const entry = (kind: string) => ({ id: `l-${kind}`, kind, storeId: 'queen', at: new Date(at.getTime() - 120) });
    handlers.get('ledger')!({ coll: 'ledger', op: 'insert', id: 'l-sale', doc: entry('sale'), at });
    handlers.get('ledger')!({ coll: 'ledger', op: 'insert', id: 'l-grant', doc: entry('grant'), at });
    const state = (changedAt: Date) => ({ _id: 'agent', activeVersion: 4, change: 'promote', changedAt });
    handlers.get('agent_state')!({ coll: 'agent_state', op: 'update', id: 'agent', doc: state(new Date(at.getTime() - 90)), at });
    handlers.get('agent_state')!({ coll: 'agent_state', op: 'update', id: 'agent', doc: state(new Date(at.getTime() - 90)), at });   // a heartbeat
    handlers.get('agent_state')!({ coll: 'agent_state', op: 'update', id: 'agent', doc: state(new Date(at.getTime() - 3_600_000)), at });   // old news
    expect(flow.events).toEqual([
      expect.objectContaining({ node: 'changeStream', value: 'ledger insert: sale', storeId: 'queen', ms: 120, ref: 'l-sale', key: 'cs:l-sale' }),
      expect.objectContaining({ node: 'changeStream', value: 'agent_state: v4 (promote)', version: 4, ms: 90 }),
    ]);
    off();
    expect(handlers.size).toBe(0);
  });

  it('only the live chat path watches money steps: evaluations never write events', () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap((d) => d.isDirectory() ? files(join(dir, d.name)) : d.name.endsWith('.ts') && !d.name.endsWith('.test.ts') ? [join(dir, d.name)] : []);
    const passing = files(root).filter((f) => /onMoneyStep\s*:/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(root.length));
    expect(passing).toEqual(['agent.ts']);
  });
});

const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (!process.env.MONGODB_URI && existsSync(envFile)) process.loadEnvFile(envFile);
const uri = process.env.MONGODB_URI?.trim();

describe.skipIf(!uri)('flow events on Atlas', () => {
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

  const all = () => db.collection<FlowEventDoc>(FLOW_EVENTS).find({}).toArray();

  it('a capped collection; the same event from two instances is written once; the newest per epoch, oldest first', async () => {
    await ensureFlowEvents(db);
    await ensureFlowEvents(db);     // again: a second instance booting
    const [info] = await db.listCollections({ name: FLOW_EVENTS }).toArray();
    expect(info).toMatchObject({ options: { capped: true, max: FLOW_CAP.max } });

    let epoch = 7;
    const a = createFlow({ db, epoch: () => epoch });
    const b = createFlow({ db, epoch: () => epoch });
    const t = Date.now();
    a.emit({ node: 'incident', value: 'refund for nothing', key: 'incident:x', at: new Date(t) });
    b.emit({ node: 'incident', value: 'refund for nothing', key: 'incident:x', at: new Date(t) });
    for (let i = 1; i <= 5; i++) a.emit({ node: 'shopper', value: `s${i}`, at: new Date(t + i) });
    epoch = 8;
    a.emit({ node: 'rollback', value: 'v2 to v0', at: new Date(t + 10) });
    await Promise.all([a.flushed(), b.flushed()]);

    const docs = await all();
    expect(docs.filter((d) => d._id === 'incident:x')).toHaveLength(1);
    expect(docs.find((d) => d._id === 'incident:x')).toMatchObject({ epoch: 7, storeId: null, loop: null, ref: null, ms: null, score: null, version: null, cents: null, firstSeenStore: null });
    expect((await recentFlow(db, 7, 3)).map((d) => d.value)).toEqual(['s3', 's4', 's5']);
    expect((await recentFlow(db, 8)).map((d) => d.node)).toEqual(['rollback']);
  }, 30_000);

  it('a rollout is written once per store and change, by the instance that recorded it', async () => {
    const recorded = [recorder(), recorder()];
    const bus = { on: () => () => {} };
    const instances = recorded.map((flow) => createStoreRuntimes({ db, bus, pollMs: 60_000, flow }));
    for (const r of instances) await r.start();
    const v = await saveVersion(db, { rules: HAND_WRITTEN_RULES, title: 'flow rollout', source: 'hand-written' });
    await promoteVersion(db, v.version);
    await Promise.all(instances.map((r) => r.refresh()));
    for (const r of instances) r.stop();

    const rollouts = recorded.flatMap((f) => f.events).filter((e) => e.node === 'rollout');
    expect(rollouts.map((e) => e.storeId).sort()).toEqual(['queen', 'scarborough', 'yonge']);
    for (const e of rollouts) {
      expect(e).toMatchObject({ version: v.version, value: `v${v.version} in ${e.ms} ms` });
      expect(e.ms).toBeGreaterThanOrEqual(0);
    }
  }, 30_000);

  it('a live chat, end to end: shopper (nickname and channel only), tool call, guard, order, reply', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');           // the keyless stand-in shopkeeper: no model calls
    try {
      await db.collection(FLOW_EVENTS).deleteMany({});
      const store = new MemoryStore();
      const agent = createAgent({ store, db, bus: { on: () => () => {} } });
      await agent.start();
      const shopper = await store.createShopper({ storeId: 'queen', kind: 'crowd', nickname: 'Brave Otter' });
      const text = 'two butter tarts please, my secret phrase is pineapple';
      const reply = await agent.handleMessage({ shopperId: shopper.id, storeId: 'queen', text, via: 'voice' });
      expect(reply.actions).toEqual([expect.objectContaining({ kind: 'order', totalCents: 700 })]);
      await new Promise((r) => setTimeout(r, 1_000));     // fire-and-forget writes

      const epoch = (await readAgentState(db)).epoch;
      const docs = await recentFlow(db, epoch);
      const order = reply.actions[0].kind === 'order' ? reply.actions[0].orderNumber : '';
      expect(docs.map((d) => [d.node, d.value])).toEqual([
        ['shopper', 'Brave Otter · voice'], ['shopkeeper', 'ring_up'], ['guard', 'pass'],
        ['transaction', `order ${order} $7.00`], ['shopkeeper', 'replied']]);
      expect(docs.every((d) => d.storeId === 'queen' && d.value.length <= 80)).toBe(true);
      expect(JSON.stringify(docs)).not.toMatch(/pineapple|butter tarts/i);
    } finally {
      vi.unstubAllEnvs();
    }
  }, 30_000);
});
