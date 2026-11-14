// The learner's output: the complete next guardrail version, as strict structured output. Structured
// outputs can't be recursive, so a condition is a clause (all or any) of fact tests, each optionally
// negated, which converts to the guard's condition format. Fact names are an enum, so the model can
// only name facts that exist.
import { z } from 'zod';
import { FACT_TYPES } from '../guard/facts';
import type { Condition, FactCondition, Rule } from '../guard/types';

const FACT_NAMES = Object.keys(FACT_TYPES) as [string, ...string[]];

const Test = z.object({
  fact: z.enum(FACT_NAMES),
  op: z.enum(['eq', 'ne', 'lt', 'lte', 'gt', 'gte']),
  value: z.union([z.number(), z.boolean(), z.null()]).describe('Compare with this value, or null when comparing with another fact'),
  compareToFact: z.union([z.enum(FACT_NAMES), z.null()]).describe('Compare with this fact, or null when comparing with a value'),
  negate: z.boolean().describe('true to require the opposite of this test'),
});

const Clause = z.object({
  match: z.enum(['all', 'any']).describe('all: every test must hold; any: at least one'),
  tests: z.array(Test).describe('One or more tests'),
});

export const LearnedRule = z.object({
  id: z.string().describe('Short id like R1, R2; keep the ids of rules you keep'),
  title: z.string().describe('Plain English, under 90 characters: what must be true for money to move'),
  on: z.enum(['checkout', 'refund']),
  when: z.union([Clause, z.null()]).describe('When the rule applies; null means always'),
  require: Clause.describe('What must hold for the money to move'),
  tellCustomer: z.string().describe('A short, friendly line for the customer when the rule stops the call'),
  cons: z.array(z.string()).describe('The ids of the cons this rule covers (at least one)'),
});

export const LearnedVersion = z.object({
  title: z.string().describe('Under 80 characters: what this version learned'),
  rules: z.array(LearnedRule).describe('Every rule of the new version: the ones kept and the new ones'),
});
export type LearnedVersion = z.infer<typeof LearnedVersion>;

type TestT = z.infer<typeof Test>;
type ClauseT = z.infer<typeof Clause>;

function testToCondition(t: TestT): Condition {
  const leaf = { fact: t.fact, [t.op]: t.compareToFact !== null ? { fact: t.compareToFact } : t.value } as FactCondition;
  return t.negate ? { not: leaf } : leaf;
}

function clauseToCondition(c: ClauseT): Condition {
  const parts = c.tests.map(testToCondition);
  if (parts.length === 1) return parts[0]!;
  return c.match === 'all' ? { all: parts } : { any: parts };
}

/** Problems the schema can't catch, before the guard's own validation. */
export function shapeProblems(v: LearnedVersion): string[] {
  const problems: string[] = [];
  v.rules.forEach((r, i) => {
    for (const [where, clause] of [['when', r.when], ['require', r.require]] as const) {
      if (!clause) continue;
      if (clause.tests.length === 0) problems.push(`rules[${i}].${where}: needs at least one test`);
      clause.tests.forEach((t, j) => {
        if ((t.value === null) === (t.compareToFact === null)) problems.push(`rules[${i}].${where}.tests[${j}]: give exactly one of value and compareToFact`);
      });
    }
  });
  return problems;
}

export function toRules(v: LearnedVersion): Rule[] {
  return v.rules.map((r) => ({
    id: r.id.trim(), title: r.title.trim(), on: r.on,
    ...(r.when ? { when: clauseToCondition(r.when) } : {}),
    require: clauseToCondition(r.require),
    tellCustomer: r.tellCustomer.trim(), cons: r.cons,
  }));
}
