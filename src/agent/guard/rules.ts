// Rules as data (ARCHITECTURE Appendix B): evaluating conditions over facts, and validating a version.
// A candidate with an unknown fact, a malformed condition, a type mismatch or a rule without cons is
// invalid as a whole, so it never reaches the gate or a store.
import { FACT_TYPES } from './facts';
import { MAX_RULES, type Comparison, type Condition, type FactCondition, type Facts, type FactValue, type GuardrailVersion, type Rule } from './types';

const COMPARISONS: Comparison[] = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'];
const ORDERED: Comparison[] = ['lt', 'lte', 'gt', 'gte'];

export class RuleError extends Error {}

function isFactCondition(c: Condition): c is FactCondition {
  return typeof (c as FactCondition).fact === 'string';
}

function comparisonOf(c: FactCondition): [Comparison, FactValue | { fact: string }] {
  const ops = COMPARISONS.filter((op) => op in c);
  if (ops.length !== 1) throw new RuleError(`a fact condition needs exactly one of ${COMPARISONS.join(', ')}`);
  return [ops[0]!, (c as Record<string, unknown>)[ops[0]!] as FactValue | { fact: string }];
}

function factValue(facts: Facts, name: string): FactValue {
  if (!(name in facts)) throw new RuleError(`unknown fact ${name}`);
  return facts[name]!;
}

/** True when the condition holds for these facts. Throws RuleError on a malformed condition. */
export function evaluate(condition: Condition, facts: Facts): boolean {
  if ('all' in condition) return condition.all.every((c) => evaluate(c, facts));
  if ('any' in condition) return condition.any.some((c) => evaluate(c, facts));
  if ('not' in condition) return !evaluate(condition.not, facts);
  if (!isFactCondition(condition)) throw new RuleError('a condition is all, any, not or a fact comparison');
  const [op, target] = comparisonOf(condition);
  const left = factValue(facts, condition.fact);
  const right = target !== null && typeof target === 'object' ? factValue(facts, target.fact) : target;
  switch (op) {
    case 'eq': return left === right;
    case 'ne': return left !== right;
    case 'lt': return (left as number) < (right as number);
    case 'lte': return (left as number) <= (right as number);
    case 'gt': return (left as number) > (right as number);
    case 'gte': return (left as number) >= (right as number);
  }
}

/** The rules a version applies to one kind of money call. */
export function rulesFor(version: GuardrailVersion, tool: 'checkout' | 'refund'): Rule[] {
  return version.rules.filter((r) => r.on === tool);
}

/** The rules that apply and fail for these facts (an empty list means the call passes). */
export function failingRules(rules: Rule[], facts: Facts): Rule[] {
  return rules.filter((rule) => (rule.when === undefined || evaluate(rule.when, facts)) && !evaluate(rule.require, facts));
}

// ── Validation ──────────────────────────────────────────────────────────────────────────

function validateCondition(c: unknown, on: Rule['on'], path: string, errors: string[], depth = 0): void {
  if (depth > 6) { errors.push(`${path}: nested too deep`); return; }
  if (!c || typeof c !== 'object' || Array.isArray(c)) { errors.push(`${path}: not a condition`); return; }
  const cond = c as Record<string, unknown>;
  const keys = Object.keys(cond);
  for (const group of ['all', 'any'] as const) {
    if (group in cond) {
      if (keys.length !== 1) { errors.push(`${path}: ${group} must stand alone`); return; }
      const list = cond[group];
      if (!Array.isArray(list) || list.length === 0) { errors.push(`${path}.${group}: needs a non-empty list`); return; }
      list.forEach((child, i) => validateCondition(child, on, `${path}.${group}[${i}]`, errors, depth + 1));
      return;
    }
  }
  if ('not' in cond) {
    if (keys.length !== 1) { errors.push(`${path}: not must stand alone`); return; }
    validateCondition(cond.not, on, `${path}.not`, errors, depth + 1);
    return;
  }
  if (typeof cond.fact !== 'string') { errors.push(`${path}: needs all, any, not or fact`); return; }
  const ops = COMPARISONS.filter((op) => op in cond);
  const extra = keys.filter((k) => k !== 'fact' && !COMPARISONS.includes(k as Comparison));
  if (ops.length !== 1 || extra.length > 0) { errors.push(`${path}: needs exactly one of ${COMPARISONS.join(', ')} and nothing else`); return; }
  const leftType = factType(cond.fact, on, `${path}.fact`, errors);
  const op = ops[0]!;
  const target = cond[op];
  let rightType: string | undefined;
  if (target !== null && typeof target === 'object') {
    const t = target as Record<string, unknown>;
    if (typeof t.fact !== 'string' || Object.keys(t).length !== 1) { errors.push(`${path}.${op}: a value or { fact }`); return; }
    rightType = factType(t.fact, on, `${path}.${op}.fact`, errors);
  } else if (typeof target === 'boolean' || typeof target === 'number') {
    rightType = typeof target;
    if (typeof target === 'number' && !Number.isFinite(target)) errors.push(`${path}.${op}: not a finite number`);
  } else {
    errors.push(`${path}.${op}: compare with a boolean, a number or { fact }`);
    return;
  }
  if (leftType && rightType && leftType !== rightType) errors.push(`${path}: compares a ${leftType} with a ${rightType}`);
  if (leftType === 'boolean' && ORDERED.includes(op)) errors.push(`${path}: ${op} needs numbers`);
}

function factType(name: string, on: Rule['on'], path: string, errors: string[]): string | undefined {
  const type = FACT_TYPES[name];
  if (!type) { errors.push(`${path}: unknown fact ${name}`); return undefined; }
  if (!name.startsWith(`${on}.`) && !name.startsWith('shopper.')) { errors.push(`${path}: a ${on} rule can't use ${name}`); return undefined; }
  return type;
}

/** Every problem with a version; an empty list means it's valid. */
export function validateVersion(version: unknown): string[] {
  const errors: string[] = [];
  const v = version as GuardrailVersion;
  if (!v || typeof v !== 'object') return ['not a version'];
  if (!Number.isInteger(v.version) || v.version < 0) errors.push('version must be a whole number');
  if (!Array.isArray(v.rules)) return [...errors, 'rules must be a list'];
  if (v.rules.length > MAX_RULES) errors.push(`at most ${MAX_RULES} rules`);
  const ids = new Set<string>();
  v.rules.forEach((rule, i) => {
    const p = `rules[${i}]`;
    if (!rule || typeof rule !== 'object') { errors.push(`${p}: not a rule`); return; }
    if (typeof rule.id !== 'string' || !rule.id.trim()) errors.push(`${p}.id: required`);
    else if (ids.has(rule.id)) errors.push(`${p}.id: ${rule.id} is used twice`);
    else ids.add(rule.id);
    if (typeof rule.title !== 'string' || !rule.title.trim() || rule.title.length > 140) errors.push(`${p}.title: 1 to 140 characters`);
    if (typeof rule.tellCustomer !== 'string' || !rule.tellCustomer.trim() || rule.tellCustomer.length > 300) errors.push(`${p}.tellCustomer: 1 to 300 characters`);
    if (rule.on !== 'checkout' && rule.on !== 'refund') { errors.push(`${p}.on: checkout or refund`); return; }
    if (!Array.isArray(rule.cons) || rule.cons.length === 0 || !rule.cons.every((c) => typeof c === 'string' && c)) errors.push(`${p}.cons: at least one con`);
    if (rule.when !== undefined) validateCondition(rule.when, rule.on, `${p}.when`, errors);
    validateCondition(rule.require, rule.on, `${p}.require`, errors);
  });
  return errors;
}
