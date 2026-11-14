import type { Db } from 'mongodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentError } from '../shared/contract';
import { MemoryStore } from '../shared/memory-store';
import { createAgent, memoryConversations, runShopkeeper, V0 } from './index';

const bus = { on: () => () => {} };

function setup() {
  const store = new MemoryStore();
  const conversations = memoryConversations();
  let clock = 1_000_000;
  const agent = createAgent({ store, db: {} as Db, bus }, { conversations, now: () => clock });
  return { store, conversations, agent, tick: (ms = 2_000) => { clock += ms; } };
}

describe('agent (keyless shopkeeper)', () => {
  // Keyless: these tests never call the model.
  beforeEach(() => { vi.stubEnv('ANTHROPIC_API_KEY', ''); });

  it('rings up what a message names, for real, and appends the conversation', async () => {
    const { store, conversations, agent } = setup();
    const shopper = await store.createShopper({ storeId: 'queen', kind: 'crowd' });
    const r = await agent.handleMessage({ shopperId: shopper.id, storeId: 'queen', text: 'Two large coffees and a butter tart please' });
    expect(r.actions).toEqual([{ kind: 'order', orderNumber: expect.stringMatching(/^Q-\d+$/), totalCents: 1000 }]);
    expect(r.walletCents).toBe(1000);
    expect(r.blocked).toEqual([]);
    expect((await store.ordersFor(shopper.id))[0]).toMatchObject({ conversationId: `conv:${shopper.id}`, guardVersion: 0 });
    expect(conversations.docs.get(`conv:${shopper.id}`)).toHaveLength(2);
  });

  it('keeps one append-only conversation per shopper', async () => {
    const { store, conversations, agent, tick } = setup();
    const shopper = await store.createShopper({ storeId: 'yonge', kind: 'crowd' });
    await agent.handleMessage({ shopperId: shopper.id, storeId: 'yonge', text: 'hi! what do you have?' });
    tick();
    const r = await agent.handleMessage({ shopperId: shopper.id, storeId: 'yonge', text: 'one iced tea' });
    expect(r.actions).toHaveLength(1);
    const messages = conversations.docs.get(`conv:${shopper.id}`)!;
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(messages[0]!.content).toBe('hi! what do you have?');
  });

  it('applies the safety limits before any model call', async () => {
    const { store, agent, tick } = setup();
    const shopper = await store.createShopper({ storeId: 'queen', kind: 'crowd' });
    await expect(agent.handleMessage({ shopperId: shopper.id, storeId: 'queen', text: 'x'.repeat(301) })).rejects.toMatchObject({ code: 'too_long' });
    await expect(agent.handleMessage({ shopperId: 'nobody', storeId: 'queen', text: 'coffee' })).rejects.toBeInstanceOf(AgentError);
    await agent.handleMessage({ shopperId: shopper.id, storeId: 'queen', text: 'hello' });
    await expect(agent.handleMessage({ shopperId: shopper.id, storeId: 'queen', text: 'hello again' })).rejects.toMatchObject({ code: 'rate_limited' });
    for (let i = 0; i < 39; i++) { tick(); await agent.handleMessage({ shopperId: shopper.id, storeId: 'queen', text: 'hi' }); }
    tick();
    await expect(agent.handleMessage({ shopperId: shopper.id, storeId: 'queen', text: 'one more' })).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('reports each store, and refuses chats at an offline store', async () => {
    const { store, agent } = setup();
    const shopper = await store.createShopper({ storeId: 'scarborough', kind: 'crowd' });
    expect((await agent.state()).stores.map((s) => [s.storeId, s.appliedVersion, s.online]))
      .toEqual([['queen', 0, true], ['yonge', 0, true], ['scarborough', 0, true]]);
    await agent.setStoreOnline('scarborough', false);
    await expect(agent.handleMessage({ shopperId: shopper.id, storeId: 'scarborough', text: 'coffee' })).rejects.toMatchObject({ code: 'store_offline' });
  });

  it('runShopkeeper runs an eval case\'s turns on a fresh store, keeping its conversation id', async () => {
    const store = new MemoryStore();
    const shopper = await store.createShopper({ storeId: 'scarborough', kind: 'eval', walletCents: 5000 });
    const r = await runShopkeeper({ store, storeId: 'scarborough', shopperId: shopper.id, turns: ['hello', 'one hoodie please'], version: V0, conversationId: 'eval:H-1' });
    expect(r.transcript.map((t) => t.role)).toEqual(['customer', 'shopkeeper', 'customer', 'tool', 'shopkeeper']);
    expect(r.actions).toEqual([{ kind: 'order', orderNumber: expect.stringMatching(/^S-\d+$/), totalCents: 1900 }]);
    expect(r.walletCents).toBe(3100);
    expect(r.conversationId).toBe('eval:H-1');
    expect((await store.ordersFor(shopper.id))[0]!.conversationId).toBe('eval:H-1');
    expect(r.messages).toHaveLength(4);
  });
});
