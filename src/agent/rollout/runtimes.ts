// The three store runtimes. Each hears about a change to the active version from the change bus,
// loads and checks the version, swaps it in and records when: time to immunity after a promotion,
// time to forget after a rollback, both measured from agent_state.changedAt on the same clock.
// A slow poll of agent_state is the safety net if a change event is missed (or before the bus exists).
import type { Db } from 'mongodb';
import type { ChangeBus, StoreId } from '../../shared/contract';
import { STORE_IDS } from '../../shared/store-data';
import { validateVersion } from '../guard/rules';
import { V0, type GuardrailVersion } from '../guard/types';
import { AGENT_STATE, ensureAgentState, loadVersion, readAgentState, ROLLOUTS, STORE_RUNTIME, type AgentStateDoc, type StateChange } from './state';

export interface StoreRuntimeDoc {
  _id: StoreId;
  appliedVersion: number;
  appliedAt: Date | null;
  online: boolean;
}

export interface RolloutDoc {
  version: number;
  storeId: StoreId;
  /** promote: time to immunity; rollback: time to forget; catchup: a store back online applying the
   *  change it missed (ms is then measured from the change it missed). */
  change: StateChange | 'catchup';
  changedAt: Date;
  appliedAt: Date;
  ms: number;
  via: 'bus' | 'poll' | 'catch-up';
}

interface Runtime {
  version: GuardrailVersion;
  appliedAt: Date | null;
  appliedChange: number;        // changedAt (ms) of the change this store last applied
  online: boolean;
  queue: Promise<void>;
}

export interface StoreRuntimesOptions { db: Db; bus: ChangeBus; pollMs?: number }

export function createStoreRuntimes({ db, bus, pollMs = 3_000 }: StoreRuntimesOptions) {
  const runtimes = new Map<StoreId, Runtime>(STORE_IDS.map((id) => [id, { version: V0, appliedAt: null, appliedChange: 0, online: true, queue: Promise.resolve() }]));
  let state: AgentStateDoc | null = null;
  let startedAt = 0;
  let timer: NodeJS.Timeout | undefined;
  let unsubscribe: (() => void) | undefined;

  function onState(doc: AgentStateDoc, via: RolloutDoc['via']) {
    if (!state || doc.changedAt.getTime() >= state.changedAt.getTime()) state = doc;
    // Each store applies the change on its own.
    return Promise.all(STORE_IDS.map((id) => applyAt(id, doc, via)));
  }

  function applyAt(storeId: StoreId, doc: AgentStateDoc, via: RolloutDoc['via']): Promise<void> {
    const r = runtimes.get(storeId)!;
    r.queue = r.queue.then(async () => {
      const change = doc.changedAt.getTime();
      if (!r.online || change <= r.appliedChange) return;
      const version = await loadVersion(db, doc.activeVersion);
      if (!version) { console.error(`${storeId}: version ${doc.activeVersion} not found; keeping v${r.version.version}`); return; }
      const errors = validateVersion(version);
      if (errors.length) { console.error(`${storeId}: version ${version.version} is invalid (${errors[0]}); keeping v${r.version.version}`); return; }
      const appliedAt = new Date();
      r.version = version;
      r.appliedAt = appliedAt;
      r.appliedChange = change;
      await db.collection<StoreRuntimeDoc>(STORE_RUNTIME).updateOne({ _id: storeId },
        { $set: { appliedVersion: version.version, appliedAt, online: r.online } }, { upsert: true });
      // Changes made while this process runs get a rollout record; at boot a store just loads the active version.
      // One row per store and change: with several processes alive (an old instance draining during a
      // deploy), the first one to apply it records the time; the others leave it alone.
      if (change >= startedAt) {
        await db.collection<RolloutDoc>(ROLLOUTS).updateOne(
          { storeId, version: version.version, change: via === 'catch-up' ? 'catchup' : doc.change, changedAt: doc.changedAt },
          { $setOnInsert: { appliedAt, ms: appliedAt.getTime() - change, via } },
          { upsert: true },
        ).catch((e) => { if ((e as { code?: number }).code !== 11000) throw e; });
      }
    }).catch((error) => console.error(`${storeId}: applying version ${doc.activeVersion} failed:`, error));
    return r.queue;
  }

  async function poll() {
    try { await onState(await readAgentState(db), 'poll'); } catch (error) { console.error('store runtimes: poll failed:', error); }
  }

  return {
    async start() {
      await ensureAgentState(db);
      startedAt = Date.now();
      await onState(await readAgentState(db), 'poll');
      unsubscribe = bus.on<AgentStateDoc>(AGENT_STATE, (e) => {
        if (e.doc && e.doc._id === 'agent') void onState({ ...e.doc, changedAt: new Date(e.doc.changedAt) }, 'bus');
      });
      timer = setInterval(() => void poll(), pollMs);
      timer.unref();
    },
    stop() {
      unsubscribe?.();
      if (timer) clearInterval(timer);
    },
    /** The version a store has applied (what its guard checks). */
    versionFor(storeId: StoreId): GuardrailVersion {
      return runtimes.get(storeId)?.version ?? V0;
    },
    isOnline(storeId: StoreId): boolean {
      return runtimes.get(storeId)?.online ?? false;
    },
    /** Stretch S1: an offline store ignores changes; back online, it catches up on the active version. */
    async setOnline(storeId: StoreId, online: boolean) {
      const r = runtimes.get(storeId);
      if (!r) return;
      r.online = online;
      await db.collection<StoreRuntimeDoc>(STORE_RUNTIME).updateOne({ _id: storeId }, { $set: { online } }, { upsert: true });
      if (online) await applyAt(storeId, await readAgentState(db), 'catch-up');
    },
    agentState(): AgentStateDoc | null {
      return state;
    },
    /** Re-read agent_state now (after this process changed it), without waiting for the bus. */
    refresh: poll,
    stores() {
      return STORE_IDS.map((storeId) => {
        const r = runtimes.get(storeId)!;
        return { storeId, appliedVersion: r.version.version, appliedAt: r.appliedAt, online: r.online };
      });
    },
  };
}

export type StoreRuntimes = ReturnType<typeof createStoreRuntimes>;
