import type { Db } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import type { StoreId } from '../shared/contract';
import { MemoryStore } from '../shared/memory-store';
import { createFlashSale, FlashSaleBusyError, type FlashSaleResult } from './flash';

function fixture() {
  const store = new MemoryStore();
  const ids: string[] = [];
  const create = store.createShopper.bind(store);
  vi.spyOn(store, 'createShopper').mockImplementation(async (input) => {
    const shopper = await create(input);
    ids.push(shopper.id);
    return shopper;
  });
  const recorded: FlashSaleResult[] = [];
  const restock = vi.fn(async () => ({ matchedCount: 1 }));
  let corrupt: 'wallet' | 'negative' | 'grant' | 'order' | 'sale' | 'missing' | undefined;
  let maxActive = 0;
  let active = 0;
  const checkout = store.checkout.bind(store);
  vi.spyOn(store, 'checkout').mockImplementation(async (input) => {
    expect(ids).toHaveLength(100);
    expect(recorded[0].stockBefore).toBe(10);
    active++;
    maxActive = Math.max(active, maxActive);
    await Promise.resolve();
    try { return await checkout(input); } finally { active--; }
  });

  type Filter = { storeId: StoreId; id?: { $in: string[] }; shopperId?: { $in: string[] } };
  const rows = async (name: string, filter: Filter) => {
    const wanted = filter.id?.$in ?? filter.shopperId?.$in ?? [];
    if (name === 'ledger') {
      const entries = store.ledger().filter((entry) => entry.storeId === filter.storeId && wanted.includes(entry.shopperId));
      if (corrupt === 'grant') entries.find((entry) => entry.kind === 'grant')!.walletDeltaCents--;
      if (corrupt === 'sale') entries.find((entry) => entry.kind === 'sale')!.orderId = 'orphan';
      return entries;
    }
    if (name === 'orders') {
      const orders = (await Promise.all(wanted.map((id) => store.ordersFor(id)))).flat();
      if (corrupt === 'order') orders[0].lines[0].sku = 'coffee';
      return orders;
    }
    const shoppers = (await Promise.all(wanted.map((id) => store.shopper(id)))).filter((shopper) => shopper !== null);
    if (corrupt === 'wallet') shoppers[0].walletCents++;
    if (corrupt === 'negative') shoppers[0].walletCents = -1;
    if (corrupt === 'missing') shoppers.pop();
    return shoppers;
  };
  const db = {
    collection(name: string) {
      if (name === 'bot_runs') return {
        insertOne: async (doc: FlashSaleResult) => { recorded.push(structuredClone(doc)); },
        updateOne: async (_filter: unknown, update: { $set: Partial<FlashSaleResult> }) => {
          Object.assign(recorded[0], structuredClone(update.$set));
        },
      };
      if (name === 'products') return {
        updateOne: restock,
        findOne: async ({ storeId }: { storeId: StoreId }) => (await store.catalog(storeId)).find((p) => p.sku === 'hoodie'),
      };
      return { find: (filter: Filter) => ({ toArray: () => rows(name, filter) }) };
    },
  } as unknown as Db;
  return { store, db, ids, recorded, restock, setCorrupt: (value: typeof corrupt) => { corrupt = value; },
    maxActive: () => maxActive, flash: createFlashSale({ store, db }) };
}

describe('flash sale', () => {
  it('launches 100 funded bots together, sells exactly 10, and persists the verified result', async () => {
    const f = fixture();
    // Unrelated ledger activity must not contribute to this run's counts.
    const stranger = await MemoryStore.prototype.createShopper.call(f.store, { storeId: 'yonge', kind: 'crowd' });
    await MemoryStore.prototype.checkout.call(f.store, {
      storeId: 'yonge', shopperId: stranger.id, idempotencyKey: 'unrelated', items: [{ sku: 'hoodie', qty: 1 }],
    });
    const result = await f.flash.runFlashSale();
    expect(result).toMatchObject({
      kind: 'flash', storeId: 'queen', status: 'done', attempted: 100, succeeded: 10, failed: 90,
      errors: { out_of_stock: 90 }, error: null, stockBefore: 10, stockAfter: 0, salesCount: 10, ordersCount: 10,
      walletsChecked: 100, walletsMatchLedger: true, noNegativeWallets: true, grantsCorrect: true,
      salesMatchOrders: true, passed: true,
    });
    expect(f.maxActive()).toBe(100);
    expect(new Set(result.shopperIds).size).toBe(100);
    expect(f.store.createShopper).toHaveBeenCalledTimes(100);
    expect(f.store.createShopper).toHaveBeenCalledWith(expect.objectContaining({ kind: 'bot', walletCents: 2000 }));
    expect(f.restock).toHaveBeenCalledWith({ storeId: 'queen', sku: 'hoodie' }, { $set: { stock: 10 } });
    expect(f.recorded[0]).toMatchObject(result);
    expect(result.finishedAt).toBeInstanceOf(Date);
  });

  it('uses the selected store and leaves other stores alone', async () => {
    const f = fixture();
    expect(await f.flash.runFlashSale({ storeId: 'scarborough' })).toMatchObject({ storeId: 'scarborough', passed: true });
    expect(f.restock).toHaveBeenCalledWith({ storeId: 'scarborough', sku: 'hoodie' }, { $set: { stock: 10 } });
    expect((await f.store.catalog('queen')).find((p) => p.sku === 'hoodie')?.stock).toBe(10);
  });

  it.each(['wallet', 'negative', 'grant', 'order', 'sale', 'missing'] as const)(
    'fails verification when persisted %s evidence is corrupt', async (corrupt) => {
      const f = fixture();
      f.setCorrupt(corrupt);
      const result = await f.flash.runFlashSale();
      expect(result).toMatchObject({ succeeded: 10, status: 'failed', passed: false });
      expect(f.recorded[0]).toMatchObject({ status: 'failed', passed: false });
    },
  );

  it('records checkout exceptions instead of reporting them as stock failures', async () => {
    const f = fixture();
    const checkout = MemoryStore.prototype.checkout.bind(f.store);
    vi.spyOn(f.store, 'checkout').mockImplementation((input) => {
      if (input.shopperId === f.ids[99]) throw new Error('private driver detail');
      return checkout(input);
    });
    const result = await f.flash.runFlashSale();
    expect(result).toMatchObject({ succeeded: 10, failed: 90, status: 'failed',
      errors: { out_of_stock: 89, checkout_exception: 1 }, passed: false });
    expect(JSON.stringify(f.recorded)).not.toContain('private driver detail');
  });

  it('records a partial setup failure and releases the run guard', async () => {
    const f = fixture();
    vi.spyOn(f.store, 'createShopper').mockRejectedValueOnce(new Error('private setup detail'));
    const result = await f.flash.runFlashSale();
    expect(result).toMatchObject({ attempted: 0, status: 'failed', error: 'flash_setup_failed', passed: false });
    expect(result.shopperIds).toHaveLength(9);
    expect(f.store.checkout).not.toHaveBeenCalled();
    expect(JSON.stringify(f.recorded)).not.toContain('private setup detail');
    // A second call enters setup rather than remaining permanently busy.
    vi.spyOn(f.store, 'product').mockResolvedValue(null);
    await expect(f.flash.runFlashSale()).resolves.toMatchObject({ error: 'flash_setup_failed' });
  });

  it('rejects overlapping restocks at the same store across factory instances', async () => {
    const f = fixture();
    const product = await f.store.product('hoodie');
    let release!: () => void;
    vi.spyOn(f.store, 'product').mockImplementation(() => new Promise((resolve) => { release = () => resolve(product); }));
    const first = f.flash.runFlashSale();
    await Promise.resolve();
    await expect(createFlashSale(f).runFlashSale()).rejects.toBeInstanceOf(FlashSaleBusyError);
    release();
    await expect(first).resolves.toMatchObject({ passed: true });
    expect(f.restock).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid store before writing anything', async () => {
    const f = fixture();
    await expect(f.flash.runFlashSale({ storeId: 'wrong' as StoreId })).rejects.toThrow('Unknown flash-sale store');
    expect(f.recorded).toHaveLength(0);
    expect(f.restock).not.toHaveBeenCalled();
  });
});
