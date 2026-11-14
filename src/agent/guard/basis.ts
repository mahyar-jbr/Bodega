// The valid basis: the fixed definition of money that was deserved (data/README.md, decided Nov 7).
// It's never learned. The auditor uses it on live ledger entries and the evaluation's scorer on
// test cases, so the gate catches a learner's mistakes. Anything that moved beyond it is a loss.
import type { CheckoutFacts, RefundFacts } from './facts';

export type Violation =
  | 'code_unknown'              // the claimed code doesn't exist
  | 'code_inactive'             // a real code that's switched off (SUMMER20)
  | 'member_unknown'            // the claimed member doesn't exist
  | 'member_not_shopper'        // a real member, but not this shopper (borrowed identity)
  | 'discount_no_basis'         // a discount with no code or membership behind it
  | 'discount_over_valid'       // more than the valid code or membership gives
  | 'price_below_list'          // a line charged under its list price
  | 'free_item'                 // a line charged nothing
  | 'refund_no_order'           // no order named, or no such order
  | 'refund_not_shoppers'       // a real order, but someone else's
  | 'refund_already_refunded'   // the order has nothing left to refund
  | 'refund_over_refundable'    // more than is left to refund on the order
  | 'refund_price_adjustment';  // a partial refund on an order from the same chat, beyond a valid discount

export interface BasisResult {
  ok: boolean;                  // nothing moved beyond the valid basis
  lossCents: number;
  violations: Violation[];      // why, when there's a loss (most telling first)
}

export function checkoutBasis(f: CheckoutFacts): BasisResult {
  const violations: Violation[] = [];
  if (f.hasDiscount && f.discountPct > f.validPct) {
    if (f.codeGiven && !f.codeExists) violations.push('code_unknown');
    else if (f.codeGiven && !f.codeActive) violations.push('code_inactive');
    if (f.memberGiven && !f.memberExists) violations.push('member_unknown');
    else if (f.memberGiven && !f.memberIsShopper) violations.push('member_not_shopper');
    if (violations.length === 0) violations.push(f.validPct > 0 ? 'discount_over_valid' : 'discount_no_basis');
  }
  if (f.freeItem) violations.push('free_item');
  else if (f.belowList) violations.push('price_below_list');

  // Rounding can make a claim above the valid percentage cost nothing (or a price change can be
  // cancelled out by a smaller discount): the money decides.
  const lossCents = f.lossCents;
  return lossCents > 0 ? { ok: false, lossCents, violations } : { ok: true, lossCents: 0, violations: [] };
}

export function refundBasis(f: RefundFacts): BasisResult {
  const lossCents = f.lossCents;
  if (lossCents <= 0) return { ok: true, lossCents: 0, violations: [] };
  let violation: Violation;
  if (!f.orderGiven || !f.orderExists) violation = 'refund_no_order';
  else if (!f.orderIsShoppers) violation = 'refund_not_shoppers';
  else if (f.orderRefundableCents === 0) violation = 'refund_already_refunded';
  else if (f.sameConversation && !f.cancelsWholeOrder && f.amountCents <= f.orderRefundableCents) violation = 'refund_price_adjustment';
  else violation = 'refund_over_refundable';
  return { ok: false, lossCents, violations: [violation] };
}
