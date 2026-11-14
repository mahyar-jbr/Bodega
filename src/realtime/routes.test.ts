import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChangeBus, ChangeEvent } from '../shared/contract';
import { createSseRouter } from './routes';

class FakeBus implements ChangeBus {
  private readonly listeners = new Map<string, Set<(event: ChangeEvent) => void>>();

  on<T = unknown>(coll: string, fn: (event: ChangeEvent<T>) => void): () => void {
    const listeners = this.listeners.get(coll) ?? new Set();
    const listener = fn as (event: ChangeEvent) => void;
    listeners.add(listener);
    this.listeners.set(coll, listeners);
    return () => listeners.delete(listener);
  }

  emit(event: ChangeEvent): void {
    for (const listener of this.listeners.get(event.coll) ?? []) listener(event);
  }
}

const bus = new FakeBus();
let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(createSseRouter({ bus }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('realtime routes', () => {
  it('rejects an unknown topic', async () => {
    const response = await fetch(`${base}/api/events?topics=nope`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_topics' });
  });

  it('filters SSE topics and strips sensitive fields recursively', async () => {
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events?topics=store:queen,shopper:s1`, { signal: controller.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    bus.emit({ coll: 'orders', op: 'insert', id: 'o1', at: new Date('2026-11-14T16:00:00Z'), doc: {
      id: 'o1', storeId: 'queen', shopperId: 's1', text: 'secret', nested: { messages: ['secret'], safe: true },
    } });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let body = '';
    while ((body.match(/data:/g) ?? []).length < 2) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += decoder.decode(chunk.value, { stream: true });
    }
    controller.abort();

    expect(body).toContain('"topic":"store:queen"');
    expect(body).toContain('"topic":"shopper:s1"');
    expect(body).toContain('"safe":true');
    expect(body).not.toContain('secret');
    expect(body).not.toContain('messages');
  });
});
