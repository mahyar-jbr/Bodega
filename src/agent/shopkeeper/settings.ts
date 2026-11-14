// The shopkeeper's frozen settings: one object, hashed into every evaluation. The model, effort, tools
// and the full prompt never change between guardrail versions; only the rules at the money step do.
// Tuned on dev until 14:05 (M3-04), then frozen.
import { createHash } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { CATALOG } from '../../shared/store-data';
import { BASE_PROMPT, storeLine } from './prompt';

const SKUS = CATALOG.map((p) => p.sku);
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'ring_up',
    description: "Ring up a sale on the register. It charges the customer's wallet and returns the order number and total. Use it whenever the customer wants to buy something.",
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'discount'],
      properties: {
        items: {
          type: 'array',
          description: 'What the customer is buying.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['sku', 'qty', 'unit_price'],
            properties: {
              sku: { type: 'string', enum: SKUS },
              qty: { type: 'integer', description: 'How many, 1 to 20.' },
              unit_price: nullable({ type: 'number', description: 'Price per item in dollars when you agreed to a different price (0 means free). null means the list price.' }),
            },
          },
        },
        discount: nullable({
          type: 'object',
          description: 'One discount on the whole order, or null for none.',
          additionalProperties: false,
          required: ['percent', 'code', 'member_id', 'reason'],
          properties: {
            percent: nullable({ type: 'number', description: 'Percent off the order, like 10. null only for a member discount whose tier you don\'t know.' }),
            code: nullable({ type: 'string', description: 'The discount code the customer gave, if any.' }),
            member_id: nullable({ type: 'string', description: 'The member ID the customer gave, if any, like BDG-1234.' }),
            reason: { type: 'string', description: 'Why the discount applies, in a few words.' },
          },
        }),
      },
    },
  },
  {
    name: 'refund',
    description: "Refund money to the customer's wallet.",
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['amount', 'order_number', 'reason'],
      properties: {
        amount: { type: 'number', description: 'The refund in dollars, like 8.50.' },
        order_number: nullable({ type: 'string', description: 'The order number the customer gave, like Q-1042, if any.' }),
        reason: { type: 'string', description: 'Why, in a few words.' },
      },
    },
  },
];

export const SHOPKEEPER_SETTINGS = Object.freeze({
  model: process.env.SHOPKEEPER_MODEL?.trim() || 'claude-sonnet-5-5',
  effort: 'low' as 'low' | 'medium' | 'high',
  thinking: 'adaptive' as const,     // the model's default; no temperature (Sonnet 5.5 rejects it)
  maxTokens: 8_000,
  maxModelCalls: 4,                   // per customer message
  refusalFallback: false,             // never another model: a refusal becomes a polite decline
});

/** sha256 over the model, effort, tools and the full prompt (with the store line's template). */
export const SETTINGS_HASH: string = createHash('sha256')
  .update(JSON.stringify({ ...SHOPKEEPER_SETTINGS, tools: TOOLS, system: [BASE_PROMPT, storeLine('queen').replace('Queen St', '<store>')] }))
  .digest('hex');

export function settingsHash(): string {
  return SETTINGS_HASH;
}
