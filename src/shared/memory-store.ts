// MemoryStore: StoreApi in plain memory. The stand-in until Kasra's AtlasStore passes the contract
// tests, and the store every evaluation case runs on (a fresh one per case).
// Integrity only, never business rules (ARCHITECTURE Appendix A): stock, wallets, idempotency and a
// complete ledger. Whether a discount, a price or a refund is deserved is the guard's and the auditor's job.
// Every method runs synchronously inside its promise, so each call is atomic on Node's single thread.
import { nanoid } from 'nanoid';
import type {
  CheckoutRequest, CheckoutResult, Code, LedgerEntry, Member, Order, Product, RefundRequest, RefundResult,
  Shopper, StoreApi, StoreId,
} from './contract';
import { discountCents, isValidPct } from './money';
import { makeNickname } from './nickname';
import { CATALOG, CODES, DEFAULT_WALLET_CENTS, isStoreId, MEMBERS, ORDER_PREFIX, STORE_IDS } from './store-data';

export const MAX_QTY = 20;
export const MAX_LINES = 20;
export const MAX_REFUND_CENTS = 60_000;

type Stored =
  | { kind: 'checkout'; result: Extract<CheckoutResult, { ok: true }> }
  | { kind: 'refund'; result: Extract<RefundResult, { ok: true }> };

export interface MemoryStoreOptions {
  /** Starting stock per sku, for every store (defaults to data/catalog.json's). */
  stock?: Partial<Record<string, number>>;
  /** The clock, for tests. */
  now?: () => Date;
}

export class MemoryStore implements StoreApi {
  private readonly products = new Map<string, Product>();
  private readonly stock = new Map<string, number>();           // `${storeId}:${sku}`
  private readonly codes = new Map<string, Code>();             // upper-case code
  private readonly members = new Map<string, Member>();
  private readonly shoppers = new Map<string, Shopper>();
  private readonly orders = new Map<string, Order>();           // by id
  private readonly orderIdByNumber = new Map<string, string>(); // upper-case number
  private readonly ledgerEntries: LedgerEntry[] = [];
  private readonly byKey = new Map<string, Stored>();
  private readonly counters = new Map<StoreId, number>();
  private readonly now: () => Date;

  constructor(options: MemoryStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    for (const { stock, ...product } of CATALOG) {
      this.products.set(product.sku, product);
      for (const storeId of STORE_IDS) this.stock.set(`${storeId}:${product.sku}`, options.stock?.[product.sku] ?? stock);
    }
    for (const code of CODES) this.codes.set(code.code.toUpperCase(), { ...code });
    for (const member of MEMBERS) this.members.set(member.memberId, { ...member });
    for (const storeId of STORE_IDS) this.counters.set(storeId, 1000);
  }

  async catalog(storeId: StoreId): Promise<(Product & { stock: number })[]> {
    return [...this.products.values()].map((p) => ({ ...p, stock: this.stock.get(`${storeId}:${p.sku}`) ?? 0 }));
  }

  async product(sku: string): Promise<Product | null> {
    const p = this.products.get(sku);
    return p ? { ...p } : null;
  }

  async code(code: string): Promise<Code | null> {
    const c = this.codes.get(String(code).trim().toUpperCase());
    return c ? { ...c } : null;
  }

  async member(memberId: string): Promise<Member | null> {
    const m = this.members.get(String(memberId).trim());
    return m ? { ...m } : null;
  }

  async createShopper(input: { storeId: StoreId; kind: Shopper['kind']; nickname?: string;
    walletCents?: number; memberId?: string | null }): Promise<Shopper> {
    if (!isStoreId(input.storeId)) throw new Error(`unknown store: ${input.storeId}`);
    const walletCents = input.walletCents ?? DEFAULT_WALLET_CENTS;
    if (!Number.isInteger(walletCents) || walletCents < 0) throw new Error(`bad walletCents: ${walletCents}`);
    const shopper: Shopper = {
      id: nanoid(),
      nickname: input.nickname ?? makeNickname(),
      storeId: input.storeId,
      walletCents: 0,                       // the grant below credits it
      memberId: input.memberId ?? null,
      kind: input.kind,
      createdAt: this.now(),
    };
    this.shoppers.set(shopper.id, shopper);
    this.record({ kind: 'grant', shopper, deltaCents: walletCents, orderId: null, claimedOrderNumber: null,
      idempotencyKey: `grant:${shopper.id}`, reason: 'welcome credit', conversationId: null, guardVersion: null });
    return { ...shopper };
  }

  async shopper(id: string): Promise<Shopper | null> {
    const s = this.shoppers.get(id);
    return s ? { ...s } : null;
  }

  async orderByNumber(number: string): Promise<Order | null> {
    const id = this.orderIdByNumber.get(normalizeOrderNumber(number));
    return id ? copyOrder(this.orders.get(id)!) : null;
  }

  async ordersFor(shopperId: string): Promise<Order[]> {
    return [...this.orders.values()].filter((o) => o.shopperId === shopperId).map(copyOrder);
  }

  async checkout(req: CheckoutRequest): Promise<CheckoutResult> {
    const previous = this.byKey.get(req?.idempotencyKey);
    if (previous) {
      if (previous.kind !== 'checkout') return invalid('idempotencyKey was already used for a refund');
      return { ...previous.result, order: copyOrder(previous.result.order), duplicate: true };
    }
    if (!isStoreId(req?.storeId)) return invalid('unknown storeId');
    if (typeof req.idempotencyKey !== 'string' || !req.idempotencyKey) return invalid('idempotencyKey is required');
    const shopper = this.shoppers.get(req.shopperId);
    if (!shopper) return invalid('unknown shopperId');
    if (!Array.isArray(req.items) || req.items.length === 0 || req.items.length > MAX_LINES) {
      return invalid(`items must have 1 to ${MAX_LINES} lines`);
    }

    const lines: Order['lines'] = [];
    const wanted = new Map<string, number>();
    for (const item of req.items) {
      if (!Number.isInteger(item?.qty) || item.qty < 1 || item.qty > MAX_QTY) return invalid(`qty must be 1 to ${MAX_QTY}`);
      const product = this.products.get(item.sku);
      if (!product) return { ok: false, error: 'unknown_sku', detail: `no product "${item.sku}"` };
      const unit = item.unitPriceCents ?? product.priceCents;
      if (!Number.isInteger(unit) || unit < 0) return invalid('unitPriceCents must be a whole number of cents, 0 or more');
      lines.push({ sku: product.sku, qty: item.qty, listPriceCents: product.priceCents, unitPriceCents: unit });
      wanted.set(product.sku, (wanted.get(product.sku) ?? 0) + item.qty);
    }
    if (req.discount !== undefined && req.discount !== null) {
      if (!isValidPct(req.discount.pct)) return invalid('discount.pct must be more than 0 and at most 100');
      if (typeof req.discount.reason !== 'string') return invalid('discount.reason is required');
    }

    const subtotalCents = lines.reduce((sum, l) => sum + l.qty * l.unitPriceCents, 0);
    const discount = req.discount ? { ...req.discount, cents: discountCents(subtotalCents, req.discount.pct) } : null;
    const totalCents = subtotalCents - (discount?.cents ?? 0);

    for (const [sku, qty] of wanted) {
      const left = this.stock.get(`${req.storeId}:${sku}`) ?? 0;
      if (left < qty) return { ok: false, error: 'out_of_stock', detail: `only ${left} ${sku} left` };
    }
    if (shopper.walletCents < totalCents) {
      return { ok: false, error: 'insufficient_funds', detail: `the wallet has ${shopper.walletCents} cents, the total is ${totalCents}` };
    }

    // Everything checks out: stock, wallet, order and ledger change together.
    for (const [sku, qty] of wanted) this.stock.set(`${req.storeId}:${sku}`, this.stock.get(`${req.storeId}:${sku}`)! - qty);
    const order = this.addOrder({ storeId: req.storeId, shopperId: shopper.id, lines, discount, subtotalCents, totalCents,
      conversationId: req.conversationId ?? null, guardVersion: req.guardVersion ?? null });
    this.record({ kind: 'sale', shopper, storeId: req.storeId, deltaCents: -totalCents, orderId: order.id, claimedOrderNumber: null,
      idempotencyKey: req.idempotencyKey, reason: discount?.reason ?? null,
      conversationId: order.conversationId, guardVersion: order.guardVersion });
    const result = { ok: true as const, order: copyOrder(order), walletCents: shopper.walletCents, duplicate: false };
    this.byKey.set(req.idempotencyKey, { kind: 'checkout', result });
    return { ...result, order: copyOrder(order) };
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    const previous = this.byKey.get(req?.idempotencyKey);
    if (previous) {
      if (previous.kind !== 'refund') return { ok: false, error: 'invalid_request', detail: 'idempotencyKey was already used for a checkout' };
      const { order } = previous.result;
      return { ...previous.result, entry: { ...previous.result.entry }, order: order ? copyOrder(order) : null, duplicate: true };
    }
    if (!isStoreId(req?.storeId)) return { ok: false, error: 'invalid_request', detail: 'unknown storeId' };
    if (typeof req.idempotencyKey !== 'string' || !req.idempotencyKey) return { ok: false, error: 'invalid_request', detail: 'idempotencyKey is required' };
    const shopper = this.shoppers.get(req.shopperId);
    if (!shopper) return { ok: false, error: 'invalid_request', detail: 'unknown shopperId' };
    if (!Number.isInteger(req.amountCents) || req.amountCents < 1 || req.amountCents > MAX_REFUND_CENTS) {
      return { ok: false, error: 'invalid_amount', detail: `amountCents must be a whole number from 1 to ${MAX_REFUND_CENTS}` };
    }

    // Refunds never fail for business reasons: an unknown or already refunded order still credits
    // the wallet, and claimedOrderNumber keeps what was claimed for the auditor.
    const claimed = typeof req.orderNumber === 'string' && req.orderNumber.trim() ? req.orderNumber.trim() : null;
    const matchedId = claimed ? this.orderIdByNumber.get(normalizeOrderNumber(claimed)) : undefined;
    const order = matchedId ? this.orders.get(matchedId)! : null;
    if (order) {
      order.refundedCents = Math.min(order.totalCents, order.refundedCents + req.amountCents);
      order.status = order.refundedCents >= order.totalCents ? 'refunded' : order.refundedCents > 0 ? 'partially_refunded' : 'paid';
    }
    const entry = this.record({ kind: 'refund', shopper, storeId: req.storeId, deltaCents: req.amountCents, orderId: order?.id ?? null,
      claimedOrderNumber: claimed, idempotencyKey: req.idempotencyKey, reason: typeof req.reason === 'string' ? req.reason : null,
      conversationId: req.conversationId ?? null, guardVersion: req.guardVersion ?? null });
    const result = { ok: true as const, entry: { ...entry }, order: order ? copyOrder(order) : null, walletCents: shopper.walletCents, duplicate: false };
    this.byKey.set(req.idempotencyKey, { kind: 'refund', result });
    return { ...result, entry: { ...entry }, order: order ? copyOrder(order) : null };
  }

  /** A past purchase for test setup: a paid order at list price that leaves the wallet as it was
   *  (a grant and a sale of the same amount, so the wallet still equals its ledger). Takes stock. */
  async seedPaidOrder(shopperId: string, items: { sku: string; qty: number }[]): Promise<Order> {
    const shopper = this.shoppers.get(shopperId);
    if (!shopper) throw new Error(`unknown shopper: ${shopperId}`);
    const lines = items.map((item) => {
      const product = this.products.get(item.sku);
      if (!product) throw new Error(`unknown sku: ${item.sku}`);
      if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > MAX_QTY) throw new Error(`bad qty: ${item.qty}`);
      return { sku: product.sku, qty: item.qty, listPriceCents: product.priceCents, unitPriceCents: product.priceCents };
    });
    for (const line of lines) {
      const key = `${shopper.storeId}:${line.sku}`;
      const left = this.stock.get(key) ?? 0;
      if (left < line.qty) throw new Error(`only ${left} ${line.sku} left`);
      this.stock.set(key, left - line.qty);
    }
    const subtotalCents = lines.reduce((sum, l) => sum + l.qty * l.unitPriceCents, 0);
    const order = this.addOrder({ storeId: shopper.storeId, shopperId, lines, discount: null, subtotalCents,
      totalCents: subtotalCents, conversationId: null, guardVersion: null });
    const common = { shopper, orderId: order.id, claimedOrderNumber: null, conversationId: null, guardVersion: null };
    this.record({ ...common, kind: 'grant', deltaCents: subtotalCents, idempotencyKey: `seed-grant:${order.id}`, reason: 'test setup: a past purchase' });
    this.record({ ...common, kind: 'sale', deltaCents: -subtotalCents, idempotencyKey: `seed-sale:${order.id}`, reason: 'test setup: a past purchase' });
    return copyOrder(order);
  }

  // ── Beyond StoreApi: for tests and the evaluation's scorer ──

  /** Every ledger entry, oldest first (only this shopper's when given). */
  ledger(shopperId?: string): LedgerEntry[] {
    return this.ledgerEntries.filter((e) => !shopperId || e.shopperId === shopperId).map((e) => ({ ...e }));
  }

  private addOrder(input: Omit<Order, 'id' | 'number' | 'refundedCents' | 'status' | 'createdAt'>): Order {
    const n = this.counters.get(input.storeId)! + 1;
    this.counters.set(input.storeId, n);
    const order: Order = { id: nanoid(), number: `${ORDER_PREFIX[input.storeId]}-${n}`, ...input,
      refundedCents: 0, status: 'paid', createdAt: this.now() };
    this.orders.set(order.id, order);
    this.orderIdByNumber.set(normalizeOrderNumber(order.number), order.id);
    return order;
  }

  private record(input: { kind: LedgerEntry['kind']; shopper: Shopper; storeId?: StoreId; deltaCents: number; orderId: string | null;
    claimedOrderNumber: string | null; idempotencyKey: string; reason: string | null;
    conversationId: string | null; guardVersion: number | null }): LedgerEntry {
    input.shopper.walletCents += input.deltaCents;
    const entry: LedgerEntry = {
      id: nanoid(), kind: input.kind, storeId: input.storeId ?? input.shopper.storeId, shopperId: input.shopper.id,
      orderId: input.orderId, claimedOrderNumber: input.claimedOrderNumber,
      walletDeltaCents: input.deltaCents, walletAfterCents: input.shopper.walletCents,
      idempotencyKey: input.idempotencyKey, reason: input.reason,
      conversationId: input.conversationId, guardVersion: input.guardVersion, at: this.now(),
    };
    this.ledgerEntries.push(entry);
    return entry;
  }
}

/** "#q-1042 " -> "Q-1042" */
export function normalizeOrderNumber(number: string): string {
  return String(number).trim().replace(/^#\s*/, '').toUpperCase();
}

function invalid(detail: string): CheckoutResult {
  return { ok: false, error: 'invalid_request', detail };
}

function copyOrder(order: Order): Order {
  return { ...order, lines: order.lines.map((l) => ({ ...l })), discount: order.discount ? { ...order.discount } : null };
}
