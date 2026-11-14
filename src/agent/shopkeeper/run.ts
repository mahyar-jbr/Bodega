// runShopkeeper: one shopkeeper conversation on a given StoreApi and guardrail version. The one entry
// point for live chats (handleMessage wraps it, after saving the conversation) and the evaluation
// (each case on a fresh MemoryStore), so both run the exact same frozen settings.
//
// S05: the types are final; the body is a stub with no model, which really calls checkout when a
// message names catalog items. The real shopkeeper (Sonnet 5.5, ring_up and refund) replaces the
// body at M1-02 without changing the signature.
import { nanoid } from 'nanoid';
import type { ChatReply, StoreApi, StoreId } from '../../shared/contract';
import { formatCents } from '../../shared/money';
import type { GuardrailVersion } from '../guard/types';

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
  /** Recorded on orders and ledger entries; null in evaluations. */
  conversationId?: string | null;
  /** For a blocked call's friendly reply: the store that first saw a con the rule covers. */
  firstSeenStore?: (conIds: string[]) => StoreId | null;
  signal?: AbortSignal;
}

/** One model message, kept as the Anthropic API shapes it (opaque outside the shopkeeper). */
export type ShopkeeperMessage = { role: 'user' | 'assistant'; content: unknown };

export type TranscriptEntry =
  | { role: 'customer'; text: string }
  | { role: 'shopkeeper'; text: string }
  | { role: 'tool'; name: 'ring_up' | 'refund'; input: unknown;
      outcome: 'done' | 'capped' | 'blocked' | 'failed'; detail: string };

export interface RunShopkeeperResult {
  /** The last shopkeeper reply (what the phone shows). */
  reply: string;
  transcript: TranscriptEntry[];
  /** Money that moved, in order. */
  actions: ChatReply['actions'];
  /** Money calls the guard blocked. */
  blocked: ChatReply['blocked'];
  walletCents: number;
  /** The whole conversation so far, to save and pass back as `history` next time. */
  messages: ShopkeeperMessage[];
  usage: { modelCalls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  latencyMs: number;
}

export async function runShopkeeper(input: RunShopkeeperInput): Promise<RunShopkeeperResult> {
  const started = Date.now();
  const transcript: TranscriptEntry[] = [];
  const actions: ChatReply['actions'] = [];
  const messages: ShopkeeperMessage[] = [...(input.history ?? [])];
  const catalog = await input.store.catalog(input.storeId);
  let reply = '';

  for (const text of input.turns) {
    transcript.push({ role: 'customer', text });
    messages.push({ role: 'user', content: text });
    const items = parseItems(text, catalog);
    if (items.length === 0) {
      reply = `Welcome! I can ring up ${catalog.slice(0, 4).map((p) => `${p.emoji} ${p.name.toLowerCase()}`).join(', ')} and more. What would you like?`;
    } else {
      const call = { items: items.map(({ sku, qty }) => ({ sku, qty })) };
      const result = await input.store.checkout({
        storeId: input.storeId, shopperId: input.shopperId, idempotencyKey: `standin-${nanoid()}`,
        items: call.items, conversationId: input.conversationId ?? undefined, guardVersion: input.version.version,
      });
      if (result.ok) {
        actions.push({ kind: 'order', orderNumber: result.order.number, totalCents: result.order.totalCents });
        transcript.push({ role: 'tool', name: 'ring_up', input: call, outcome: 'done', detail: result.order.number });
        const list = items.map((i) => `${i.qty} × ${i.name.toLowerCase()}`).join(', ');
        reply = `Done! ${list}: ${formatCents(result.order.totalCents)}. Your order number is ${result.order.number}.`;
      } else {
        transcript.push({ role: 'tool', name: 'ring_up', input: call, outcome: 'failed', detail: result.error });
        reply = result.error === 'insufficient_funds' ? "Sorry, that's more than your wallet has."
          : result.error === 'out_of_stock' ? "Sorry, we're out of that one." : "Sorry, I couldn't ring that up.";
      }
    }
    transcript.push({ role: 'shopkeeper', text: reply });
    messages.push({ role: 'assistant', content: reply });
  }

  const shopper = await input.store.shopper(input.shopperId);
  return {
    reply, transcript, actions, blocked: [], walletCents: shopper?.walletCents ?? 0, messages,
    usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    latencyMs: Date.now() - started,
  };
}

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/** The stub's "understanding": catalog items named in the text, with a quantity just before them. */
function parseItems(text: string, catalog: { sku: string; name: string }[]) {
  const lower = text.toLowerCase();
  const found: { sku: string; name: string; qty: number }[] = [];
  for (const p of catalog) {
    const words = [p.sku, p.name.toLowerCase(), ...p.name.toLowerCase().split(' ').filter((w) => w.length > 4)];
    const hit = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (hit === undefined) continue;
    const before = lower.slice(0, hit).trim().split(/\s+/).slice(-3);
    const qtyWord = before.reverse().find((w) => /^\d+$/.test(w) || w in NUMBER_WORDS);
    const qty = qtyWord ? Math.min(20, Math.max(1, /^\d+$/.test(qtyWord) ? Number(qtyWord) : NUMBER_WORDS[qtyWord]!)) : 1;
    found.push({ sku: p.sku, name: p.name, qty });
  }
  return found;
}
