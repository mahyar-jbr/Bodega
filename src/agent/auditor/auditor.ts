// The auditor: reads every sale and refund from the change bus, judges it against the fixed valid
// basis, and turns each loss with no basis into an incident (a screen-safe summary, never raw text)
// and an attack metric. The con memory groups incidents into cons; the learner learns from them.
import { ObjectId, type Db } from 'mongodb';
import type { ChangeBus, LedgerEntry, StoreApi, StoreId } from '../../shared/contract';
import type { Violation } from '../guard/basis';
import { judgeEntry } from './judge';
import { summarizeIncident, type IncidentText } from './summarize';

export interface IncidentDoc {
  _id: ObjectId;
  ledgerId: string;                 // unique: an entry becomes at most one incident
  storeId: StoreId;
  shopperId: string;
  nickname: string | null;
  conversationId: string | null;
  kind: 'sale' | 'refund';
  lossCents: number;
  violations: Violation[];
  title: string;                    // "fake code"
  summary: string;                  // "Fake 50% code from Instagram"
  summarySource: IncidentText['source'];
  orderNumber: string | null;
  guardVersion: number | null;
  conId: string | null;             // set by the con memory
  epoch: number;
  at: Date;                         // when the money moved
  createdAt: Date;
}

export interface MetricPoint {
  ts: Date;
  meta: { storeId: StoreId; epoch: number; kind: 'lost' | 'blocked' };
  cents: number;
  // Blocks only, for the screen's feed and the con cards (names and titles, never raw text):
  nickname?: string | null;
  ruleId?: string | null;
  title?: string | null;
  version?: number | null;
}

export interface AuditorDeps {
  db: Db;
  store: StoreApi;
  bus: ChangeBus;
  /** The con-memory epoch (a reset starts a new one). */
  epoch?: () => Promise<number>;
  /** The customer's messages in a conversation, for the summary only. */
  customerTurns?: (conversationId: string) => Promise<string[]>;
  summarize?: typeof summarizeIncident;
  onIncident?: (incident: IncidentDoc) => void;
}

export type AgentMetrics = { storeId: StoreId; lostCents: number; blockedCents: number;
  lostCount: number; blockedCount: number;          // beyond the contract: cons that worked, cons blocked (the screen's tiles)
  perMinute: { minute: Date; lostCents: number; blockedCents: number }[] }[];

const STORES: StoreId[] = ['queen', 'yonge', 'scarborough'];
const PER_MINUTE_WINDOW_MS = 30 * 60_000;

export function createAuditor(deps: AuditorDeps) {
  const { db } = deps;
  const incidents = db.collection<IncidentDoc>('incidents');
  const metrics = db.collection<MetricPoint>('attack_metrics');
  const ledger = db.collection('ledger');
  const epoch = deps.epoch ?? (async () => (await db.collection('agent_state').findOne({}, { projection: { epoch: 1 } }))?.epoch ?? 0);
  const customerTurns = deps.customerTurns ?? ((id: string) => defaultCustomerTurns(db, id));
  const summarize = deps.summarize ?? summarizeIncident;
  const inFlight = new Set<string>();
  let unsubscribe: (() => void) | null = null;

  async function ensureCollections() {
    try {
      await db.createCollection('attack_metrics', { timeseries: { timeField: 'ts', metaField: 'meta', granularity: 'seconds' } });
    } catch (err) {
      if ((err as { codeName?: string }).codeName !== 'NamespaceExists') throw err;
    }
    await incidents.createIndex({ ledgerId: 1 }, { unique: true });
    await incidents.createIndex({ epoch: 1, at: -1 });
  }

  async function priorRefunded(entry: LedgerEntry): Promise<number> {
    if (entry.kind !== 'refund' || !entry.orderId) return 0;
    const [row] = await ledger.aggregate<{ cents: number }>([
      { $match: { kind: 'refund', orderId: entry.orderId, at: { $lt: entry.at }, idempotencyKey: { $ne: entry.idempotencyKey } } },
      { $group: { _id: null, cents: { $sum: '$walletDeltaCents' } } },
    ]).toArray();
    return row?.cents ?? 0;
  }

  /** Judge one ledger entry; a loss becomes an incident. Safe to call twice for the same entry. */
  async function audit(entry: LedgerEntry): Promise<IncidentDoc | null> {
    if (entry.kind !== 'sale' && entry.kind !== 'refund') return null;
    if (inFlight.has(entry.id) || (await incidents.countDocuments({ ledgerId: entry.id }, { limit: 1 }))) return null;
    inFlight.add(entry.id);
    try {
      const judged = await judgeEntry(deps.store, entry, await priorRefunded(entry));
      if (!judged || judged.ok) return null;

      const [shopper, turns, currentEpoch] = await Promise.all([
        deps.store.shopper(entry.shopperId),
        entry.conversationId ? customerTurns(entry.conversationId).catch(() => []) : Promise.resolve([]),
        epoch(),
      ]);
      const text = await summarize({ violations: judged.violations, lossCents: judged.lossCents, kind: judged.kind,
        customerTurns: turns, toolReason: entry.reason });
      const doc: IncidentDoc = {
        _id: new ObjectId(), ledgerId: entry.id, storeId: entry.storeId, shopperId: entry.shopperId,
        nickname: shopper?.nickname ?? null, conversationId: entry.conversationId, kind: judged.kind,
        lossCents: judged.lossCents, violations: judged.violations,
        title: text.title, summary: text.summary, summarySource: text.source,
        orderNumber: judged.orderNumber, guardVersion: entry.guardVersion, conId: null, epoch: currentEpoch,
        at: new Date(entry.at), createdAt: new Date(),
      };
      try {
        await incidents.insertOne(doc);
      } catch (err) {
        if ((err as { code?: number }).code === 11000) return null;     // another process got there first
        throw err;
      }
      await metrics.insertOne({ ts: doc.at, meta: { storeId: doc.storeId, epoch: currentEpoch, kind: 'lost' }, cents: doc.lossCents });
      deps.onIncident?.(doc);
      return doc;
    } finally {
      inFlight.delete(entry.id);
    }
  }

  return {
    audit,

    async start() {
      await ensureCollections();
      unsubscribe = deps.bus.on<LedgerEntry & { _id?: unknown }>('ledger', (e) => {
        if (e.op !== 'insert' || !e.doc) return;
        const entry = { ...e.doc, id: e.doc.id ?? String(e.doc._id) } as LedgerEntry;
        audit(entry).catch((err) => console.error('auditor:', err));
      });
    },

    stop() { unsubscribe?.(); unsubscribe = null; },

    /** The guard calls this when it blocks a money call: what the con would have cost. */
    async recordBlocked(storeId: StoreId, cents: number,
      detail: { shopperId?: string; ruleId?: string; title?: string; version?: number } = {}, at = new Date()) {
      if (cents <= 0) return;
      const shopper = detail.shopperId ? await deps.store.shopper(detail.shopperId).catch(() => null) : null;
      await metrics.insertOne({ ts: at, meta: { storeId, epoch: await epoch(), kind: 'blocked' }, cents,
        nickname: shopper?.nickname ?? null, ruleId: detail.ruleId ?? null, title: detail.title ?? null, version: detail.version ?? null });
    },

    /** Losses and blocks per store in the current epoch, with the last 30 minutes per minute. */
    async metrics(): Promise<AgentMetrics> {
      const current = await epoch();
      const since = new Date(Date.now() - PER_MINUTE_WINDOW_MS);
      const [totals, minutes] = await Promise.all([
        metrics.aggregate<{ _id: { storeId: StoreId; kind: string }; cents: number; count: number }>([
          { $match: { 'meta.epoch': current } },
          { $group: { _id: { storeId: '$meta.storeId', kind: '$meta.kind' }, cents: { $sum: '$cents' }, count: { $sum: 1 } } },
        ]).toArray(),
        metrics.aggregate<{ _id: { storeId: StoreId; kind: string; minute: Date }; cents: number }>([
          { $match: { 'meta.epoch': current, ts: { $gte: since } } },
          { $group: { _id: { storeId: '$meta.storeId', kind: '$meta.kind', minute: { $dateTrunc: { date: '$ts', unit: 'minute' } } }, cents: { $sum: '$cents' } } },
          { $sort: { '_id.minute': 1 } },
        ]).toArray(),
      ]);
      return STORES.map((storeId) => {
        const row = (kind: string) => totals.find((t) => t._id.storeId === storeId && t._id.kind === kind);
        const total = (kind: string) => row(kind)?.cents ?? 0;
        const byMinute = new Map<number, { minute: Date; lostCents: number; blockedCents: number }>();
        for (const m of minutes.filter((m) => m._id.storeId === storeId)) {
          const key = m._id.minute.getTime();
          const row = byMinute.get(key) ?? { minute: m._id.minute, lostCents: 0, blockedCents: 0 };
          if (m._id.kind === 'lost') row.lostCents += m.cents; else row.blockedCents += m.cents;
          byMinute.set(key, row);
        }
        return { storeId, lostCents: total('lost'), blockedCents: total('blocked'),
          lostCount: row('lost')?.count ?? 0, blockedCount: row('blocked')?.count ?? 0, perMinute: [...byMinute.values()] };
      });
    },
  };
}

export type Auditor = ReturnType<typeof createAuditor>;

/** Customer messages from a conversation document: plain-string user turns in `messages`. */
async function defaultCustomerTurns(db: Db, conversationId: string): Promise<string[]> {
  const filter = ObjectId.isValid(conversationId) && conversationId.length === 24
    ? { $or: [{ _id: new ObjectId(conversationId) }, { conversationId }] }
    : { $or: [{ _id: conversationId as unknown as ObjectId }, { conversationId }] };
  const conv = await db.collection('conversations').findOne(filter, { projection: { messages: 1 } });
  const messages = (conv?.messages ?? []) as { role?: string; content?: unknown }[];
  return messages.filter((m) => m.role === 'user' && typeof m.content === 'string').map((m) => m.content as string);
}
