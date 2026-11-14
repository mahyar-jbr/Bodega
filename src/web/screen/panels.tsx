// The big screen's scene panels: learning (M4-01), immunity and forget, and the results (M4-03).
import { AwningMark } from './parts';
import { money, seconds } from './format';
import { storeName, type LearningData, type ResultsData, type RolloutData, type TestProgress } from './types';

// ── Learning ──────────────────────────────────────────────────────────────────────────────

const STEP_STATE: Record<LearningData['phase'], ['done' | 'running' | 'waiting', 'done' | 'running' | 'waiting', 'done' | 'running' | 'waiting']> = {
  incident: ['running', 'waiting', 'waiting'],
  drafting: ['done', 'running', 'waiting'],
  testing: ['done', 'done', 'running'],
  promoted: ['done', 'done', 'done'],
  rejected: ['done', 'done', 'done'],
};

const PHASE_WORD: Record<LearningData['phase'], [string, string]> = {
  incident: ['Noticed', 'learning'],
  drafting: ['Drafting', 'learning'],
  testing: ['Testing', 'learning'],
  promoted: ['Promoted', 'immune'],
  rejected: ['Rejected', 'conned'],
};

function Dots({ total, tested, good, tone }: { total: number; tested: number; good: number; tone: 'immune' | 'served' }) {
  // Good results first, then misses, then the case being run, then the ones still waiting.
  const misses = tested - good;
  return (
    <div className="bs-dots">
      {Array.from({ length: total }, (_, i) => {
        const state = i < good ? tone : i < good + misses ? 'miss' : i === tested && tested < total ? 'running' : 'waiting';
        return <span key={i} className="bs-tdot" data-state={state} />;
      })}
    </div>
  );
}

function TestColumn({ test, scamsTotal, honestTotal }: { test: TestProgress; scamsTotal: number; honestTotal: number }) {
  return (
    <div>
      <div className="stage-label bs-col-label">{scamsTotal + honestTotal} cases it never saw</div>
      <div className="bs-test-row stage-body">
        <span>Scams stopped</span>
        <span className="bd-num"><b>{test.scamsStopped}</b><span className="bs-quiet">/{scamsTotal}</span></span>
      </div>
      <Dots total={scamsTotal} tested={test.scamsTested} good={test.scamsStopped} tone="immune" />
      <div className="bs-test-row stage-body" style={{ marginTop: 24 }}>
        <span>Honest served</span>
        <span className="bd-num"><b>{test.honestServed}</b><span className="bs-quiet">/{honestTotal}</span></span>
      </div>
      <Dots total={honestTotal} tested={test.honestTested} good={test.honestServed} tone="served" />
    </div>
  );
}

export function LearningPanel({ data }: { data: LearningData }) {
  const steps = STEP_STATE[data.phase];
  const [word, tone] = PHASE_WORD[data.phase];
  return (
    <section className="bs-glass bs-panel bs-scene" aria-label="Learning">
      <div className="bs-panel-head">
        <h2 className="stage-title">Learning from {storeName(data.store)}</h2>
        <span className="bs-state stage-callout" data-tone={tone}><span className="bs-dot" /><span key={word} className="bs-state-word">{word}</span></span>
      </div>
      <div className="bs-learn-cols">
        <div className="bs-learn-col" data-step={steps[0]}>
          <div className="stage-label bs-col-label">What happened</div>
          <div className="stage-body">{data.incident.summary}</div>
          <div className="stage-label bs-quiet" style={{ marginTop: 8 }}>{data.incident.detail}</div>
          <div className="stage-number bd-num" style={{ color: 'var(--loss)', marginTop: 20 }}>{'−'}{money(data.incident.lostCents)}</div>
        </div>
        <div className="bs-learn-col" data-step={steps[1]}>
          <div className="stage-label bs-col-label">New guardrail, in plain words</div>
          {data.phase === 'incident' ? <div className="stage-body bs-quiet">Waiting for the con memory</div>
            : data.guardrail.rules.slice(0, 2).map((r) => <div key={r} className="stage-body bs-rule">{r}</div>)}
          {data.phase !== 'incident' && (
            <div className="stage-label bs-quiet" style={{ marginTop: 6 }}>
              Policy v{data.guardrail.version}{data.guardrail.rules.length > 2 ? `, and ${data.guardrail.rules.length - 2} more` : ''}, every store
            </div>
          )}
        </div>
        <div className="bs-learn-col" data-step={steps[2]}>
          <TestColumn test={data.test} scamsTotal={data.scamsTotal} honestTotal={data.honestTotal} />
        </div>
      </div>
      <div className="bs-learn-foot" data-verdict={data.phase === 'promoted' || data.phase === 'rejected' ? data.phase : 'pending'}>
        <span className="stage-body">{data.verdict ?? 'Ships only if it stops more scams and still serves honest shoppers.'}</span>
        <span className="stage-label bs-quiet" style={{ whiteSpace: "nowrap" }}>Same model, same prompt <span className="mono-stage">{data.settingsHash.slice(0, 8)}</span></span>
      </div>
    </section>
  );
}

// ── Immunity and forget ───────────────────────────────────────────────────────────────────

export function RolloutPanel({ data }: { data: RolloutData }) {
  const reported = data.stores.filter((s) => s.ms != null) as { store: RolloutData['stores'][number]['store']; ms: number }[];
  const all = reported.length === data.stores.length;
  const last = reported.length ? Math.max(...reported.map((s) => s.ms)) : 0;
  const scale = Math.max(last, 1);
  const forgot = data.kind === 'forgot';
  return (
    <section className="bs-glass bs-panel bs-scene bs-rollout" aria-label={forgot ? 'Rolled back' : 'Immunity'}>
      <div>
        <div className="bs-state stage-callout" data-tone={forgot ? 'learning' : 'immune'}>
          <span className="bs-dot" />
          <span className="bs-state-word">
            {forgot ? `Policy v${data.version} taken back${all ? ' at every store' : ''}` : `Policy v${data.version} is live${all ? ' at every store' : ''}`}
          </span>
        </div>
        <div className="bs-hero bd-num">{(last / 1000).toFixed(1)}<span className="bs-hero-unit">s</span></div>
        <div className="stage-body bs-quiet-2">
          {forgot ? <>for every store to forget it.<br />Back on v{data.toVersion}{data.learningPaused ? '; learning is paused.' : '.'}</>
            : <>from verdict to the last store.<br />Same model, new memory.</>}
        </div>
        {!forgot && data.scams && data.honest && (
          <div className="bs-proof stage-body bd-num">
            <span><b>{data.scams[0]}/{data.scams[1]}</b> <span className="bs-quiet">scams stopped</span></span>
            <span className="bs-proof-sep" />
            <span><b>{data.honest[0]}/{data.honest[1]}</b> <span className="bs-quiet">honest served</span></span>
          </div>
        )}
      </div>
      <div className="bs-timeline" style={{ ['--tl' as string]: forgot ? 'var(--learning)' : 'var(--immune)' }}>
        <div className="bs-tl-row stage-body" style={{ top: 0 }}>
          <span className="bs-tl-t bd-num bs-quiet">0.0s</span><span className="bs-tl-dot" data-state="origin" /><span className="bs-quiet">{forgot ? 'Roll back' : 'Verdict'}</span>
        </div>
        {data.stores.map((s) => (
          <div key={s.store} className="bs-tl-row stage-body" style={{ top: s.ms == null ? '100%' : `${10 + (82 * s.ms) / scale}%`, opacity: s.ms == null ? 0.35 : 1 }}>
            <span className="bs-tl-t bd-num bs-quiet">{s.ms == null ? '…' : seconds(s.ms)}</span>
            <span className="bs-tl-dot" data-state={s.ms == null ? 'waiting' : 'done'} />
            <AwningMark store={s.store} width={30} /> {storeName(s.store)}
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Results ──────────────────────────────────────────────────────────────────────────────

export function ResultsRow({ data }: { data: ResultsData }) {
  return (
    <div className="bs-results">
      <section className="bs-glass bs-panel bs-scene">
        <div className="stage-label bs-quiet">Scams that work</div>
        <div className="stage-display bd-num" style={{ color: 'var(--immune)' }}>{fmtPct(data.after.scamsPct)}</div>
        <div className="stage-label bs-quiet">From <b className="bs-ink">{fmtPct(data.before.scamsPct)}</b> before learning</div>
      </section>
      <section className="bs-glass bs-panel bs-scene">
        <div className="stage-label bs-quiet">Honest turned away</div>
        <div><span className="stage-display bd-num">{data.after.honestAway}</span> <span className="stage-heading bs-quiet">of {data.honestTotal}</span></div>
        <div className="stage-label bs-quiet">Was {data.before.honestAway} at v{data.before.version}; real codes still work</div>
      </section>
      <section className="bs-glass bs-panel bs-scene">
        <div className="stage-label bs-quiet">Time to immunity</div>
        <div className="stage-display bd-num">{data.immunityMs == null ? '–' : seconds(data.immunityMs)}</div>
        <div className="stage-label bs-quiet">Verdict to every store</div>
      </section>
    </div>
  );
}

function fmtPct(p: number) {
  return `${Number.isInteger(p) ? p : p.toFixed(1)}%`;
}
