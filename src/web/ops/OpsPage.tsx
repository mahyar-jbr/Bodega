import { type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { AgentApi } from '../../shared/contract';
import { ApiError, apiJson } from '../ui/api';
import { AwningMark } from '../ui/AwningMark';
import { Icon, type IconName } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { isStoreKey, STORES, STORE_KEYS, type StoreKey } from '../ui/stores';
import '../ui/theme.css';
import './ops.css';

const OPS_ENDPOINTS = {
  reset: '/api/ops/reset',
  learn: '/api/ops/learn-now',
  evaluate: '/api/ops/eval',
  gateDemo: '/api/ops/gate-demo',
  rollback: '/api/ops/rollback',
  opening: '/api/ops/opening',
  crowdStart: '/api/ops/crowd/start',
  crowdStop: '/api/ops/crowd/stop',
} as const;

type AgentState = Awaited<ReturnType<AgentApi['state']>>;
type StoreState = AgentState['stores'][number];

type HealthState = {
  ok: boolean;
  db?: { ok?: boolean; reason?: string };
  uptimeSeconds?: number;
};

type BotResult = {
  id?: string;
  kind?: string;
  status?: string;
  storeId?: StoreKey;
  summary?: string;
  completed?: number;
  failed?: number;
};

type LogLine = {
  id: string;
  time: string;
  text: string;
  tone: 'quiet' | 'good' | 'warning' | 'bad';
};

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clockTime() {
  return new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
    .format(new Date())
    .replace(/\s[ap]\.m\.$/i, '');
}

function parseAgentState(value: unknown): AgentState {
  const outer = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const payload = outer.state && typeof outer.state === 'object' ? outer.state as Record<string, unknown> : outer;
  const stores = Array.isArray(payload.stores) ? payload.stores.flatMap((item): StoreState[] => {
    if (!item || typeof item !== 'object') return [];
    const store = item as Record<string, unknown>;
    const storeId = typeof store.storeId === 'string' ? store.storeId : undefined;
    if (!isStoreKey(storeId)) return [];
    return [{
      storeId,
      appliedVersion: typeof store.appliedVersion === 'number' ? store.appliedVersion : 0,
      appliedAt: typeof store.appliedAt === 'string' ? new Date(store.appliedAt) : null,
      online: store.online !== false,
    }];
  }) : [];
  return {
    activeVersion: typeof payload.activeVersion === 'number' ? payload.activeVersion : 0,
    learning: payload.learning === true,
    learningPaused: payload.learningPaused === true,
    stores,
  };
}

function describeResult(value: unknown, fallback: string) {
  if (!value || typeof value !== 'object') return fallback;
  const result = value as Record<string, unknown>;
  if (typeof result.reason === 'string') return result.reason;
  if (typeof result.evaluationId === 'string') return `Evaluation ${result.evaluationId} started`;
  if (typeof result.fromVersion === 'number' && typeof result.toVersion === 'number') {
    return `Policy v${result.fromVersion} rolled back to v${result.toVersion}`;
  }
  if (result.started === false) return 'Already running';
  return fallback;
}

export default function OpsPage() {
  const [passwordInput, setPasswordInput] = useState('');
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [state, setState] = useState<AgentState>({ activeVersion: 0, learning: false, learningPaused: false, stores: [] });
  const [health, setHealth] = useState<HealthState | null>(null);
  const [selectedStore, setSelectedStore] = useState<StoreKey>('queen');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('Ready for the opening.');
  const [crowdRunning, setCrowdRunning] = useState(false);
  const [lastBot, setLastBot] = useState<BotResult | null>(null);
  const [log, setLog] = useState<LogLine[]>([
    { id: makeId(), time: clockTime(), text: 'Ops console ready', tone: 'quiet' },
  ]);

  const addLog = useCallback((text: string, tone: LogLine['tone'] = 'quiet') => {
    setLog((current) => [...current.slice(-39), { id: makeId(), time: clockTime(), text, tone }]);
  }, []);

  const refreshOverview = useCallback(async () => {
    const [nextState, nextHealth] = await Promise.allSettled([
      apiJson<unknown>('/api/agent/state'),
      apiJson<HealthState>('/api/health'),
    ]);
    if (nextState.status === 'fulfilled') setState(parseAgentState(nextState.value));
    if (nextHealth.status === 'fulfilled') setHealth(nextHealth.value);
    else setHealth({ ok: false });
  }, []);

  useEffect(() => {
    void refreshOverview();
    const timer = window.setInterval(() => void refreshOverview(), 5_000);
    return () => window.clearInterval(timer);
  }, [refreshOverview]);

  useEffect(() => {
    if (!unlocked) return;
    const events = new EventSource('/api/events?topics=ops');
    events.onmessage = ({ data }) => {
      try {
        const event = JSON.parse(data) as { coll?: unknown; op?: unknown; doc?: unknown };
        if (event.coll === 'settings') void refreshOverview();
        if (event.coll === 'bot_runs' && event.doc && typeof event.doc === 'object') {
          const doc = event.doc as BotResult;
          setLastBot(doc);
          const kind = doc.kind ?? 'Bot';
          const status = doc.status ?? String(event.op ?? 'updated');
          addLog(`${kind} ${status}`, status === 'failed' ? 'bad' : 'good');
        }
      } catch {
        // Ignore heartbeats and future event shapes.
      }
    };
    return () => events.close();
  }, [addLog, refreshOverview, unlocked]);

  function unlock(event: FormEvent) {
    event.preventDefault();
    if (!passwordInput) return;
    setPassword(passwordInput);
    setPasswordInput('');
    setUnlocked(true);
    addLog('Console unlocked');
  }

  async function runAction(
    key: string,
    label: string,
    path: string,
    body?: Record<string, unknown>,
    onSuccess?: (result: unknown) => void,
  ) {
    if (!password || busy) return;
    setBusy(key);
    setNotice(`${label}…`);
    addLog(`${label} started`);
    try {
      const result = await apiJson<unknown>(path, {
        method: 'POST',
        headers: { 'x-ops-password': password },
        body: body ? JSON.stringify(body) : undefined,
      });
      const message = describeResult(result, `${label} complete`);
      setNotice(message);
      addLog(message, 'good');
      onSuccess?.(result);
      await refreshOverview();
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setUnlocked(false);
        setPassword('');
        setNotice('Password rejected.');
        addLog('Password rejected', 'bad');
      } else {
        setNotice(`${label} failed. Try again.`);
        addLog(`${label} failed`, 'bad');
      }
    } finally {
      setBusy(null);
    }
  }

  if (!unlocked) {
    return (
      <main className="ops-page bd-surface ops-locked" data-theme="stage">
        <form className="ops-login-panel" onSubmit={unlock}>
          <Logo height={30} />
          <div className="ops-login-title">
            <Icon name="shield" size={28} />
            <div>
              <h1>Operations console</h1>
              <p>Team access only</p>
            </div>
          </div>
          <label htmlFor="ops-password">Ops password</label>
          <input
            id="ops-password"
            type="password"
            autoComplete="current-password"
            value={passwordInput}
            onChange={(event) => setPasswordInput(event.target.value)}
            autoFocus
          />
          <button type="submit" disabled={!passwordInput}>Open console</button>
        </form>
      </main>
    );
  }

  return (
    <main className="ops-page bd-surface" data-theme="stage">
      <header className="ops-topbar">
        <Logo height={25} />
        <div>
          <h1>Operations console</h1>
          <p><span className={`ops-dot ${health?.ok ? 'is-good' : 'is-bad'}`} />{health?.ok ? 'Live' : 'Needs attention'}</p>
        </div>
        <button type="button" className="ops-icon-button" aria-label="Refresh state" onClick={() => void refreshOverview()}>
          <Icon name="refresh" size={20} />
        </button>
      </header>

      <div className="ops-grid">
        <aside className="ops-column">
          <ConsolePanel title="Run of show" aside="3 minutes">
            <ol className="ops-run-list">
              <RunStep number="1" title="Opening" note="Three Queen St cons land at once." />
              <RunStep number="2" title="Queen St con" note="The shopkeeper gives the deal." />
              <RunStep number="3" title="Learn and test" note="Same model, new governed memory." />
              <RunStep number="4" title="Immunity" note="Every store applies the policy." />
              <RunStep number="5" title="Yonge St proof" note="The reworded trick is blocked." />
              <RunStep number="6" title="Roll back" note="Every store forgets the policy." />
            </ol>
          </ConsolePanel>

          <ConsolePanel title="Health">
            <StatusRow icon="database" label="Atlas" value={health?.db?.ok ? 'Connected' : health?.db?.reason ?? 'Unavailable'} tone={health?.db?.ok ? 'good' : 'bad'} />
            <StatusRow icon="loop" label="Learning" value={state.learning ? 'Running' : state.learningPaused ? 'Paused' : 'Ready'} tone={state.learning ? 'warning' : state.learningPaused ? 'bad' : 'good'} />
            <StatusRow icon="shield" label="Active policy" value={`v${state.activeVersion}`} tone="good" />
            <StatusRow
              icon="broadcast"
              label="Stores online"
              value={`${state.stores.filter((store) => store.online).length}/${Math.max(state.stores.length, 3)}`}
              tone={state.stores.filter((store) => store.online).length < 3 ? 'warning' : 'good'}
            />
          </ConsolePanel>

          <ConsolePanel title="Reset demo" aside="Hold for 1.5 seconds">
            <p className="ops-panel-copy">Clears shoppers, orders, ledger and bot runs, restocks every store and returns the agent to v0.</p>
            <HoldButton
              disabled={busy !== null}
              onComplete={() => void runAction('reset', 'Reset demo', OPS_ENDPOINTS.reset)}
            />
          </ConsolePanel>
        </aside>

        <section className="ops-column ops-main-column">
          <ConsolePanel title="What the room sees" aside={state.learningPaused ? 'Learning paused' : 'Live'} tone={state.learningPaused ? 'warning' : undefined}>
            <div className="ops-room-state">
              <div>
                <strong className="bd-num">v{state.activeVersion}</strong>
                <span>Active policy</span>
              </div>
              <div className={`ops-learning-state ${state.learning ? 'is-learning' : state.learningPaused ? 'is-paused' : 'is-ready'}`}>
                <Icon name={state.learning ? 'loop' : state.learningPaused ? 'pause' : 'check-circle'} size={24} />
                <strong>{state.learning ? 'Learning' : state.learningPaused ? 'Learning paused' : 'Ready'}</strong>
                <span>{state.learningPaused ? 'Learn now or Reset resumes it.' : 'The big screen follows live state.'}</span>
              </div>
            </div>
            <p className="ops-notice" aria-live="polite">{notice}</p>
          </ConsolePanel>

          <ConsolePanel title="Demo actions" aside="Use in order">
            <div className="ops-action-stack">
              <button
                type="button"
                className="ops-button is-primary is-large"
                disabled={busy !== null}
                onClick={() => void runAction('opening', 'Opening', OPS_ENDPOINTS.opening, { storeId: selectedStore }, (result) => setLastBot(result as BotResult))}
              >
                <Icon name="play" size={21} />
                <span><strong>Opening</strong><small>Send three chosen cons at {STORES[selectedStore].name}</small></span>
              </button>

              <button
                type="button"
                className="ops-button is-secondary is-large"
                disabled={busy !== null}
                onClick={() => void runAction('gate-demo', 'Test a strict version', OPS_ENDPOINTS.gateDemo)}
              >
                <Icon name="flask" size={21} />
                <span><strong>Test a strict version</strong><small>One paid held-out gate run for the recorded demo</small></span>
              </button>

              <button
                type="button"
                className="ops-rollback-button"
                disabled={busy !== null}
                onClick={() => void runAction('rollback', 'Roll back', OPS_ENDPOINTS.rollback)}
              >
                <Icon name="return" size={30} />
                <span><strong>Roll back</strong><small>Every store forgets the active version. Learning pauses.</small></span>
              </button>
            </div>
          </ConsolePanel>

          <div className="ops-two-up">
            <ConsolePanel title="Learning">
              <button
                type="button"
                className="ops-button is-secondary"
                disabled={busy !== null}
                onClick={() => void runAction('learn', 'Learn now', OPS_ENDPOINTS.learn)}
              >
                <Icon name="loop" size={19} />Learn now
              </button>
              <p className="ops-panel-copy">Forces one learning cycle and resumes automatic learning after a rollback.</p>
            </ConsolePanel>

            <ConsolePanel title="Evaluations">
              <div className="ops-button-pair">
                <button type="button" className="ops-button is-secondary" disabled={busy !== null} onClick={() => void runAction('eval-dev', 'Run dev evaluation', OPS_ENDPOINTS.evaluate, { set: 'dev' })}>Dev</button>
                <button type="button" className="ops-button is-secondary" disabled={busy !== null} onClick={() => void runAction('eval-heldout', 'Run held-out evaluation', OPS_ENDPOINTS.evaluate, { set: 'heldout' })}>Held-out</button>
              </div>
              <p className="ops-panel-copy">Use held-out only for the planned gate and final proof.</p>
            </ConsolePanel>
          </div>

          <ConsolePanel title="Crowd bot" aside={crowdRunning ? 'Running' : 'Stopped'}>
            <div className="ops-bot-controls">
              <label htmlFor="crowd-store">Store</label>
              <select id="crowd-store" value={selectedStore} onChange={(event) => setSelectedStore(event.target.value as StoreKey)}>
                {STORE_KEYS.map((store) => <option key={store} value={store}>{STORES[store].name}</option>)}
              </select>
              <button
                type="button"
                className="ops-button is-secondary"
                disabled={busy !== null || crowdRunning}
                onClick={() => void runAction('crowd-start', 'Start crowd', OPS_ENDPOINTS.crowdStart, { storeId: selectedStore }, (result) => {
                  setCrowdRunning(true);
                  setLastBot(result as BotResult);
                })}
              ><Icon name="bot" size={18} />Start</button>
              <button
                type="button"
                className="ops-button is-ghost"
                disabled={busy !== null || !crowdRunning}
                onClick={() => void runAction('crowd-stop', 'Stop crowd', OPS_ENDPOINTS.crowdStop, undefined, () => setCrowdRunning(false))}
              ><Icon name="pause" size={18} />Stop</button>
            </div>
          </ConsolePanel>
        </section>

        <aside className="ops-column">
          <ConsolePanel title="Stores" aside="Applied policy">
            <div className="ops-store-list">
              {STORE_KEYS.map((store) => {
                const live = state.stores.find((item) => item.storeId === store);
                return <StoreRow key={store} store={store} state={live} activeVersion={state.activeVersion} />;
              })}
            </div>
          </ConsolePanel>

          <ConsolePanel title="Bots" aside={crowdRunning ? '1 running' : 'None running'}>
            {lastBot ? (
              <div className="ops-last-bot">
                <Icon name="bot" size={22} />
                <div>
                  <strong>{lastBot.kind ?? 'Crowd bot'}</strong>
                  <span>{lastBot.summary ?? lastBot.status ?? 'Last run updated'}</span>
                  {(lastBot.completed !== undefined || lastBot.failed !== undefined) && (
                    <small className="bd-num">{lastBot.completed ?? 0} complete · {lastBot.failed ?? 0} failed</small>
                  )}
                </div>
              </div>
            ) : <p className="ops-empty">No bot results yet.</p>}
          </ConsolePanel>

          <ConsolePanel title="Ops log" aside="Newest last" grow>
            <div className="ops-log" role="log" aria-live="polite">
              {log.map((line) => (
                <p key={line.id} className={`is-${line.tone}`}><time>{line.time}</time><span>{line.text}</span></p>
              ))}
            </div>
          </ConsolePanel>
        </aside>
      </div>
    </main>
  );
}

function ConsolePanel({
  title,
  aside,
  tone,
  grow,
  children,
}: {
  title: string;
  aside?: string;
  tone?: 'warning';
  grow?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`ops-panel${tone ? ` is-${tone}` : ''}${grow ? ' is-grow' : ''}`}>
      <header><h2>{title}</h2>{aside && <span>{aside}</span>}</header>
      <div className="ops-panel-content">{children}</div>
    </section>
  );
}

function RunStep({ number, title, note }: { number: string; title: string; note: string }) {
  return <li><span>{number}</span><div><strong>{title}</strong><p>{note}</p></div></li>;
}

function StatusRow({ icon, label, value, tone }: { icon: IconName; label: string; value: string; tone: 'good' | 'warning' | 'bad' }) {
  return (
    <div className="ops-status-row">
      <Icon name={icon} size={18} />
      <span>{label}</span>
      <strong className={`is-${tone}`}>{value}</strong>
    </div>
  );
}

function StoreRow({ store, state, activeVersion }: { store: StoreKey; state?: StoreState; activeVersion: number }) {
  const design = STORES[store];
  const applied = state?.appliedVersion ?? 0;
  const caughtUp = applied === activeVersion;
  return (
    <div className="ops-store-row">
      <AwningMark store={store} width={32} />
      <div><strong>{design.name}</strong><span>Policy v{applied}</span></div>
      <span className={`ops-store-state ${!state?.online ? 'is-offline' : caughtUp ? 'is-good' : 'is-warning'}`}>
        <i />{!state?.online ? 'Offline' : caughtUp ? 'Applied' : 'Updating'}
      </span>
    </div>
  );
}

function HoldButton({ disabled, onComplete }: { disabled: boolean; onComplete: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);

  function cancel() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  }

  function start() {
    if (disabled || timer.current !== null) return;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onComplete();
    }, 1_500);
  }

  useEffect(() => cancel, []);

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    start();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
      event.preventDefault();
      start();
    }
  }

  function handleKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Enter' || event.key === ' ') cancel();
  }

  return (
    <button
      type="button"
      className={`ops-hold-button${holding ? ' is-holding' : ''}`}
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={cancel}
    >
      <span>{holding ? 'Keep holding…' : 'Hold to reset'}</span>
    </button>
  );
}
