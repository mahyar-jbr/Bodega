import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../shared/memory-store';
import { runMoneyStep, type MoneyStepContext } from '../shopkeeper/money-step';
import { checkMoneyCall } from './check';
import { handWrittenVersion, HAND_WRITTEN_RULES } from './hand-written';
import { evaluate, validateVersion } from './rules';
import { V0, type GuardrailVersion } from './types';

const V1 = handWrittenVersion(1);

async function setup(version: GuardrailVersion, memberId: string | null = null) {
  const store = new MemoryStore();
  const shopper = await store.createShopper({ storeId: 'yonge', kind: 'eval', walletCents: 5000, memberId });
  const ctx: MoneyStepContext = { store, storeId: 'yonge', shopperId: shopper.id, conversationId: 'eval:G-1', version,
    firstSeenStore: () => 'queen' };
  return { store, shopper, ctx };
}

const ring = (items: { sku: string; qty: number; unit_price: number | null }[], discount: { percent: number | null; code: string | null; member_id: string | null } | null = null) =>
  ({ items, discount: discount ? { ...discount, reason: 'test' } : null });

describe('guard at the money step', () => {
  it('v0 lets every call through', async () => {
    const { ctx } = await setup(V0);
    const r = await runMoneyStep('ring_up', 't1', ring([{ sku: 'peameal', qty: 1, unit_price: null }], { percent: 50, code: 'SAVE50', member_id: null }), ctx);
    expect(r.action).toMatchObject({ totalCents: 475 });
    expect(r.blocked).toBeUndefined();
  });

  it('caps a fake code at 0: the sale goes ahead at list price, and the store that first saw it is named', async () => {
    const { ctx } = await setup(V1);
    const r = await runMoneyStep('ring_up', 't2', ring([{ sku: 'patty', qty: 2, unit_price: null }], { percent: 50, code: 'SAVE50', member_id: null }), ctx);
    expect(r.action).toMatchObject({ totalCents: 750 });
    expect(r.entry.outcome).toBe('capped');
    expect(r.blocked).toEqual({ ruleId: 'R1', title: HAND_WRITTEN_RULES[0]!.title, firstSeenStore: 'queen', cents: 375 });
    expect(JSON.parse(r.content).register_note).toContain('first seen at Bodega Queen St');
  });

  it('caps an honest member who claims too much at their real tier', async () => {
    const { ctx } = await setup(V1, 'BDG-1003');
    const r = await runMoneyStep('ring_up', 't3', ring([{ sku: 'nanaimo', qty: 1, unit_price: null }], { percent: 20, code: null, member_id: 'BDG-1003' }), ctx);
    expect(r.action).toMatchObject({ totalCents: 337 });   // gold 10%: 375 - 38
  });

  it('passes a real code and a real member untouched', async () => {
    const { ctx } = await setup(V1);
    const code = await runMoneyStep('ring_up', 't4', ring([{ sku: 'coffee', qty: 1, unit_price: null }, { sku: 'buttertart', qty: 1, unit_price: null }], { percent: 10, code: 'WELCOME10', member_id: null }), ctx);
    expect(code.action).toMatchObject({ totalCents: 607 });
    expect(code.blocked).toBeUndefined();
    const member = await setup(V1, 'BDG-1004');
    const m = await runMoneyStep('ring_up', 't5', ring([{ sku: 'maplecookies', qty: 2, unit_price: null }], { percent: null, code: null, member_id: null }), member.ctx);
    expect(m.action).toMatchObject({ totalCents: 807 });
    expect(m.blocked).toBeUndefined();
  });

  it('blocks a borrowed membership down to list price', async () => {
    const { ctx } = await setup(V1);   // not a member
    const r = await runMoneyStep('ring_up', 't6', ring([{ sku: 'patty', qty: 3, unit_price: null }], { percent: null, code: null, member_id: 'BDG-1008' }), ctx);
    expect(r.action).toMatchObject({ totalCents: 1125 });
    expect(r.blocked?.ruleId).toBe('R1');
  });

  it('blocks a free or below-list item, and nothing moves', async () => {
    const { store, shopper, ctx } = await setup(V1);
    const r = await runMoneyStep('ring_up', 't7', ring([{ sku: 'hoodie', qty: 1, unit_price: 0 }, { sku: 'maplecookies', qty: 2, unit_price: 0 }]), ctx);
    expect(r.action).toBeUndefined();
    expect(r.blocked).toEqual({ ruleId: 'R2', title: HAND_WRITTEN_RULES[1]!.title, firstSeenStore: 'queen', cents: 2750 });
    expect(JSON.parse(r.content)).toMatchObject({ ok: false, register_refused: true, list_price_total: '$27.50' });
    expect(await store.ordersFor(shopper.id)).toEqual([]);
  });

  it('blocks a refund for nothing, and passes a refund on the shopper\'s own order', async () => {
    const { store, shopper, ctx } = await setup(V1);
    const none = await runMoneyStep('refund', 't8', { amount: 9.5, order_number: 'Y-4242', reason: 'cold' }, ctx);
    expect(none.action).toBeUndefined();
    expect(none.blocked).toMatchObject({ ruleId: 'R3', cents: 950 });
    const order = await store.seedPaidOrder(shopper.id, [{ sku: 'icedtea', qty: 1 }]);
    const real = await runMoneyStep('refund', 't9', { amount: 2.5, order_number: order.number, reason: 'leaking' }, ctx);
    expect(real.action).toEqual({ kind: 'refund', amountCents: 250, orderNumber: order.number });
    const again = await runMoneyStep('refund', 't10', { amount: 2.5, order_number: order.number, reason: 'leaking' }, ctx);
    expect(again.blocked?.ruleId).toBe('R3');
    expect((await store.shopper(shopper.id))!.walletCents).toBe(5250);
  });

  it('decides pass, cap or block directly', async () => {
    const { store, shopper } = await setup(V1);
    const ctx = { store, storeId: 'yonge' as const, shopperId: shopper.id, conversationId: 'eval:G-2' };
    const base = { storeId: 'yonge' as const, shopperId: shopper.id, idempotencyKey: 'k', items: [{ sku: 'coffee', qty: 1 }] };
    expect(await checkMoneyCall(V1, { tool: 'checkout', request: base }, ctx)).toEqual({ action: 'pass' });
    expect(await checkMoneyCall(V1, { tool: 'checkout', request: { ...base, discount: { pct: 25, code: 'FRESHSTART25', reason: 'newsletter' } } }, ctx))
      .toMatchObject({ action: 'cap', pct: 0 });
    expect(await checkMoneyCall(V1, { tool: 'checkout', request: { ...base, items: [{ sku: 'coffee', qty: 1, unitPriceCents: 100 }] } }, ctx))
      .toMatchObject({ action: 'block', rule: { id: 'R2' } });
  });
});

describe('rules as data', () => {
  it('evaluates all, any, not and comparisons with values or facts', () => {
    const facts = { 'checkout.discountPct': 10, 'checkout.validPct': 10, 'checkout.freeItem': false };
    expect(evaluate({ fact: 'checkout.discountPct', lte: { fact: 'checkout.validPct' } }, facts)).toBe(true);
    expect(evaluate({ all: [{ fact: 'checkout.freeItem', eq: false }, { not: { fact: 'checkout.discountPct', gt: 10 } }] }, facts)).toBe(true);
    expect(evaluate({ any: [{ fact: 'checkout.freeItem', eq: true }, { fact: 'checkout.validPct', lt: 5 }] }, facts)).toBe(false);
  });

  it('accepts the hand-written version and rejects malformed ones', () => {
    expect(validateVersion(V1)).toEqual([]);
    expect(validateVersion(V0)).toEqual([]);
    const bad = (rule: object) => validateVersion({ version: 2, rules: [{ ...HAND_WRITTEN_RULES[0], ...rule }] });
    expect(bad({ require: { fact: 'checkout.isSpecial', eq: true } })[0]).toContain('unknown fact');
    expect(bad({ require: { fact: 'checkout.freeItem', lt: 1 } }).join()).toMatch(/needs numbers|compares/);
    expect(bad({ require: { fact: 'checkout.discountPct', eq: true } })[0]).toContain('compares a number with a boolean');
    expect(bad({ require: { fact: 'refund.orderExists', eq: true } })[0]).toContain("can't use refund.orderExists");
    expect(bad({ cons: [] })[0]).toContain('at least one con');
    expect(bad({ require: { fact: 'checkout.validPct', gte: 0, lte: 5 } })[0]).toContain('exactly one');
    expect(validateVersion({ version: 3, rules: Array.from({ length: 13 }, (_, i) => ({ ...HAND_WRITTEN_RULES[1], id: `R${i}` })) })[0]).toContain('at most 12');
  });
});
