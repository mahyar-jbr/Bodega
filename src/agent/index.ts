// The agent side's entry point (ARCHITECTURE Appendix A): createAgent(deps): AgentApi.
// Until M1-03 it is the stand-in agent: chat that really calls checkout, no model, no learning.
import type { AgentApi, AgentDeps } from '../shared/contract';
import { createStandInAgent } from './stand-in';

export function createAgent(deps: AgentDeps): AgentApi {
  return createStandInAgent(deps);
}

export { hasModelKey, runShopkeeper } from './shopkeeper/run';
export { SETTINGS_HASH, settingsHash, SHOPKEEPER_SETTINGS } from './shopkeeper/settings';
export type { RunShopkeeperInput, RunShopkeeperResult, ShopkeeperMessage, TranscriptEntry } from './shopkeeper/run';
export { V0, MAX_RULES } from './guard/types';
export type { GuardDecision, MoneyCall } from './guard/check';
export type { Condition, FactCondition, FactName, Facts, FactValue, GuardrailVersion, Rule } from './guard/types';
