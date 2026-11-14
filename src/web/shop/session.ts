import type { Shopper as ContractShopper } from '../../shared/contract';
import { ApiError, apiJson } from '../ui/api';
import type { StoreKey } from '../ui/stores';

export type Shopper = Pick<ContractShopper, 'id' | 'nickname' | 'storeId' | 'walletCents'>;
export type LocalShopper = Shopper & { joined: boolean };

const pendingShoppers = new Map<string, Promise<LocalShopper>>();
const pendingLoads = new Map<string, Promise<LocalShopper>>();
export const RESET_NOTICE = "The store was reset, so you're a new shopper now.";

export function isUnknownShopper(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 404 && error.code === 'unknown_shopper';
}

export class SessionChangedError extends Error {
  constructor() { super('This response belongs to an earlier shopper session.'); }
}

export type ShopperRequest = <T>(send: (shopperId: string) => Promise<T>, signal?: AbortSignal) => Promise<T>;

export function shopperStorageKey(store: StoreKey, slot: string | null = null) {
  return `bodega:shopper:${store}${slot ? `:${slot}` : ''}`;
}

function parseShopper(value: unknown, store: StoreKey): Shopper {
  if (!value || typeof value !== 'object') throw new Error('The shopper response was incomplete.');
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || typeof candidate.nickname !== 'string' || typeof candidate.walletCents !== 'number') {
    throw new Error('The shopper response was incomplete.');
  }
  if (candidate.storeId !== undefined && candidate.storeId !== store) throw new Error('Wrong shopper store.');
  return { id: candidate.id, nickname: candidate.nickname, storeId: store, walletCents: candidate.walletCents };
}

function readLocalShopper(store: StoreKey, slot: string | null): LocalShopper | null {
  try {
    const saved = localStorage.getItem(shopperStorageKey(store, slot));
    if (!saved) return null;
    const payload = JSON.parse(saved) as unknown;
    return { ...parseShopper(payload, store), joined: Boolean((payload as { joined?: unknown }).joined) };
  } catch {
    return null;
  }
}

export function saveLocalShopper(shopper: LocalShopper, slot: string | null) {
  try {
    localStorage.setItem(shopperStorageKey(shopper.storeId, slot), JSON.stringify(shopper));
  } catch {
    // Private browsing can deny storage; the in-memory session still works.
  }
}

function createShopper(store: StoreKey, slot: string | null, joined: boolean): Promise<LocalShopper> {
  const key = shopperStorageKey(store, slot);
  const active = pendingShoppers.get(key);
  if (active) return active;
  const request = apiJson<unknown>('/api/shoppers', {
    method: 'POST',
    body: JSON.stringify({ storeId: store }),
  }).then((payload) => {
    const shopper = { ...parseShopper(payload, store), joined };
    saveLocalShopper(shopper, slot);
    return shopper;
  }).finally(() => pendingShoppers.delete(key));
  pendingShoppers.set(key, request);
  return request;
}

function forgetTranscript(shopperId: string) {
  try { sessionStorage.removeItem(`bodega:chat:${shopperId}`); } catch { /* Storage is optional. */ }
}

function replaceShopper(store: StoreKey, slot: string | null, old: LocalShopper): Promise<LocalShopper> {
  forgetTranscript(old.id);
  const saved = readLocalShopper(store, slot);
  if (saved && saved.id !== old.id) return Promise.resolve(saved);
  return createShopper(store, slot, old.joined);
}

export function ensureShopper(store: StoreKey, slot: string | null): Promise<LocalShopper> {
  const key = shopperStorageKey(store, slot);
  const pending = pendingLoads.get(key);
  if (pending) return pending;
  const request = (async () => {
    const saved = readLocalShopper(store, slot);
    if (!saved) return createShopper(store, slot, false);
    try {
      const payload = await apiJson<unknown>(`/api/shoppers/${encodeURIComponent(saved.id)}`, { cache: 'no-store' });
      const shopper = { ...parseShopper(payload, store), joined: saved.joined };
      if (shopper.id !== saved.id) throw new Error('Wrong shopper identity.');
      saveLocalShopper(shopper, slot);
      return shopper;
    } catch (error) {
      if (!isUnknownShopper(error)) throw error;
      return replaceShopper(store, slot, saved);
    }
  })().finally(() => pendingLoads.delete(key));
  pendingLoads.set(key, request);
  return request;
}

export function createShopSession(store: StoreKey, slot: string | null, onChange: (shopper: LocalShopper, reason: 'load' | 'reset' | 'update') => void) {
  let shopper: LocalShopper | null = null;
  let loading: Promise<LocalShopper> | null = null;
  let recovery: Promise<LocalShopper> | null = null;
  let disposed = false;

  function publish(next: LocalShopper, reason: 'load' | 'reset' | 'update') {
    if (disposed) throw new SessionChangedError();
    shopper = next;
    onChange(next, reason);
    return next;
  }
  function load() {
    if (disposed) return Promise.reject(new SessionChangedError());
    if (shopper) return Promise.resolve(shopper);
    if (loading) return loading;
    const saved = readLocalShopper(store, slot);
    loading = ensureShopper(store, slot).then((next) => publish(next, saved && saved.id !== next.id ? 'reset' : 'load'))
      .finally(() => { loading = null; });
    return loading;
  }
  function recover(old: LocalShopper) {
    if (disposed) return Promise.reject(new SessionChangedError());
    if (shopper && shopper.id !== old.id) return Promise.resolve(shopper);
    if (recovery) return recovery;
    recovery = replaceShopper(store, slot, old).then((next) => publish(next, 'reset'))
      .finally(() => { recovery = null; });
    return recovery;
  }
  function check(id: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (disposed || shopper?.id !== id) throw new SessionChangedError();
  }
  const run: ShopperRequest = async (send, signal) => {
    signal?.throwIfAborted();
    const first = await (recovery ?? load());
    check(first.id, signal);
    try {
      const result = await send(first.id);
      check(first.id, signal);
      return result;
    } catch (error) {
      if (!isUnknownShopper(error)) throw error;
      signal?.throwIfAborted();
      const next = await recover(first);
      check(next.id, signal);
      // The retry has no recovery catch: a second 404 is surfaced, never looped.
      const result = await send(next.id);
      check(next.id, signal);
      return result;
    }
  };
  return {
    load, run,
    get shopper() { return shopper; },
    join() {
      if (!shopper || disposed) return;
      const next = { ...shopper, joined: true };
      saveLocalShopper(next, slot);
      publish(next, 'update');
    },
    setWallet(id: string, walletCents: number) {
      if (!shopper || disposed || shopper.id !== id || !Number.isSafeInteger(walletCents) || walletCents < 0) return;
      const next = { ...shopper, walletCents };
      saveLocalShopper(next, slot);
      publish(next, 'update');
    },
    dispose() { disposed = true; },
  };
}

export type ShopSession = ReturnType<typeof createShopSession>;

// Keep a bounded transcript for this tab's reloads; it expires with the raw-chat retention window.
export function readTranscript<T>(shopperId: string): T[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(`bodega:chat:${shopperId}`) ?? 'null');
    if (saved && Date.now() - saved.savedAt < 86_400_000 && Array.isArray(saved.messages)) return saved.messages.slice(-60);
  } catch {
    // Storage is optional.
  }
  return [];
}

export function saveTranscript<T>(shopperId: string, messages: T[]) {
  try {
    sessionStorage.setItem(`bodega:chat:${shopperId}`, JSON.stringify({ savedAt: Date.now(), messages: messages.slice(-60) }));
  } catch {
    // Storage is optional.
  }
}
