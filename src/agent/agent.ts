// The agent (AgentApi). handleMessage: safety limits first (no model call when they fail), then the
// shopper's conversation, then runShopkeeper on the version this store has applied, then the new
// messages appended to the conversation in one write.
import Anthropic from '@anthropic-ai/sdk';
import { AgentError, type AgentApi, type AgentDeps, type StoreId } from '../shared/contract';
import { STORE_IDS } from '../shared/store-data';
import { createAuditor, type Auditor } from './auditor/auditor';
import { atlasConversations, conversationIdFor, type ConversationLog } from './conversations';
import { V0, type GuardrailVersion } from './guard/types';
import { runShopkeeper } from './shopkeeper/run';

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
  let auditor: Auditor | null = null;   // created in start(): it needs the database and the change bus
  // Each store's applied version and status. The store runtimes (M4-02) keep these from the change bus.
  const applied = new Map<StoreId, { version: GuardrailVersion; appliedAt: Date | null; online: boolean }>(
    STORE_IDS.map((id) => [id, { version: V0, appliedAt: null, online: true }]));

  /** One message at a time per shopper, so their conversation stays in order. */
  function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
    queues.set(key, run.catch(() => {}));
    return run;
  }

  return {
    async start() {
      auditor ??= createAuditor({ db: deps.db, store, bus: deps.bus });
      await auditor.start();
    },

    async handleMessage({ shopperId, storeId, text }) {
      if (typeof text !== 'string' || text.trim().length === 0) throw new AgentError('too_long', 'Say something first!');
      if (text.length > LIMITS.maxChars) throw new AgentError('too_long', `Messages are at most ${LIMITS.maxChars} characters.`);
      const runtime = applied.get(storeId);
      if (!runtime) throw new AgentError('unknown_shopper', 'Unknown store.');
      if (!runtime.online) throw new AgentError('store_offline', 'This store is offline for a moment.');
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
        try {
          result = await runShopkeeper({ store, storeId, shopperId, turns: [text], version: runtime.version, history, conversationId });
        } catch (error) {
          if (error instanceof Anthropic.APIError) {
            console.error(`shopkeeper call failed (${error.status ?? 'network'}): ${error.message}`);
            throw new AgentError('unavailable', 'The shopkeeper is busy. Try again in a moment.');
          }
          throw error;
        }
        await conversations.append({ conversationId, shopperId, storeId, messages: result.messages.slice(history.length), at: new Date() });
        for (const b of result.blocked) {
          if (b.cents > 0) auditor?.recordBlocked(storeId, b.cents).catch((e) => console.error('recordBlocked failed:', e));
        }
        return {
          reply: result.reply,
          actions: result.actions,
          blocked: result.blocked.map(({ ruleId, title, firstSeenStore }) => ({ ruleId, title, firstSeenStore })),
          walletCents: result.walletCents,
        };
      });
    },

    async state() {
      return {
        activeVersion: 0, learning: false, learningPaused: false,
        stores: STORE_IDS.map((storeId) => {
          const r = applied.get(storeId)!;
          return { storeId, appliedVersion: r.version.version, appliedAt: r.appliedAt, online: r.online };
        }),
      };
    },

    async metrics() {
      if (auditor) return auditor.metrics();
      return STORE_IDS.map((storeId) => ({ storeId, lostCents: 0, blockedCents: 0, perMinute: [] }));
    },

    async learnNow() { return { started: false, reason: 'Learning is not built yet.' }; },
    async runEval() { throw new AgentError('unavailable', 'Evaluations are not wired to the agent yet.'); },
    async gateDemo() { throw new AgentError('unavailable', 'The gate demo is not built yet.'); },
    async rollback() { return { fromVersion: 0, toVersion: 0 }; },
    async reset() {
      sent.clear();
    },
    async setStoreOnline(storeId, online) {
      const r = applied.get(storeId);
      if (r) r.online = online;
    },
  };
}
