import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureShopper, readTranscript, saveTranscript, shopperStorageKey } from './session';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('shopper slots', () => {
  it('keeps the legacy shopper when no slot is supplied', async () => {
    localStorage.setItem('bodega:shopper:queen', JSON.stringify({ id: 'legacy', nickname: 'Polite Goose', walletCents: 1700, joined: true }));
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(shopperStorageKey('queen')).toBe('bodega:shopper:queen');
    expect(await ensureShopper('queen', null)).toMatchObject({ id: 'legacy', walletCents: 1700, joined: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('isolates same-store slots, deduplicates one slot, and restores both after reload', async () => {
    let id = 0;
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: `shopper-${++id}`, nickname: 'Sneaky Raccoon', walletCents: 2000 })));
    vi.stubGlobal('fetch', fetch);
    const q1 = ensureShopper('queen', 'q1');
    expect(ensureShopper('queen', 'q1')).toBe(q1);
    const [first, second] = await Promise.all([q1, ensureShopper('queen', 'q2')]);
    expect(first.id).not.toBe(second.id);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem('bodega:shopper:queen:q1')!).id).toBe(first.id);
    expect(JSON.parse(localStorage.getItem('bodega:shopper:queen:q2')!).id).toBe(second.id);
    expect((await ensureShopper('queen', 'q1')).id).toBe(first.id);
    expect((await ensureShopper('queen', 'q2')).id).toBe(second.id);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

it('restores bounded chat for its own shopper and expires it after a day', () => {
  vi.useFakeTimers();
  const messages = Array.from({ length: 70 }, (_, id) => ({ id, text: `Message ${id}` }));
  saveTranscript('q1-shopper', messages);
  expect(readTranscript('q1-shopper')).toEqual(messages.slice(-60));
  expect(readTranscript('q2-shopper')).toEqual([]);
  vi.advanceTimersByTime(86_400_001);
  expect(readTranscript('q1-shopper')).toEqual([]);
});
