import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Db } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentApi, StoreApi } from '../shared/contract';
import { createApiRouter } from './routes';

type Governance = Pick<AgentApi, 'setApprovalRequired' | 'approve' | 'reject' | 'forgetShopper' | 'proveMemoryRules'>;
const methods = {
  setApprovalRequired: vi.fn(async (on: boolean) => ({ approvalRequired: on })),
  approve: vi.fn(async () => ({ approved: true, version: 3, fromVersion: 2 })),
  reject: vi.fn(async (reason?: string) => ({ rejected: true, version: 3, reason })),
  forgetShopper: vi.fn(async (_shopperId: string) => ({ conversationsDeleted: 2, incidentsRedacted: 3 })),
  proveMemoryRules: vi.fn(async () => ({ at: new Date('2026-11-14T17:30:00Z'), collection: 'incidents', field: 'text', refused: true, code: 121, codeName: 'DocumentValidationFailure' })),
} satisfies Governance;
const agent = {} as AgentApi;
const cases = [
  { path: 'approval', method: 'setApprovalRequired', body: { on: true } },
  { path: 'approve', method: 'approve' },
  { path: 'reject', method: 'reject', body: { reason: 'Keep the current version' } },
  { path: 'forget-shopper', method: 'forgetShopper', body: { shopperId: 'shopper-1' } },
  { path: 'prove-memory-rules', method: 'proveMemoryRules' },
] as const;
let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter({ agent, store: {} as StoreApi, db: {} as Db }));
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: 'internal' }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ops/`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(agent, methods);
  vi.stubEnv('OPS_PASSWORD', 'governance-test');
});

async function post(path: string, body?: unknown, password: string | null = 'governance-test') {
  const headers = new Headers();
  if (password !== null) headers.set('x-ops-password', password);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return fetch(`${base}${path}`, { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe('governance authentication and optional methods', () => {
  it.each(cases)('protects $path before invoking its method', async ({ path, method, ...test }) => {
    const body = 'body' in test ? test.body : undefined;
    expect((await post(path, body, null)).status).toBe(401);
    expect((await post(path, body, 'wrong')).status).toBe(401);
    expect(methods[method]).not.toHaveBeenCalled();
  });

  it.each(cases)('returns 501 when $method is absent', async ({ path, method, ...test }) => {
    delete agent[method];
    const response = await post(path, 'body' in test ? test.body : undefined);
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: 'not_implemented' });
  });

  it('OPS_OPEN=true opens the ops routes without a password; any other value keeps the password', async () => {
    vi.stubEnv('OPS_OPEN', 'true');
    vi.stubEnv('OPS_PASSWORD', '');
    expect((await post('approve', undefined, null)).status).toBe(200);
    expect(methods.approve).toHaveBeenCalledTimes(1);
    for (const value of ['', 'false', 'TRUE', '1']) {
      vi.stubEnv('OPS_OPEN', value);
      vi.stubEnv('OPS_PASSWORD', 'governance-test');
      expect((await post('approve', undefined, null)).status).toBe(401);
      expect((await post('approve', undefined, 'wrong')).status).toBe(401);
    }
    expect(methods.approve).toHaveBeenCalledTimes(1);
    vi.stubEnv('OPS_OPEN', '');
    expect((await post('approve')).status).toBe(200);
  });

  it('refuses access when ops is not configured', async () => {
    vi.stubEnv('OPS_PASSWORD', '');
    expect((await post('approve')).status).toBe(503);
    expect(methods.approve).not.toHaveBeenCalled();
  });
});

describe('governance method mapping', () => {
  it('sets both approval modes and preserves approve/reject results', async () => {
    expect(await (await post('approval', { on: true })).json()).toEqual({ approvalRequired: true });
    expect(await (await post('approval', { on: false })).json()).toEqual({ approvalRequired: false });
    expect(methods.setApprovalRequired.mock.calls).toEqual([[true], [false]]);
    expect(await (await post('approve')).json()).toEqual({ approved: true, version: 3, fromVersion: 2 });
    expect(methods.approve).toHaveBeenCalledWith();
    expect(await (await post('reject', { reason: '  Keep the current version  ' })).json()).toMatchObject({ rejected: true, version: 3, reason: 'Keep the current version' });
    expect(methods.reject).toHaveBeenLastCalledWith('Keep the current version');
    expect((await post('reject')).status).toBe(200);
    expect(methods.reject).toHaveBeenLastCalledWith(undefined);
  });

  it('forgets only the supplied shopper and returns deletion/redaction counts', async () => {
    const response = await post('forget-shopper', { shopperId: '  shopper-1  ' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ conversationsDeleted: 2, incidentsRedacted: 3 });
    expect(methods.forgetShopper).toHaveBeenCalledExactlyOnceWith('shopper-1');
  });

  it('returns the exact memory proof, including validator code 121', async () => {
    const response = await post('prove-memory-rules');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ at: '2026-11-14T17:30:00.000Z', collection: 'incidents', field: 'text', refused: true, code: 121, codeName: 'DocumentValidationFailure' });
    expect(methods.proveMemoryRules).toHaveBeenCalledWith();
  });

  it('preserves a negative decision result rather than claiming an approval happened', async () => {
    methods.approve.mockResolvedValueOnce({ approved: false, version: 3, fromVersion: 2 });
    expect(await (await post('approve')).json()).toMatchObject({ approved: false });
  });

  it.each([
    ['approval', {}], ['approval', { on: 'true' }], ['approval', { on: true, extra: 1 }],
    ['reject', { reason: 12 }], ['reject', { reason: 'x'.repeat(501) }],
    ['forget-shopper', {}], ['forget-shopper', { shopperId: '  ' }],
    ['forget-shopper', { shopperId: 'x'.repeat(201) }], ['forget-shopper', { shopperId: 'id', all: true }],
  ])('rejects invalid %s input before invoking the agent', async (path, body) => {
    expect((await post(path as string, body)).status).toBe(400);
    for (const method of Object.values(methods)) expect(method).not.toHaveBeenCalled();
  });

  it('lets the server error handler report a failure without echoing agent details', async () => {
    methods.proveMemoryRules.mockRejectedValueOnce(new Error('private connection detail'));
    const response = await post('prove-memory-rules');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal' });
  });
});
