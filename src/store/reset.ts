import type { Db } from 'mongodb';
import type { StoreId } from '../shared/contract';
import { catalogDocuments, STORE_SEEDS } from './seed';

interface CounterDoc {
  _id: StoreId;
  seq: number;
}

export interface StoreResetSummary {
  shoppersDeleted: number;
  ordersDeleted: number;
  ledgerDeleted: number;
  botRunsDeleted: number;
  productsRestocked: number;
}

export async function resetStoreData(db: Db): Promise<StoreResetSummary> {
  const session = db.client.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const shoppers = await db.collection('shoppers').deleteMany({}, { session });
      const orders = await db.collection('orders').deleteMany({}, { session });
      const ledger = await db.collection('ledger').deleteMany({}, { session });
      const botRuns = await db.collection('bot_runs').deleteMany({}, { session });

      await db.collection<CounterDoc>('counters').deleteMany({}, { session });
      await db.collection<CounterDoc>('counters').insertMany(
        STORE_SEEDS.map(({ storeId }) => ({ _id: storeId, seq: 1000 })),
        { session },
      );

      const products = catalogDocuments();
      const restocked = await db.collection('products').bulkWrite(
        products.map((product) => ({
          updateOne: {
            filter: { storeId: product.storeId, sku: product.sku },
            update: { $set: { stock: product.stock } },
          },
        })),
        { session, ordered: true },
      );
      if (restocked.matchedCount !== products.length) {
        throw new Error(`reset found ${restocked.matchedCount} of ${products.length} seeded products`);
      }

      return {
        shoppersDeleted: shoppers.deletedCount,
        ordersDeleted: orders.deletedCount,
        ledgerDeleted: ledger.deletedCount,
        botRunsDeleted: botRuns.deletedCount,
        productsRestocked: restocked.matchedCount,
      };
    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
    });
    if (!result) throw new Error('store reset transaction returned no result');
    return result;
  } finally {
    await session.endSession();
  }
}
