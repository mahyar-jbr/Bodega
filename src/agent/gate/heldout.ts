// The sealed held-out set: the only file in the repo that names it (src/agent/gate/seal.test.ts).
// Its cases go only to the evaluation runner, in memory. Nothing per case leaves the evaluation:
// the learner, the screen and Atlas see aggregate numbers only.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCases, type EvalCase } from '../eval/cases';

const HELDOUT_PATH = fileURLToPath(new URL('../../../data/heldout.jsonl', import.meta.url));

let cases: EvalCase[] | null = null;
export function loadHeldoutCases(): EvalCase[] {
  cases ??= parseCases(readFileSync(HELDOUT_PATH, 'utf8'));
  return cases;
}
