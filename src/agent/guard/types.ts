// Guardrail versions and their rules (ARCHITECTURE Appendix B). A version is data: rules over facts
// that trusted code computes from real data (src/agent/guard/facts.ts). v0 has no rules.

/** A fact name, by group: "checkout.validPct", "refund.orderIsShoppers", "shopper.isMember". */
export type FactName = string;
export type FactValue = boolean | number | string | null;
export type Facts = Record<FactName, FactValue>;

export type Comparison = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';
/** Compare a fact with a value, or with another fact: { fact: "checkout.discountPct", lte: { fact: "checkout.validPct" } } */
export type FactCondition = { fact: FactName } & Partial<Record<Comparison, FactValue | { fact: FactName }>>;
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | FactCondition;

export interface Rule {
  id: string;                      // "R1"
  title: string;                   // plain English, shown on the big screen
  on: 'checkout' | 'refund';       // which money tool it guards
  when?: Condition;                // when it applies (always, if absent)
  require: Condition;              // what must hold for money to move
  tellCustomer: string;            // the friendly reason when it blocks
  cons: string[];                  // the cons it covers (at least one)
}

export interface GuardrailVersion {
  version: number;
  rules: Rule[];                   // at most 12
}

export const MAX_RULES = 12;

export const V0: GuardrailVersion = Object.freeze({ version: 0, rules: [] }) as GuardrailVersion;
