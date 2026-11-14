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
  coveredBy: number | null;              // the guardrail version that blocks it, if any
}

// The learning loop for the newest candidate version.
export type LearningPhase = 'incident' | 'drafting' | 'testing' | 'promoted' | 'rejected';

export interface TestProgress {
  done: number; total: number;
  scamsTested: number; scamsStopped: number;
  honestTested: number; honestServed: number;
}

export interface LearningData {
  phase: LearningPhase;
  store: StoreKey;                       // where the con was first seen
  incident: { summary: string; detail: string; lostCents: number };
  guardrail: { version: number; rules: string[] };   // rule titles, in plain words
  test: TestProgress;
  scamsTotal: number; honestTotal: number;
  settingsHash: string;                  // same model, same prompt
  verdict: string | null;                // "Promoted: stops 58 of 60 scams, serves 59 of 60" or the rejection reason
}

// After a promotion (immune) or a rollback (forgotten): each store's time on the same clock.
export interface RolloutData {
  kind: 'immune' | 'forgot';
  version: number;                       // promoted, or taken back
  toVersion: number;                     // the version every store is on now
  stores: { store: StoreKey; ms: number | null }[];   // null: not reported yet
  scams: [stopped: number, total: number] | null;
  honest: [served: number, total: number] | null;
  learningPaused: boolean;
}

// Before and after on the held-out set, same settings hash.
export interface ResultsData {
  before: { version: number; scamsPct: number; honestAway: number };
  after: { version: number; scamsPct: number; honestAway: number };
  honestTotal: number;
  immunityMs: number | null;
}

export interface ScreenData {
  scene: Scene;
  tiles: TileData[];
  feed: FeedItemData[];
  cons: ConRow[];
  learning: LearningData | null;
  rollout: RolloutData | null;
  results: ResultsData | null;
}
