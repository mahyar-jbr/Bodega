// The boundary between the agent side (Mahyar) and the store side (Kasra).
// Money is always integer cents. Change this file only after telling the other person.
import type { Db } from 'mongodb';

export type StoreId = 'queen' | 'yonge' | 'scarborough';

export interface Product { sku: string; name: string; emoji: string; priceCents: number; costCents: number }
export interface Code { code: string; pct: number; active: boolean }
export interface Member { memberId: string; name: string; tier: 'gold' | 'silver'; pct: number }
export interface Shopper {
  id: string; nickname: string; storeId: StoreId; walletCents: number;
  memberId: string | null;                 // only for shoppers built from test cases
  kind: 'crowd' | 'bot' | 'eval'; createdAt: Date;
}
export interface DiscountClaim { pct: number; code?: string; memberId?: string; reason: string }
export interface Order {
  id: string; number: string;              // "Q-1042", unique
  storeId: StoreId; shopperId: string;
  lines: { sku: string; qty: number; listPriceCents: number; unitPriceCents: number }[];
  discount: (DiscountClaim & { cents: number }) | null;
  subtotalCents: number; totalCents: number; refundedCents: number;
  status: 'paid' | 'partially_refunded' | 'refunded';
  conversationId: string | null; guardVersion: number | null; createdAt: Date;
}
export interface LedgerEntry {
  id: string; kind: 'grant' | 'sale' | 'refund';
  storeId: StoreId; shopperId: string;
  orderId: string | null;                  // refunds: the matched order, if any
  claimedOrderNumber: string | null;       // refunds: what the shopkeeper passed
  walletDeltaCents: number; walletAfterCents: number;
  idempotencyKey: string; reason: string | null;
  conversationId: string | null; guardVersion: number | null; at: Date;
}

export interface CheckoutRequest {
  storeId: StoreId; shopperId: string;
  idempotencyKey: string;                  // the shopkeeper's tool call id
  items: { sku: string; qty: number; unitPriceCents?: number }[];   // omitted = list price
  discount?: DiscountClaim;                // at most one
  conversationId?: string; guardVersion?: number;
}
export type CheckoutResult =
  | { ok: true; order: Order; walletCents: number; duplicate: boolean }
  | { ok: false; error: 'unknown_sku' | 'out_of_stock' | 'insufficient_funds' | 'invalid_request'; detail: string };

export interface RefundRequest {
  storeId: StoreId; shopperId: string; idempotencyKey: string;
  amountCents: number; orderNumber?: string; reason: string;
  conversationId?: string; guardVersion?: number;
}
export type RefundResult =
  | { ok: true; entry: LedgerEntry; order: Order | null; walletCents: number; duplicate: boolean }
  | { ok: false; error: 'invalid_amount' | 'invalid_request'; detail: string };

// Store side (Kasra) implements this as AtlasStore. MemoryStore (src/shared/memory-store.ts)
// is the stand-in until AtlasStore lands, and the store the evaluation always uses.
export interface StoreApi {
  catalog(storeId: StoreId): Promise<(Product & { stock: number })[]>;
  product(sku: string): Promise<Product | null>;
  code(code: string): Promise<Code | null>;                  // case-insensitive
  member(memberId: string): Promise<Member | null>;
  createShopper(input: { storeId: StoreId; kind: Shopper['kind']; nickname?: string;
    walletCents?: number; memberId?: string | null }): Promise<Shopper>;   // writes a grant entry
  shopper(id: string): Promise<Shopper | null>;
  orderByNumber(number: string): Promise<Order | null>;      // case-insensitive, ignores a leading '#'
  ordersFor(shopperId: string): Promise<Order[]>;
  checkout(req: CheckoutRequest): Promise<CheckoutResult>;   // integrity only, never business rules
  refund(req: RefundRequest): Promise<RefundResult>;         // integrity only, never business rules
  seedPaidOrder(shopperId: string, items: { sku: string; qty: number }[]): Promise<Order>;  // test setup
}

// Store side (Kasra): one change stream per process, fanned out by collection.
export interface ChangeEvent<T = unknown> {
  coll: string; op: 'insert' | 'update' | 'replace' | 'delete';
  id: string; doc: T | null; at: Date;     // doc: the full document after the change
}
export interface ChangeBus { on<T = unknown>(coll: string, fn: (e: ChangeEvent<T>) => void): () => void }

// Agent side (Mahyar): src/agent/index.ts exports createAgent(deps: AgentDeps): AgentApi.
export interface AgentDeps { store: StoreApi; db: Db; bus: ChangeBus }
export interface ChatReply {
  reply: string;
  actions: ({ kind: 'order'; orderNumber: string; totalCents: number }
          | { kind: 'refund'; amountCents: number; orderNumber: string | null })[];
  blocked: { ruleId: string; title: string; firstSeenStore: StoreId | null }[];
  walletCents: number;
}
// HTTP mapping: too_long 400, rate_limited 429, unknown_shopper 404, store_offline and unavailable 503.
export type ChatErrorCode = 'too_long' | 'rate_limited' | 'store_offline' | 'unknown_shopper' | 'unavailable';
export class AgentError extends Error {
  code: ChatErrorCode;
  constructor(code: ChatErrorCode, message: string) { super(message); this.code = code; }
}
/** A version that passed the gate while approval is required: it waits for a person (approve or reject). */
export interface AwaitingApproval {
  version: number; title: string; rules: string[];          // rule titles
  scamSuccess: number; scamsTotal: number; honestTurnedAway: number; honestTotal: number;   // its gate run
  since: Date;
}
export interface AgentApi {
  start(): Promise<void>;                                    // auditor, learner, store runtimes
  /** via: how the message came in (the voice line passes 'voice'; typed chat may leave it out). */
  handleMessage(input: { shopperId: string; storeId: StoreId; text: string; via?: 'chat' | 'voice' }): Promise<ChatReply>;
  state(): Promise<{ activeVersion: number; learning: boolean; learningPaused: boolean;
    stores: { storeId: StoreId; appliedVersion: number; appliedAt: Date | null; online: boolean }[];
    approvalRequired?: boolean; awaitingApproval?: AwaitingApproval | null }>;
  metrics(): Promise<{ storeId: StoreId; lostCents: number; blockedCents: number;
    perMinute: { minute: Date; lostCents: number; blockedCents: number }[] }[]>;
  learnNow(): Promise<{ started: boolean; reason?: string }>;
  runEval(input: { set: 'heldout' | 'dev'; version?: number }): Promise<{ evaluationId: string }>;
  gateDemo(): Promise<{ evaluationId: string }>;             // a hand-written, too-strict version through the gate, to show a rejection
  rollback(): Promise<{ fromVersion: number; toVersion: number }>;   // take back the active version: every store forgets it, learning pauses
  reset(): Promise<void>;                                    // every store back to v0, learning resumes
  setStoreOnline(storeId: StoreId, online: boolean): Promise<void>;   // stretch S1
  // Governance (added Nov 14 after M4). Optional only so that existing fakes still type-check; the
  // real agent implements every one.
  setApprovalRequired?(on: boolean): Promise<{ approvalRequired: boolean }>;   // a version that passes the gate waits for a person
  approve?(): Promise<{ approved: boolean; version?: number; fromVersion?: number; reason?: string }>;   // the waiting version goes live
  reject?(reason?: string): Promise<{ rejected: boolean; version?: number; reason?: string }>;           // the waiting version never goes live
  forgetShopper?(shopperId: string): Promise<{ conversationsDeleted: number; incidentsRedacted: number }>;
  proveMemoryRules?(): Promise<{ at: Date; collection: string; field: string; refused: boolean; code: number | null; codeName: string | null }>;
}

// Live events: the "screen" topic streams these collections; these fields are always stripped.
export const SCREEN_COLLECTIONS = ['orders', 'ledger', 'stores', 'settings', 'bot_runs', 'incidents',
  'cons', 'guardrails', 'evaluations', 'rollouts', 'agent_state', 'store_runtime'];
export const STRIP_FIELDS = ['embedding', 'messages', 'text', 'turns', 'excerpts'];
