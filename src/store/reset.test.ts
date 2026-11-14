import '../server/env';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, dbName, getClient } from '../shared/db';
import { resetStoreData } from './reset';
import { seedDatabase, STORE_SEEDS } from './seed';

const testRunId = `${process.pid}_${randomBytes(4).toString('hex')}`;
const db = getClient().db(`${dbName()}_reset_${testRunId}`);
const collections = [
  'products', 'codes', 'members', 'stores', 'shoppers', 'orders', 'ledger', 'counters', 'bot_runs', 'evaluations',
];

beforeAll(async () => {
  await seedDatabase(db);
});

afterAll(async () => {
  await Promise.all(collections.map((name) => db.collection(name).deleteMany({})));
  await closeDb();
});

describe('resetStoreData', () => {
  it('clears store activity, resets counters and stock, and leaves evaluations alone', async () => {
    await db.collection('shoppers').insertOne({ id: 'reset-shopper', walletCents: 100, storeId: 'queen' });
    await db.collection('orders').insertOne({ id: 'reset-order', number: 'Q-1234', idempotencyKey: 'reset-order-key' });
    await db.collection('ledger').insertOne({ id: 'reset-ledger', idempotencyKey: 'reset-ledger-key' });
    await db.collection('bot_runs').insertOne({ id: 'reset-bot-run' });
    await db.collection('products').updateOne({ storeId: 'queen', sku: 'coffee' }, { $set: { stock: 1 } });
    await db.collection('evaluations').insertOne({ id: 'baseline-must-stay' });

    const first = await resetStoreData(db);
    expect(first).toMatchObject({
      shoppersDeleted: 1, ordersDeleted: 1, ledgerDeleted: 1, botRunsDeleted: 1, productsRestocked: 36,
    });
    for (const name of ['shoppers', 'orders', 'ledger', 'bot_runs']) {
      expect(await db.collection(name).countDocuments()).toBe(0);
    }
    expect(await db.collection('products').findOne({ storeId: 'queen', sku: 'coffee' }))
      .toMatchObject({ stock: 100 });
    expect(await db.collection('counters').find().sort({ _id: 1 }).toArray())
      .toEqual(expect.arrayContaining(STORE_SEEDS.map(({ storeId }) => expect.objectContaining({ _id: storeId, seq: 1000 }))));
    expect(await db.collection('evaluations').findOne({ id: 'baseline-must-stay' })).not.toBeNull();

    const second = await resetStoreData(db);
    expect(second).toMatchObject({ shoppersDeleted: 0, ordersDeleted: 0, ledgerDeleted: 0, botRunsDeleted: 0 });
    expect(await db.collection('evaluations').countDocuments({ id: 'baseline-must-stay' })).toBe(1);
  }, 60_000);
});
