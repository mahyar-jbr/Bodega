// The agent side's entry point (ARCHITECTURE Appendix A): createAgent({ store, db, bus }): AgentApi,
// then await agent.start(). Without ANTHROPIC_API_KEY the shopkeeper is the keyless stub.
import type { AgentApi, AgentDeps } from '../shared/contract';
import { createRealAgent, type AgentOptions } from './agent';

export function createAgent(deps: AgentDeps, options?: AgentOptions): AgentApi {
  return createRealAgent(deps, options);
}

export { LIMITS } from './agent';
export type { AgentOptions } from './agent';
export { atlasConversations, memoryConversations, conversationIdFor } from './conversations';

export { hasModelKey, runShopkeeper } from './shopkeeper/run';
export { SETTINGS_HASH, settingsHash, SHOPKEEPER_SETTINGS } from './shopkeeper/settings';
export type { RunShopkeeperInput, RunShopkeeperResult, ShopkeeperMessage, TranscriptEntry } from './shopkeeper/run';
export { V0, MAX_RULES } from './guard/types';
export type { GuardDecision, MoneyCall } from './guard/check';
export type { Condition, FactCondition, FactName, Facts, FactValue, GuardrailVersion, Rule } from './guard/types';
