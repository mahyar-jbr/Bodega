// The guard: every money call passes through checkMoneyCall before the store moves anything. It
// evaluates the version's rules over facts computed from real data (./facts.ts, never from what the
// customer said). v0 has no rules, so everything passes.
// A failed rule blocks the call, except a discount above checkout.validPct: the guard re-checks the
// call with the discount capped at validPct (no discount when it's 0), and if every rule then
// passes, the sale goes ahead at the capped discount. So an honest member whose tier was guessed
// wrong is still served at the right price, and a fake code still gains nothing.
import type { CheckoutRequest, RefundRequest, StoreApi, StoreId } from '../../shared/contract';
import { checkoutFactSet, refundFactSet } from './facts';
import { failingRules, RuleError, rulesFor } from './rules';
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

export async function checkMoneyCall(version: GuardrailVersion, call: MoneyCall, ctx: MoneyContext): Promise<GuardDecision> {
  const rules = rulesFor(version, call.tool);
  if (rules.length === 0) return { action: 'pass' };
  try {
    if (call.tool === 'refund') {
      const r = call.request;
      const { facts } = await refundFactSet(ctx.store, { shopperId: r.shopperId, amountCents: r.amountCents,
        orderNumber: r.orderNumber ?? null, conversationId: r.conversationId ?? ctx.conversationId });
      const failed = failingRules(rules, facts);
      return failed.length === 0 ? { action: 'pass' } : { action: 'block', rule: failed[0]! };
    }

    const r = call.request;
    const { facts, checkout } = await checkoutFactSet(ctx.store, { shopperId: r.shopperId, items: r.items, discount: r.discount ?? null });
    const failed = failingRules(rules, facts);
    if (failed.length === 0) return { action: 'pass' };
    if (checkout.hasDiscount && checkout.discountPct > checkout.validPct) {
      const pct = checkout.validPct;
      const capped = await checkoutFactSet(ctx.store, { shopperId: r.shopperId, items: r.items,
        discount: pct > 0 && r.discount ? { ...r.discount, pct } : null });
      const stillFailing = failingRules(rules, capped.facts);
      if (stillFailing.length === 0) return { action: 'cap', pct, rule: failed[0]! };
      return { action: 'block', rule: stillFailing[0]! };
    }
    return { action: 'block', rule: failed[0]! };
  } catch (error) {
    // A version is validated before any store applies it, so this shouldn't happen. If it does,
    // the broken version must not stop honest customers: let the call through and say so.
    if (error instanceof RuleError) {
      console.error(`guard: version ${version.version} has a broken rule (${error.message}); passing the call`);
      return { action: 'pass' };
    }
    throw error;
  }
}
