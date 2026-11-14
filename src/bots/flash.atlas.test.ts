import '../server/env';
import { ObjectId } from 'mongodb';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { LedgerEntry, Order, Shopper } from '../shared/contract';
import { closeDb, getDb } from '../shared/db';
import { AtlasStore } from '../store/atlas-store';
import { createFlashSale } from './flash';

// Explicit opt-in: this restocks one development shelf and retains its run as evidence.
// Never change this to the deployed database or invoke the live HTTP endpoint here.
describe.skipIf(process.env.BODEGA_FLASH_ATLAS_TEST !== '1')('flash sale on bodega_kasra', () => {
  afterAll(closeDb);

  it('sells exactly 10 of 100 simultaneous checkouts and independently reconciles Atlas', async () => {
    const db = getDb();
    if (db.databaseName !== 'bodega_kasra') throw new Error('Flash test requires exactly bodega_kasra');
    const shelf = db.collection('products');
    expect(await shelf.findOne({ storeId: 'queen', sku: 'hoodie' })).not.toBeNull();
    const otherShelves = await shelf.find({ storeId: { $ne: 'queen' }, sku: 'hoodie' }).toArray();
    // A partially sold shelf proves the implementation sets stock to 10 rather than adding 10.
    await shelf.updateOne({ storeId: 'queen', sku: 'hoodie' }, { $set: { stock: 3 } });
    const store = new AtlasStore(db);
    const originalCheckout = store.checkout.bind(store);
    let active = 0;
    let maxActive = 0;
    vi.spyOn(store, 'checkout').mockImplementation(async (input) => {
      active++;
      maxActive = Math.max(maxActive, active);
      try { return await originalCheckout(input); } finally { active--; }
    });
    const result = await createFlashSale({ store, db }).runFlashSale();
    console.log('FLASH_ATLAS_RESULT', JSON.stringify({ ...result, shopperIds: `[${result.shopperIds.length} bot IDs persisted]` }));
    expect(result).toMatchObject({ storeId: 'queen', kind: 'flash', status: 'done', attempted: 100,
      succeeded: 10, failed: 90, errors: { out_of_stock: 90 }, stockAfter: 0, salesCount: 10,
      walletsChecked: 100, walletsMatchLedger: true, noNegativeWallets: true,
      grantsCorrect: true, salesMatchOrders: true, passed: true, error: null });
    expect(maxActive).toBe(100);
    expect(new Set(result.shopperIds).size).toBe(100);
    const [wallets, ledger, orders, persisted] = await Promise.all([
      db.collection<Shopper>('shoppers').find({ id: { $in: result.shopperIds } }).toArray(),
      db.collection<LedgerEntry>('ledger').find({ shopperId: { $in: result.shopperIds } }).toArray(),
      db.collection<Order>('orders').find({ shopperId: { $in: result.shopperIds } }).toArray(),
      db.collection('bot_runs').findOne({ _id: new ObjectId(result.runId) }),
    ]);
    expect(wallets).toHaveLength(100);
    expect(ledger.filter((entry) => entry.kind === 'grant')).toHaveLength(100);
    expect(ledger.filter((entry) => entry.kind === 'sale')).toHaveLength(10);
    expect(orders).toHaveLength(10);
    expect(wallets.filter((shopper) => shopper.walletCents === 100)).toHaveLength(10);
    expect(wallets.filter((shopper) => shopper.walletCents === 2000)).toHaveLength(90);
    for (const shopper of wallets) {
      expect(shopper.kind).toBe('bot');
      expect(shopper.walletCents).toBeGreaterThanOrEqual(0);
      expect(shopper.walletCents).toBe(ledger.filter((entry) => entry.shopperId === shopper.id)
        .reduce((sum, entry) => sum + entry.walletDeltaCents, 0));
    }
    expect((await shelf.findOne({ storeId: 'queen', sku: 'hoodie' }))?.stock).toBe(0);
    expect(await shelf.find({ storeId: { $ne: 'queen' }, sku: 'hoodie' }).toArray()).toEqual(otherShelves);
    expect(persisted).toMatchObject(result);
  }, 240_000);
});
