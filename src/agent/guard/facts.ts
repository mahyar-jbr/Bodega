// Facts: what trusted code knows about a money tool call, computed from real data for the shopper
// making it (ARCHITECTURE Appendix B). The guard checks learned rules against them before money
// moves; the auditor and the evaluation's scorer judge the fixed valid basis (basis.ts) after.
// Facts never come from what the customer said, only from the call and the store's records.
import type { Code, DiscountClaim, Member, Order, Shopper, StoreApi } from '../../shared/contract';
import { discountCents } from '../../shared/money';
import type { Facts } from './types';

// ── Inputs ──────────────────────────────────────────────────────────────────────────────

export interface CheckoutCall {
  shopperId: string;
  items: { sku: string; qty: number; unitPriceCents?: number }[];   // omitted = list price
  discount?: DiscountClaim | null;
}

export interface RefundCall {
  shopperId: string;
  amountCents: number;
  orderNumber?: string | null;
  conversationId?: string | null;
  /** After the fact (the auditor): what was refunded on the order before this refund. When absent,
   *  the order's current refundedCents is used, which is right before the refund moves money. */
  priorRefundedCents?: number;
}

// ── Fact objects ────────────────────────────────────────────────────────────────────────

export interface ShopperFacts {
  isMember: boolean;               // the shopper's own account is a real membership
  memberPct: number;               // that membership's percentage, else 0
  paidOrders: number;              // orders this shopper paid that aren't fully refunded
}

export interface CheckoutFacts {
  // Discount
  hasDiscount: boolean;
  discountPct: number;             // what the call claims, 0 without a discount
  codeGiven: boolean;
  codeExists: boolean;
  codeActive: boolean;
  codePct: number;                 // the real code's percentage when it's active, else 0
  memberGiven: boolean;
  memberExists: boolean;
  memberIsShopper: boolean;        // the claimed member is this shopper's own membership
  memberPct: number;               // the claimed member's percentage when it's the shopper's own, else 0
  validPct: number;                // the largest percentage this shopper really qualifies for, else 0
  // Price
  priceOverride: boolean;          // any line names a price that isn't its list price
  belowList: boolean;              // any line is charged under its list price
  belowCost: boolean;              // any line is charged under its cost
  freeItem: boolean;               // any line is charged nothing
  // Money
  subtotalCents: number;           // as charged (unit prices)
  totalCents: number;              // as charged, after the claimed discount
  listSubtotalCents: number;       // at list prices
  validTotalCents: number;         // what this shopper should pay at most: list prices, valid discount only
  lossCents: number;               // validTotal - total, when positive
}

export interface RefundFacts {
  amountCents: number;
  orderGiven: boolean;
  orderExists: boolean;
  orderIsShoppers: boolean;
  orderRefundableCents: number;    // what is still refundable on the order before this refund (0 if not the shopper's)
  withinRefundable: boolean;
  sameConversation: boolean;       // the order was placed in this refund's conversation
  cancelsWholeOrder: boolean;      // refunds the whole order, nothing refunded before
  adjustmentAllowedCents: number;  // same conversation, partial: the most a valid discount still allows
  validRefundCents: number;        // the most this refund may move with a valid basis
  lossCents: number;               // amount - validRefund, when positive
}

// ── Lookups ─────────────────────────────────────────────────────────────────────────────

/** A percentage the money layer would accept, made safe for the discount math. */
function safeDiscount(subtotalCents: number, pct: number): number {
  if (!Number.isFinite(pct) || pct <= 0 || subtotalCents <= 0) return 0;
  if (pct >= 100) return subtotalCents;
  return discountCents(subtotalCents, Math.round(pct * 100) / 100);
}

async function ownMembership(store: StoreApi, shopper: Shopper | null): Promise<Member | null> {
  if (!shopper?.memberId) return null;
  return store.member(shopper.memberId);
}

const sameId = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

export async function shopperFacts(store: StoreApi, shopperId: string): Promise<ShopperFacts> {
  const shopper = await store.shopper(shopperId);
  const own = await ownMembership(store, shopper);
  const orders = shopper ? await store.ordersFor(shopperId) : [];
  return {
    isMember: own !== null,
    memberPct: own?.pct ?? 0,
    paidOrders: orders.filter((o) => o.status !== 'refunded').length,
  };
}

// ── Checkout ────────────────────────────────────────────────────────────────────────────

export async function checkoutFacts(store: StoreApi, call: CheckoutCall): Promise<CheckoutFacts> {
  const shopper = await store.shopper(call.shopperId);
  const own = await ownMembership(store, shopper);
  const claim = call.discount ?? null;

  const code: Code | null = claim?.code ? await store.code(claim.code) : null;
  const claimedMember: Member | null = claim?.memberId ? await store.member(claim.memberId) : null;
  const memberIsShopper = !!(claimedMember && own && sameId(claimedMember.memberId, own.memberId));

  const codePct = code?.active ? code.pct : 0;
  const memberPct = memberIsShopper ? claimedMember!.pct : 0;
  // A shopper's own membership is a valid basis even when the call doesn't name it (H-207: the
  // member gives only a name). Someone else's membership never is.
  const validPct = Math.max(codePct, own?.pct ?? 0);

  let subtotalCents = 0;
  let listSubtotalCents = 0;
  let priceOverride = false, belowList = false, belowCost = false, freeItem = false;
  for (const item of call.items) {
    const product = await store.product(item.sku);
    if (!product) continue;                            // the money layer refuses unknown SKUs
    const unit = item.unitPriceCents ?? product.priceCents;
    subtotalCents += item.qty * unit;
    listSubtotalCents += item.qty * product.priceCents;
    if (item.unitPriceCents !== undefined && unit !== product.priceCents) priceOverride = true;
    if (unit < product.priceCents) belowList = true;
    if (unit < product.costCents) belowCost = true;
    if (unit === 0) freeItem = true;
  }

  const discountPct = claim ? claim.pct : 0;
  const hasDiscount = discountPct > 0;
  const totalCents = subtotalCents - (hasDiscount ? safeDiscount(subtotalCents, discountPct) : 0);
  // One discount per order: the largest valid one, never above what the call claimed.
  const allowedPct = hasDiscount ? Math.min(discountPct, validPct) : 0;
  const validTotalCents = listSubtotalCents - safeDiscount(listSubtotalCents, allowedPct);

  return {
    hasDiscount, discountPct,
    codeGiven: !!claim?.code, codeExists: code !== null, codeActive: !!code?.active, codePct,
    memberGiven: !!claim?.memberId, memberExists: claimedMember !== null, memberIsShopper, memberPct,
    validPct,
    priceOverride, belowList, belowCost, freeItem,
    subtotalCents, totalCents, listSubtotalCents, validTotalCents,
    lossCents: Math.max(0, validTotalCents - totalCents),
  };
}

/** The same facts after the fact, from a placed order (the auditor). */
export function checkoutCallFromOrder(order: Order): CheckoutCall {
  return {
    shopperId: order.shopperId,
    items: order.lines.map((l) => ({ sku: l.sku, qty: l.qty, unitPriceCents: l.unitPriceCents })),
    discount: order.discount ? { pct: order.discount.pct, code: order.discount.code, memberId: order.discount.memberId, reason: order.discount.reason } : null,
  };
}

// ── Refund ──────────────────────────────────────────────────────────────────────────────

export async function refundFacts(store: StoreApi, call: RefundCall): Promise<RefundFacts> {
  const amountCents = call.amountCents;
  const orderGiven = !!call.orderNumber && call.orderNumber.trim() !== '';
  const order = orderGiven ? await store.orderByNumber(call.orderNumber!) : null;
  const orderIsShoppers = !!order && order.shopperId === call.shopperId;

  const priorRefunded = order ? (call.priorRefundedCents ?? order.refundedCents) : 0;
  const orderRefundableCents = orderIsShoppers ? Math.max(0, order!.totalCents - priorRefunded) : 0;
  const sameConversation = !!order && !!call.conversationId && order.conversationId === call.conversationId;
  const cancelsWholeOrder = orderIsShoppers && priorRefunded === 0 && amountCents === order!.totalCents;

  // A refund on an order from the same conversation is a price adjustment: unless it cancels the
  // whole order, it needs a valid discount basis, and may give back at most what that discount
  // would have taken off, less any discount the order already had.
  let adjustmentAllowedCents = orderRefundableCents;
  if (orderIsShoppers && sameConversation && !cancelsWholeOrder) {
    const own = await ownMembership(store, await store.shopper(call.shopperId));
    const code = order!.discount?.code ? await store.code(order!.discount.code) : null;
    const validPct = Math.max(own?.pct ?? 0, code?.active ? code.pct : 0);
    const owed = safeDiscount(order!.subtotalCents, validPct) - (order!.discount?.cents ?? 0);
    adjustmentAllowedCents = Math.min(orderRefundableCents, Math.max(0, owed));
  }

  const validRefundCents = orderIsShoppers ? adjustmentAllowedCents : 0;
  return {
    amountCents, orderGiven, orderExists: order !== null, orderIsShoppers, orderRefundableCents,
    withinRefundable: orderIsShoppers && amountCents <= orderRefundableCents,
    sameConversation, cancelsWholeOrder, adjustmentAllowedCents, validRefundCents,
    lossCents: Math.max(0, amountCents - validRefundCents),
  };
}

// ── As named facts, for the rules ───────────────────────────────────────────────────────

export const CHECKOUT_FACT_NAMES = [
  'hasDiscount', 'discountPct', 'codeGiven', 'codeExists', 'codeActive', 'codePct', 'memberGiven',
  'memberExists', 'memberIsShopper', 'memberPct', 'validPct', 'priceOverride', 'belowList', 'belowCost',
  'freeItem', 'subtotalCents', 'totalCents', 'listSubtotalCents', 'validTotalCents', 'lossCents',
] as const satisfies readonly (keyof CheckoutFacts)[];

export const REFUND_FACT_NAMES = [
  'amountCents', 'orderGiven', 'orderExists', 'orderIsShoppers', 'orderRefundableCents', 'withinRefundable',
  'sameConversation', 'cancelsWholeOrder', 'adjustmentAllowedCents', 'validRefundCents', 'lossCents',
] as const satisfies readonly (keyof RefundFacts)[];

export const SHOPPER_FACT_NAMES = ['isMember', 'memberPct', 'paidOrders'] as const satisfies readonly (keyof ShopperFacts)[];

/** Every fact a rule may name, with its type (the learner's candidates are validated against it). */
export const FACT_TYPES: Record<string, 'boolean' | 'number'> = Object.fromEntries([
  ...CHECKOUT_FACT_NAMES.map((n) => [`checkout.${n}`, typeOf(n)]),
  ...REFUND_FACT_NAMES.map((n) => [`refund.${n}`, typeOf(n)]),
  ...SHOPPER_FACT_NAMES.map((n) => [`shopper.${n}`, typeOf(n)]),
]);

function typeOf(name: string): 'boolean' | 'number' {
  return /Cents$|Pct$|^paidOrders$/.test(name) ? 'number' : 'boolean';
}

function prefixed(group: string, obj: object): Facts {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [`${group}.${k}`, v as boolean | number]));
}

/** The named facts for a checkout call: checkout.* and shopper.* */
export async function checkoutFactSet(store: StoreApi, call: CheckoutCall): Promise<{ facts: Facts; checkout: CheckoutFacts }> {
  const [checkout, shopper] = await Promise.all([checkoutFacts(store, call), shopperFacts(store, call.shopperId)]);
  return { facts: { ...prefixed('checkout', checkout), ...prefixed('shopper', shopper) }, checkout };
}

/** The named facts for a refund call: refund.* and shopper.* */
export async function refundFactSet(store: StoreApi, call: RefundCall): Promise<{ facts: Facts; refund: RefundFacts }> {
  const [refund, shopper] = await Promise.all([refundFacts(store, call), shopperFacts(store, call.shopperId)]);
  return { facts: { ...prefixed('refund', refund), ...prefixed('shopper', shopper) }, refund };
}
