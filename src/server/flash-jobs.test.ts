import type { Db } from 'mongodb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlashSaleResult } from '../bots/flash';
import { createFlashJobs } from './flash-jobs';

afterEach(() => vi.useRealTimers());

export function completedFlash(storeId: FlashSaleResult['storeId'] = 'queen'): FlashSaleResult {
  return {
    runId: 'flash-test', kind: 'flash', storeId, status: 'done', shopperIds: ['private-shopper-id'],
    attempted: 100, succeeded: 10, failed: 90, errors: { out_of_stock: 90 }, error: null,
    stockBefore: 10, stockAfter: 0, salesCount: 10, ordersCount: 10, walletsChecked: 100,
    walletsMatchLedger: true, noNegativeWallets: true, grantsCorrect: true, salesMatchOrders: true,
    passed: true, startedAt: new Date(), finishedAt: new Date(), durationMs: 105_000,
  };
}

function database(saved: FlashSaleResult | null = null) {
  const findOne = vi.fn(async () => saved);
  return { db: { collection: () => ({ findOne }) } as unknown as Db, findOne };
}

describe('background flash jobs', () => {
  it('returns a running state immediately and retains the result after a 105-second run', async () => {
    vi.useFakeTimers();
    const { db } = database();
    const flash = { runFlashSale: vi.fn(() => new Promise<FlashSaleResult>((resolve) => setTimeout(() => resolve(completedFlash()), 105_000))) };
    const jobs = createFlashJobs(flash, db);
    expect(jobs.start('queen').status).toBe('running');
    expect(jobs.running('queen')).toBe(true);
    await vi.advanceTimersByTimeAsync(104_000);
    expect((await jobs.status('queen'))?.status).toBe('running');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(jobs.running()).toBe(false);
    const result = await jobs.status('queen');
    expect(result).toMatchObject({ status: 'done', succeeded: 10, failed: 90, stockAfter: 0, passed: true });
    expect(result).not.toHaveProperty('shopperIds');
  });

  it('recovers the persisted result for a new console/process and projects out shopper identifiers', async () => {
    const { db, findOne } = database(completedFlash('yonge'));
    const jobs = createFlashJobs({ runFlashSale: vi.fn() }, db);
    expect(await jobs.status('yonge')).toMatchObject({ storeId: 'yonge', passed: true });
    expect(findOne).toHaveBeenCalledWith({ kind: 'flash', storeId: 'yonge' }, expect.objectContaining({ projection: { _id: 0, shopperIds: 0 } }));
  });

  it('reports a background failure without leaking the driver error', async () => {
    const { db } = database();
    const jobs = createFlashJobs({ runFlashSale: vi.fn(async () => { throw new Error('private connection details'); }) }, db);
    jobs.start('queen');
    await vi.waitFor(() => expect(jobs.running()).toBe(false));
    expect(await jobs.status('queen')).toMatchObject({ status: 'failed', error: 'flash_run_failed', passed: false });
    expect(JSON.stringify(await jobs.status('queen'))).not.toContain('private');
  });
});
