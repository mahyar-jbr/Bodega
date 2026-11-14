import { describe, expect, it } from 'vitest';
import { MemoryStore } from './memory-store';
import { discountCents, dollarsToCents, formatCents } from './money';
import { storeContractTests } from './store-contract';

storeContractTests('MemoryStore', () => new MemoryStore(), {
  ledgerFor: async (store, shopperId) => (store as MemoryStore).ledger(shopperId),
});

describe('money', () => {
  it('rounds discounts half up in integer cents', () => {
    expect(discountCents(675, 10)).toBe(68);   // data/README.md H-001
    expect(discountCents(375, 10)).toBe(38);   // H-004
    expect(discountCents(1000, 5)).toBe(50);
    expect(discountCents(10, 5)).toBe(1);      // 0.5 rounds up
    expect(discountCents(9, 5)).toBe(0);       // 0.45 rounds down
    expect(discountCents(950, 100)).toBe(950);
    expect(discountCents(333, 12.5)).toBe(42); // 41.625
  });

  it('converts dollars to cents and formats them', () => {
    expect(dollarsToCents(3.25)).toBe(325);
    expect(dollarsToCents(0.7)).toBe(70);
    expect(dollarsToCents(6.07)).toBe(607);
    expect(formatCents(607)).toBe('$6.07');
    expect(formatCents(-250)).toBe('-$2.50');
  });
});
