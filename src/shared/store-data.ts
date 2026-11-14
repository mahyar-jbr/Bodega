// The store's real data from data/ (catalog, codes, members), in cents. Read once per process.
// Both stores seed from it: MemoryStore directly, and Kasra's seed script if it wants to.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Code, Member, Product, StoreId } from './contract';
import { dollarsToCents } from './money';

export const STORE_IDS: readonly StoreId[] = ['queen', 'yonge', 'scarborough'];

/** Order numbers start with the store's letter: Q-1001, Y-1001, S-1001. */
export const ORDER_PREFIX: Record<StoreId, string> = { queen: 'Q', yonge: 'Y', scarborough: 'S' };

export function isStoreId(value: unknown): value is StoreId {
  return typeof value === 'string' && (STORE_IDS as readonly string[]).includes(value);
}

function readData<T>(file: string): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../../data/${file}`, import.meta.url)), 'utf8')) as T;
}

interface RawProduct { sku: string; name: string; price: number; cost: number; emoji: string; stock: number }

/** The catalog with each store's starting stock (every store starts with the same). */
export const CATALOG: readonly (Product & { stock: number })[] = readData<RawProduct[]>('catalog.json').map((p) => ({
  sku: p.sku,
  name: p.name,
  emoji: p.emoji,
  priceCents: dollarsToCents(p.price),
  costCents: dollarsToCents(p.cost),
  stock: p.stock,
}));

export const CODES: readonly Code[] = readData<Code[]>('codes.json');
export const MEMBERS: readonly Member[] = readData<Member[]>('members.json');

/** The default grant for crowd and bot shoppers. */
export const DEFAULT_WALLET_CENTS = 2_000;
