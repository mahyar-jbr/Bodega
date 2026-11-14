import type { Db } from 'mongodb';
import type { FlashSale, FlashSaleResult } from '../bots/flash';
import type { StoreId } from '../shared/contract';

export type FlashRun = Pick<FlashSaleResult, 'kind' | 'storeId' | 'status' | 'startedAt'>
  & Partial<Omit<FlashSaleResult, 'shopperIds'>>;

function publicResult({ shopperIds: _shopperIds, ...result }: FlashSaleResult): FlashRun {
  return result;
}

// The money work outlives its POST request. bot_runs remains the durable result and SSE source.
export function createFlashJobs(flash: FlashSale, db: Db) {
  const jobs = new Map<StoreId, FlashRun>();
  const running = (storeId?: StoreId) => storeId
    ? jobs.get(storeId)?.status === 'running'
    : [...jobs.values()].some((job) => job.status === 'running');

  return {
    running,
    clear: () => jobs.clear(),
    start(storeId: StoreId): FlashRun {
      const startedAt = new Date();
      const pending: FlashRun = { kind: 'flash', storeId, status: 'running', startedAt };
      jobs.set(storeId, pending);
      void flash.runFlashSale({ storeId }).then((result) => {
        jobs.set(storeId, publicResult(result));
      }).catch(() => {
        // Do not send driver errors or connection details to the browser.
        jobs.set(storeId, {
          ...pending, status: 'failed', passed: false, error: 'flash_run_failed',
          finishedAt: new Date(), durationMs: Date.now() - startedAt.valueOf(),
        });
      });
      return pending;
    },
    async status(storeId: StoreId): Promise<FlashRun | null> {
      const job = jobs.get(storeId);
      if (job && job.status !== 'running') return job;
      const saved = await db.collection<FlashSaleResult>('bot_runs').findOne(
        { kind: 'flash', storeId, ...(job ? { startedAt: { $gte: job.startedAt } } : {}) },
        { sort: { startedAt: -1 }, projection: { _id: 0, shopperIds: 0 } },
      );
      return saved ? publicResult(saved) : job ?? null;
    },
  };
}
