// The money step: turns one ring_up or refund tool call into a store call, through the guard's hook.
// The model passes dollars; this converts them to integer cents. The tool call id is the
// idempotency key, so a retried call never doubles an order.
import type { ChatReply, CheckoutRequest, DiscountClaim, RefundRequest, StoreId } from '../../shared/contract';
import { dollarsToCents, formatCents, isValidPct, totalCents } from '../../shared/money';
import { MAX_QTY } from '../../shared/memory-store';
import { checkMoneyCall, type MoneyCall, type MoneyContext } from '../guard/check';
import type { GuardrailVersion } from '../guard/types';
import type { TranscriptEntry } from './run';

export interface RingUpInput {
  items: { sku: string; qty: number; unit_price: number | null }[];
  discount: { percent: number | null; code: string | null; member_id: string | null; reason: string } | null;
}
export interface RefundInput { amount: number; order_number: string | null; reason: string }

export interface MoneyStepResult {
  /** The tool_result content for the model (JSON text). */
  content: string;
  isError: boolean;
  entry: Extract<TranscriptEntry, { role: 'tool' }>;
  action?: ChatReply['actions'][number];
  blocked?: ChatReply['blocked'][number] & { cents: number };
}

export interface MoneyStepContext extends MoneyContext {
  version: GuardrailVersion;
  firstSeenStore?: (conIds: string[]) => StoreId | null;
}

const reply = (value: unknown) => JSON.stringify(value);

export async function runMoneyStep(name: string, id: string, input: unknown, ctx: MoneyStepContext): Promise<MoneyStepResult> {
  if (name === 'ring_up') return ringUp(id, input as RingUpInput, ctx);
  if (name === 'refund') return refund(id, input as RefundInput, ctx);
  const detail = `Unknown tool "${name}". The tools are ring_up and refund.`;
  return { content: reply({ ok: false, error: detail }), isError: true,
    entry: { role: 'tool', name: 'ring_up', input, outcome: 'failed', detail } };
}

async function ringUp(id: string, input: RingUpInput, ctx: MoneyStepContext): Promise<MoneyStepResult> {
  const fail = (detail: string): MoneyStepResult => ({ content: reply({ ok: false, error: detail }), isError: true,
    entry: { role: 'tool', name: 'ring_up', input, outcome: 'failed', detail } });

  if (!Array.isArray(input?.items) || input.items.length === 0) return fail('Add at least one item.');
  const items: CheckoutRequest['items'] = [];
  for (const item of input.items) {
    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > MAX_QTY) return fail(`qty must be a whole number from 1 to ${MAX_QTY}.`);
    if (item.unit_price !== null && (typeof item.unit_price !== 'number' || !(item.unit_price >= 0))) return fail('unit_price must be 0 or more, or null.');
    items.push({ sku: item.sku, qty: item.qty, ...(item.unit_price === null ? {} : { unitPriceCents: dollarsToCents(item.unit_price) }) });
  }

  let discount: DiscountClaim | undefined;
  if (input.discount) {
    const d = input.discount;
    let pct = d.percent;
    let memberId = d.member_id?.trim().toUpperCase() || null;
    // A member discount without a tier: the register applies the member's own percentage, for the ID the
    // customer gave or, with no ID, the membership on the customer's account. Whose membership an ID is
    // isn't checked here: that's for guardrails.
    if (pct === null || pct === 0) {
      memberId ??= (await ctx.store.shopper(ctx.shopperId))?.memberId ?? null;
      pct = memberId ? (await ctx.store.member(memberId))?.pct ?? null : null;
      if (pct === null) return fail(memberId ? "That member ID isn't one the register knows. Pass the percent, or ring it up without the discount."
        : "There's no membership on this customer's account. Pass the member ID or the percent, or ring it up without the discount.");
    }
    if (!isValidPct(pct)) return fail('percent must be more than 0 and at most 100.');
    discount = { pct, reason: d.reason, ...(d.code ? { code: d.code.trim() } : {}), ...(memberId ? { memberId } : {}) };
  }

  const request: CheckoutRequest = { storeId: ctx.storeId, shopperId: ctx.shopperId, idempotencyKey: id, items,
    ...(discount ? { discount } : {}), conversationId: ctx.conversationId, guardVersion: ctx.version.version };
  const decision = await checkMoneyCall(ctx.version, { tool: 'checkout', request }, ctx);

  if (decision.action === 'block') return blockedResult('ring_up', input, request, decision.rule, ctx);
  let capNote: string | undefined;
  if (decision.action === 'cap' && request.discount) {
    capNote = decision.rule.tellCustomer;
    if (decision.pct > 0) request.discount = { ...request.discount, pct: decision.pct };
    else delete request.discount;
  }

  const result = await ctx.store.checkout(request);
  if (!result.ok) {
    const shopper = await ctx.store.shopper(ctx.shopperId);
    return { content: reply({ ok: false, error: result.error, detail: result.detail, wallet: formatCents(shopper?.walletCents ?? 0) }),
      isError: false, entry: { role: 'tool', name: 'ring_up', input, outcome: 'failed', detail: result.error } };
  }
  const { order } = result;
  return {
    content: reply({
      ok: true, order_number: order.number,
      items: order.lines.map((l) => `${l.qty} x ${l.sku} at ${formatCents(l.unitPriceCents)}`),
      subtotal: formatCents(order.subtotalCents),
      discount: order.discount ? `${order.discount.pct}% (-${formatCents(order.discount.cents)})` : 'none',
      total: formatCents(order.totalCents), wallet_left: formatCents(result.walletCents),
      ...(capNote ? { register_note: `The register lowered the discount. ${capNote}` } : {}),
    }),
    isError: false,
    entry: { role: 'tool', name: 'ring_up', input, outcome: capNote ? 'capped' : 'done', detail: order.number },
    action: { kind: 'order', orderNumber: order.number, totalCents: order.totalCents },
  };
}

async function refund(id: string, input: RefundInput, ctx: MoneyStepContext): Promise<MoneyStepResult> {
  if (typeof input?.amount !== 'number' || !(input.amount > 0)) {
    const detail = 'amount must be more than 0.';
    return { content: reply({ ok: false, error: detail }), isError: true, entry: { role: 'tool', name: 'refund', input, outcome: 'failed', detail } };
  }
  const request: RefundRequest = { storeId: ctx.storeId, shopperId: ctx.shopperId, idempotencyKey: id,
    amountCents: dollarsToCents(input.amount), reason: input.reason ?? '',
    ...(input.order_number?.trim() ? { orderNumber: input.order_number.trim() } : {}),
    conversationId: ctx.conversationId, guardVersion: ctx.version.version };
  const decision = await checkMoneyCall(ctx.version, { tool: 'refund', request }, ctx);
  if (decision.action !== 'pass') return blockedResult('refund', input, request, decision.rule, ctx);

  const result = await ctx.store.refund(request);
  if (!result.ok) {
    return { content: reply({ ok: false, error: result.error, detail: result.detail }), isError: false,
      entry: { role: 'tool', name: 'refund', input, outcome: 'failed', detail: result.error } };
  }
  return {
    content: reply({ ok: true, refunded: formatCents(result.entry.walletDeltaCents), wallet_now: formatCents(result.walletCents) }),
    isError: false,
    entry: { role: 'tool', name: 'refund', input, outcome: 'done', detail: formatCents(result.entry.walletDeltaCents) },
    action: { kind: 'refund', amountCents: result.entry.walletDeltaCents, orderNumber: result.order?.number ?? null },
  };
}

async function blockedResult(tool: 'ring_up' | 'refund', input: unknown, request: MoneyCall['request'],
  rule: { id: string; title: string; tellCustomer: string; cons: string[] }, ctx: MoneyStepContext): Promise<MoneyStepResult> {
  const firstSeenStore = ctx.firstSeenStore?.(rule.cons) ?? null;
  // What the blocked call would have given away: a refund's amount, or how far a sale fell below list price.
  const listCents = 'items' in request ? await listTotalCents(request, ctx) : 0;
  const cents = 'amountCents' in request ? request.amountCents : Math.max(0, listCents - (await requestedTotalCents(request, ctx)));
  const listTotal = 'items' in request ? formatCents(listCents) : undefined;
  return {
    content: JSON.stringify({ ok: false, register_refused: true, reason: rule.tellCustomer,
      ...(listTotal ? { list_price_total: listTotal, offer: 'You can ring it up at the list price instead.' } : {}) }),
    isError: false,
    entry: { role: 'tool', name: tool, input, outcome: 'blocked', detail: rule.id },
    blocked: { ruleId: rule.id, title: rule.title, firstSeenStore, cents },
  };
}

async function requestedTotalCents(request: CheckoutRequest, ctx: MoneyStepContext): Promise<number> {
  let subtotal = 0;
  for (const item of request.items) subtotal += item.qty * (item.unitPriceCents ?? (await ctx.store.product(item.sku))?.priceCents ?? 0);
  return request.discount ? totalCents(subtotal, request.discount.pct) : subtotal;
}

async function listTotalCents(request: CheckoutRequest, ctx: MoneyStepContext): Promise<number> {
  let total = 0;
  for (const item of request.items) total += item.qty * ((await ctx.store.product(item.sku))?.priceCents ?? 0);
  return total;
}
