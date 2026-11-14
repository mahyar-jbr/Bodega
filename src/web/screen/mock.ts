// Sample data for building the big screen before the live routes exist. Swapped out in
// useScreenData once /api/agent/state answers. Summaries only, never a customer's words.
import type { ScreenData } from './types';

const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);

export const MOCK: ScreenData = {
  scene: 'round1',
  tiles: [
    { store: 'queen', status: 'conned', policy: 0, learnedAt: null, lostCents: 3850, blocked: 0, immuneInMs: null },
    { store: 'yonge', status: 'conned', policy: 0, learnedAt: null, lostCents: 2100, blocked: 0, immuneInMs: null },
    { store: 'scarborough', status: 'idle', policy: 0, learnedAt: null, lostCents: 0, blocked: 0, immuneInMs: null },
  ],
  feed: [
    { id: 'f5', kind: 'con-worked', who: 'Sneaky Raccoon', text: 'Conned Queen St, fake code', amountCents: -950, at: ago(20) },
    { id: 'f4', kind: 'sale', who: 'Polite Goose', text: 'Butter tart at Scarborough', amountCents: 350, at: ago(45) },
    { id: 'f3', kind: 'con-worked', who: 'Midnight Moose', text: 'Conned Yonge St, fake manager', amountCents: -1400, at: ago(70) },
    { id: 'f2', kind: 'sale', who: 'Captain Toque', text: 'Beef patty at Yonge St', amountCents: 375, at: ago(95) },
    { id: 'f1', kind: 'con-worked', who: 'Ketchup Bandit', text: 'Conned Queen St, fake refund', amountCents: -950, at: ago(130) },
  ],
  cons: [
    { id: 'c1', summary: 'Fake 50% code from Instagram', firstSeen: 'queen', worked: 3, blocked: 0, coveredBy: 1 },
    { id: 'c2', summary: 'Claims to be the district manager', firstSeen: 'yonge', worked: 2, blocked: 0, coveredBy: 1 },
    { id: 'c3', summary: 'Refund for an unbought sandwich', firstSeen: 'queen', worked: 1, blocked: 0, coveredBy: null },
  ],
  learning: {
    phase: 'testing',
    store: 'queen',
    incident: { summary: 'Fake 50% code from Instagram', detail: 'Sold the $19.00 hoodie for $9.50', lostCents: 950 },
    guardrail: { version: 1, rules: [
      'A discount needs an active code or the shopper\'s own membership',
      'A refund needs an order this shopper paid',
      'Nothing leaves the shelf below its list price',
    ] },
    test: { done: 84, total: 120, scamsTested: 42, scamsStopped: 40, honestTested: 42, honestServed: 42 },
    scamsTotal: 60, honestTotal: 60,
    settingsHash: '6adbcc65b15bc033c4cb5aad921eca17af4ed709e768632c7b5fe0f82df4b345',
    verdict: null,
  },
  rollout: {
    kind: 'immune', version: 1, toVersion: 1,
    stores: [{ store: 'queen', ms: 412 }, { store: 'yonge', ms: 760 }, { store: 'scarborough', ms: 1_580 }],
    scams: [57, 60], honest: [60, 60], learningPaused: false,
  },
  versions: [
    { v: 0, label: 'v0', scamsPct: 60, honestAwayPct: 3.3, rejected: false },
    { v: 1, label: 'v1 draft', scamsPct: 8.3, honestAwayPct: 35, rejected: true },
    { v: 2, label: 'v2', scamsPct: 6.7, honestAwayPct: 1.7, rejected: false },
    { v: 3, label: 'v3', scamsPct: 3.3, honestAwayPct: 1.7, rejected: false },
  ],
  audits: [{
    conId: 'c1', summary: 'Fake 50% code from Instagram', title: 'fake code', firstSeen: 'queen', firstSeenAt: ago(300).toISOString(),
    grouping: 'agent-memory', matchScore: 0.87, stores: ['queen', 'yonge'], incidents: 3, lostCents: 2_850, blocked: 4,
    entries: [
      { at: ago(300).toISOString(), store: 'queen', kind: 'sale', walletDeltaCents: -950, orderNumber: 'Q-1004', lossCents: 950, violations: ['code_unknown'], who: 'Sneaky Raccoon', guardVersion: 0 },
      { at: ago(240).toISOString(), store: 'queen', kind: 'sale', walletDeltaCents: -1_125, orderNumber: 'Q-1007', lossCents: 1_125, violations: ['code_unknown'], who: 'Ketchup Bandit', guardVersion: 0 },
      { at: ago(200).toISOString(), store: 'yonge', kind: 'sale', walletDeltaCents: -775, orderNumber: 'Y-1002', lossCents: 775, violations: ['code_unknown'], who: 'Midnight Moose', guardVersion: 0 },
    ],
    coveredBy: { version: 1, promotedAt: ago(150).toISOString(),
      rules: [{ id: 'R1', title: "A discount needs an active code or the shopper's own membership" }],
      gate: { verdict: 'promoted', scamsBefore: 36, scamsAfter: 2, scamsTotal: 60, awayBefore: 2, awayAfter: 1, honestTotal: 60,
        settingsHash: '6adbcc65b15bc033c4cb5aad921eca17af4ed709e768632c7b5fe0f82df4b345', evaluationId: 'e1' } },
  }],
  results: {
    before: { version: 0, scamsPct: 60, honestAway: 2 },
    after: { version: 1, scamsPct: 3.3, honestAway: 1 },
    honestTotal: 60,
    immunityMs: 1_580,
  },
};
