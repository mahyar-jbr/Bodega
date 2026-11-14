import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The held-out seal (ARCHITECTURE, "Sealed"): only the gate's loader may name the held-out file.
// The name is assembled here so that this test never contains it.
const HELDOUT = 'heldout' + '.jsonl';
const LOADER = 'src/agent/gate/heldout.ts';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// Code and config under src/, scripts/ and the repo root, tracked or new. Git's ignore rules keep out
// node_modules, dist and the personal files. Docs (.md) may describe the seal, and data/ is never read.
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|json)$/;
const inScope = (path: string) =>
  CODE.test(path) && (path.startsWith('src/') || path.startsWith('scripts/') || !path.includes('/'));

function codeFiles(): string[] {
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return [...new Set(listed.split('\0'))].filter((path) => inScope(path) && existsSync(join(ROOT, path)));
}

describe('held-out seal', () => {
  it(`lets only ${LOADER} name the held-out file`, () => {
    const files = codeFiles();
    expect(files).toContain('src/agent/gate/seal.test.ts'); // the scan really covers this repo's code
    const offenders = files.filter(
      (path) => path !== LOADER && readFileSync(join(ROOT, path), 'utf8').toLowerCase().includes(HELDOUT),
    );
    expect(offenders, `only ${LOADER} may name ${HELDOUT}`).toEqual([]);
  });
});
