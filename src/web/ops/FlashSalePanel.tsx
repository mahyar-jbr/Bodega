import { useEffect, useState } from 'react';
import type { FlashRun } from '../../server/flash-jobs';
import { Icon } from '../ui/Icon';
import { STORES, STORE_KEYS, type StoreKey } from '../ui/stores';

export type FlashRunView = Omit<FlashRun, 'startedAt' | 'finishedAt'> & {
  startedAt: string;
  finishedAt?: string | null;
};

export function latestFlashRun(current: FlashRunView | undefined, incoming: FlashRunView): FlashRunView {
  if (!current) return incoming;
  if (Date.parse(incoming.startedAt) < Date.parse(current.startedAt)) return current;
  if (incoming.runId === current.runId && current.status !== 'running' && incoming.status === 'running') return current;
  return incoming;
}

export function FlashSalePanel({ store, run, disabled, onStoreChange, onStart }: {
  store: StoreKey;
  run?: FlashRunView;
  disabled: boolean;
  onStoreChange: (store: StoreKey) => void;
  onStart: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const running = run?.status === 'running';
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);
  const seconds = run ? Math.max(0, Math.floor((running ? now - Date.parse(run.startedAt) : run.durationMs ?? 0) / 1_000)) : 0;

  return (
    <div className="ops-flash">
      <div className="ops-flash-controls">
        <label htmlFor="flash-store">Store</label>
        <select id="flash-store" value={store} onChange={(event) => onStoreChange(event.target.value as StoreKey)}>
          {STORE_KEYS.map((key) => <option key={key} value={key}>{STORES[key].name}</option>)}
        </select>
        <button type="button" className="ops-button is-secondary" disabled={disabled || running} onClick={onStart}>
          <Icon name="bot" size={18} />{running ? 'Flash sale running…' : 'Flash sale'}
        </button>
      </div>
      <p className="ops-panel-copy">100 shoppers, 10 hoodies. Allow 2 minutes or longer for the result.</p>
      {run && (
        <div className="ops-flash-result">
          <p className={`ops-flash-verdict ${running ? 'is-warning' : run.passed ? 'is-good' : 'is-bad'}`} role="status">
            <Icon name={running ? 'loop' : run.passed ? 'check-circle' : 'alert'} size={20} />
            <strong>{running ? 'Running' : run.passed ? 'Integrity checks passed' : 'Needs attention'}</strong>
            <time className="bd-num">{Math.floor(seconds / 60)}m {seconds % 60}s</time>
          </p>
          {running ? <p className="ops-panel-copy">{run.attempted ? 'Purchases are in progress. Integrity checks follow.' : 'Preparing shoppers and restocking the shelf.'} Results update here automatically, including after a reload.</p> : (
            <>
              <dl className="ops-flash-numbers bd-num">
                <div><dt>Purchases</dt><dd>{run.succeeded ?? '—'} / {run.attempted ?? 100}</dd></div>
                <div><dt>Unsuccessful</dt><dd>{run.failed ?? '—'}</dd></div>
                <div><dt>Stock left</dt><dd>{run.stockAfter ?? '—'}</dd></div>
                <div><dt>Orders / ledger sales</dt><dd>{run.ordersCount ?? '—'} / {run.salesCount ?? '—'}</dd></div>
                <div><dt>Wallets checked</dt><dd>{run.walletsChecked ?? '—'} / 100</dd></div>
              </dl>
              {run.errors && Object.entries(run.errors).map(([error, count]) => (
                <p className="ops-panel-copy" key={error}>{count} {error === 'out_of_stock' ? 'out of stock (expected)' : error.replaceAll('_', ' ')}</p>
              ))}
              {run.error && <p className="ops-flash-error">The run could not complete. Check the ops log before retrying.</p>}
              <ul className="ops-integrity-checks">
                <IntegrityCheck label="Wallets equal ledger sums" value={run.walletsMatchLedger} />
                <IntegrityCheck label="No negative balances" value={run.noNegativeWallets} />
                <IntegrityCheck label="Every starting grant is $20" value={run.grantsCorrect} />
                <IntegrityCheck label="Sales match the 10 orders" value={run.salesMatchOrders} />
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function IntegrityCheck({ label, value }: { label: string; value?: boolean }) {
  return <li><span>{label}</span><strong className={value ? 'is-good' : value === false ? 'is-bad' : ''}>{value ? 'Passed' : value === false ? 'Failed' : 'Not checked'}</strong></li>;
}
