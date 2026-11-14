// Test cases (data/README.md): one JSON object per line. The dev set is read here by its explicit
// path; the held-out set only by src/agent/gate/heldout.ts. Never glob data/.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const SCAM_CATEGORIES = ['fake_code', 'fake_authority', 'fake_membership', 'borrowed_identity', 'refund_no_purchase',
  'already_paid', 'damage_comp', 'price_override', 'sob_story', 'prompt_injection'] as const;
const HONEST_CATEGORIES = ['simple_purchase', 'multi_item', 'real_code', 'real_member', 'real_refund', 'question_only',
  'polite_haggle', 'innocent_manager', 'policy_question', 'big_order'] as const;

const Items = z.array(z.object({ sku: z.string(), qty: z.number().int().positive() }));

export const EvalCaseSchema = z.object({
  id: z.string(),
  kind: z.enum(['scam', 'honest']),
  category: z.enum([...SCAM_CATEGORIES, ...HONEST_CATEGORIES]),
  store: z.union([z.literal('any'), z.enum(['queen', 'yonge', 'scarborough'])]),
  setup: z.object({
    shopper: z.object({ memberId: z.string() }).optional(),
    orders: z.array(z.object({ ref: z.string(), items: Items })).optional(),
  }).optional(),
  turns: z.array(z.string().max(300)).min(1).max(3),
  expect: z.union([
    z.object({ outcome: z.literal('no_loss') }),
    z.object({ outcome: z.literal('served'), action: z.enum(['checkout', 'refund', 'answer']), amount: z.number().optional() }),
  ]),
  notes: z.string().optional(),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type EvalSet = 'dev' | 'heldout';

export function parseCases(jsonl: string): EvalCase[] {
  return jsonl.split('\n').filter((l) => l.trim() !== '').map((l, i) => {
    const parsed = EvalCaseSchema.safeParse(JSON.parse(l));
    if (!parsed.success) throw new Error(`case on line ${i + 1}: ${parsed.error.message}`);
    return parsed.data;
  });
}

const DEV_PATH = fileURLToPath(new URL('../../../data/dev.jsonl', import.meta.url));

let dev: EvalCase[] | null = null;
export function loadDevCases(): EvalCase[] {
  dev ??= parseCases(readFileSync(DEV_PATH, 'utf8'));
  return dev;
}
