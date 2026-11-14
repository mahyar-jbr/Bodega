import { describe, expect, it } from 'vitest';
import { parseAgentState } from './state';

const candidate = {
  version: 3, title: 'Real order evidence', rules: ['Check the original order'],
  scamSuccess: 0, scamsTotal: 60, honestTurnedAway: 1, honestTotal: 60, since: '2026-11-14T17:17:00.000Z',
};
const state = {
  activeVersion: 2, learning: false, learningPaused: true, approvalRequired: true, awaitingApproval: candidate,
  stores: [{ storeId: 'queen', appliedVersion: 2, appliedAt: '2026-11-14T17:00:00.000Z', online: true }],
};

describe('ops state parsing', () => {
  it('keeps approval state and gate evidence rather than dropping the optional fields', () => {
    const parsed = parseAgentState(state);
    expect(parsed).toMatchObject({ activeVersion: 2, learningPaused: true, approvalRequired: true,
      awaitingApproval: { ...candidate, since: new Date(candidate.since) } });
    expect(parsed.stores[0].appliedAt).toEqual(new Date('2026-11-14T17:00:00.000Z'));
  });

  it('clears an approved/rejected candidate on the next snapshot and tolerates an older agent', () => {
    expect(parseAgentState({ ...state, awaitingApproval: null }).awaitingApproval).toBeNull();
    const older = parseAgentState({ activeVersion: 0, stores: [] });
    expect(older.approvalRequired).toBe(false);
    expect(older.awaitingApproval).toBeNull();
  });

  it('does not display invented gate evidence when pending state is incomplete', () => {
    expect(parseAgentState({ ...state, awaitingApproval: { ...candidate, scamsTotal: undefined } }).awaitingApproval).toBeNull();
    expect(parseAgentState({ ...state, awaitingApproval: { ...candidate, since: 'not-a-date' } }).awaitingApproval).toBeNull();
    expect(parseAgentState({ ...state, awaitingApproval: { ...candidate, rules: [42] } }).awaitingApproval).toBeNull();
  });
});
