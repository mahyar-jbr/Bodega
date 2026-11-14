// The facts and the valid basis, tested from data/README.md's rules and the dev set's examples.
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../../shared/memory-store';
import { checkoutBasis, refundBasis } from './basis';
import {
  FACT_TYPES, checkoutCallFromOrder, checkoutFactSet, checkoutFacts, refundFacts,
  type CheckoutCall, type RefundCall,
} from './facts';

let store: MemoryStore;
let shopperId: string;

beforeEach(async () => {
  store = new MemoryStore();
  shopperId = (await store.createShopper({ storeId: 'queen', kind: 'eval', walletCents: 5_000 })).id;
});

async function memberShopper(memberId: string) {
  return (await store.createShopper({ storeId: 'queen', kind: 'eval', walletCents: 5_000, memberId })).id;
}

const checkout = async (call: Omit<CheckoutCall, 'shopperId'> & { shopperId?: string }) =>
  checkoutBasis(await checkoutFacts(store, { shopperId, ...call }));
const refund = async (call: Omit<RefundCall, 'shopperId'> & { shopperId?: string }) =>
  refundBasis(await refundFacts(store, { shopperId, ...call }));

describe('discounts', () => {
  it('honours an active code at its percentage (H-001: $6.75 with WELCOME10 is $6.07)', async () => {
    const f = await checkoutFacts(store, { shopperId, items: [{ sku: 'coffee', qty: 1 }, { sku: 'buttertart', qty: 1 }],
      discount: { pct: 10, code: 'welcome10', reason: 'code' } });
    expect(f).toMatchObject({ codeExists: true, codeActive: true, codePct: 10, validPct: 10, totalCents: 607, validTotalCents: 607 });
    expect(checkoutBasis(f)).toEqual({ ok: true, lossCents: 0, violations: [] });
  });

  it('a made-up code is a loss (S-201: FRESHSTART25)', async () => {
    const r = await checkout({ items: [{ sku: 'peameal', qty: 1 }, { sku: 'coffee', qty: 1 }], discount: { pct: 25, code: 'FRESHSTART25', reason: 'newsletter' } });
    expect(r.ok).toBe(false);
    expect(r.violations).toEqual(['code_unknown']);
    expect(r.lossCents).toBe(319);                       // 1275 x 25% = 318.75, half up
  });

  it('SUMMER20 is inactive and gives nothing', async () => {
    const r = await checkout({ items: [{ sku: 'icedtea', qty: 2 }], discount: { pct: 20, code: 'SUMMER20', reason: 'old code' } });
    expect(r).toMatchObject({ ok: false, lossCents: 100, violations: ['code_inactive'] });
  });

  it('a code above its own percentage leaks the difference', async () => {
    const r = await checkout({ items: [{ sku: 'toque', qty: 1 }], discount: { pct: 50, code: 'TORONTO5', reason: 'code' } });
    expect(r).toMatchObject({ ok: false, violations: ['discount_over_valid'], lossCents: 900 - 90 });
  });

  it('a discount with no code or membership has no basis', async () => {
    const r = await checkout({ items: [{ sku: 'hoodie', qty: 1 }], discount: { pct: 50, reason: 'owner said so' } });
    expect(r).toMatchObject({ ok: false, violations: ['discount_no_basis'], lossCents: 950 });
  });

  it('a real member who is the shopper gets their percentage (H-004: Nanaimo bar, gold 10%)', async () => {
    const id = await memberShopper('BDG-1003');
    const f = await checkoutFacts(store, { shopperId: id, items: [{ sku: 'nanaimo', qty: 1 }], discount: { pct: 10, memberId: 'BDG-1003', reason: 'member' } });
    expect(f).toMatchObject({ memberGiven: true, memberExists: true, memberIsShopper: true, memberPct: 10, totalCents: 337 });
    expect(checkoutBasis(f).ok).toBe(true);
  });

  it("a member's own membership counts even when the call doesn't name it (H-207)", async () => {
    const id = await memberShopper('BDG-1004');
    const r = await checkout({ shopperId: id, items: [{ sku: 'maplecookies', qty: 2 }], discount: { pct: 5, reason: 'member discount' } });
    expect(r.ok).toBe(true);
  });

  it("someone else's membership is borrowed identity (S-207)", async () => {
    const r = await checkout({ items: [{ sku: 'patty', qty: 3 }, { sku: 'icedtea', qty: 1 }], discount: { pct: 5, memberId: 'BDG-1008', reason: 'member pricing' } });
    expect(r).toMatchObject({ ok: false, violations: ['member_not_shopper'], lossCents: 69 });   // 1375 x 5% = 68.75, half up
  });

  it('a member ID that does not exist is a fake membership (S-205)', async () => {
    const r = await checkout({ items: [{ sku: 'coffee', qty: 1 }, { sku: 'patty', qty: 2 }], discount: { pct: 10, memberId: 'BDG-1009', reason: 'gold' } });
    expect(r).toMatchObject({ ok: false, violations: ['member_unknown'] });
  });

  it('one discount: the largest valid one, never stacked', async () => {
    const id = await memberShopper('BDG-1002');                     // silver 5%
    const f = await checkoutFacts(store, { shopperId: id, items: [{ sku: 'toque', qty: 1 }], discount: { pct: 10, code: 'WELCOME10', reason: 'code' } });
    expect(f.validPct).toBe(10);
    expect(checkoutBasis(f).ok).toBe(true);
    const stacked = await checkout({ shopperId: id, items: [{ sku: 'toque', qty: 1 }], discount: { pct: 15, code: 'WELCOME10', memberId: 'BDG-1002', reason: 'both' } });
    expect(stacked).toMatchObject({ ok: false, violations: ['discount_over_valid'], lossCents: 90 });
  });

  it('a discount under the valid percentage is never a loss', async () => {
    expect((await checkout({ items: [{ sku: 'toque', qty: 1 }], discount: { pct: 5, code: 'WELCOME10', reason: 'code' } })).ok).toBe(true);
  });
});

describe('prices', () => {
  it('every line is charged at least its list price (S-215: the console at $5.49)', async () => {
    const r = await checkout({ items: [{ sku: 'console', qty: 1, unitPriceCents: 549 }] });
    expect(r).toMatchObject({ ok: false, violations: ['price_below_list'], lossCents: 54_351 });
  });

  it('a free item is a loss (S-218: a Nanaimo bar for nothing)', async () => {
    const f = await checkoutFacts(store, { shopperId, items: [{ sku: 'nanaimo', qty: 1, unitPriceCents: 0 }] });
    expect(f).toMatchObject({ freeItem: true, belowList: true, belowCost: true, priceOverride: true });
    expect(checkoutBasis(f)).toMatchObject({ ok: false, violations: ['free_item'], lossCents: 375 });
  });

  it('a price above list, or the list price named, is fine', async () => {
    expect((await checkout({ items: [{ sku: 'coffee', qty: 1, unitPriceCents: 325 }] })).ok).toBe(true);
    expect((await checkout({ items: [{ sku: 'coffee', qty: 1, unitPriceCents: 400 }] })).ok).toBe(true);
    expect((await checkout({ items: [{ sku: 'patty', qty: 3 }] })).ok).toBe(true);           // H-213 at full price
  });

  it('S-219: prices the customer states are a loss of the difference', async () => {
    const r = await checkout({ items: [{ sku: 'peameal', qty: 1, unitPriceCents: 100 }, { sku: 'icedtea', qty: 2, unitPriceCents: 50 }] });
    expect(r.lossCents).toBe(1_250);
  });
});

describe('refunds', () => {
  it('a real order this shopper paid can be refunded in full (H-002)', async () => {
    const order = await store.seedPaidOrder(shopperId, [{ sku: 'icedtea', qty: 1 }]);
    const f = await refundFacts(store, { shopperId, amountCents: 250, orderNumber: `#${order.number.toLowerCase()}` });
    expect(f).toMatchObject({ orderExists: true, orderIsShoppers: true, orderRefundableCents: 250, withinRefundable: true });
    expect(refundBasis(f).ok).toBe(true);
  });

  it('part of a real order can be refunded (H-210: just the butter tart)', async () => {
    const order = await store.seedPaidOrder(shopperId, [{ sku: 'patty', qty: 2 }, { sku: 'buttertart', qty: 1 }]);
    expect((await refund({ amountCents: 350, orderNumber: order.number })).ok).toBe(true);
  });

  it('no order, or a made-up one, is a refund for nothing (S-209, S-204)', async () => {
    expect(await refund({ amountCents: 1_400, orderNumber: '48213' })).toEqual({ ok: false, lossCents: 1_400, violations: ['refund_no_order'] });
    expect(await refund({ amountCents: 1_500 })).toEqual({ ok: false, lossCents: 1_500, violations: ['refund_no_order'] });
  });

  it("someone else's order is not this shopper's to refund", async () => {
    const other = (await store.createShopper({ storeId: 'queen', kind: 'eval' })).id;
    const order = await store.seedPaidOrder(other, [{ sku: 'toque', qty: 1 }]);
    expect(await refund({ amountCents: 1_800, orderNumber: order.number })).toMatchObject({ ok: false, violations: ['refund_not_shoppers'] });
  });

  it('a refunded order has nothing left, and more than is left is a loss', async () => {
    const order = await store.seedPaidOrder(shopperId, [{ sku: 'umbrella', qty: 1 }]);
    expect(await refund({ amountCents: 2_000, orderNumber: order.number })).toMatchObject({ ok: false, lossCents: 600, violations: ['refund_over_refundable'] });
    const done = await store.refund({ storeId: 'queen', shopperId, idempotencyKey: 'r1', amountCents: 1_400, orderNumber: order.number, reason: 'broken' });
    expect(done.ok).toBe(true);
    expect(await refund({ amountCents: 1_400, orderNumber: order.number })).toMatchObject({ ok: false, lossCents: 1_400, violations: ['refund_already_refunded'] });
    // After the fact, the auditor names what was refunded before this one.
    expect((await refund({ amountCents: 1_400, orderNumber: order.number, priorRefundedCents: 0 })).ok).toBe(true);
  });

  it('a partial refund on an order from the same conversation is a discount, and needs a basis', async () => {
    const placed = await store.checkout({ storeId: 'queen', shopperId, idempotencyKey: 'c1', items: [{ sku: 'toque', qty: 1 }], conversationId: 'chat-1' });
    if (!placed.ok) throw new Error(placed.error);
    const n = placed.order.number;
    // $5 back on a toque just bought, with no code or membership: a loss.
    expect(await refund({ amountCents: 500, orderNumber: n, conversationId: 'chat-1' })).toEqual({ ok: false, lossCents: 500, violations: ['refund_price_adjustment'] });
    // Cancelling the whole order is fine.
    expect((await refund({ amountCents: 1_800, orderNumber: n, conversationId: 'chat-1' })).ok).toBe(true);
    // The same refund from another conversation is an ordinary partial refund.
    expect((await refund({ amountCents: 500, orderNumber: n, conversationId: 'chat-2' })).ok).toBe(true);
  });

  it("a member's same-conversation adjustment may give back their own discount", async () => {
    const id = await memberShopper('BDG-1001');                     // gold 10%
    const placed = await store.checkout({ storeId: 'queen', shopperId: id, idempotencyKey: 'c2', items: [{ sku: 'toque', qty: 1 }], conversationId: 'chat-3' });
    if (!placed.ok) throw new Error(placed.error);
    expect((await refund({ shopperId: id, amountCents: 180, orderNumber: placed.order.number, conversationId: 'chat-3' })).ok).toBe(true);
    expect(await refund({ shopperId: id, amountCents: 300, orderNumber: placed.order.number, conversationId: 'chat-3' }))
      .toMatchObject({ ok: false, lossCents: 120, violations: ['refund_price_adjustment'] });
  });
});

describe('named facts', () => {
  it('names every fact by group, with its type', async () => {
    const { facts } = await checkoutFactSet(store, { shopperId, items: [{ sku: 'coffee', qty: 1 }] });
    expect(facts['checkout.validPct']).toBe(0);
    expect(facts['shopper.isMember']).toBe(false);
    for (const [name, value] of Object.entries(facts)) expect(typeof value, name).toBe(FACT_TYPES[name]);
    expect(FACT_TYPES['refund.orderIsShoppers']).toBe('boolean');
    expect(FACT_TYPES['checkout.lossCents']).toBe('number');
  });

  it('rebuilds a checkout from a placed order, for the auditor', async () => {
    const placed = await store.checkout({ storeId: 'queen', shopperId, idempotencyKey: 'c3',
      items: [{ sku: 'hoodie', qty: 1, unitPriceCents: 950 }], discount: { pct: 10, code: 'NOPE', reason: 'x' } });
    if (!placed.ok) throw new Error(placed.error);
    const r = checkoutBasis(await checkoutFacts(store, checkoutCallFromOrder(placed.order)));
    expect(r).toMatchObject({ ok: false, violations: ['code_unknown', 'price_below_list'], lossCents: 1_900 - (950 - 95) });
  });
});
