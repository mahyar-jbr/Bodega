// The big screen's data, in the shapes its components take. Money is integer cents, as in the
// contract. Until the live routes land, mock.ts fills these; then useScreenData maps
// /api/agent/state, /api/agent/metrics and the screen SSE topic onto them.

export type StoreKey = 'queen' | 'yonge' | 'scarborough';

export const STORES: { key: StoreKey; name: string }[] = [
  { key: 'queen', name: 'Queen St' },
  { key: 'yonge', name: 'Yonge St' },
  { key: 'scarborough', name: 'Scarborough' },
];

export const storeName = (key: StoreKey) => STORES.find((s) => s.key === key)?.name ?? key;

// The beats of the demo, left to right in the header (plan/DEMO.md).
export type Scene = 'round1' | 'learning' | 'immunity' | 'round2' | 'memory';

export const SCENES: { key: Scene; label: string }[] = [
  { key: 'round1', label: 'Round 1' },
  { key: 'learning', label: 'Learning' },
  { key: 'immunity', label: 'Immunity' },
  { key: 'round2', label: 'Round 2' },
  { key: 'memory', label: 'Memory' },
];

export type StoreStatus = 'idle' | 'conned' | 'learning' | 'immune';

export interface TileData {
  store: StoreKey;
  status: StoreStatus;
  policy: number; // the guardrail version this store has applied
  learnedAt: Date | null; // when that version was promoted (null for v0)
  lostCents: number;
  blocked: number; // cons blocked
  immuneInMs: number | null; // appliedAt - promotedAt for the current version
}

export type FeedKind = 'sale' | 'con-worked' | 'con-blocked' | 'rule-promoted' | 'rule-rejected' | 'learning' | 'rollback';

export interface FeedItemData {
  id: string;
  kind: FeedKind;
  who: string; // a nickname or a store, never raw text
  text: string; // 30 characters or fewer
  amountCents: number | null; // signed: a loss is negative, a sale positive
  at: Date;
}

// One con on the wall: a screen-safe summary, never the customer's words.
export interface ConRow {
  id: string;
  summary: string;
  firstSeen: StoreKey;
  worked: number;
  blocked: number;
}

export interface ScreenData {
  scene: Scene;
  tiles: TileData[];
  feed: FeedItemData[];
  cons: ConRow[];
}
