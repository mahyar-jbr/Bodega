import { describe, expect, it } from 'vitest';
import type { RolloutDoc } from '../rollout/runtimes';
import { dedupeRollouts } from './snapshot';

const at = new Date('2026-11-14T16:33:27.068Z');
const row = (storeId: RolloutDoc['storeId'], ms: number, extra: Partial<RolloutDoc> = {}): RolloutDoc =>
  ({ version: 1, storeId, change: 'promote', changedAt: at, appliedAt: new Date(at.getTime() + ms), ms, via: 'bus', ...extra });

describe('dedupeRollouts', () => {
  it('keeps one row per store for a change, the first report', () => {
    const rows = [row('queen', 320), row('queen', 319), row('queen', 320), row('yonge', 320), row('yonge', 321), row('scarborough', 319)];
    const out = dedupeRollouts(rows, 1);
    expect(out).toHaveLength(3);
    expect(Object.fromEntries(out.map((r) => [r.storeId, r.ms]))).toEqual({ queen: 319, yonge: 320, scarborough: 319 });
  });

  it('ignores rows for another version', () => {
    expect(dedupeRollouts([row('queen', 300, { version: 2 }), row('queen', 310)], 1).map((r) => r.ms)).toEqual([310]);
  });
});
