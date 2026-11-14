import { describe, expect, it } from 'vitest';
import { timelineTops } from './panels';

describe('timelineTops', () => {
  it('spreads stores that land within a few ms of each other', () => {
    const tops = timelineTops([{ store: 'queen', ms: 320 }, { store: 'yonge', ms: 320 }, { store: 'scarborough', ms: 319 }], 320);
    const ys = [...tops.values()].sort((a, b) => a - b);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(16);
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(16);
    expect(Math.max(...ys)).toBeLessThanOrEqual(92);
    expect(tops.get('scarborough')).toBeLessThan(tops.get('queen')!);   // still in order of time
  });

  it('keeps times to scale when they are far apart', () => {
    const tops = timelineTops([{ store: 'queen', ms: 400 }, { store: 'yonge', ms: 800 }, { store: 'scarborough', ms: 1600 }], 1600);
    expect(tops.get('queen')).toBeCloseTo(10 + 82 * 0.25);
    expect(tops.get('scarborough')).toBeCloseTo(92);
  });
});
