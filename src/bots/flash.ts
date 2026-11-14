import { ObjectId, type Db } from 'mongodb';
import type { CheckoutResult, LedgerEntry, Order, Shopper, StoreApi, StoreId } from '../shared/contract';
import { isStoreId } from '../shared/store-data';

export const FLASH_SALE = Object.freeze({ sku: 'hoodie', stock: 10, shoppers: 100, walletCents: 2_000 });

export interface FlashSaleResult {
  runId: string;
  kind: 'flash';
  storeId: StoreId;
  status: 'running' | 'done' | 'failed';
  shopperIds: string[];
  attempted: number;
  succeeded: number;
  failed: number;
  errors: Record<string, number>;
  error: string | null;
  stockAfter: number | null;
  salesCount: number;
  ordersCount: number;
  walletsChecked: number;
  walletsMatchLedger: boolean;
  noNegativeWallets: boolean;
  grantsCorrect: boolean;
  salesMatchOrders: boolean;
  passed: boolean;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number;
}

export class FlashSaleBusyError extends Error {
  readonly code = 'flash_busy';
  constructor() { super('A flash sale is already running at this store'); }
}

// The app is one process. Share the guard across factory instances using the same database handle.
const active = new WeakMap<Db, Set<StoreId>>();

export function createFlashSale({ store, db }: { store: StoreApi; db: Db }) {
  return {
    async runFlashSale({ storeId = 'queen' }: { storeId?: StoreId } = {}): Promise<FlashSaleResult> {
      if (!isStoreId(storeId)) throw new RangeError('Unknown flash-sale store');
      const stores = active.get(db) ?? new Set<StoreId>();
      if (stores.has(storeId)) throw new FlashSaleBusyError();
      active.set(db, stores);
      stores.add(storeId);
      try {
        return await run(store, db, storeId);
      } finally {
        stores.delete(storeId);
      }
    },
  };
}

async function run(store: StoreApi, db: Db, storeId: StoreId): Promise<FlashSaleResult> {
  const _id = new ObjectId();
  const result: FlashSaleResult = {
    runId: _id.toHexString(), kind: 'flash', storeId, status: 'running', shopperIds: [],
    attempted: 0, succeeded: 0, failed: 0, errors: {}, error: null, stockAfter: null,
    salesCount: 0, ordersCount: 0, walletsChecked: 0, walletsMatchLedger: false,
    noNegativeWallets: false, grantsCorrect: false, salesMatchOrders: false, passed: false,
    startedAt: new Date(), finishedAt: null, durationMs: 0,
  };
  const runs = db.collection<FlashSaleResult>('bot_runs');
  await runs.insertOne({ _id, ...result });

  let phase: 'setup' | 'verification' = 'setup';
  try {
    const product = await store.product(FLASH_SALE.sku);
    if (!product || product.priceCents > FLASH_SALE.walletCents) throw new Error('Hoodie unavailable');
    const restock = await db.collection('products').updateOne(
      { storeId, sku: FLASH_SALE.sku }, { $set: { stock: FLASH_SALE.stock } },
    );
    if (restock.matchedCount !== 1) throw new Error('Hoodie shelf missing');

    // Creation can be paced for Atlas. No checkout starts until every grant has committed.
    const shoppers: Shopper[] = [];
    for (let offset = 0; offset < FLASH_SALE.shoppers; offset += 10) {
      const batch = await Promise.allSettled(Array.from({ length: 10 }, (_, index) => store.createShopper({
        storeId, kind: 'bot', walletCents: FLASH_SALE.walletCents,
        nickname: `Flash ${result.runId.slice(-6)} ${offset + index + 1}`,
      })));
      for (const item of batch) {
        if (item.status === 'fulfilled') {
          shoppers.push(item.value);
          result.shopperIds.push(item.value.id);
        }
      }
      if (batch.some((item) => item.status === 'rejected')) throw new Error('Shopper creation failed');
    }
    await runs.updateOne({ _id }, { $set: { shopperIds: result.shopperIds, attempted: FLASH_SALE.shoppers } });

    // Release all 100 calls in the same microtask turn, with no checkout queue or AI calls.
    result.attempted = shoppers.length;
    const attempts = await Promise.allSettled(shoppers.map((shopper) => Promise.resolve().then(() => store.checkout({
      storeId, shopperId: shopper.id, idempotencyKey: `flash:${result.runId}:${shopper.id}`,
      items: [{ sku: FLASH_SALE.sku, qty: 1 }],
    }))));
    const successful = new Map<string, Extract<CheckoutResult, { ok: true }>>();
    for (const [index, attempt] of attempts.entries()) {
      if (attempt.status === 'fulfilled' && attempt.value.ok) {
        result.succeeded++;
        successful.set(shoppers[index].id, attempt.value);
      } else {
        result.failed++;
        const error = attempt.status === 'rejected' ? 'checkout_exception'
          : (attempt.value as Extract<CheckoutResult, { ok: false }>).error;
        result.errors[error] = (result.errors[error] ?? 0) + 1;
      }
    }

    phase = 'verification';
    const filter = { storeId, shopperId: { $in: result.shopperIds } };
    const [shelf, wallets, ledger, orders] = await Promise.all([
      db.collection('products').findOne({ storeId, sku: FLASH_SALE.sku }),
      db.collection<Shopper>('shoppers').find({ storeId, id: { $in: result.shopperIds } }).toArray(),
      db.collection<LedgerEntry>('ledger').find(filter).toArray(),
      db.collection<Order>('orders').find(filter).toArray(),
    ]);
    const sales = ledger.filter((entry) => entry.kind === 'sale');
    const grants = ledger.filter((entry) => entry.kind === 'grant');
    const sums = new Map<string, number>();
    for (const entry of ledger) sums.set(entry.shopperId, (sums.get(entry.shopperId) ?? 0) + entry.walletDeltaCents);
    result.stockAfter = shelf?.stock ?? null;
    result.salesCount = sales.length;
    result.ordersCount = orders.length;
    result.walletsChecked = wallets.length;
    result.walletsMatchLedger = wallets.length === FLASH_SALE.shoppers
      && new Set(wallets.map((shopper) => shopper.id)).size === FLASH_SALE.shoppers
      && wallets.every((shopper) => shopper.walletCents === sums.get(shopper.id));
    result.noNegativeWallets = wallets.length === FLASH_SALE.shoppers
      && wallets.every((shopper) => Number.isSafeInteger(shopper.walletCents) && shopper.walletCents >= 0)
      && ledger.every((entry) => Number.isSafeInteger(entry.walletAfterCents) && entry.walletAfterCents >= 0);
    result.grantsCorrect = grants.length === FLASH_SALE.shoppers
      && new Set(grants.map((entry) => entry.shopperId)).size === FLASH_SALE.shoppers
      && grants.every((entry) => entry.walletDeltaCents === FLASH_SALE.walletCents
        && entry.walletAfterCents === FLASH_SALE.walletCents);
    result.salesMatchOrders = orders.length === FLASH_SALE.stock && sales.length === FLASH_SALE.stock
      && new Set(sales.map((entry) => entry.orderId)).size === FLASH_SALE.stock
      && orders.every((order) => {
        const checkout = successful.get(order.shopperId);
        const sale = sales.find((entry) => entry.orderId === order.id);
        return checkout?.order.id === order.id && !checkout.duplicate && order.status === 'paid'
          && order.lines.length === 1 && order.lines[0].sku === FLASH_SALE.sku && order.lines[0].qty === 1
          && order.totalCents === product.priceCents && sale?.shopperId === order.shopperId
          && sale.walletDeltaCents === -product.priceCents
          && sale.walletAfterCents === FLASH_SALE.walletCents - product.priceCents
          && sale.idempotencyKey === `flash:${result.runId}:${order.shopperId}`;
      });
    result.passed = result.succeeded === FLASH_SALE.stock && result.failed === 90
      && result.errors.out_of_stock === 90 && Object.keys(result.errors).length === 1
      && result.stockAfter === 0 && result.walletsMatchLedger && result.noNegativeWallets
      && result.grantsCorrect && result.salesMatchOrders;
  } catch {
    // Driver messages may contain connection details. Persist only a stable, non-secret code.
    result.error = `flash_${phase}_failed`;
  }
  result.status = result.passed ? 'done' : 'failed';
  result.finishedAt = new Date();
  result.durationMs = result.finishedAt.getTime() - result.startedAt.getTime();
  await runs.updateOne({ _id }, { $set: result });
  return result;
}

export type FlashSale = ReturnType<typeof createFlashSale>;
