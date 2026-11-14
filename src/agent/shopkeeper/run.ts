// runShopkeeper: one shopkeeper conversation on a given StoreApi and guardrail version. The one entry
// point for live chats (handleMessage wraps it, after saving the conversation) and the evaluation
// (each case on a fresh MemoryStore), so both run the exact same frozen settings (./settings.ts).
// Money moves only through ring_up and refund, and every call goes through the guard's hook.
// Without ANTHROPIC_API_KEY it runs the keyless stub (./stub.ts) instead of the model.
import Anthropic from '@anthropic-ai/sdk';
import { nanoid } from 'nanoid';
import type { ChatReply, StoreApi, StoreId } from '../../shared/contract';
import type { GuardrailVersion } from '../guard/types';
import { runMoneyStep, type MoneyStepContext } from './money-step';
import { BASE_PROMPT, REFUSAL_REPLY, storeLine, TOO_MANY_STEPS_REPLY } from './prompt';
import { SHOPKEEPER_SETTINGS, TOOLS } from './settings';
import { stubTurn } from './stub';

export interface RunShopkeeperInput {
  store: StoreApi;
  storeId: StoreId;
  shopperId: string;
  /** The customer's new messages, answered in order (a live chat sends one; an eval case sends 1 to 3). */
  turns: string[];
  /** The guardrail version this store has applied (V0 has no rules). */
  version: GuardrailVersion;
  /** The conversation's earlier model messages, as a previous result's `messages` (live chats only). */
  history?: ShopkeeperMessage[];
  /** Recorded on orders and ledger entries, and used by the same-conversation refund rule.
   *  Live chats pass the real one; the eval runner passes `eval:<caseId>`. Generated if absent. */
  conversationId?: string;
  /** For a blocked call's friendly reply: the store that first saw a con the rule covers. */
  firstSeenStore?: (conIds: string[]) => StoreId | null;
  signal?: AbortSignal;
}

/** One model message, exactly as the Anthropic API shapes it (thinking blocks included, unchanged). */
export type ShopkeeperMessage = Anthropic.MessageParam;

export type TranscriptEntry =
  | { role: 'customer'; text: string }
  | { role: 'shopkeeper'; text: string; stop?: string }
  | { role: 'tool'; name: 'ring_up' | 'refund'; input: unknown;
      outcome: 'done' | 'capped' | 'blocked' | 'failed'; detail: string };

export interface RunShopkeeperResult {
  /** The last shopkeeper reply (what the phone shows). */
  reply: string;
  transcript: TranscriptEntry[];
  /** Money that moved, in order. */
  actions: ChatReply['actions'];
  /** Money calls the guard blocked, with what each would have given away. */
  blocked: (ChatReply['blocked'][number] & { cents: number })[];
  walletCents: number;
  conversationId: string;
  /** The whole conversation so far, to save and pass back as `history` next time (append-only). */
  messages: ShopkeeperMessage[];
  usage: { modelCalls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  refusals: number;
  latencyMs: number;
}

let client: Anthropic | undefined;
function anthropic(): Anthropic {
  client ??= new Anthropic({ maxRetries: 4, timeout: 90_000 });
  return client;
}

export function hasModelKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function runShopkeeper(input: RunShopkeeperInput): Promise<RunShopkeeperResult> {
  const started = Date.now();
  const conversationId = input.conversationId ?? `chat:${nanoid()}`;
  const ctx: MoneyStepContext = { store: input.store, storeId: input.storeId, shopperId: input.shopperId,
    conversationId, version: input.version, firstSeenStore: input.firstSeenStore };
  const out: RunShopkeeperResult = {
    reply: '', transcript: [], actions: [], blocked: [], walletCents: 0, conversationId,
    messages: [...(input.history ?? [])],
    usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    refusals: 0, latencyMs: 0,
  };

  for (const text of input.turns) {
    out.transcript.push({ role: 'customer', text });
    if (hasModelKey()) {
      out.reply = await modelTurn(text, input, ctx, out);
    } else {
      const catalog = await input.store.catalog(input.storeId);
      const turn = await stubTurn(text, catalog, ctx, `stub_${nanoid()}`);
      out.transcript.push(...turn.tools);
      if (turn.step?.action) out.actions.push(turn.step.action);
      if (turn.step?.blocked) out.blocked.push(turn.step.blocked);
      out.messages.push({ role: 'user', content: text }, { role: 'assistant', content: turn.reply });
      out.reply = turn.reply;
    }
    out.transcript.push({ role: 'shopkeeper', text: out.reply });
  }

  out.walletCents = (await input.store.shopper(input.shopperId))?.walletCents ?? 0;
  out.latencyMs = Date.now() - started;
  return out;
}

/** One customer message: up to maxModelCalls model calls, running every money tool call in between. */
async function modelTurn(text: string, input: RunShopkeeperInput, ctx: MoneyStepContext, out: RunShopkeeperResult): Promise<string> {
  const s = SHOPKEEPER_SETTINGS;
  out.messages.push({ role: 'user', content: text });

  for (let call = 1; call <= s.maxModelCalls; call++) {
    const response = await anthropic().messages.create({
      model: s.model,
      max_tokens: s.maxTokens,
      output_config: { effort: s.effort },
      // Tools and the base prompt are the same for every store and version: cached once.
      system: [
        { type: 'text', text: BASE_PROMPT, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: storeLine(input.storeId) },
      ],
      tools: TOOLS,
      tool_choice: { type: 'auto' },
      // The conversation so far is cached too, so the tool loop's next call re-reads it cheaply.
      cache_control: { type: 'ephemeral' },
      messages: out.messages,
    }, { signal: input.signal });

    out.usage.modelCalls++;
    out.usage.inputTokens += response.usage.input_tokens;
    out.usage.outputTokens += response.usage.output_tokens;
    out.usage.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
    out.usage.cacheWriteTokens += response.usage.cache_creation_input_tokens ?? 0;

    if (response.stop_reason === 'refusal') {
      // Never another model (the same-model claim): a refusal becomes a polite decline.
      out.refusals++;
      out.messages.push({ role: 'assistant', content: [{ type: 'text', text: REFUSAL_REPLY }] });
      return REFUSAL_REPLY;
    }

    // Append-only: the assistant turn goes back exactly as it came, thinking blocks included.
    out.messages.push({ role: 'assistant', content: response.content });
    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const replyText = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();

    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      return replyText || "Sorry, could you say that again?";
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    if (call === s.maxModelCalls) {
      // No model call is left to read the results: answer every call so the history stays valid.
      for (const t of toolUses) results.push({ type: 'tool_result', tool_use_id: t.id, is_error: true, content: 'Not run: too many register steps for one message.' });
      out.messages.push({ role: 'user', content: results });
      return TOO_MANY_STEPS_REPLY;
    }
    for (const t of toolUses) {
      const step = await runMoneyStep(t.name, t.id, t.input, ctx);
      out.transcript.push(step.entry);
      if (step.action) out.actions.push(step.action);
      if (step.blocked) out.blocked.push(step.blocked);
      results.push({ type: 'tool_result', tool_use_id: t.id, content: step.content, ...(step.isError ? { is_error: true } : {}) });
    }
    // Every result in one user message.
    out.messages.push({ role: 'user', content: results });
  }
  return TOO_MANY_STEPS_REPLY;
}
