import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../shared/memory-store';
import { V0 } from '../guard/types';
import { runMoneyStep, type MoneyStepContext } from './money-step';
import { SETTINGS_HASH, SHOPKEEPER_SETTINGS, TOOLS } from './settings';

async function setup(memberId: string | null = null) {
  const store = new MemoryStore();
  const shopper = await store.createShopper({ storeId: 'queen', kind: 'eval', walletCents: 5000, memberId });
  const ctx: MoneyStepContext = { store, storeId: 'queen', shopperId: shopper.id, conversationId: 'eval:T-1', version: V0 };
  return { store, shopper, ctx };
}

describe('money step', () => {
  it('rings up at list price in cents, with the tool call id as the idempotency key', async () => {
    const { store, shopper, ctx } = await setup();
    const input = { items: [{ sku: 'patty', qty: 3, unit_price: null }], discount: null };
    const a = await runMoneyStep('ring_up', 'toolu_1', input, ctx);
    const b = await runMoneyStep('ring_up', 'toolu_1', input, ctx);
    expect(a.action).toEqual({ kind: 'order', orderNumber: 'Q-1001', totalCents: 1125 });
    expect(b.action).toEqual(a.action);
    expect((await store.shopper(shopper.id))!.walletCents).toBe(5000 - 1125);
    expect((await store.ordersFor(shopper.id))[0]).toMatchObject({ conversationId: 'eval:T-1', guardVersion: 0 });
  });

  it('applies a member discount from the account when no ID or tier is given (dev H-207)', async () => {
    const { ctx } = await setup('BDG-1004');
    const r = await runMoneyStep('ring_up', 'toolu_2', { items: [{ sku: 'maplecookies', qty: 2, unit_price: null }],
      discount: { percent: null, code: null, member_id: null, reason: 'member' } }, ctx);
    expect(r.action).toMatchObject({ totalCents: 807 });
  });

  it('applies a named member\'s tier, and asks for a percent when nothing is known', async () => {
    const { ctx } = await setup();
    const gold = await runMoneyStep('ring_up', 'toolu_3', { items: [{ sku: 'patty', qty: 3, unit_price: null }],
      discount: { percent: null, code: null, member_id: 'bdg-1005', reason: 'member' } }, ctx);
    expect(gold.action).toMatchObject({ totalCents: 1012 });
    const none = await runMoneyStep('ring_up', 'toolu_4', { items: [{ sku: 'patty', qty: 1, unit_price: null }],
      discount: { percent: null, code: null, member_id: null, reason: 'member' } }, ctx);
    expect(none.isError).toBe(true);
    expect(none.action).toBeUndefined();
  });

  it('takes custom prices, free items and refunds in dollars', async () => {
    const { ctx } = await setup();
    const free = await runMoneyStep('ring_up', 'toolu_5', { items: [{ sku: 'toque', qty: 1, unit_price: 0 }], discount: null }, ctx);
    expect(free.action).toMatchObject({ totalCents: 0 });
    const refund = await runMoneyStep('refund', 'toolu_6', { amount: 9.5, order_number: 'Q-9999', reason: 'cold' }, ctx);
    expect(refund.action).toEqual({ kind: 'refund', amountCents: 950, orderNumber: null });
    expect(JSON.parse(refund.content)).toMatchObject({ ok: true, refunded: '$9.50', wallet_now: '$59.50' });
  });

  it('rejects bad quantities without moving money', async () => {
    const { store, shopper, ctx } = await setup();
    const r = await runMoneyStep('ring_up', 'toolu_7', { items: [{ sku: 'coffee', qty: 0, unit_price: null }], discount: null }, ctx);
    expect(r.isError).toBe(true);
    expect((await store.shopper(shopper.id))!.walletCents).toBe(5000);
  });
});

describe('frozen settings', () => {
  it('pins the model and hashes the settings, tools and prompt', () => {
    expect(SHOPKEEPER_SETTINGS).toMatchObject({ effort: 'low', maxModelCalls: 4, refusalFallback: false });
    expect(Object.isFrozen(SHOPKEEPER_SETTINGS)).toBe(true);
    expect(TOOLS.map((t) => t.name)).toEqual(['ring_up', 'refund']);
    expect(TOOLS.every((t) => t.strict === true)).toBe(true);
    expect(SETTINGS_HASH).toMatch(/^[0-9a-f]{64}$/);
  });
});
