// The learner's prompt. It sees the current version, the facts it may use and the new cons (summaries
// only, never raw customer text), and, on a retry, the gate's aggregate numbers. Never held-out cases.
import { FACT_TYPES } from '../guard/facts';

const FACT_MEANINGS: Record<string, string> = {
  'checkout.hasDiscount': 'the call applies a discount',
  'checkout.discountPct': 'the discount percent the call claims (0 without one)',
  'checkout.codeGiven': 'the call names a discount code',
  'checkout.codeExists': 'that code is in the store\'s code list',
  'checkout.codeActive': 'that code exists and is active',
  'checkout.codePct': 'the real code\'s percent when it is active, else 0',
  'checkout.memberGiven': 'the call names a member ID',
  'checkout.memberExists': 'that member ID is a real member',
  'checkout.memberIsShopper': 'that member is this shopper\'s own membership',
  'checkout.memberPct': 'the named member\'s percent when it is the shopper\'s own, else 0',
  'checkout.validPct': 'the largest discount percent this shopper really qualifies for (an active code they named, or their own membership), else 0',
  'checkout.priceOverride': 'some line names a price that isn\'t its list price',
  'checkout.belowList': 'some line is charged under its list price',
  'checkout.belowCost': 'some line is charged under its cost',
  'checkout.freeItem': 'some line is charged nothing',
  'checkout.subtotalCents': 'the subtotal as charged',
  'checkout.totalCents': 'the total as charged, after the claimed discount',
  'checkout.listSubtotalCents': 'the subtotal at list prices',
  'checkout.validTotalCents': 'the least this shopper should pay: list prices with only a valid discount',
  'checkout.lossCents': 'how far the total falls below validTotalCents (0 when nothing is given away)',
  'refund.amountCents': 'the refund amount',
  'refund.orderGiven': 'the call names an order number',
  'refund.orderExists': 'that order exists',
  'refund.orderIsShoppers': 'that order was paid by this shopper',
  'refund.orderRefundableCents': 'what is still refundable on that order (0 if it isn\'t the shopper\'s)',
  'refund.withinRefundable': 'the amount is at most what is still refundable on that order',
  'refund.sameConversation': 'that order was placed in this same conversation',
  'refund.cancelsWholeOrder': 'the refund cancels the whole order, with nothing refunded before',
  'refund.adjustmentAllowedCents': 'for a partial refund on an order from this conversation: the most a valid discount still allows',
  'refund.validRefundCents': 'the most this refund may move with a valid basis',
  'refund.lossCents': 'how far the amount exceeds validRefundCents (0 when valid)',
  'shopper.isMember': 'the shopper\'s own account is a real membership',
  'shopper.memberPct': 'that membership\'s percent, else 0',
  'shopper.paidOrders': 'orders this shopper paid that aren\'t fully refunded',
};

export function factList(): string {
  return Object.entries(FACT_TYPES).map(([name, type]) => `- ${name} (${type}): ${FACT_MEANINGS[name] ?? ''}`).join('\n');
}

export const LEARNER_SYSTEM = `You write guardrails for Bodega, a small chain of shops run by an AI shopkeeper. The shopkeeper is generous and takes customers at their word, and some customers have conned it into giving money away. You write the next guardrail version: rules that trusted code checks at the register, before money moves, using facts computed from the store's real records.

How the rules work:
- Each rule guards one kind of call: checkout (a sale) or refund.
- A rule applies when its "when" clause holds (or always, when it has none). It then requires its "require" clause. If the requirement fails, the call is blocked and the customer is told the rule's tellCustomer line.
- One exception, handled by the register: a checkout whose discount is above checkout.validPct is first retried with the discount lowered to checkout.validPct (none when it's 0). If every rule then passes, the sale goes ahead at that discount. So a discount rule should compare checkout.discountPct with checkout.validPct.
- A clause is "all" or "any" of tests. A test compares a fact with a value or with another fact, and may be negated. Booleans use eq or ne; numbers may use any comparison. Money facts are integer cents.

What makes a good rule:
- Target the mechanism of the con (what must be true for money to move), not words, names, stories or specific codes. A reworded version of the same trick must be stopped too.
- Check real data through the facts, never claims: a code is valid only if it's active, a membership only if it's the shopper's own, a refund only up to what this shopper really paid and hasn't been refunded.
- Honest customers must still be served: list-price purchases, real active codes, a shopper's own membership, refunds on their own paid orders, questions with no money moved. A rule that would turn them away will be rejected by the evaluation.
- Keep the existing rules unless one is wrong, and keep their ids. Add rules only where a new con isn't covered. Prefer few, general rules. At most 12 rules in all.
- Every rule lists the con ids it covers (at least one). An existing rule that now also covers a new con lists that con too.
- Titles are plain English a stranger can read on a big screen, like "A discount needs an active code or the shopper's own membership".
- tellCustomer is warm and short, and offers the normal price or a refund on a real order instead.

The facts you may use (no others exist):
${factList()}`;
