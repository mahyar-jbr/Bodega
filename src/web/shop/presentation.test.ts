import { describe, expect, it } from 'vitest';
import { displayReply, policyLabel, policySnapshot } from './presentation';

describe('policy arrivals', () => {
  it('labels initial snapshots without announcing that they arrived live', () => {
    expect(policyLabel(policySnapshot(null, 0))).toBe('Policy v0');
    expect(policyLabel(policySnapshot(null, 3))).toBe('Policy v3');
  });

  it('announces a newer live version, keeps its time across polls, and clears it on rollback', () => {
    const at = new Date('2026-11-14T16:00:00Z');
    const arrived = policySnapshot(policySnapshot(null, 0), 1, at);
    expect(policyLabel(arrived, at.valueOf())).toBe('Policy v1, just arrived');
    const polled = policySnapshot(arrived, 1, new Date(at.valueOf() + 120_000));
    expect(policyLabel(polled, at.valueOf() + 120_000)).toBe('Policy v1, learned 2 min ago');
    expect(policyLabel(policySnapshot(polled, 0))).toBe('Policy v0');
    expect(policyLabel(policySnapshot(policySnapshot(null, 3), 2))).toBe('Policy v2');
  });
});

it('removes shopkeeper emoji without changing prices, codes, or accents', () => {
  expect(displayReply('Enjoy! ☕🥧')).toBe('Enjoy!');
  expect(displayReply('Café 🇨🇦 costs $3.50; WELCOME10 saves 10%. 👍🏽')).toBe('Café costs $3.50; WELCOME10 saves 10%.');
});
