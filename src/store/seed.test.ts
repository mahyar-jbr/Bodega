import { describe, expect, it } from 'vitest';
import type { Product } from '../shared/contract';
import { STORE_SEEDS, catalogDocuments } from './seed';

const catalog: (Product & { stock: number })[] = [
  { sku: 'coffee', name: 'Large coffee', priceCents: 325, costCents: 70, emoji: '☕', stock: 100 },
];

describe('store seed data', () => {
  it('copies the shared cents catalog to every store', () => {
    expect(catalogDocuments(catalog)).toEqual(
      STORE_SEEDS.map(({ storeId }) => ({
        storeId,
        sku: 'coffee',
        name: 'Large coffee',
        emoji: '☕',
        priceCents: 325,
        costCents: 70,
        stock: 100,
      })),
    );
  });

  it('refuses a non-integer stock value before writing', () => {
    expect(() => catalogDocuments([{ ...catalog[0], stock: 1.5 }])).toThrow('non-negative integer');
  });
});
