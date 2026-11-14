// The con memory: groups incidents into cons. A con is one trick (a mechanism), with where and when it
// was first seen. Matching happens in Atlas Agent Memory (CON_MEMORY=agent, the default): an incident's
// screen-safe summary is searched within its namespace, cons:<epoch>:<violation>, so reworded versions
// of a known trick land on the same con and different mechanisms never mix. CON_MEMORY=local, missing
// Agent Memory keys, an error or a lookup over a second all fall back to grouping by violation in Atlas
// (ARCHITECTURE Appendix E), so an incident always lands and the demo never stalls.
// The `cons` documents feed the big screen and the learner; they hold summaries only, never raw text.
import { nanoid } from 'nanoid';
import type { Db } from 'mongodb';
import type { StoreId } from '../../shared/contract';
import type { IncidentDoc } from '../auditor/auditor';
import { CONS, INCIDENTS } from '../rollout/state';
import { accessToken, agentMemory, agentMemoryConfigured } from './agent-memory';

export interface ConDoc {
  _id: string;
  epoch: number;
  violation: string;               // the incident's main violation: the namespace it matches within
  title: string;
  summary: string;
  firstSeenStore: StoreId;
  firstSeenAt: Date;
  lastSeenAt: Date;
  stores: StoreId[];
  incidents: number;
  lostCents: number;
  coveredBy: number | null;        // the guardrail version whose rules cover it
  grouping: 'agent-memory' | 'violation';
  memoryId: string | null;         // its Agent Memory id
  matchScore: number | null;       // the last incident's similarity, when it matched
}

// Within one violation's namespace. P16: the same con 0.856 to 0.891, different cons 0.789 to 0.808
// (across violations); Nov 14: a reworded fake code scored 0.843. Namespaces keep mechanisms apart,
// so grouping a little more readily inside one only helps reworded tricks land together.
export const SAME_CON_THRESHOLD = 0.8;
const LOOKUP_TIMEOUT_MS = 1_000;
const SAVE_TIMEOUT_MS = 2_000;

export type ConMemoryMode = 'agent' | 'local';

export function conMemoryMode(): ConMemoryMode {
  const wanted = process.env.CON_MEMORY?.trim().toLowerCase() === 'local' ? 'local' : 'agent';
  return wanted === 'agent' && agentMemoryConfigured() ? 'agent' : 'local';
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error(`${what} took over ${ms} ms`)), ms).unref())]);
}

export interface ConMemoryOptions {
  db: Db;
  mode?: ConMemoryMode;
  /** Called when an incident starts a new con (the learner's trigger). */
  onNewCon?: (con: ConDoc) => void;
}

export function createConMemory({ db, mode = conMemoryMode(), onNewCon }: ConMemoryOptions) {
  const cons = db.collection<ConDoc>(CONS);
  const incidents = db.collection<IncidentDoc>(INCIDENTS);
  const firstSeen = new Map<string, { storeId: StoreId; at: number }>();
  const unknown = new Set<string>();
  const queues = new Map<string, Promise<unknown>>();

  function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
    queues.set(key, run.catch(() => {}));
    return run;
  }

  /** Agent Memory's best match within the namespace, or null; throws when it errors or is slow. */
  async function lookup(namespace: string, summary: string): Promise<{ conId: string; score: number } | null> {
    const hits = await withTimeout(agentMemory().searchSemantic({ query: summary, userId: namespace, topK: 3 }), LOOKUP_TIMEOUT_MS, 'Agent Memory lookup');
    for (const hit of hits) {
      const meta = (hit.metadata?.metadata ?? hit.metadata) as { conId?: unknown } | undefined;
      const score = hit.similarity_score ?? 0;
      if (typeof meta?.conId === 'string' && score >= SAME_CON_THRESHOLD) return { conId: meta.conId, score };
    }
    return null;
  }

  async function attach(incident: IncidentDoc, conId: string, score: number | null): Promise<ConDoc | null> {
    const con = await cons.findOneAndUpdate({ _id: conId }, {
      $inc: { incidents: 1, lostCents: incident.lossCents },
      $set: { lastSeenAt: incident.at, matchScore: score },
      $addToSet: { stores: incident.storeId },
    }, { returnDocument: 'after' });
    if (con) await incidents.updateOne({ _id: incident._id }, { $set: { conId } });
    return con;
  }

  async function create(incident: IncidentDoc, conId: string, violation: string, grouping: ConDoc['grouping']): Promise<ConDoc> {
    const con: ConDoc = {
      _id: conId, epoch: incident.epoch, violation, title: incident.title, summary: incident.summary,
      firstSeenStore: incident.storeId, firstSeenAt: incident.at, lastSeenAt: incident.at, stores: [incident.storeId],
      incidents: 1, lostCents: incident.lossCents, coveredBy: null, grouping, memoryId: null, matchScore: null,
    };
    await cons.insertOne(con);
    await incidents.updateOne({ _id: incident._id }, { $set: { conId } });
    firstSeen.set(conId, { storeId: con.firstSeenStore, at: con.firstSeenAt.getTime() });
    onNewCon?.(con);
    return con;
  }

  /** Grouping by violation: one con per epoch and violation. */
  async function byViolation(incident: IncidentDoc, violation: string): Promise<ConDoc> {
    const conId = `v:${incident.epoch}:${violation}`;
    const existing = await attach(incident, conId, null);
    if (existing) return existing;
    try {
      return await create(incident, conId, violation, 'violation');
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return (await attach(incident, conId, null))!;
      throw error;
    }
  }

  return {
    mode,

    /** Loads where the current epoch's cons were first seen, for the guard's friendly replies. */
    async start() {
      for (const con of await cons.find({}, { projection: { firstSeenStore: 1, firstSeenAt: 1 } }).toArray()) {
        firstSeen.set(con._id, { storeId: con.firstSeenStore, at: con.firstSeenAt.getTime() });
      }
      if (mode === 'agent') {
        // Warm up before the first incident: the token exchange and the first search are the slow ones.
        const started = Date.now();
        try {
          await withTimeout(accessToken(), 10_000, 'Agent Memory token');
          await withTimeout(agentMemory().searchSemantic({ query: 'warm-up', userId: 'cons:warmup', topK: 1 }), 10_000, 'Agent Memory warm-up');
          console.log(`con memory: Atlas Agent Memory (ready in ${Date.now() - started} ms)`);
        } catch (error) {
          console.error(`con memory: Agent Memory warm-up failed (${(error as Error).message}); lookups fall back to grouping by violation when they fail`);
        }
      } else {
        console.log('con memory: grouping by violation');
      }
    },

    /** Files an incident under a con (a known one, or a new one). Returns the con. */
    async assign(incident: IncidentDoc): Promise<ConDoc> {
      const violation = incident.violations[0] ?? 'unknown';
      const namespace = `cons:${incident.epoch}:${violation}`;
      return serial(namespace, async () => {
        if (mode === 'local') return byViolation(incident, violation);
        let match: { conId: string; score: number } | null;
        try {
          match = await lookup(namespace, incident.summary);
        } catch (error) {
          console.error(`con memory: ${(error as Error).message}; grouping by violation`);
          return byViolation(incident, violation);
        }
        if (match) {
          const con = await attach(incident, match.conId, match.score);
          if (con) return con;
        }
        const con = await create(incident, `c:${incident.epoch}:${nanoid(10)}`, violation, 'agent-memory');
        try {
          const saved = await withTimeout(agentMemory().saveSemantic({ text: incident.summary, label: con._id, userId: namespace,
            metadata: { conId: con._id, violation, firstSeenStore: con.firstSeenStore }, upsert: true }), SAVE_TIMEOUT_MS, 'Agent Memory save');
          await cons.updateOne({ _id: con._id }, { $set: { memoryId: saved.id } });
          con.memoryId = saved.id;
          // Saves take a moment to become searchable: hold this namespace's queue until it is (about
          // 1.5 s at most), so the next incident with the same trick finds it instead of starting a new con.
          for (let i = 0; i < 4; i++) {
            await new Promise((r) => setTimeout(r, 400));
            const hits = await withTimeout(agentMemory().searchSemantic({ query: incident.summary, userId: namespace, topK: 3 }), LOOKUP_TIMEOUT_MS, 'Agent Memory check').catch(() => []);
            if (hits.some((h) => (h.metadata?.metadata as { conId?: string } | undefined)?.conId === con._id)) break;
          }
        } catch (error) {
          console.error(`con memory: saving ${con._id} failed (${(error as Error).message}); it stays in Atlas`);
        }
        return con;
      });
    },

    /** Loads where these cons were first seen when this process doesn't know yet: a con filed by
     *  another instance (one still draining after a deploy) or before this process started. */
    async ensureFirstSeen(conIds: string[]): Promise<void> {
      const missing = [...new Set(conIds)].filter((id) => !firstSeen.has(id) && !unknown.has(id));
      if (missing.length === 0) return;
      const found = await cons.find({ _id: { $in: missing } }, { projection: { firstSeenStore: 1, firstSeenAt: 1 } }).toArray();
      for (const con of found) firstSeen.set(con._id, { storeId: con.firstSeenStore, at: con.firstSeenAt.getTime() });
      for (const id of missing) if (!firstSeen.has(id)) unknown.add(id);   // e.g. 'hand-written': never a real con
    },

    /** The store that first saw any of these cons (the earliest), for "Queen St saw that one first". */
    firstSeenStore(conIds: string[]): StoreId | null {
      let best: { storeId: StoreId; at: number } | null = null;
      for (const id of conIds) {
        const seen = firstSeen.get(id);
        if (seen && (!best || seen.at < best.at)) best = seen;
      }
      return best?.storeId ?? null;
    },

    /** The current epoch's cons that no version covers yet (what the learner learns from). */
    async uncovered(epoch: number): Promise<ConDoc[]> {
      return cons.find({ epoch, coveredBy: null }).sort({ firstSeenAt: 1 }).toArray();
    },

    /** After a reset: a new epoch starts with an empty con memory. */
    reset() {
      firstSeen.clear();
      unknown.clear();
    },
  };
}

export type ConMemory = ReturnType<typeof createConMemory>;
