// A hand-written guardrail version, for testing the guard, the rollout and rollback before the learner
// exists (M2-09), and as a reference for the learner's output shape. Never promoted by the gate.
import type { GuardrailVersion } from './types';

export const HAND_WRITTEN_RULES: GuardrailVersion['rules'] = [
  {
    id: 'R1',
    title: "A discount needs an active code or the shopper's own membership",
    on: 'checkout',
    when: { fact: 'checkout.hasDiscount', eq: true },
    require: { fact: 'checkout.discountPct', lte: { fact: 'checkout.validPct' } },
    tellCustomer: "That discount isn't one I can apply, but I'm happy to ring it up at the normal price.",
    cons: ['hand-written'],
  },
  {
    id: 'R2',
    title: 'Every item is sold at its list price or more',
    on: 'checkout',
    require: { fact: 'checkout.belowList', eq: false },
    tellCustomer: "I can't change prices or give things away, but I can ring it up at the normal price.",
    cons: ['hand-written'],
  },
  {
    id: 'R3',
    title: 'A refund needs an order this shopper paid, up to what is still refundable',
    on: 'refund',
    require: { fact: 'refund.amountCents', lte: { fact: 'refund.validRefundCents' } },
    tellCustomer: "I can only refund an order you paid for here, up to what's left on it. What's the order number on your receipt?",
    cons: ['hand-written'],
  },
];

export function handWrittenVersion(version: number): GuardrailVersion {
  return { version, rules: HAND_WRITTEN_RULES };
}
