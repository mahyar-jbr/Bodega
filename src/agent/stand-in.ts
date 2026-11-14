// The stand-in agent (S05): AgentApi with no model and no learning, so the phone shop and the
// routes can be built now. Its chat really calls checkout, through runShopkeeper's stub.
// The real agent replaces it behind the same createAgent at M1-03.
import { AgentError, type AgentApi, type AgentDeps } from '../shared/contract';
import { STORE_IDS } from '../shared/store-data';
import { V0 } from './guard/types';
import { runShopkeeper } from './shopkeeper/run';

export const MAX_MESSAGE_CHARS = 300;

export function createStandInAgent({ store }: AgentDeps): AgentApi {
  return {
    async start() {},

    async handleMessage({ shopperId, storeId, text }) {
      if (typeof text !== 'string' || text.length > MAX_MESSAGE_CHARS) {
        throw new AgentError('too_long', `Messages are at most ${MAX_MESSAGE_CHARS} characters.`);
      }
      const shopper = await store.shopper(shopperId);
      if (!shopper) throw new AgentError('unknown_shopper', 'Unknown shopper.');
      const result = await runShopkeeper({ store, storeId, shopperId, turns: [text], version: V0 });
      return { reply: result.reply, actions: result.actions, blocked: result.blocked, walletCents: result.walletCents };
    },

    async state() {
      return {
        activeVersion: 0, learning: false, learningPaused: false,
        stores: STORE_IDS.map((storeId) => ({ storeId, appliedVersion: 0, appliedAt: null, online: true })),
      };
    },

    async metrics() {
      return STORE_IDS.map((storeId) => ({ storeId, lostCents: 0, blockedCents: 0, perMinute: [] }));
    },

    async learnNow() { return { started: false, reason: 'The stand-in agent does not learn yet.' }; },
    async runEval() { throw new AgentError('unavailable', 'Evaluations are not built yet.'); },
    async gateDemo() { throw new AgentError('unavailable', 'The gate demo is not built yet.'); },
    async rollback() { return { fromVersion: 0, toVersion: 0 }; },
    async reset() {},
    async setStoreOnline() {},
  };
}
