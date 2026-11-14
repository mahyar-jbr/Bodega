import { nanoid } from 'nanoid';
import type { ClientSession, Db, Document, WithId } from 'mongodb';
import type {
  CheckoutRequest,
  CheckoutResult,
  Code,
  LedgerEntry,
  Member,
  Order,
  Product,
  RefundRequest,
  RefundResult,
  Shopper,
  StoreApi,
  StoreId,
} from '../shared/contract';
import { discountCents, isValidPct } from '../shared/money';
import { makeNickname } from '../shared/nickname';
import { DEFAULT_WALLET_CENTS, isStoreId, ORDER_PREFIX } from '../shared/store-data';

const MAX_QTY = 20;
const MAX_LINES = 20;
const MAX_REFUND_CENTS = 60_000;

interface ProductDoc extends Product { storeId: StoreId; stock: number }
interface OrderDoc extends Order { idempotencyKey: string }
interface CounterDoc { _id: StoreId; seq: number }

type CheckoutFailure = Extract<CheckoutResult, { ok: false }>;
type RefundFailure = Extract<RefundResult, { ok: false }>;

class CheckoutAbort extends Error {
  constructor(readonly failure: CheckoutFailure) {
    super(failure.detail);
  }
}

interface StaticData {
  products: Map<string, Product>;
  codes: Map<string, Code>;
  members: Map<string, Member>;
}

export class AtlasStore implements StoreApi {
  private staticDataPromise: Promise<StaticData> | undefined;

  constructor(private readonly db: Db) {}

  async catalog(storeId: StoreId): Promise<(Product & { stock: number })[]> {
    const docs = await this.db.collection<ProductDoc>('products').find({ storeId }).sort({ _id: 1 }).toArray();
    return docs.map(({ _id: _ignored, storeId: _storeId, ...product }) => product);
  }

  async product(sku: string): Promise<Product | null> {
    const product = (await this.staticData()).products.get(String(sku));
    return product ? { ...product } : null;
  }

  async code(value: string): Promise<Code | null> {
    const code = (await this.staticData()).codes.get(String(value).trim().toUpperCase());
    return code ? { ...code } : null;
  }

  async member(memberId: string): Promise<Member | null> {
    const member = (await this.staticData()).members.get(String(memberId).trim());
    return member ? { ...member } : null;
  }

  async createShopper(input: { storeId: StoreId; kind: Shopper['kind']; nickname?: string;
    walletCents?: number; memberId?: string | null }): Promise<Shopper> {
    if (!isStoreId(input.storeId)) throw new Error(`unknown store: ${input.storeId}`);
    const walletCents = input.walletCents ?? DEFAULT_WALLET_CENTS;
    if (!Number.isSafeInteger(walletCents) || walletCents < 0) throw new Error(`bad walletCents: ${walletCents}`);

    const shopper: Shopper = {
      id: nanoid(),
      nickname: input.nickname ?? makeNickname(),
      storeId: input.storeId,
      walletCents,
      memberId: input.memberId ?? null,
      kind: input.kind,
      createdAt: new Date(),
    };
    const grant: LedgerEntry = {
      id: nanoid(), kind: 'grant', storeId: shopper.storeId, shopperId: shopper.id,
      orderId: null, claimedOrderNumber: null, walletDeltaCents: walletCents,
      walletAfterCents: walletCents, idempotencyKey: `grant:${shopper.id}`,
      reason: 'welcome credit', conversationId: null, guardVersion: null, at: new Date(),
    };

    await this.transaction(async (session) => {
      await this.db.collection<Shopper>('shoppers').insertOne(shopper, { session });
      await this.db.collection<LedgerEntry>('ledger').insertOne(grant, { session });
    });
    return { ...shopper };
  }

  async shopper(id: string): Promise<Shopper | null> {
    const doc = await this.db.collection<Shopper>('shoppers').findOne({ id });
    return doc ? withoutId(doc) : null;
  }

  async orderByNumber(number: string): Promise<Order | null> {
    const doc = await this.db.collection<OrderDoc>('orders').findOne({ number: normalizeOrderNumber(number) });
    return doc ? toOrder(doc) : null;
  }

  async ordersFor(shopperId: string): Promise<Order[]> {
    const docs = await this.db.collection<OrderDoc>('orders').find({ shopperId }).sort({ createdAt: 1 }).toArray();
    return docs.map(toOrder);
  }

  async checkout(req: CheckoutRequest): Promise<CheckoutResult> {
    if (typeof req?.idempotencyKey !== 'string' || !req.idempotencyKey) return invalidCheckout('idempotencyKey is required');

    try {
      return await this.transaction(async (session) => {
        const existingOrder = await this.db.collection<OrderDoc>('orders')
          .findOne({ idempotencyKey: req.idempotencyKey }, { session });
        const existingEntry = await this.db.collection<LedgerEntry>('ledger')
          .findOne({ idempotencyKey: req.idempotencyKey }, { session });
        if (existingOrder) {
          return {
            ok: true, order: toOrder(existingOrder),
            walletCents: existingEntry?.walletAfterCents ?? (await this.shopperWallet(existingOrder.shopperId, session)),
            duplicate: true,
          };
        }
        if (existingEntry) return invalidCheckout('idempotencyKey was already used for a refund');

        const prepared = await this.prepareCheckout(req);
        if ('ok' in prepared) return prepared;
        const shopper = await this.db.collection<Shopper>('shoppers').findOne({ id: req.shopperId }, { session });
        if (!shopper) return invalidCheckout('unknown shopperId');

        const stockDocs = await this.db.collection<ProductDoc>('products').find(
          { storeId: req.storeId, sku: { $in: [...prepared.wanted.keys()] } },
          { session },
        ).toArray();
        const stockBySku = new Map(stockDocs.map((product) => [product.sku, product.stock]));
        for (const [sku, qty] of prepared.wanted) {
          const left = stockBySku.get(sku) ?? 0;
          if (left < qty) return { ok: false, error: 'out_of_stock', detail: `only ${left} ${sku} left` };
        }
        if (shopper.walletCents < prepared.totalCents) {
          return { ok: false, error: 'insufficient_funds',
            detail: `the wallet has ${shopper.walletCents} cents, the total is ${prepared.totalCents}` };
        }

        for (const [sku, qty] of prepared.wanted) {
          const result = await this.db.collection<ProductDoc>('products').updateOne(
            { storeId: req.storeId, sku, stock: { $gte: qty } }, { $inc: { stock: -qty } }, { session },
          );
          if (result.modifiedCount !== 1) {
            throw new CheckoutAbort({ ok: false, error: 'out_of_stock', detail: `${sku} sold out during checkout` });
          }
        }

        const shopperAfter = await this.db.collection<Shopper>('shoppers').findOneAndUpdate(
          { id: req.shopperId, walletCents: { $gte: prepared.totalCents } },
          { $inc: { walletCents: -prepared.totalCents } },
          { session, returnDocument: 'after' },
        );
        if (!shopperAfter) {
          throw new CheckoutAbort({ ok: false, error: 'insufficient_funds', detail: 'the wallet changed during checkout' });
        }

        const order = await this.newOrder(req.storeId, {
          storeId: req.storeId, shopperId: req.shopperId, lines: prepared.lines,
          discount: prepared.discount, subtotalCents: prepared.subtotalCents, totalCents: prepared.totalCents,
          refundedCents: 0, status: 'paid', conversationId: req.conversationId ?? null,
          guardVersion: req.guardVersion ?? null, createdAt: new Date(),
        }, session);
        const entry: LedgerEntry = {
          id: nanoid(), kind: 'sale', storeId: req.storeId, shopperId: req.shopperId,
          orderId: order.id, claimedOrderNumber: null, walletDeltaCents: -prepared.totalCents,
          walletAfterCents: shopperAfter.walletCents, idempotencyKey: req.idempotencyKey,
          reason: prepared.discount?.reason ?? null, conversationId: order.conversationId,
          guardVersion: order.guardVersion, at: new Date(),
        };
        await this.db.collection<OrderDoc>('orders').insertOne({ ...order, idempotencyKey: req.idempotencyKey }, { session });
        await this.db.collection<LedgerEntry>('ledger').insertOne(entry, { session });

        return { ok: true, order, walletCents: shopperAfter.walletCents, duplicate: false };
      });
    } catch (error) {
      if (error instanceof CheckoutAbort) return error.failure;
      if (mongoCode(error) === 11000) {
        const duplicate = await this.checkoutDuplicate(req.idempotencyKey);
        if (duplicate) return duplicate;
      }
      throw error;
    }
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    if (typeof req?.idempotencyKey !== 'string' || !req.idempotencyKey) return invalidRefund('idempotencyKey is required');

    try {
      return await this.transaction(async (session) => {
        const existingEntry = await this.db.collection<LedgerEntry>('ledger')
          .findOne({ idempotencyKey: req.idempotencyKey }, { session });
        if (existingEntry) {
          if (existingEntry.kind !== 'refund') return invalidRefund('idempotencyKey was already used for a checkout');
          const order = existingEntry.orderId
            ? await this.db.collection<OrderDoc>('orders').findOne({ id: existingEntry.orderId }, { session })
            : null;
          return { ok: true, entry: withoutId(existingEntry), order: order ? toOrder(order) : null,
            walletCents: existingEntry.walletAfterCents, duplicate: true };
        }
        const checkoutWithKey = await this.db.collection<OrderDoc>('orders')
          .findOne({ idempotencyKey: req.idempotencyKey }, { session });
        if (checkoutWithKey) return invalidRefund('idempotencyKey was already used for a checkout');
        if (!isStoreId(req.storeId)) return invalidRefund('unknown storeId');
        if (!Number.isSafeInteger(req.amountCents) || req.amountCents < 1 || req.amountCents > MAX_REFUND_CENTS) {
          return { ok: false, error: 'invalid_amount',
            detail: `amountCents must be a whole number from 1 to ${MAX_REFUND_CENTS}` };
        }

        const shopperAfter = await this.db.collection<Shopper>('shoppers').findOneAndUpdate(
          { id: req.shopperId }, { $inc: { walletCents: req.amountCents } }, { session, returnDocument: 'after' },
        );
        if (!shopperAfter) return invalidRefund('unknown shopperId');

        const claimed = typeof req.orderNumber === 'string' && req.orderNumber.trim() ? req.orderNumber.trim() : null;
        const orderDoc = claimed
          ? await this.db.collection<OrderDoc>('orders').findOne({ number: normalizeOrderNumber(claimed) }, { session })
          : null;
        let order: Order | null = null;
        if (orderDoc) {
          const refundedCents = Math.min(orderDoc.totalCents, orderDoc.refundedCents + req.amountCents);
          const status: Order['status'] = refundedCents >= orderDoc.totalCents
            ? 'refunded' : refundedCents > 0 ? 'partially_refunded' : 'paid';
          const updated = await this.db.collection<OrderDoc>('orders').findOneAndUpdate(
            { id: orderDoc.id }, { $set: { refundedCents, status } }, { session, returnDocument: 'after' },
          );
          order = updated ? toOrder(updated) : null;
        }

        const entry: LedgerEntry = {
          id: nanoid(), kind: 'refund', storeId: req.storeId, shopperId: req.shopperId,
          orderId: order?.id ?? null, claimedOrderNumber: claimed, walletDeltaCents: req.amountCents,
          walletAfterCents: shopperAfter.walletCents, idempotencyKey: req.idempotencyKey,
          reason: typeof req.reason === 'string' ? req.reason : null,
          conversationId: req.conversationId ?? null, guardVersion: req.guardVersion ?? null, at: new Date(),
        };
        await this.db.collection<LedgerEntry>('ledger').insertOne(entry, { session });
        return { ok: true, entry, order, walletCents: shopperAfter.walletCents, duplicate: false };
      });
    } catch (error) {
      if (mongoCode(error) === 11000) {
        const duplicate = await this.refundDuplicate(req.idempotencyKey);
        if (duplicate) return duplicate;
      }
      throw error;
    }
  }

  async seedPaidOrder(shopperId: string, items: { sku: string; qty: number }[]): Promise<Order> {
    return this.transaction(async (session) => {
      const shopper = await this.db.collection<Shopper>('shoppers').findOne({ id: shopperId }, { session });
      if (!shopper) throw new Error(`unknown shopper: ${shopperId}`);
      const data = await this.staticData();
      const lines: Order['lines'] = [];
      const wanted = new Map<string, number>();
      for (const item of items) {
        const product = data.products.get(item.sku);
        if (!product) throw new Error(`unknown sku: ${item.sku}`);
        if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > MAX_QTY) throw new Error(`bad qty: ${item.qty}`);
        lines.push({ sku: product.sku, qty: item.qty, listPriceCents: product.priceCents, unitPriceCents: product.priceCents });
        wanted.set(product.sku, (wanted.get(product.sku) ?? 0) + item.qty);
      }
      for (const [sku, qty] of wanted) {
        const result = await this.db.collection<ProductDoc>('products').updateOne(
          { storeId: shopper.storeId, sku, stock: { $gte: qty } }, { $inc: { stock: -qty } }, { session },
        );
        if (result.modifiedCount !== 1) throw new Error(`not enough ${sku} stock`);
      }

      const subtotalCents = lines.reduce((sum, line) => sum + line.qty * line.unitPriceCents, 0);
      const order = await this.newOrder(shopper.storeId, {
        storeId: shopper.storeId, shopperId, lines, discount: null, subtotalCents,
        totalCents: subtotalCents, refundedCents: 0, status: 'paid', conversationId: null,
        guardVersion: null, createdAt: new Date(),
      }, session);
      await this.db.collection<OrderDoc>('orders').insertOne({ ...order, idempotencyKey: `seed-order:${order.id}` }, { session });
      await this.db.collection<LedgerEntry>('ledger').insertMany([
        {
          id: nanoid(), kind: 'grant', storeId: shopper.storeId, shopperId,
          orderId: order.id, claimedOrderNumber: null, walletDeltaCents: subtotalCents,
          walletAfterCents: shopper.walletCents + subtotalCents, idempotencyKey: `seed-grant:${order.id}`,
          reason: 'test setup: a past purchase', conversationId: null, guardVersion: null, at: new Date(),
        },
        {
          id: nanoid(), kind: 'sale', storeId: shopper.storeId, shopperId,
          orderId: order.id, claimedOrderNumber: null, walletDeltaCents: -subtotalCents,
          walletAfterCents: shopper.walletCents, idempotencyKey: `seed-sale:${order.id}`,
          reason: 'test setup: a past purchase', conversationId: null, guardVersion: null, at: new Date(),
        },
      ], { session });
      return order;
    });
  }

  async ledger(shopperId?: string): Promise<LedgerEntry[]> {
    const filter = shopperId ? { shopperId } : {};
    const docs = await this.db.collection<LedgerEntry>('ledger').find(filter).sort({ at: 1 }).toArray();
    return docs.map(withoutId);
  }

  private async prepareCheckout(req: CheckoutRequest): Promise<{
    lines: Order['lines']; wanted: Map<string, number>; subtotalCents: number;
    discount: Order['discount']; totalCents: number;
  } | CheckoutFailure> {
    if (!isStoreId(req.storeId)) return invalidCheckout('unknown storeId');
    if (!Array.isArray(req.items) || req.items.length === 0 || req.items.length > MAX_LINES) {
      return invalidCheckout(`items must have 1 to ${MAX_LINES} lines`);
    }
    const products = (await this.staticData()).products;
    const lines: Order['lines'] = [];
    const wanted = new Map<string, number>();
    for (const item of req.items) {
      if (!Number.isInteger(item?.qty) || item.qty < 1 || item.qty > MAX_QTY) {
        return invalidCheckout(`qty must be 1 to ${MAX_QTY}`);
      }
      const product = products.get(item.sku);
      if (!product) return { ok: false, error: 'unknown_sku', detail: `no product "${item.sku}"` };
      const unitPriceCents = item.unitPriceCents ?? product.priceCents;
      if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) {
        return invalidCheckout('unitPriceCents must be a whole number of cents, 0 or more');
      }
      lines.push({ sku: product.sku, qty: item.qty, listPriceCents: product.priceCents, unitPriceCents });
      wanted.set(product.sku, (wanted.get(product.sku) ?? 0) + item.qty);
    }
    if (req.discount != null) {
      if (!isValidPct(req.discount.pct)) return invalidCheckout('discount.pct must be more than 0 and at most 100');
      if (typeof req.discount.reason !== 'string') return invalidCheckout('discount.reason is required');
    }
    const subtotalCents = lines.reduce((sum, line) => sum + line.qty * line.unitPriceCents, 0);
    if (!Number.isSafeInteger(subtotalCents)) return invalidCheckout('subtotal is too large');
    const discount = req.discount
      ? { ...req.discount, cents: discountCents(subtotalCents, req.discount.pct) }
      : null;
    return { lines, wanted, subtotalCents, discount, totalCents: subtotalCents - (discount?.cents ?? 0) };
  }

  private async newOrder(storeId: StoreId, order: Omit<Order, 'id' | 'number'>, session: ClientSession): Promise<Order> {
    const counter = await this.db.collection<CounterDoc>('counters').findOneAndUpdate(
      { _id: storeId },
      [{ $set: { seq: { $add: [{ $ifNull: ['$seq', 1000] }, 1] } } }],
      { session, upsert: true, returnDocument: 'after' },
    );
    if (!counter) throw new Error(`could not allocate an order number for ${storeId}`);
    return { id: nanoid(), number: `${ORDER_PREFIX[storeId]}-${counter.seq}`, ...order };
  }

  private async staticData(): Promise<StaticData> {
    this.staticDataPromise ??= (async () => {
      const [productDocs, codeDocs, memberDocs] = await Promise.all([
        this.db.collection<ProductDoc>('products').find({ storeId: 'queen' }).toArray(),
        this.db.collection<Code>('codes').find().toArray(),
        this.db.collection<Member>('members').find().toArray(),
      ]);
      return {
        products: new Map(productDocs.map(({ _id: _ignored, storeId: _storeId, stock: _stock, ...product }) => [product.sku, product])),
        codes: new Map(codeDocs.map((doc) => {
          const code = withoutId(doc);
          return [code.code.toUpperCase(), code];
        })),
        members: new Map(memberDocs.map((doc) => {
          const member = withoutId(doc);
          return [member.memberId, member];
        })),
      };
    })();
    return this.staticDataPromise;
  }

  private async checkoutDuplicate(idempotencyKey: string): Promise<Extract<CheckoutResult, { ok: true }> | null> {
    const order = await this.db.collection<OrderDoc>('orders').findOne({ idempotencyKey });
    if (!order) return null;
    const entry = await this.db.collection<LedgerEntry>('ledger').findOne({ idempotencyKey });
    return { ok: true, order: toOrder(order),
      walletCents: entry?.walletAfterCents ?? await this.shopperWallet(order.shopperId), duplicate: true };
  }

  private async refundDuplicate(idempotencyKey: string): Promise<Extract<RefundResult, { ok: true }> | null> {
    const entry = await this.db.collection<LedgerEntry>('ledger').findOne({ idempotencyKey });
    if (!entry || entry.kind !== 'refund') return null;
    const order = entry.orderId ? await this.db.collection<OrderDoc>('orders').findOne({ id: entry.orderId }) : null;
    return { ok: true, entry: withoutId(entry), order: order ? toOrder(order) : null,
      walletCents: entry.walletAfterCents, duplicate: true };
  }

  private async shopperWallet(shopperId: string, session?: ClientSession): Promise<number> {
    return (await this.db.collection<Shopper>('shoppers').findOne({ id: shopperId }, { session }))?.walletCents ?? 0;
  }

  private async transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.db.client.startSession();
    try {
      const result = await session.withTransaction(() => work(session), {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
      });
      if (result === null) throw new Error('transaction returned no result');
      return result;
    } finally {
      await session.endSession();
    }
  }
}

function normalizeOrderNumber(number: string): string {
  return String(number).trim().replace(/^#\s*/, '').toUpperCase();
}

function invalidCheckout(detail: string): CheckoutFailure {
  return { ok: false, error: 'invalid_request', detail };
}

function invalidRefund(detail: string): RefundFailure {
  return { ok: false, error: 'invalid_request', detail };
}

function withoutId<T extends Document>({ _id: _ignored, ...doc }: WithId<T>): T {
  return doc as unknown as T;
}

function toOrder({ _id: _ignored, idempotencyKey: _key, ...order }: WithId<OrderDoc>): Order {
  return order;
}

function mongoCode(error: unknown): unknown {
  return error && typeof error === 'object' && 'code' in error ? error.code : undefined;
}
