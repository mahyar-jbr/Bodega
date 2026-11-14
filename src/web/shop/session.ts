import type { Shopper as ContractShopper } from '../../shared/contract';
import { apiJson } from '../ui/api';
import type { StoreKey } from '../ui/stores';

export type Shopper = Pick<ContractShopper, 'id' | 'nickname' | 'storeId' | 'walletCents'>;
export type LocalShopper = Shopper & { joined: boolean };

const pendingShoppers = new Map<string, Promise<LocalShopper>>();

export function shopperStorageKey(store: StoreKey, slot: string | null = null) {
  return `bodega:shopper:${store}${slot ? `:${slot}` : ''}`;
}

function parseShopper(value: unknown, store: StoreKey): Shopper {
  if (!value || typeof value !== 'object') throw new Error('The shopper response was incomplete.');
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || typeof candidate.nickname !== 'string' || typeof candidate.walletCents !== 'number') {
    throw new Error('The shopper response was incomplete.');
  }
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

export function ensureShopper(store: StoreKey, slot: string | null): Promise<LocalShopper> {
  const saved = readLocalShopper(store, slot);
  if (saved) return Promise.resolve(saved);
  const key = shopperStorageKey(store, slot);
  const active = pendingShoppers.get(key);
  if (active) return active;
  const request = apiJson<unknown>('/api/shoppers', {
    method: 'POST',
    body: JSON.stringify({ storeId: store }),
  }).then((payload) => {
    const shopper = { ...parseShopper(payload, store), joined: false };
    saveLocalShopper(shopper, slot);
    return shopper;
  }).finally(() => pendingShoppers.delete(key));
  pendingShoppers.set(key, request);
  return request;
}

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
