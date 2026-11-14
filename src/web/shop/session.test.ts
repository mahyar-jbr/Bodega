import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiJson } from '../ui/api';
import { createShopSession, ensureShopper, readTranscript, saveLocalShopper, saveTranscript, SessionChangedError, shopperStorageKey } from './session';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('shopper slots', () => {
  it('keeps the legacy shopper when no slot is supplied', async () => {
    localStorage.setItem('bodega:shopper:queen', JSON.stringify({ id: 'legacy', nickname: 'Polite Goose', walletCents: 1700, joined: true }));
    const fetch = vi.fn(async (_path: string) => json({ id: 'legacy', nickname: 'Polite Goose', storeId: 'queen', walletCents: 1700 }));
    vi.stubGlobal('fetch', fetch);
    expect(shopperStorageKey('queen')).toBe('bodega:shopper:queen');
    expect(await ensureShopper('queen', null)).toMatchObject({ id: 'legacy', walletCents: 1700, joined: true });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe('/api/shoppers/legacy');
  });

  it('isolates same-store slots, deduplicates one slot, and restores both after reload', async () => {
    let id = 0;
    const fetch = vi.fn(async (path: string, options?: RequestInit) => json({ id: options?.method === 'POST' ? `shopper-${++id}` : path.split('/').at(-1), nickname: 'Sneaky Raccoon', walletCents: 2000 }));
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
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

const old = { id: 'before-reset', nickname: 'Old Goose', storeId: 'queen' as const, walletCents: 350, joined: true };
const fresh = { id: 'after-reset', nickname: 'New Maple', storeId: 'queen' as const, walletCents: 2000 };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const missing = () => json({ error: 'unknown_shopper' }, 404);

describe('reset session recovery', () => {
  it('validates a deleted saved shopper, replaces it in the same slot and removes its stale transcript', async () => {
    saveLocalShopper(old, 'q1'); saveLocalShopper({ ...old, id: 'other-slot' }, 'q2');
    saveTranscript(old.id, [{ text: 'old receipt', walletCents: 350 }]);
    saveTranscript('other-slot', [{ text: 'keep this' }]);
    const fetch = vi.fn(async (path: string) => path.endsWith(old.id) ? missing() : json(fresh, 201));
    vi.stubGlobal('fetch', fetch);
    const changed = vi.fn();
    const session = createShopSession('queen', 'q1', changed);
    expect(await session.load()).toEqual({ ...fresh, joined: true });
    expect(changed).toHaveBeenCalledWith({ ...fresh, joined: true }, 'reset');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem(shopperStorageKey('queen', 'q1'))!)).toEqual({ ...fresh, joined: true });
    expect(JSON.parse(localStorage.getItem(shopperStorageKey('queen', 'q2'))!).id).toBe('other-slot');
    expect(readTranscript(old.id)).toEqual([]);
    expect(readTranscript(fresh.id)).toEqual([]);
    expect(readTranscript('other-slot')).toEqual([{ text: 'keep this' }]);
  });

  it('refreshes the saved nickname and wallet from a cheap existing-shopper lookup', async () => {
    saveLocalShopper(old, null);
    const fetch = vi.fn(async (_path: string, _init?: RequestInit) => json({ ...old, nickname: 'Current Goose', walletCents: 1200 }));
    vi.stubGlobal('fetch', fetch);
    const session = createShopSession('queen', null, vi.fn());
    expect(await session.load()).toMatchObject({ id: old.id, nickname: 'Current Goose', walletCents: 1200 });
    expect(fetch.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
    expect(JSON.parse(localStorage.getItem(shopperStorageKey('queen'))!).walletCents).toBe(1200);
  });

  it('retries the first open-tab chat once with exactly the same message and new identity', async () => {
    saveLocalShopper(old, 'q1'); saveTranscript(old.id, [{ text: 'old paid order' }]);
    const reply = { reply: 'Here is your coffee', walletCents: 1675, actions: [{ kind: 'order', orderNumber: 'Q-1001', totalCents: 325 }], blocked: [] };
    const chats: unknown[] = [];
    const fetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.includes('/api/shoppers/')) return json(old);
      if (path === '/api/shoppers') return json(fresh, 201);
      const body = JSON.parse(init!.body as string); chats.push(body);
      return body.shopperId === old.id ? missing() : json(reply);
    });
    vi.stubGlobal('fetch', fetch);
    const changed = vi.fn(); const session = createShopSession('queen', 'q1', changed);
    await session.load();
    const send = (shopperId: string) => apiJson<typeof reply>('/api/chat', { method: 'POST', body: JSON.stringify({ shopperId, storeId: 'queen', text: 'A coffee please' }) });
    expect(await session.run(send)).toEqual(reply);
    expect(chats).toEqual([
      { shopperId: old.id, storeId: 'queen', text: 'A coffee please' },
      { shopperId: fresh.id, storeId: 'queen', text: 'A coffee please' },
    ]);
    session.setWallet(fresh.id, reply.walletCents);
    session.setWallet(old.id, 99); // A queued SSE event from the deleted subscription.
    expect(session.shopper).toMatchObject({ nickname: fresh.nickname, walletCents: 1675 });
    expect(JSON.parse(localStorage.getItem(shopperStorageKey('queen', 'q1'))!).walletCents).toBe(1675);
    expect(readTranscript(old.id)).toEqual([]);
    expect(changed.mock.calls.filter(([, reason]) => reason === 'reset')).toHaveLength(1);
    await session.run(send);
    expect(chats.at(-1)).toMatchObject({ shopperId: fresh.id });
    expect(fetch.mock.calls.filter(([path]) => path === '/api/shoppers')).toHaveLength(1);
  });

  it('single-flights concurrent chat and voice-token errors, including a late old-id error', async () => {
    saveLocalShopper(old, null);
    let completeCreate!: (response: Response) => void;
    const fetch = vi.fn(async (path: string) => {
      if (path === `/api/shoppers/${old.id}`) return json(old);
      if (path === '/api/shoppers') return new Promise<Response>((resolve) => { completeCreate = resolve; });
      return path.endsWith(old.id) ? missing() : json({ ok: true });
    });
    vi.stubGlobal('fetch', fetch);
    const changed = vi.fn(); const session = createShopSession('queen', null, changed); await session.load();
    const first = session.run((id) => apiJson(`/chat/${id}`));
    const second = session.run((id) => apiJson(`/token/${id}`));
    let rejectLate!: (error: Error) => void;
    let attempts = 0;
    const late = session.run(async () => { if (++attempts === 1) return new Promise((_, reject) => { rejectLate = reject; }); return 'late retry'; });
    await vi.waitFor(() => expect(completeCreate).toBeTypeOf('function'));
    expect(fetch.mock.calls.filter(([path]) => path === '/api/shoppers')).toHaveLength(1);
    completeCreate(json(fresh, 201));
    await Promise.all([first, second]);
    rejectLate(new ApiError(404, 'unknown_shopper', 'reset'));
    expect(await late).toBe('late retry');
    expect(attempts).toBe(2);
    expect(changed.mock.calls.filter(([, reason]) => reason === 'reset')).toHaveLength(1);
    expect(fetch.mock.calls.filter(([path]) => path === '/api/shoppers')).toHaveLength(1);
  });

  it('surfaces the second unknown_shopper without a retry loop or a second replacement', async () => {
    saveLocalShopper(old, null);
    const fetch = vi.fn(async (path: string) => json(path.includes('/api/shoppers/') ? old : fresh));
    vi.stubGlobal('fetch', fetch);
    const session = createShopSession('queen', null, vi.fn()); await session.load();
    const send = vi.fn(async () => { throw new ApiError(404, 'unknown_shopper', 'reset again'); });
    await expect(session.run(send)).rejects.toMatchObject({ code: 'unknown_shopper' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.filter(([path]) => path === '/api/shoppers')).toHaveLength(1);
  });

  it.each([[404, null], [404, 'not_found'], [429, 'rate_limited'], [503, 'unavailable']] as const)('never recovers for unrelated HTTP %s %s', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn(async () => json(fresh)));
    const session = createShopSession('queen', null, vi.fn()); await session.load();
    const send = vi.fn(async () => { throw new ApiError(status, code, 'unrelated'); });
    await expect(session.run(send)).rejects.toMatchObject({ status });
    expect(send).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce(); // Initial shopper only.
  });

  it('recovers separate slots independently without crossing stored identities or stores', async () => {
    for (const slot of ['q1', 'q2']) saveLocalShopper({ ...old, id: slot }, slot);
    let created = 0;
    const fetch = vi.fn(async (path: string) => path.includes('/api/shoppers/') ? missing() : json({ ...fresh, id: `new-${++created}` }));
    vi.stubGlobal('fetch', fetch);
    const [first, second] = await Promise.all(['q1', 'q2'].map((slot) => createShopSession('queen', slot, vi.fn()).load()));
    expect(first.id).not.toBe(second.id);
    expect(created).toBe(2);
    expect(JSON.parse(localStorage.getItem(shopperStorageKey('queen', 'q1'))!).id).toBe(first.id);
    expect(JSON.parse(localStorage.getItem(shopperStorageKey('queen', 'q2'))!).id).toBe(second.id);
    expect(localStorage.getItem(shopperStorageKey('yonge', 'q1'))).toBeNull();
  });

  it('drops late success responses from the deleted shopper instead of applying old wallets or receipts', async () => {
    saveLocalShopper(old, null);
    vi.stubGlobal('fetch', vi.fn(async (path: string) => json(path.includes('/api/shoppers/') ? old : fresh)));
    const session = createShopSession('queen', null, vi.fn()); await session.load();
    let resolveOld!: (value: unknown) => void;
    const late = session.run(() => new Promise((resolve) => { resolveOld = resolve; }));
    const rejected = expect(late).rejects.toBeInstanceOf(SessionChangedError);
    let attempt = 0;
    await session.run(async () => { if (++attempt === 1) throw new ApiError(404, 'unknown_shopper', 'reset'); return 'new'; });
    resolveOld({ walletCents: 1, actions: [{ orderNumber: 'OLD-RECEIPT' }] });
    await rejected;
    expect(session.shopper).toMatchObject({ id: fresh.id, walletCents: 2000 });
  });

  it('cancels a retry while allowing shared recovery to finish safely', async () => {
    saveLocalShopper(old, null);
    let completeCreate!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path.includes('/api/shoppers/') ? json(old) : new Promise<Response>((resolve) => { completeCreate = resolve; })));
    const session = createShopSession('queen', null, vi.fn()); await session.load();
    const abort = new AbortController();
    const send = vi.fn(async () => { throw new ApiError(404, 'unknown_shopper', 'reset'); });
    const pending = session.run(send, abort.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(completeCreate).toBeTypeOf('function'));
    abort.abort(); completeCreate(json(fresh)); await rejected;
    expect(send).toHaveBeenCalledOnce();
    expect(session.shopper?.id).toBe(fresh.id);
  });

  it('does not replace a shopper on a failed validation request or accept another store identity', async () => {
    saveLocalShopper(old, null);
    const fetch = vi.fn().mockResolvedValueOnce(json({ error: 'unavailable' }, 503)).mockResolvedValueOnce(json({ ...old, storeId: 'yonge' }));
    vi.stubGlobal('fetch', fetch);
    await expect(ensureShopper('queen', null)).rejects.toMatchObject({ status: 503 });
    await expect(ensureShopper('queen', null)).rejects.toThrow('Wrong shopper store');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem(shopperStorageKey('queen'))!).id).toBe(old.id);
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
