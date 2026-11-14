// The guard's hook at the money step: every money call passes through checkMoneyCall before the store
// moves anything. v0 has no rules, so everything passes. M2-02 evaluates the version's rules over the
// facts (src/agent/guard/facts.ts): a failed discount rule caps the discount at the valid percentage,
// any other failed rule blocks.
import type { CheckoutRequest, RefundRequest, StoreApi, StoreId } from '../../shared/contract';
import type { GuardrailVersion, Rule } from './types';

export type MoneyCall =
  | { tool: 'checkout'; request: CheckoutRequest }
  | { tool: 'refund'; request: RefundRequest };

export interface MoneyContext {
  store: StoreApi;
  storeId: StoreId;
  shopperId: string;
  conversationId: string;
}

export type GuardDecision =
  | { action: 'pass' }
  | { action: 'cap'; pct: number; rule: Rule }      // checkout only: the discount is lowered to pct (0 = none)
  | { action: 'block'; rule: Rule };

export async function checkMoneyCall(version: GuardrailVersion, _call: MoneyCall, _ctx: MoneyContext): Promise<GuardDecision> {
  if (version.rules.length === 0) return { action: 'pass' };
  return { action: 'pass' };   // M2-02: evaluate the rules
}
