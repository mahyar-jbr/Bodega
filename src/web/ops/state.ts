import type { AgentApi, AwaitingApproval } from '../../shared/contract';
import { isStoreKey } from '../ui/stores';

export type AgentState = Awaited<ReturnType<AgentApi['state']>>;
export type StoreState = AgentState['stores'][number];

function parsePending(value: unknown): AwaitingApproval | null {
  if (!value || typeof value !== 'object') return null;
  const pending = value as Record<string, unknown>;
  const numbers = ['version', 'scamSuccess', 'scamsTotal', 'honestTurnedAway', 'honestTotal'] as const;
  if (numbers.some((key) => typeof pending[key] !== 'number' || !Number.isInteger(pending[key]) || (pending[key] as number) < 0)) return null;
  if (typeof pending.title !== 'string' || !Array.isArray(pending.rules) || !pending.rules.every((rule) => typeof rule === 'string')) return null;
  const since = pending.since instanceof Date ? pending.since : typeof pending.since === 'string' ? new Date(pending.since) : null;
  if (!since || Number.isNaN(since.valueOf())) return null;
  return {
    version: pending.version as number, title: pending.title, rules: pending.rules,
    scamSuccess: pending.scamSuccess as number, scamsTotal: pending.scamsTotal as number,
    honestTurnedAway: pending.honestTurnedAway as number, honestTotal: pending.honestTotal as number, since,
  };
}

export function parseAgentState(value: unknown): AgentState {
  const outer = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const payload = outer.state && typeof outer.state === 'object' ? outer.state as Record<string, unknown> : outer;
  const stores = Array.isArray(payload.stores) ? payload.stores.flatMap((item): StoreState[] => {
    if (!item || typeof item !== 'object') return [];
    const store = item as Record<string, unknown>;
    const storeId = typeof store.storeId === 'string' ? store.storeId : undefined;
    if (!isStoreKey(storeId)) return [];
    return [{
      storeId,
      appliedVersion: typeof store.appliedVersion === 'number' ? store.appliedVersion : 0,
      appliedAt: typeof store.appliedAt === 'string' ? new Date(store.appliedAt) : null,
      online: store.online !== false,
    }];
  }) : [];
  return {
    activeVersion: typeof payload.activeVersion === 'number' ? payload.activeVersion : 0,
    learning: payload.learning === true,
    learningPaused: payload.learningPaused === true,
    approvalRequired: payload.approvalRequired === true,
    awaitingApproval: parsePending(payload.awaitingApproval),
    stores,
  };
}
