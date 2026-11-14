import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { V0 } from '../guard/types';
import type { ConDoc } from '../memory/con-memory';
import { FALLBACK_LEARNER_MODEL, proposeVersion, type LearnerCall } from './learner';
import type { LearnedVersion } from './schema';

const CON = { _id: 'c:1:fakecode', violation: 'code_unknown', title: 'fake code', summary: 'Claimed a code that does not exist',
  stores: ['queen'], incidents: 1, lostCents: 319 } as unknown as ConDoc;

const VALID: LearnedVersion = {
  title: 'Discounts need a real basis',
  rules: [{
    id: 'R1', title: "A discount needs an active code or the shopper's own membership", on: 'checkout',
    when: { match: 'all', tests: [{ fact: 'checkout.hasDiscount', op: 'eq', value: true, compareToFact: null, negate: false }] },
    require: { match: 'all', tests: [{ fact: 'checkout.discountPct', op: 'lte', value: null, compareToFact: 'checkout.validPct', negate: false }] },
    tellCustomer: "That discount isn't one I can apply.", cons: ['c:1:fakecode'],
  }],
};

const overloaded = () => new Anthropic.APIError(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 'Overloaded', new Headers());
const badRequest = () => new Anthropic.APIError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }, 'bad', new Headers());

/** A fake client: `failures` lists what each call throws, in order; after that, calls succeed. */
function fakeClient(failures: (Error | null)[]) {
  const models: string[] = [];
  const client = {
    messages: {
      parse: async (params: { model: string }) => {
        models.push(params.model);
        const failure = failures.shift();
        if (failure) throw failure;
        return { stop_reason: 'end_turn', parsed_output: VALID, content: [{ type: 'text', text: '{}' }] };
      },
    },
  };
  return { client: client as unknown as LearnerCall['client'], models };
}

const input = { active: V0, cons: [CON], knownCons: new Set([CON._id]), nextVersion: 1 };

describe('learner model calls', () => {
  it('retries an overloaded call once, then succeeds on the same model', async () => {
    const { client, models } = fakeClient([overloaded()]);
    const r = await proposeVersion(input, { model: 'claude-opus-5-5', client, retryDelayMs: 0 });
    expect(models).toEqual(['claude-opus-5-5', 'claude-opus-5-5']);
    expect(r.model).toBe('claude-opus-5-5');
    expect(r.rules).toHaveLength(1);
  });

  it('falls back to Sonnet when Opus is still overloaded, and stays on it for the rest of the cycle', async () => {
    const { client, models } = fakeClient([overloaded(), overloaded()]);
    const call: LearnerCall = { model: 'claude-opus-5-5', client, retryDelayMs: 0 };
    const r = await proposeVersion(input, call);
    expect(models).toEqual(['claude-opus-5-5', 'claude-opus-5-5', FALLBACK_LEARNER_MODEL]);
    expect(r.model).toBe(FALLBACK_LEARNER_MODEL);
    const again = await proposeVersion({ ...input, feedback: 'rejected' }, call);   // attempt 2 of the same cycle
    expect(again.model).toBe(FALLBACK_LEARNER_MODEL);
    expect(models.at(-1)).toBe(FALLBACK_LEARNER_MODEL);
  });

  it('does not retry or switch models on a request error', async () => {
    const { client, models } = fakeClient([badRequest()]);
    await expect(proposeVersion(input, { model: 'claude-opus-5-5', client, retryDelayMs: 0 })).rejects.toBeInstanceOf(Anthropic.APIError);
    expect(models).toEqual(['claude-opus-5-5']);
  });

  it('gives up when the fallback is overloaded too', async () => {
    const { client, models } = fakeClient([overloaded(), overloaded(), overloaded()]);
    await expect(proposeVersion(input, { model: 'claude-opus-5-5', client, retryDelayMs: 0 })).rejects.toBeInstanceOf(Anthropic.APIError);
    expect(models).toEqual(['claude-opus-5-5', 'claude-opus-5-5', FALLBACK_LEARNER_MODEL]);
  });
});
