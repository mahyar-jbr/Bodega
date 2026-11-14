// OPS_OPEN=true: the demo buttons work without the ops password, within limits; what spends money or
// floods the app still needs it; the right password always passes with no limits.
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Db } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentApi, StoreApi } from '../shared/contract';
import { createApiRouter, openOpsPolicy, type OpsAutomation } from './routes';

const agent = {
  start: vi.fn(), handleMessage: vi.fn(), state: vi.fn(async () => ({ activeVersion: 0, learning: false, learningPaused: false, stores: [{ storeId: 'yonge', appliedVersion: 0, appliedAt: null, online: true }] })),
  metrics: vi.fn(), learnNow: vi.fn(async () => ({ started: true })), runEval: vi.fn(async () => ({ evaluationId: 'e1' })),
  gateDemo: vi.fn(async () => ({ evaluationId: 'g1' })), rollback: vi.fn(async () => ({ fromVersion: 2, toVersion: 0 })),
  reset: vi.fn(async () => {}), setStoreOnline: vi.fn(async () => {}),
  approve: vi.fn(async () => ({ approved: false, reason: 'nothing waiting' })),
} as unknown as AgentApi;
const opsAutomation = {
  opening: vi.fn(async (storeId) => ({ runId: 'r1', storeId, cases: [] })),
  startCrowd: vi.fn(async (storeId) => ({ status: 'running', storeId })),
  stopCrowd: vi.fn(async () => ({ status: 'stopped' })),
  status: vi.fn(() => ({ running: false })),
} satisfies OpsAutomation;
const flash = { runFlashSale: vi.fn() };
const resetData = vi.fn(async () => ({}));

let clock = 1_000_000;
let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter({ store: {} as StoreApi, agent, db: {} as Db, opsAutomation, flash: flash as never, resetData, now: () => clock }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ops`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OPS_PASSWORD', 'stage-password');
  vi.stubEnv('OPS_OPEN', 'true');
  clock += 3_600_000;     // every test starts with the limits clear
});

const post = (path: string, { body, password }: { body?: unknown; password?: string } = {}) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(password ? { 'x-ops-password': password } : {}) },
  body: JSON.stringify(body ?? {}),
});

describe('OPS_OPEN=true', () => {
  it('still needs the password for what spends money or floods the app', async () => {
    for (const [path, body] of [['/eval', { version: 1 }], ['/gate-demo'], ['/learn-now'], ['/crowd/start', { storeId: 'queen' }], ['/flash', { storeId: 'queen' }]] as const) {
      expect((await post(path, { body })).status, path).toBe(401);
      expect((await post(path, { body, password: 'wrong' })).status, path).toBe(401);
    }
    expect(agent.runEval).not.toHaveBeenCalled();
    expect(agent.gateDemo).not.toHaveBeenCalled();
    expect(agent.learnNow).not.toHaveBeenCalled();
    expect(opsAutomation.startCrowd).not.toHaveBeenCalled();
    expect((await post('/gate-demo', { password: 'stage-password' })).status).toBe(200);
    expect((await post('/learn-now', { password: 'stage-password' })).status).toBe(200);
  });

  it('opening: open, once a minute across the app', async () => {
    expect((await post('/opening', { body: { storeId: 'queen' } })).status).toBe(200);
    clock += 15_000;
    const again = await post('/opening', { body: { storeId: 'queen' } });
    expect(again.status).toBe(429);
    expect(await again.json()).toEqual({ error: 'rate_limited', detail: 'wait 45 s', retryAfterS: 45 });
    expect(again.headers.get('retry-after')).toBe('45');
    expect(opsAutomation.opening).toHaveBeenCalledTimes(1);
    clock += 45_000;
    expect((await post('/opening', { body: { storeId: 'queen' } })).status).toBe(200);
  });

  it('reset: once every 10 s; rollback: once every 5 s', async () => {
    expect((await post('/reset')).status).toBe(200);
    expect((await post('/reset')).status).toBe(429);
    expect((await post('/rollback')).status).toBe(200);
    expect((await post('/rollback')).status).toBe(429);
    clock += 5_000;
    expect((await post('/rollback')).status).toBe(200);
    expect((await post('/reset')).status).toBe(429);
    clock += 5_000;
    expect((await post('/reset')).status).toBe(200);
    expect(agent.reset).toHaveBeenCalledTimes(2);
    expect(agent.rollback).toHaveBeenCalledTimes(2);
  });

  it('governance and store switches: 10 a minute per address', async () => {
    for (let i = 0; i < 6; i++) expect((await post('/approve')).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await post('/store/yonge/online', { body: { online: true } })).status).toBe(200);
    const eleventh = await post('/approve');
    expect(eleventh.status).toBe(429);
    expect((await eleventh.json()).detail).toBe('wait 60 s');
    clock += 60_000;
    expect((await post('/approve')).status).toBe(200);
  });

  it('the right password passes with no limits; status reads are open', async () => {
    for (let i = 0; i < 3; i++) expect((await post('/reset', { password: 'stage-password' })).status).toBe(200);
    expect((await fetch(`${base}/crowd/status`)).status).toBe(200);
  });

  it('a route not on the list keeps the password', () => {
    expect(openOpsPolicy('POST', '/something-new')).toEqual({ kind: 'password' });
    expect(openOpsPolicy('POST', '/RESET/')).toEqual({ kind: 'global', everyMs: 10_000 });
    expect(openOpsPolicy('GET', '/flash')).toEqual({ kind: 'open' });
  });

  it('off (unset or any other value): every ops call needs the password, with no limits', async () => {
    for (const value of ['', 'false', '1']) {
      vi.stubEnv('OPS_OPEN', value);
      expect((await post('/opening', { body: { storeId: 'queen' } })).status).toBe(401);
      expect((await post('/reset')).status).toBe(401);
    }
    expect((await post('/reset', { password: 'stage-password' })).status).toBe(200);
    expect((await post('/reset', { password: 'stage-password' })).status).toBe(200);
  });
});
