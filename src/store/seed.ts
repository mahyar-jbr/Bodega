import type { Db, Document } from 'mongodb';
import type { Product, StoreId } from '../shared/contract';
import { CATALOG, CODES, MEMBERS } from '../shared/store-data';

export const STORE_SEEDS = [
  { storeId: 'queen', name: 'Queen St', color: '#baaee3', awning: 'lilac' },
  { storeId: 'yonge', name: 'Yonge St', color: '#d9c099', awning: 'sand' },
  { storeId: 'scarborough', name: 'Scarborough', color: '#e1a6a9', awning: 'rose' },
] as const satisfies readonly { storeId: StoreId; name: string; color: string; awning: string }[];

const nonNegativeInteger: Document = {
  bsonType: ['int', 'long', 'double', 'decimal'],
  minimum: 0,
  multipleOf: 1,
};

const collectionValidators: Record<string, Document | undefined> = {
  products: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['stock'],
      properties: { stock: nonNegativeInteger },
    },
  },
  shoppers: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['walletCents'],
      properties: { walletCents: nonNegativeInteger },
    },
  },
  codes: undefined,
  members: undefined,
  stores: undefined,
  orders: undefined,
  ledger: undefined,
  counters: undefined,
};

export interface SeedSummary {
  stores: number;
  products: number;
  codes: number;
  members: number;
}

export interface SeedProductDocument extends Product {
  storeId: StoreId;
  stock: number;
}

export function catalogDocuments(
  catalog: readonly (Product & { stock: number })[] = CATALOG,
): SeedProductDocument[] {
  return STORE_SEEDS.flatMap(({ storeId }) =>
    catalog.map((item) => {
      if (!item.sku.trim() || !item.name.trim() || !item.emoji.trim()) {
        throw new Error('Catalog entries require sku, name, and emoji');
      }
      if (!Number.isInteger(item.stock) || item.stock < 0) {
        throw new Error(`Catalog stock must be a non-negative integer for ${item.sku}`);
      }
      if (!Number.isInteger(item.priceCents) || item.priceCents < 0
        || !Number.isInteger(item.costCents) || item.costCents < 0) {
        throw new Error(`Catalog prices must be non-negative integer cents for ${item.sku}`);
      }

      return {
        storeId,
        sku: item.sku,
        name: item.name,
        emoji: item.emoji,
        priceCents: item.priceCents,
        costCents: item.costCents,
        stock: item.stock,
      };
    }),
  );
}

export async function seedDatabase(db: Db): Promise<SeedSummary> {
  for (const [name, validator] of Object.entries(collectionValidators)) {
    await ensureCollection(db, name, validator);
  }

  await Promise.all([
    db.collection('products').createIndex({ storeId: 1, sku: 1 }, { unique: true, name: 'uniq_store_sku' }),
    db.collection('codes').createIndex({ code: 1 }, { unique: true, name: 'uniq_code' }),
    db.collection('members').createIndex({ memberId: 1 }, { unique: true, name: 'uniq_member_id' }),
    db.collection('orders').createIndex({ number: 1 }, { unique: true, name: 'uniq_order_number' }),
    db.collection('orders').createIndex({ idempotencyKey: 1 }, { unique: true, name: 'uniq_order_idempotency_key' }),
    db.collection('ledger').createIndex({ idempotencyKey: 1 }, { unique: true, name: 'uniq_ledger_idempotency_key' }),
  ]);

  const products = catalogDocuments();

  if (products.length > 0) {
    await db.collection('products').bulkWrite(
      products.map((product) => ({
        updateOne: {
          filter: { storeId: product.storeId, sku: product.sku },
          update: { $set: product },
          upsert: true,
        },
      })),
    );
  }

  if (CODES.length > 0) {
    await db.collection('codes').bulkWrite(
      CODES.map((code) => ({
        updateOne: {
          filter: { code: code.code.toUpperCase() },
          update: { $set: { ...code, code: code.code.toUpperCase() } },
          upsert: true,
        },
      })),
    );
  }

  if (MEMBERS.length > 0) {
    await db.collection('members').bulkWrite(
      MEMBERS.map((member) => ({
        updateOne: {
          filter: { memberId: member.memberId.toUpperCase() },
          update: { $set: { ...member, memberId: member.memberId.toUpperCase() } },
          upsert: true,
        },
      })),
    );
  }

  await db.collection('stores').bulkWrite(
    STORE_SEEDS.map((store) => ({
      updateOne: {
        filter: { storeId: store.storeId },
        update: { $set: store },
        upsert: true,
      },
    })),
  );

  await db.collection<{ _id: string; seq: number }>('counters').bulkWrite(
    STORE_SEEDS.map(({ storeId }) => ({
      updateOne: {
        filter: { _id: storeId },
        update: { $setOnInsert: { seq: 1000 } },
        upsert: true,
      },
    })),
  );

  return {
    stores: STORE_SEEDS.length,
    products: products.length,
    codes: CODES.length,
    members: MEMBERS.length,
  };
}

async function ensureCollection(db: Db, name: string, validator: Document | undefined): Promise<void> {
  const existing = await db.listCollections({ name }, { nameOnly: false }).next();
  const validationOptions = validator
    ? { validator, validationLevel: 'strict' as const, validationAction: 'error' as const }
    : {};

  if (!existing) {
    await db.createCollection(name, validationOptions);
    return;
  }

  if (validator && !existing.options?.validator) await db.command({ collMod: name, ...validationOptions });
}
