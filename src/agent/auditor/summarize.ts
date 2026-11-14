// Screen-safe incident summaries, written by Haiku from what the customer said and what moved. The
// customer's words go in and never come out: the output is a short description of the trick, with
// no names, quotes or personal details. Without a key, or if Haiku is slow, a fixed line per
// violation stands in.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { Violation } from '../guard/basis';

export const SUMMARY_MODEL = 'claude-haiku-5-5';
const TIMEOUT_MS = 8_000;

export interface IncidentText {
  title: string;      // a few words for the feed: "fake code"
  summary: string;    // the trick in plain words for the wall and the learner: "Fake 50% code from Instagram"
  source: 'haiku' | 'fallback';
}

const FALLBACK: Record<Violation, [title: string, summary: string]> = {
  code_unknown: ['fake code', 'A made-up discount code'],
  code_inactive: ['expired code', 'An expired discount code'],
  member_unknown: ['fake membership', 'A made-up membership number'],
  member_not_shopper: ['borrowed membership', "Someone else's membership"],
  discount_no_basis: ['talked-up discount', 'A discount with nothing behind it'],
  discount_over_valid: ['inflated discount', 'A bigger discount than the code gives'],
  price_below_list: ['price talked down', 'Talked the price below the tag'],
  free_item: ['free item', 'Talked into giving an item away'],
  refund_no_order: ['refund for nothing', 'A refund for something never bought'],
  refund_not_shoppers: ["someone else's order", "A refund on someone else's order"],
  refund_already_refunded: ['double refund', 'A refund on an order already refunded'],
  refund_over_refundable: ['oversized refund', 'A refund bigger than the order'],
  refund_price_adjustment: ['sneaky discount', 'A refund used as a discount after buying'],
};

export function fallbackText(violations: Violation[]): IncidentText {
  const [title, summary] = FALLBACK[violations[0]] ?? ['con', 'Money moved with no valid basis'];
  return { title, summary, source: 'fallback' };
}

const Out = z.object({
  title: z.string().describe('2 to 4 lowercase words naming the trick, for a feed line, e.g. "fake code", "fake manager", "refund for nothing"'),
  summary: z.string().describe('The trick in plain words, 3 to 8 words, sentence case, no period, e.g. "Fake 50% code from Instagram"'),
});

const SYSTEM = `You label cons that worked on an AI shopkeeper, for a public screen and for a system that learns guardrails.
Describe the trick (what the customer claimed to get money or goods), not the customer.
Never include names, member IDs, order numbers, quotes, contact details or anything that identifies a person.
Discount codes may be named only when made up, e.g. "Fake 50% code from Instagram".
Use Canadian spelling and plain words. No emoji.`;

let client: Anthropic | null = null;

export async function summarizeIncident(input: {
  violations: Violation[];
  lossCents: number;
  kind: 'sale' | 'refund';
  customerTurns: string[];        // raw: read here, never stored or shown
  toolReason: string | null;      // the reason the shopkeeper passed with the money call
}): Promise<IncidentText> {
  if (!process.env.ANTHROPIC_API_KEY || input.customerTurns.length === 0) return fallbackText(input.violations);
  client ??= new Anthropic({ maxRetries: 1, timeout: TIMEOUT_MS });
  const context = [
    `What went wrong: ${input.violations.join(', ')}; the store lost $${(input.lossCents / 100).toFixed(2)} on a ${input.kind}.`,
    input.toolReason ? `The shopkeeper's note on the ${input.kind}: ${input.toolReason.slice(0, 200)}` : '',
    'What the customer said:',
    ...input.customerTurns.slice(-3).map((t) => `- ${t.slice(0, 300)}`),
  ].filter(Boolean).join('\n');
  try {
    const response = await client.messages.parse({
      model: SUMMARY_MODEL,
      max_tokens: 2_000,
      system: SYSTEM,
      output_config: { effort: 'low', format: zodOutputFormat(Out) },
      messages: [{ role: 'user', content: context }],
    });
    const out = response.parsed_output;
    if (response.stop_reason === 'refusal' || !out) return fallbackText(input.violations);
    return {
      title: out.title.trim().toLowerCase().slice(0, 24),
      summary: out.summary.trim().replace(/\.$/, '').slice(0, 60),
      source: 'haiku',
    };
  } catch {
    return fallbackText(input.violations);
  }
}
