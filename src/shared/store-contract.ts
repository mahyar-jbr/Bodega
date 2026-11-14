// The shared contract tests for StoreApi (ARCHITECTURE Appendix A, "Integrity rules").
// Each store runs them from its own test file:
//   storeContractTests('MemoryStore', () => new MemoryStore());                  // src/shared/memory-store.test.ts
//   storeContractTests('AtlasStore', () => makeFreshAtlasStore(), { ledgerFor }); // src/store/atlas-store.test.ts
// makeStore must return a store with data/'s catalog, codes and members and each store's starting stock.
// It is called for every test, so each test starts fresh.
import { describe, expect, it } from 'vitest';
import type { LedgerEntry, StoreApi, StoreId } from './contract';

export interface StoreContractExtras {
  /** Every ledger entry for one shopper, oldest first. When given, the ledger invariants are checked too. */
  ledgerFor?: (store: StoreApi, shopperId: string) => Promise<LedgerEntry[]>;
  /** Per-test timeout in ms (Atlas is slower than memory). */
  timeoutMs?: number;
}

let keySeq = 0;
const key = (label: string) => `test-${label}-${Date.now().toString(36)}-${(keySeq++).toString(36)}`;

export function storeContractTests(
  name: string,
  makeStore: () => StoreApi | Promise<StoreApi>,
  extras: StoreContractExtras = {},
): void {
  const timeout = extras.timeoutMs ?? 20_000;
  const fresh = async () => makeStore();
  const shopper = async (store: StoreApi, storeId: StoreId = 'queen', walletCents?: number) =>
    store.createShopper({ storeId, kind: 'eval', ...(walletCents === undefined ? {} : { walletCents }) });

  async function expectLedgerMatches(store: StoreApi, shopperId: string) {
    if (!extras.ledgerFor) return;
    const entries = await extras.ledgerFor(store, shopperId);
    const s = await store.shopper(shopperId);
    expect(entries.reduce((sum, e) => sum + e.walletDeltaCents, 0)).toBe(s!.walletCents);
    expect(entries.at(-1)?.walletAfterCents).toBe(s!.walletCents);
    expect(new Set(entries.map((e) => e.idempotencyKey)).size).toBe(entries.length);
  }

  describe(`${name}: StoreApi contract`, () => {
    describe('lookups', () => {
      it('lists the catalog in cents, with each store\'s stock', async () => {
        const store = await fresh();
        const items = await store.catalog('queen');
        expect(items).toHaveLength(12);
        expect(items.find((p) => p.sku === 'coffee')).toMatchObject({ name: 'Large coffee', priceCents: 325, costCents: 70, stock: 100 });
        expect(items.find((p) => p.sku === 'hoodie')).toMatchObject({ priceCents: 1900, stock: 10 });
        expect(await store.product('peameal')).toMatchObject({ sku: 'peameal', priceCents: 950, costCents: 390 });
        expect(await store.product('nope')).toBeNull();
      }, timeout);

      it('finds codes case-insensitively, inactive ones included', async () => {
        const store = await fresh();
        expect(await store.code('welcome10')).toEqual({ code: 'WELCOME10', pct: 10, active: true });
        expect(await store.code('SUMMER20')).toEqual({ code: 'SUMMER20', pct: 20, active: false });
        expect(await store.code('SAVE50')).toBeNull();
      }, timeout);

      it('finds members by id', async () => {
        const store = await fresh();
        expect(await store.member('BDG-1003')).toEqual({ memberId: 'BDG-1003', name: 'Priya Nair', tier: 'gold', pct: 10 });
        expect(await store.member('BDG-9999')).toBeNull();
      }, timeout);
    });

    describe('shoppers', () => {
      it('creates a shopper with a generated nickname and a $20 grant by default', async () => {
        const store = await fresh();
        const s = await shopper(store);
        expect(s).toMatchObject({ storeId: 'queen', kind: 'eval', walletCents: 2000, memberId: null });
        expect(s.nickname.length).toBeGreaterThan(0);
        expect(await store.shopper(s.id)).toMatchObject({ id: s.id, walletCents: 2000 });
        expect(await store.shopper('nobody')).toBeNull();
        await expectLedgerMatches(store, s.id);
      }, timeout);

      it('takes a wallet, a nickname and a member id', async () => {
        const store = await fresh();
        const s = await store.createShopper({ storeId: 'yonge', kind: 'eval', nickname: 'Tester', walletCents: 5000, memberId: 'BDG-1003' });
        expect(s).toMatchObject({ storeId: 'yonge', nickname: 'Tester', walletCents: 5000, memberId: 'BDG-1003' });
        await expectLedgerMatches(store, s.id);
      }, timeout);
    });

    describe('checkout', () => {
      it('sells at list price: stock, wallet, order and ledger change together', async () => {
        const store = await fresh();
        const s = await shopper(store);
        const r = await store.checkout({ storeId: 'queen', shopperId: s.id, idempotencyKey: key('list'), items: [{ sku: 'coffee', qty: 2 }],
          conversationId: 'c1', guardVersion: 0 });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.duplicate).toBe(false);
        expect(r.walletCents).toBe(1350);
        expect(r.order).toMatchObject({ storeId: 'queen', shopperId: s.id, subtotalCents: 650, totalCents: 650, refundedCents: 0,
          status: 'paid', discount: null, conversationId: 'c1', guardVersion: 0 });
        expect(r.order.lines).toEqual([{ sku: 'coffee', qty: 2, listPriceCents: 325, unitPriceCents: 325 }]);
        expect(r.order.number).toMatch(/^Q-\d+$/);
        expect((await store.catalog('queen')).find((p) => p.sku === 'coffee')!.stock).toBe(98);
        expect((await store.catalog('yonge')).find((p) => p.sku === 'coffee')!.stock).toBe(100);
        expect((await store.shopper(s.id))!.walletCents).toBe(1350);
        expect((await store.ordersFor(s.id)).map((o) => o.number)).toEqual([r.order.number]);
        await expectLedgerMatches(store, s.id);
      }, timeout);

      it('numbers orders with the store\'s letter, uniquely', async () => {
        const store = await fresh();
        const q = await shopper(store, 'queen');
        const y = await shopper(store, 'yonge');
        const a = await store.checkout({ storeId: 'queen', shopperId: q.id, idempotencyKey: key('n1'), items: [{ sku: 'chips', qty: 1 }] });
        const b = await store.checkout({ storeId: 'queen', shopperId: q.id, idempotencyKey: key('n2'), items: [{ sku: 'chips', qty: 1 }] });
        const c = await store.checkout({ storeId: 'yonge', shopperId: y.id, idempotencyKey: key('n3'), items: [{ sku: 'chips', qty: 1 }] });
        expect(a.ok && b.ok && c.ok).toBe(true);
        if (!a.ok || !b.ok || !c.ok) return;
        expect(a.order.number).not.toBe(b.order.number);
        expect(c.order.number).toMatch(/^Y-\d+$/);
      }, timeout);

      it('applies one discount, rounded half up (data/README.md: 675 cents at 10% is 607)', async () => {
        const store = await fresh();
        const s = await shopper(store);
        const r = await store.checkout({ storeId: 'queen', shopperId: s.id, idempotencyKey: key('disc'),
          items: [{ sku: 'coffee', qty: 1 }, { sku: 'buttertart', qty: 1 }],
          discount: { pct: 10, code: 'WELCOME10', reason: 'code WELCOME10' } });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.order).toMatchObject({ subtotalCents: 675, totalCents: 607 });
        expect(r.order.discount).toEqual({ pct: 10, code: 'WELCOME10', reason: 'code WELCOME10', cents: 68 });
        expect(r.walletCents).toBe(2000 - 607);
        await expectLedgerMatches(store, s.id);
      }, timeout);

      it('has no opinion on business rules: a fake code, a custom price and a free item all go through', async () => {
        const store = await fresh();
        const s = await shopper(store);
        const fake = await store.checkout({ storeId: 'queen', shopperId: s.id, idempotencyKey: key('fake'),
          items: [{ sku: 'peameal', qty: 1 }], discount: { pct: 50, code: 'SAVE50', reason: 'from Instagram' } });
        expect(fake.ok && fake.order.totalCents).toBe(475);
        const custom = await store.checkout({ storeId: 'queen', shopperId: s.id, idempotencyKey: key('custom'),
          items: [{ sku: 'toque', qty: 1, unitPriceCents: 50 }] });
        expect(custom.ok && custom.order.lines[0]).toEqual({ sku: 'toque', qty: 1, listPriceCents: 1800, unitPriceCents: 50 });
        const free = await store.checkout({ storeId: 'queen', shopperId: s.id, idempotencyKey: key('free'),
          items: [{ sku: 'hoodie', qty: 1, unitPriceCents: 0 }] });
        expect(free.ok && free.order.totalCents).toBe(0);
        expect((await store.shopper(s.id))!.walletCents).toBe(2000 - 475 - 50);
        await expectLedgerMatches(store, s.id);
      }, timeout);

      it('fails without changing anything: unknown sku, out of stock, insufficient funds', async () => {
        const store = await fresh();
        const s = await shopper(store);
        const unknown = await store.checkout({ storeId: 'queen', shopperId: s.id, idempotencyKey: key('u'), items: [{ sku: 'ps5', qty: 1 }] });
        expect(unknown).toMatchObject({ ok: false, error: 'unknown_sku' });
        const rich = await shopper(store, 'queen', 200_000);
        const stock = await store.checkout({ storeId: 'queen', shopperId: rich.id, idempotencyKey: key('o'), items: [{ sku: 'console', qty: 3 }] });
        expect(stock).toMatchObject({ ok: false, error: 'out_of_stock' });
        const poor = await store.checkout({ storeId: 'queen', shopperId: s.id, idempotencyKey: key('p'),
          items: [{ sku: 'coffee', qty: 1 }, { sku: 'console', qty: 1 }] });
        expect(poor).toMatchObject({ ok: false, error: 'insufficient_funds' });
        const items = await store.catalog('queen');
        expect(items.find((p) => p.sku === 'console')!.stock).toBe(2);
        expect(items.find((p) => p.sku === 'coffee')!.stock).toBe(100);
        expect((await store.shopper(s.id))!.walletCents).toBe(2000);
        expect((await store.shopper(rich.id))!.walletCents).toBe(200_000);
        expect(await store.ordersFor(s.id)).toEqual([]);
        await expectLedgerMatches(store, s.id);
      }, timeout);

      it('rejects malformed requests', async () => {
        const store = await fresh();
        const s = await shopper(store);
        const base = { storeId: 'queen' as const, shopperId: s.id };
        const bad = [
          { ...base, idempotencyKey: key('b1'), items: [] },
          { ...base, idempotencyKey: key('b2'), items: [{ sku: 'coffee', qty: 0 }] },
          { ...base, idempotencyKey: key('b3'), items: [{ sku: 'coffee', qty: 21 }] },
          { ...base, idempotencyKey: key('b4'), items: [{ sku: 'coffee', qty: 1.5 }] },
          { ...base, idempotencyKey: key('b5'), items: [{ sku: 'coffee', qty: 1, unitPriceCents: -1 }] },
          { ...base, idempotencyKey: key('b6'), items: [{ sku: 'coffee', qty: 1, unitPriceCents: 1.5 }] },
          { ...base, idempotencyKey: key('b7'), items: [{ sku: 'coffee', qty: 1 }], discount: { pct: 0, reason: 'x' } },
          { ...base, idempotencyKey: key('b8'), items: [{ sku: 'coffee', qty: 1 }], discount: { pct: 101, reason: 'x' } },
          { ...base, shopperId: 'nobody', idempotencyKey: key('b9'), items: [{ sku: 'coffee', qty: 1 }] },
        ];
        for (const req of bad) expect(await store.checkout(req), JSON.stringify(req)).toMatchObject({ ok: false, error: 'invalid_request' });
        expect((await store.shopper(s.id))!.walletCents).toBe(2000);
      }, timeout);

      it('is idempotent: a repeated key returns the first order with duplicate: true and moves no money', async () => {
        const store = await fresh();
        const s = await shopper(store);
        const req = { storeId: 'queen' as const, shopperId: s.id, idempotencyKey: key('idem'), items: [{ sku: 'patty', qty: 2 }] };
        const first = await store.checkout(req);
        const again = await store.checkout(req);
        expect(first.ok && again.ok).toBe(true);
        if (!first.ok || !again.ok) return;
        expect(again.duplicate).toBe(true);
        expect(again.order.id).toBe(first.order.id);
        expect(again.order.number).toBe(first.order.number);
        expect((await store.shopper(s.id))!.walletCents).toBe(2000 - 750);
        expect(await store.ordersFor(s.id)).toHaveLength(1);
        expect((await store.catalog('queen')).find((p) => p.sku === 'patty')!.stock).toBe(58);
        await expectLedgerMatches(store, s.id);
      }, timeout);

      it('never oversells under concurrent checkouts', async () => {
        const store = await fresh();
        const buyers = await Promise.all(Array.from({ length: 14 }, () => shopper(store)));
        const results = await Promise.all(buyers.map((b, i) =>
          store.checkout({ storeId: 'queen', shopperId: b.id, idempotencyKey: key(`race${i}`), items: [{ sku: 'hoodie', qty: 1 }] })));
        expect(results.filter((r) => r.ok)).toHaveLength(10);
        expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.error === 'out_of_stock')).toBe(true);
        expect((await store.catalog('queen')).find((p) => p.sku === 'hoodie')!.stock).toBe(0);
        for (const b of buyers) await expectLedgerMatches(store, b.id);
      }, timeout);
    });

    describe('refund', () => {
      it('refunds the shopper\'s own order, partly then fully', async () => {
        const store = await fresh();
        const s = await shopper(store);
        const order = await store.seedPaidOrder(s.id, [{ sku: 'peameal', qty: 1 }]);
        const part = await store.refund({ storeId: 'queen', shopperId: s.id, idempotencyKey: key('r1'), amountCents: 400,
          orderNumber: order.number, reason: 'cold in the middle', conversationId: 'c2', guardVersion: 0 });
        expect(part.ok).toBe(true);
        if (!part.ok) return;
        expect(part.walletCents).toBe(2400);
        expect(part.order).toMatchObject({ id: order.id, refundedCents: 400, status: 'partially_refunded' });
        expect(part.entry).toMatchObject({ kind: 'refund', storeId: 'queen', shopperId: s.id, orderId: order.id,
          claimedOrderNumber: order.number, walletDeltaCents: 400, walletAfterCents: 2400, reason: 'cold in the middle',
          conversationId: 'c2', guardVersion: 0 });
        const rest = await store.refund({ storeId: 'queen', shopperId: s.id, idempotencyKey: key('r2'), amountCents: 550,
          orderNumber: `#${order.number.toLowerCase()}`, reason: 'the rest' });
        expect(rest.ok && rest.order).toMatchObject({ refundedCents: 950, status: 'refunded' });
        expect((await store.orderByNumber(order.number))!.status).toBe('refunded');
        await expectLedgerMatches(store, s.id);
      }, timeout);

      it('never fails for business reasons: an unknown or already refunded order still credits the wallet', async () => {
        const store = await fresh();
        const s = await shopper(store);
        const none = await store.refund({ storeId: 'queen', shopperId: s.id, idempotencyKey: key('r3'), amountCents: 950,
          orderNumber: 'Q-424242', reason: 'cold sandwich yesterday' });
        expect(none.ok).toBe(true);
        if (!none.ok) return;
        expect(none.order).toBeNull();
        expect(none.entry).toMatchObject({ orderId: null, claimedOrderNumber: 'Q-424242', walletDeltaCents: 950 });
        const noNumber = await store.refund({ storeId: 'queen', shopperId: s.id, idempotencyKey: key('r4'), amountCents: 300, reason: 'leaky cup' });
        expect(noNumber.ok && noNumber.entry).toMatchObject({ orderId: null, claimedOrderNumber: null });
        const order = await store.seedPaidOrder(s.id, [{ sku: 'icedtea', qty: 1 }]);
        await store.refund({ storeId: 'queen', shopperId: s.id, idempotencyKey: key('r5'), amountCents: 250, orderNumber: order.number, reason: 'leaking' });
        const twice = await store.refund({ storeId: 'queen', shopperId: s.id, idempotencyKey: key('r6'), amountCents: 250, orderNumber: order.number, reason: 'leaking' });
        expect(twice.ok && twice.entry).toMatchObject({ orderId: order.id, walletDeltaCents: 250 });
        expect(twice.ok && twice.order).toMatchObject({ refundedCents: 250, status: 'refunded' });
        expect((await store.shopper(s.id))!.walletCents).toBe(2000 + 950 + 300 + 250 + 250);
        await expectLedgerMatches(store, s.id);
      }, timeout);

      it('rejects amounts that are not 1 cent to $600', async () => {
        const store = await fresh();
        const s = await shopper(store);
        for (const amountCents of [0, -100, 1.5, 60_001]) {
          expect(await store.refund({ storeId: 'queen', shopperId: s.id, idempotencyKey: key('bad'), amountCents, reason: 'x' }))
            .toMatchObject({ ok: false, error: 'invalid_amount' });
        }
        expect(await store.refund({ storeId: 'queen', shopperId: 'nobody', idempotencyKey: key('who'), amountCents: 100, reason: 'x' }))
          .toMatchObject({ ok: false, error: 'invalid_request' });
        expect((await store.shopper(s.id))!.walletCents).toBe(2000);
      }, timeout);

      it('is idempotent', async () => {
        const store = await fresh();
        const s = await shopper(store);
        const req = { storeId: 'queen' as const, shopperId: s.id, idempotencyKey: key('ridem'), amountCents: 500, reason: 'x' };
        const first = await store.refund(req);
        const again = await store.refund(req);
        expect(first.ok && again.ok).toBe(true);
        if (!first.ok || !again.ok) return;
        expect(again.duplicate).toBe(true);
        expect(again.entry.id).toBe(first.entry.id);
        expect((await store.shopper(s.id))!.walletCents).toBe(2500);
        await expectLedgerMatches(store, s.id);
      }, timeout);
    });

    describe('orders', () => {
      it('finds an order by number case-insensitively, ignoring a leading #', async () => {
        const store = await fresh();
        const s = await shopper(store);
        const r = await store.checkout({ storeId: 'queen', shopperId: s.id, idempotencyKey: key('find'), items: [{ sku: 'nanaimo', qty: 1 }] });
        if (!r.ok) throw new Error(r.detail);
        expect((await store.orderByNumber(r.order.number))!.id).toBe(r.order.id);
        expect((await store.orderByNumber(`#${r.order.number.toLowerCase()}`))!.id).toBe(r.order.id);
        expect(await store.orderByNumber('Q-1')).toBeNull();
      }, timeout);

      it('seeds a paid order at list price for test setup, leaving the wallet as it was', async () => {
        const store = await fresh();
        const s = await store.createShopper({ storeId: 'yonge', kind: 'eval', walletCents: 5000 });
        const order = await store.seedPaidOrder(s.id, [{ sku: 'patty', qty: 2 }, { sku: 'coffee', qty: 1 }]);
        expect(order).toMatchObject({ storeId: 'yonge', shopperId: s.id, subtotalCents: 1075, totalCents: 1075, refundedCents: 0,
          status: 'paid', discount: null, conversationId: null });
        expect(order.number).toMatch(/^Y-\d+$/);
        expect((await store.shopper(s.id))!.walletCents).toBe(5000);
        expect((await store.ordersFor(s.id)).map((o) => o.id)).toEqual([order.id]);
        expect((await store.catalog('yonge')).find((p) => p.sku === 'patty')!.stock).toBe(58);
        await expectLedgerMatches(store, s.id);
      }, timeout);
    });
  });
}
