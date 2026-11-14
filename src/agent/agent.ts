// The agent (AgentApi). handleMessage: safety limits first (no model call when they fail), then the
// shopper's conversation, then runShopkeeper on the version this store has applied, then the new
// messages appended to the conversation in one write.
import Anthropic from '@anthropic-ai/sdk';
import { AgentError, type AgentApi, type AgentDeps, type StoreId } from '../shared/contract';
import { STORE_IDS } from '../shared/store-data';
import { createAuditor, type Auditor } from './auditor/auditor';
import { atlasConversations, conversationIdFor, type ConversationLog } from './conversations';
import { V0 } from './guard/types';
import { gate, gateDemo, runEvaluation } from './gate/gate';
import { createLearner, type Learner } from './learner/learner';
import { createConMemory, type ConMemory } from './memory/con-memory';
import { ensureMemoryRules } from './memory/memory-rules';
import { resetAgentState, rollbackActive } from './rollout/state';
import { createStoreRuntimes, type StoreRuntimes } from './rollout/runtimes';
import { screenSnapshot } from './screen/snapshot';
import { STORE_NAMES } from './shopkeeper/prompt';
import { runShopkeeper } from './shopkeeper/run';
import { SETTINGS_HASH } from './shopkeeper/settings';

export const LIMITS = Object.freeze({
  maxChars: 300,
  minIntervalMs: 2_000,      // one message every 2 seconds per shopper
  maxMessages: 40,           // per shopper, in total
});

export interface AgentOptions {
  conversations?: ConversationLog;
  now?: () => number;
}

export function createRealAgent(deps: AgentDeps, options: AgentOptions = {}): AgentApi {
  const { store } = deps;
  const conversations = options.conversations ?? atlasConversations(deps.db);
  const now = options.now ?? Date.now;
  const sent = new Map<string, { last: number; count: number }>();
  const queues = new Map<string, Promise<unknown>>();
  // Created in start(): they need the database and the change bus. Before start(), every store is
  // online on v0 (tests, and the keyless stand-in path).
  let auditor: Auditor | null = null;
  let runtimes: StoreRuntimes | null = null;
  let conMemory: ConMemory | null = null;
  let learner: Learner | null = null;
  const offlineBeforeStart = new Set<StoreId>();

  function requireRuntimes(): StoreRuntimes {
    if (!runtimes) throw new AgentError('unavailable', 'The agent has not started.');
    return runtimes;
  }

  /** One message at a time per shopper, so their conversation stays in order. */
  function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
    queues.set(key, run.catch(() => {}));
    return run;
  }

  let starting: Promise<void> | null = null;

  async function startOnce(): Promise<void> {
      await ensureMemoryRules(deps.db);
      runtimes ??= createStoreRuntimes({ db: deps.db, bus: deps.bus });
      await runtimes.start();
      // The learner starts 10 s after the first new con the active version doesn't cover.
      conMemory ??= createConMemory({ db: deps.db, onNewCon: (con) => learner?.onNewCon(con) });
      await conMemory.start();
      const memory = conMemory;
      learner ??= createLearner({ db: deps.db, store, conMemory: memory, gate: (n, opts) => gate({ db: deps.db }, n, opts) });
      await learner.start();
      auditor ??= createAuditor({ db: deps.db, store, bus: deps.bus,
        onIncident: (incident) => { memory.assign(incident).catch((e) => console.error('con memory: assign failed:', e)); } });
      await auditor.start();
  }

  const api: AgentApi = {
    /** Starts once per process, however often it's called: one set of store runtimes, one auditor,
     *  one con memory and one learner. */
    async start() {
      starting ??= startOnce().catch((error) => { starting = null; throw error; });
      return starting;
    },

    async handleMessage({ shopperId, storeId, text }) {
      if (typeof text !== 'string' || text.trim().length === 0) throw new AgentError('too_long', 'Say something first!');
      if (text.length > LIMITS.maxChars) throw new AgentError('too_long', `Messages are at most ${LIMITS.maxChars} characters.`);
      if (!STORE_IDS.includes(storeId)) throw new AgentError('unknown_shopper', 'Unknown store.');
      const online = runtimes ? runtimes.isOnline(storeId) : !offlineBeforeStart.has(storeId);
      if (!online) throw new AgentError('store_offline', 'This store is offline for a moment.');
      const shopper = await store.shopper(shopperId);
      if (!shopper) throw new AgentError('unknown_shopper', 'Unknown shopper.');

      const t = now();
      const s = sent.get(shopperId) ?? { last: -Infinity, count: 0 };
      if (s.count >= LIMITS.maxMessages) throw new AgentError('rate_limited', "That's all the chatting for today. Thanks for shopping!");
      if (t - s.last < LIMITS.minIntervalMs) throw new AgentError('rate_limited', 'One message every couple of seconds, please.');
      sent.set(shopperId, { last: t, count: s.count + 1 });

      return serial(shopperId, async () => {
        const conversationId = conversationIdFor(shopperId);
        const history = await conversations.load(conversationId);
        let result;
        // The version this store has applied right now: after a promotion it may lag for a moment.
        const version = runtimes?.versionFor(storeId) ?? V0;
        try {
          result = await runShopkeeper({ store, storeId, shopperId, turns: [text], version, history, conversationId,
            firstSeenStore: (conIds) => conMemory?.firstSeenStore(conIds) ?? null });
        } catch (error) {
          if (error instanceof Anthropic.APIError) {
            console.error(`shopkeeper call failed (${error.status ?? 'network'}): ${error.message}`);
            throw new AgentError('unavailable', 'The shopkeeper is busy. Try again in a moment.');
          }
          throw error;
        }
        await conversations.append({ conversationId, shopperId, storeId, messages: result.messages.slice(history.length), at: new Date() });
        for (const b of result.blocked) {
          if (b.cents > 0) {
            auditor?.recordBlocked(storeId, b.cents, { shopperId, ruleId: b.ruleId, title: b.title, version: version.version })
              .catch((e) => console.error('recordBlocked failed:', e));
          }
        }
        // The shared memory speaks for itself: when this store blocked a trick another store saw
        // first, the phone shows it under the shopkeeper's reply. Display only: it isn't added to the
        // model's history, and evaluations never pass through here.
        const seen = result.blocked.find((b) => b.firstSeenStore)?.firstSeenStore;
        const note = seen ? `\n\n🛡 Bodega memory: ${STORE_NAMES[seen]} saw this trick first. Every Bodega store now blocks it.` : '';
        return {
          reply: result.reply + note,
          actions: result.actions,
          blocked: result.blocked.map(({ ruleId, title, firstSeenStore }) => ({ ruleId, title, firstSeenStore })),
          walletCents: result.walletCents,
        };
      });
    },

    async state() {
      const s = runtimes?.agentState();
      const stores = runtimes?.stores() ?? STORE_IDS.map((storeId) => ({ storeId, appliedVersion: 0, appliedAt: null, online: !offlineBeforeStart.has(storeId) }));
      const state = {
        activeVersion: s?.activeVersion ?? 0, learning: s?.learning ?? false, learningPaused: s?.learningPaused ?? false, stores,
        // The big screen's data (summaries, titles, nicknames and numbers only), once the agent has started.
        ...(runtimes && auditor ? { screen: await screenSnapshot({ db: deps.db, store, metrics: () => auditor!.metrics(), stores: () => stores, settingsHash: SETTINGS_HASH }) } : {}),
      };
      return state;
    },

    async metrics() {
      if (auditor) return auditor.metrics();
      return STORE_IDS.map((storeId) => ({ storeId, lostCents: 0, blockedCents: 0, perMinute: [] }));
    },

    async learnNow() {
      if (!learner) throw new AgentError('unavailable', 'The agent has not started.');
      return learner.learnNow();
    },
    async runEval(input) {
      requireRuntimes();
      return runEvaluation({ db: deps.db }, input);
    },
    async gateDemo() {
      requireRuntimes();
      return gateDemo({ db: deps.db });
    },
    async rollback() {
      requireRuntimes();
      // Every store hears about it from the change bus (the slow poll is the safety net) and records
      // its time to forget.
      const { fromVersion, toVersion } = await rollbackActive(deps.db);
      return { fromVersion, toVersion };
    },
    async reset() {
      const r = requireRuntimes();
      await resetAgentState(deps.db);
      conMemory?.reset();
      learner?.reset();
      sent.clear();
      await r.refresh();
    },
    async setStoreOnline(storeId, online) {
      if (runtimes) await runtimes.setOnline(storeId, online);
      else if (online) offlineBeforeStart.delete(storeId);
      else offlineBeforeStart.add(storeId);
    },
  };
  return api;
}
