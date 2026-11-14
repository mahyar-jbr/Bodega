import '../server/env';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll } from 'vitest';
import { closeDb, dbName, getClient } from '../shared/db';
import type { StoreId } from '../shared/contract';
import { storeContractTests } from '../shared/store-contract';
import { AtlasStore } from './atlas-store';
import { catalogDocuments, seedDatabase, STORE_SEEDS } from './seed';

const testRunId = `${process.pid}_${randomBytes(4).toString('hex')}`;
const db = getClient().db(`${dbName()}_contract_${testRunId}`);

beforeAll(async () => {
  await seedDatabase(db);
});

afterAll(async () => {
  try {
    await db.dropDatabase();
  } finally {
    await closeDb();
  }
});

async function makeFreshAtlasStore(): Promise<AtlasStore> {
  await Promise.all([
    db.collection('shoppers').deleteMany({}),
    db.collection('orders').deleteMany({}),
    db.collection('ledger').deleteMany({}),
    db.collection('counters').deleteMany({}),
    db.collection('products').bulkWrite(
      catalogDocuments().map((product) => ({
        updateOne: {
          filter: { storeId: product.storeId, sku: product.sku },
          update: { $set: { stock: product.stock } },
        },
      })),
    ),
  ]);
  await db.collection<{ _id: StoreId; seq: number }>('counters').insertMany(
    STORE_SEEDS.map(({ storeId }) => ({ _id: storeId, seq: 1000 })),
  );
  return new AtlasStore(db);
}

storeContractTests('AtlasStore', makeFreshAtlasStore, {
  ledgerFor: async (store, shopperId) => (store as AtlasStore).ledger(shopperId),
  timeoutMs: 60_000,
});
