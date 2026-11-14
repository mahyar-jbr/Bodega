// The keyless shopkeeper: no model, so the app runs without an API key (Kasra's machine, tests).
// It really calls checkout when a message names catalog items, through the same money step.
import type { Product } from '../../shared/contract';
import { formatCents } from '../../shared/money';
import { runMoneyStep, type MoneyStepContext } from './money-step';
import type { TranscriptEntry } from './run';

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };

export async function stubTurn(text: string, catalog: Product[], ctx: MoneyStepContext, callId: string) {
  const items = parseItems(text, catalog);
  const tools: Extract<TranscriptEntry, { role: 'tool' }>[] = [];
  if (items.length === 0) {
    return { reply: `Welcome! I can ring up ${catalog.slice(0, 4).map((p) => `${p.emoji} ${p.name.toLowerCase()}`).join(', ')} and more. What would you like?`, tools, step: null };
  }
  const step = await runMoneyStep('ring_up', callId, { items: items.map(({ sku, qty }) => ({ sku, qty, unit_price: null })), discount: null }, ctx);
  tools.push(step.entry);
  const list = items.map((i) => `${i.qty} × ${i.name.toLowerCase()}`).join(', ');
  const reply = step.action?.kind === 'order'
    ? `Done! ${list}: ${formatCents(step.action.totalCents)}. Your order number is ${step.action.orderNumber}.`
    : step.entry.detail === 'insufficient_funds' ? "Sorry, that's more than your wallet has."
      : step.entry.detail === 'out_of_stock' ? "Sorry, we're out of that one." : "Sorry, I couldn't ring that up.";
  return { reply, tools, step };
}

/** Catalog items named in the text, with a quantity just before them. */
export function parseItems(text: string, catalog: { sku: string; name: string }[]) {
  const lower = text.toLowerCase();
  const found: { sku: string; name: string; qty: number }[] = [];
  for (const p of catalog) {
    const words = [p.sku, p.name.toLowerCase(), ...p.name.toLowerCase().split(' ').filter((w) => w.length > 4)];
    const hit = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (hit === undefined) continue;
    const before = lower.slice(0, hit).trim().split(/\s+/).slice(-3).reverse();
    const qtyWord = before.find((w) => /^\d+$/.test(w) || w in NUMBER_WORDS);
    const qty = qtyWord ? Math.min(20, Math.max(1, /^\d+$/.test(qtyWord) ? Number(qtyWord) : NUMBER_WORDS[qtyWord]!)) : 1;
    found.push({ sku: p.sku, name: p.name, qty });
  }
  return found;
}
