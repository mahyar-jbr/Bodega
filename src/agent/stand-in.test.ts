import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { AgentError } from '../shared/contract';
import { MemoryStore } from '../shared/memory-store';
import { createAgent, runShopkeeper, V0 } from './index';

const bus = { on: () => () => {} };

describe('stand-in agent', () => {
  it('rings up what a message names, for real', async () => {
    const store = new MemoryStore();
    const agent = createAgent({ store, db: {} as Db, bus });
    const shopper = await store.createShopper({ storeId: 'queen', kind: 'crowd' });
    const r = await agent.handleMessage({ shopperId: shopper.id, storeId: 'queen', text: 'Two large coffees and a butter tart please' });
    expect(r.actions).toEqual([{ kind: 'order', orderNumber: expect.stringMatching(/^Q-\d+$/), totalCents: 1000 }]);
    expect(r.walletCents).toBe(1000);
    expect(r.reply).toContain(r.actions[0]!.kind === 'order' ? r.actions[0]!.orderNumber : '');
    expect(await store.ordersFor(shopper.id)).toHaveLength(1);
  });

  it('answers without moving money when nothing is named', async () => {
    const store = new MemoryStore();
    const agent = createAgent({ store, db: {} as Db, bus });
    const shopper = await store.createShopper({ storeId: 'yonge', kind: 'crowd' });
    const r = await agent.handleMessage({ shopperId: shopper.id, storeId: 'yonge', text: 'hi! what do you have?' });
    expect(r.actions).toEqual([]);
    expect(r.walletCents).toBe(2000);
  });

  it('refuses long messages and unknown shoppers with AgentError codes', async () => {
    const store = new MemoryStore();
    const agent = createAgent({ store, db: {} as Db, bus });
    const shopper = await store.createShopper({ storeId: 'queen', kind: 'crowd' });
    await expect(agent.handleMessage({ shopperId: shopper.id, storeId: 'queen', text: 'x'.repeat(301) }))
      .rejects.toMatchObject({ code: 'too_long' });
    await expect(agent.handleMessage({ shopperId: 'nobody', storeId: 'queen', text: 'coffee' }))
      .rejects.toBeInstanceOf(AgentError);
    expect((await agent.state()).stores).toHaveLength(3);
  });

  it('runShopkeeper runs an eval case\'s turns on a fresh store', async () => {
    const store = new MemoryStore();
    const shopper = await store.createShopper({ storeId: 'scarborough', kind: 'eval', walletCents: 5000 });
    const r = await runShopkeeper({ store, storeId: 'scarborough', shopperId: shopper.id, turns: ['hello', 'one hoodie please'], version: V0 });
    expect(r.transcript.map((t) => t.role)).toEqual(['customer', 'shopkeeper', 'customer', 'tool', 'shopkeeper']);
    expect(r.actions).toEqual([{ kind: 'order', orderNumber: expect.stringMatching(/^S-\d+$/), totalCents: 1900 }]);
    expect(r.walletCents).toBe(3100);
    expect(r.messages).toHaveLength(4);
  });
});
