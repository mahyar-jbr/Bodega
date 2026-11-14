import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FlashSalePanel, latestFlashRun, type FlashRunView } from './FlashSalePanel';

const result: FlashRunView = {
  kind: 'flash', runId: 'test-run', storeId: 'queen', status: 'done', startedAt: new Date().toISOString(),
  attempted: 100, succeeded: 10, failed: 90, stockAfter: 0, ordersCount: 10, salesCount: 10,
  walletsChecked: 100, walletsMatchLedger: true, noNegativeWallets: true, grantsCorrect: true,
  salesMatchOrders: true, passed: true, errors: { out_of_stock: 90 }, durationMs: 105_000,
};
const render = (run: FlashRunView) => renderToStaticMarkup(<FlashSalePanel store="queen" run={run} disabled={false} onStoreChange={() => {}} onStart={() => {}} />);

describe('flash results', () => {
  it('shows a long running state without announcing a completed integrity check', () => {
    const html = render({ kind: 'flash', storeId: 'queen', status: 'running', startedAt: new Date().toISOString() });
    expect(html).toContain('Flash sale running');
    expect(html).toContain('2 minutes or longer');
    expect(html).not.toContain('Integrity checks passed');
  });

  it('shows purchases, expected failures, empty stock and all four successful integrity checks', () => {
    const html = render(result);
    expect(html).toContain('Integrity checks passed');
    expect(html).toContain('10 / 100');
    expect(html).toContain('90 out of stock (expected)');
    expect(html).toContain('Stock left</dt><dd>0');
    expect(html).toContain('1m 45s');
    expect(html.match(/>Passed</g)).toHaveLength(4);
    const failed = render({ ...result, status: 'failed', passed: false, walletsMatchLedger: false });
    expect(failed).toContain('Needs attention');
    expect(failed).toContain('>Failed<');
  });

  it('does not regress a final result when an older poll or running SSE event arrives', () => {
    expect(latestFlashRun(result, { ...result, status: 'running' })).toBe(result);
    expect(latestFlashRun(result, { ...result, runId: 'older-run', startedAt: new Date(0).toISOString() })).toBe(result);
  });
});
