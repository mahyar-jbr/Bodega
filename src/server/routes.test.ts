import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Db } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentError, type AgentApi, type Shopper, type StoreApi } from '../shared/contract';
import { createApiRouter, type OpsAutomation } from './routes';
import type { FlashSaleResult } from '../bots/flash';

const shopper: Shopper = {
  id: 'shopper-1',
  nickname: 'Sneaky Raccoon',
  storeId: 'queen',
  walletCents: 2_000,
  memberId: null,
  kind: 'crowd',
  createdAt: new Date('2026-11-14T16:00:00.000Z'),
};

const store = {
  catalog: vi.fn(), product: vi.fn(), code: vi.fn(), member: vi.fn(),
  createShopper: vi.fn(async () => shopper), shopper: vi.fn(), orderByNumber: vi.fn(),
  ordersFor: vi.fn(), checkout: vi.fn(), refund: vi.fn(), seedPaidOrder: vi.fn(),
} satisfies StoreApi;

const chatReply = { reply: 'Fresh coffee, coming up.', actions: [], blocked: [], walletCents: 2_000 };
const agent = {
  start: vi.fn(),
  handleMessage: vi.fn(async () => chatReply),
  state: vi.fn(async () => ({
    activeVersion: 2,
    learning: false,
    learningPaused: false,
    stores: [
      { storeId: 'queen' as const, appliedVersion: 2, appliedAt: new Date(), online: true },
      { storeId: 'yonge' as const, appliedVersion: 2, appliedAt: new Date(), online: true },
      { storeId: 'scarborough' as const, appliedVersion: 2, appliedAt: new Date(), online: true },
    ],
  })),
  metrics: vi.fn(async () => []),
  learnNow: vi.fn(async () => ({ started: true })),
  runEval: vi.fn(async () => ({ evaluationId: 'eval-1' })),
  gateDemo: vi.fn(async () => ({ evaluationId: 'eval-strict' })),
  rollback: vi.fn(async () => ({ fromVersion: 2, toVersion: 1 })),
  reset: vi.fn(async () => undefined),
  setStoreOnline: vi.fn(),
} satisfies AgentApi;

const stores = [
  { storeId: 'scarborough', name: 'Scarborough', color: '#e1a6a9', awning: 'rose' },
  { storeId: 'queen', name: 'Queen St', color: '#baaee3', awning: 'lilac' },
  { storeId: 'yonge', name: 'Yonge St', color: '#d9c099', awning: 'sand' },
];
const db = {
  collection: vi.fn(() => ({
    find: vi.fn(() => ({ toArray: vi.fn(async () => [...stores]) })),
    findOne: vi.fn(async () => null),
  })),
} as unknown as Db;

const opsAutomation = {
  opening: vi.fn(async (storeId) => ({ kind: 'opening', storeId })),
  startCrowd: vi.fn(async (storeId) => ({ kind: 'crowd', status: 'running', storeId })),
  stopCrowd: vi.fn(async () => ({ kind: 'crowd', status: 'stopped' })),
  status: vi.fn(() => ({ running: true, runId: 'crowd-1', storeId: 'yonge' as const, active: 2 })),
} satisfies OpsAutomation;
const resetData = vi.fn(async () => ({ shoppersDeleted: 1 }));
const flash = { runFlashSale: vi.fn<({ storeId }: { storeId?: 'queen' | 'yonge' | 'scarborough' }) => Promise<FlashSaleResult>>() };

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter({ store, agent, db, opsAutomation, flash, resetData }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void error;
    res.status(500).json({ error: 'internal' });
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OPS_PASSWORD', 'test-password');
});

async function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set('content-type', 'application/json');
  return fetch(`${base}${path}`, { ...init, headers });
}

function opsPost(path: string, body?: unknown) {
  return request(path, {
    method: 'POST',
    headers: { 'x-ops-password': 'test-password' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('store and agent routes', () => {
  it('creates a crowd shopper and returns the shopper directly', async () => {
    const response = await request('/api/shoppers', { method: 'POST', body: JSON.stringify({ storeId: 'queen' }) });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ id: 'shopper-1', nickname: 'Sneaky Raccoon', walletCents: 2_000 });
    expect(store.createShopper).toHaveBeenCalledWith({ storeId: 'queen', kind: 'crowd' });
  });

  it('chats using the contract shape and maps agent errors', async () => {
    const response = await request('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ shopperId: 'shopper-1', storeId: 'queen', text: 'A coffee, please' }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(chatReply);

    agent.handleMessage.mockRejectedValueOnce(new AgentError('rate_limited', 'Slow down'));
    const limited = await request('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ shopperId: 'shopper-1', storeId: 'queen', text: 'Again' }),
    });
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toEqual({ error: 'rate_limited' });
  });

  it('rejects invalid shopper and chat inputs', async () => {
    const badStore = await request('/api/shoppers', { method: 'POST', body: JSON.stringify({ storeId: 'nope' }) });
    expect(badStore.status).toBe(400);
    const longChat = await request('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ shopperId: 'shopper-1', storeId: 'queen', text: 'x'.repeat(301) }),
    });
    expect(longChat.status).toBe(400);
  });

  it('returns stores in the demo order plus agent state and metrics', async () => {
    const storeResponse = await request('/api/stores');
    expect((await storeResponse.json()).map((item: { storeId: string }) => item.storeId)).toEqual(['queen', 'yonge', 'scarborough']);
    expect((await (await request('/api/agent/state')).json()).activeVersion).toBe(2);
    await expect((await request('/api/agent/metrics')).json()).resolves.toEqual([]);
  });
});

describe('password-protected ops routes', () => {
  it('rejects a missing or wrong password', async () => {
    expect((await request('/api/ops/reset', { method: 'POST' })).status).toBe(401);
    expect((await request('/api/ops/reset', { method: 'POST', headers: { 'x-ops-password': 'wrong' } })).status).toBe(401);
    expect((await request('/api/ops/crowd/status')).status).toBe(401);
    expect((await request('/api/ops/flash', { method: 'POST' })).status).toBe(401);
    expect((await request('/api/ops/flash')).status).toBe(401);
    expect((await request('/api/ops/store/queen/online', { method: 'POST' })).status).toBe(401);
  });

  it('reads the running crowd without starting a model run', async () => {
    const response = await request('/api/ops/crowd/status', { headers: { 'x-ops-password': 'test-password' } });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ running: true, runId: 'crowd-1', storeId: 'yonge', active: 2 });
    expect(opsAutomation.startCrowd).not.toHaveBeenCalled();
    expect(opsAutomation.opening).not.toHaveBeenCalled();
  });

  it('calls the final agent action table', async () => {
    expect((await opsPost('/api/ops/reset')).status).toBe(200);
    expect((await opsPost('/api/ops/learn-now')).status).toBe(200);
    expect((await opsPost('/api/ops/eval', { set: 'dev', version: 2 })).status).toBe(200);
    expect((await opsPost('/api/ops/gate-demo')).status).toBe(200);
    expect((await opsPost('/api/ops/rollback')).status).toBe(200);
    expect(agent.reset).toHaveBeenCalledOnce();
    expect(resetData).toHaveBeenCalledOnce();
    expect(resetData.mock.invocationCallOrder[0]).toBeLessThan(agent.reset.mock.invocationCallOrder[0]);
    expect(agent.learnNow).toHaveBeenCalledOnce();
    expect(agent.runEval).toHaveBeenCalledWith({ set: 'dev', version: 2 });
    expect(agent.gateDemo).toHaveBeenCalledOnce();
    expect(agent.rollback).toHaveBeenCalledOnce();
  });

  it('runs opening and crowd automation with the final request shapes', async () => {
    expect((await opsPost('/api/ops/opening')).status).toBe(200);
    expect((await opsPost('/api/ops/crowd/start', { storeId: 'yonge' })).status).toBe(200);
    expect((await opsPost('/api/ops/crowd/stop')).status).toBe(200);
    expect(opsAutomation.opening).toHaveBeenCalledWith('queen');
    expect(opsAutomation.startCrowd).toHaveBeenCalledWith('yonge');
    expect(opsAutomation.stopCrowd).toHaveBeenCalledOnce();
  });

  it('accepts a long flash run immediately, defaults to Queen, and prevents duplicate starts/reset', async () => {
    let finish!: (result: FlashSaleResult) => void;
    flash.runFlashSale.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const started = await opsPost('/api/ops/flash');
    expect(started.status).toBe(202);
    await expect(started.json()).resolves.toMatchObject({ kind: 'flash', storeId: 'queen', status: 'running' });
    expect(flash.runFlashSale).toHaveBeenCalledWith({ storeId: 'queen' });
    expect((await opsPost('/api/ops/flash', { storeId: 'queen' })).status).toBe(409);
    expect((await opsPost('/api/ops/reset')).status).toBe(409);
    expect(resetData).not.toHaveBeenCalled();
    const pending = await request('/api/ops/flash?storeId=queen', { headers: { 'x-ops-password': 'test-password' } });
    expect((await pending.json()).run.status).toBe('running');
    finish({ kind: 'flash', storeId: 'queen', status: 'done', succeeded: 10, failed: 90, passed: true, shopperIds: [] } as unknown as FlashSaleResult);
    const completed = await request('/api/ops/flash?storeId=queen', { headers: { 'x-ops-password': 'test-password' } });
    expect((await completed.json()).run).toMatchObject({ status: 'done', succeeded: 10, failed: 90, passed: true });
  });

  it('validates flash input before starting any work', async () => {
    expect((await opsPost('/api/ops/flash', { storeId: 'unknown' })).status).toBe(400);
    expect((await opsPost('/api/ops/flash', { storeId: 'queen', count: 1000 })).status).toBe(400);
    expect(flash.runFlashSale).not.toHaveBeenCalled();
  });

  it('sets a store online/offline and returns its current runtime entry', async () => {
    const offline = { storeId: 'yonge' as const, appliedVersion: 1, appliedAt: new Date(), online: false };
    agent.state.mockResolvedValueOnce({ activeVersion: 2, learning: false, learningPaused: false, stores: [offline] });
    const response = await opsPost('/api/ops/store/yonge/online', { online: false });
    expect(response.status).toBe(200);
    expect(agent.setStoreOnline).toHaveBeenCalledWith('yonge', false);
    expect(await response.json()).toMatchObject({ storeId: 'yonge', appliedVersion: 1, online: false });
    expect((await opsPost('/api/ops/store/yonge/online', { online: true })).status).toBe(200);
    expect(agent.setStoreOnline).toHaveBeenLastCalledWith('yonge', true);
  });

  it('rejects an unknown store and non-boolean online values', async () => {
    expect((await opsPost('/api/ops/store/unknown/online', { online: false })).status).toBe(400);
    expect((await opsPost('/api/ops/store/queen/online', { online: 'false' })).status).toBe(400);
    expect(agent.setStoreOnline).not.toHaveBeenCalled();
  });
});
