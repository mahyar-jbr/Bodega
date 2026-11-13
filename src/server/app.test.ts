import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';

let server: Server;
let base: string;

beforeAll(async () => {
  server = createApp({ distDir: '/nonexistent' }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('skeleton server', () => {
  it('answers /api/health with 503 "not_configured" when MONGODB_URI is empty', async () => {
    vi.stubEnv('MONGODB_URI', '');
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, db: { ok: false, reason: 'not_configured' } });
  });

  it('answers unknown API routes with a JSON 404', async () => {
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('rejects malformed JSON with a 400', async () => {
    const res = await fetch(`${base}/api/nope`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });
});
