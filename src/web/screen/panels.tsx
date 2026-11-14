// The big screen's scene panels: learning (M4-01), immunity and forget, and the results (M4-03).
import { AwningMark } from './parts';
import { clock, money, seconds } from './format';
import { storeName, type AuditData, type ConRow, type FlashData, type MemoryData, type LearningData, type VersionPoint, type ResultsData, type RolloutData, type TestProgress } from './types';

// ── Learning ──────────────────────────────────────────────────────────────────────────────

const STEP_STATE: Record<LearningData['phase'], ['done' | 'running' | 'waiting', 'done' | 'running' | 'waiting', 'done' | 'running' | 'waiting']> = {
  incident: ['running', 'waiting', 'waiting'],
  drafting: ['done', 'running', 'waiting'],
  testing: ['done', 'done', 'running'],
  awaiting: ['done', 'done', 'done'],
  promoted: ['done', 'done', 'done'],
  rejected: ['done', 'done', 'done'],
};

const PHASE_WORD: Record<LearningData['phase'], [string, string]> = {
  incident: ['Noticed', 'learning'],
  drafting: ['Drafting', 'learning'],
  testing: ['Testing', 'learning'],
  awaiting: ['Waiting for approval', 'learning'],
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
        <h2 className="stage-title">{data.title ?? `Learning from ${storeName(data.store)}`}</h2>
        <span className="bs-state stage-callout" data-tone={tone}><span className="bs-dot" /><span key={word} className="bs-state-word">{word}</span></span>
      </div>
      <div className="bs-learn-cols">
        <div className="bs-learn-col" data-step={steps[0]}>
          <div className="stage-label bs-col-label">What happened</div>
          <div className="stage-body">{data.incident.summary}</div>
          <div className="stage-label bs-quiet bs-detail" style={{ marginTop: 8 }}>{data.incident.detail}</div>
          {data.incident.lostCents > 0 && <div className="stage-number bd-num" style={{ color: 'var(--loss)', marginTop: 20 }}>{'−'}{money(data.incident.lostCents)}</div>}
        </div>
        <div className="bs-learn-col" data-step={steps[1]}>
          <div className="stage-label bs-col-label">New guardrail, in plain words</div>
          {data.guardrail.rules.length === 0 ? <div className="stage-body bs-quiet">{data.phase === 'incident' ? 'Remembering the con\u2026' : 'Opus is writing the next guardrail\u2026'}</div>
            : data.guardrail.rules.slice(0, 2).map((r, i) => (
              <div key={r} className="stage-body bs-rule" data-new={(data.guardrail.parentRules ?? 0) > 0 && i < (data.guardrail.newRules ?? 0) ? 'true' : undefined}>{r}</div>
            ))}
          {data.guardrail.rules.length > 0 && (
            <div className="stage-label bs-quiet" style={{ marginTop: 6 }}>{buildsOn(data.guardrail)}</div>
          )}
        </div>
        <div className="bs-learn-col" data-step={steps[2]}>
          <TestColumn test={data.test} scamsTotal={data.scamsTotal} honestTotal={data.honestTotal} />
        </div>
      </div>
      <div className="bs-learn-foot" data-verdict={data.phase === 'promoted' || data.phase === 'rejected' || data.phase === 'awaiting' ? data.phase : 'pending'}>
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
  const tops = timelineTops(data.stores, scale);
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
          <div key={s.store} className="bs-tl-row stage-body" style={{ top: `${tops.get(s.store)}%`, opacity: s.ms == null ? 0.35 : 1 }}>
            <span className="bs-tl-t bd-num bs-quiet">{s.ms == null ? '…' : seconds(s.ms)}</span>
            <span className="bs-tl-dot" data-state={s.ms == null ? 'waiting' : 'done'} />
            <AwningMark store={s.store} width={30} /> {storeName(s.store)}{s.caughtUp ? <span className="bs-quiet">, caught up</span> : null}
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
        <div className="stage-label bs-quiet">From <b className="bs-ink">{fmtPct(data.before.scamsPct)}</b> before<span className="bs-wide-only"> learning</span></div>
      </section>
      <section className="bs-glass bs-panel bs-scene">
        <div className="stage-label bs-quiet">Honest turned away</div>
        <div><span className="stage-display bd-num">{data.after.honestAway}</span> <span className="stage-heading bs-quiet">of {data.honestTotal}</span></div>
        <div className="stage-label bs-quiet">Was {data.before.honestAway} at v{data.before.version}<span className="bs-wide-only">; real codes still work</span></div>
      </section>
      <section className="bs-glass bs-panel bs-scene">
        <div className="stage-label bs-quiet">Time to immunity</div>
        <div className="stage-display bd-num">{data.immunityMs == null ? '–' : seconds(data.immunityMs)}</div>
        <div className="stage-label bs-quiet">To every store</div>
      </section>
    </div>
  );
}

function fmtPct(p: number) {
  return `${Number.isInteger(p) ? p : p.toFixed(1)}%`;
}

// ── Memory you can govern (M4-07) ────────────────────────────────────────────────────────────

const MEMORY_RULES: [title: string, body: string][] = [
  ['Raw chats stay put', 'Only their own shopkeeper reads them. Gone 24 hours after the last message.'],
  ['Only proven rules travel', 'Shared with every store only after winning on 120 unseen cases.'],
  ['Any rule can be taken back', 'Roll back, and every store forgets it in seconds.'],
];

export function MemoryPanel({ cons, max = 3, onOpen, memory }: { cons: ConRow[]; max?: number; onOpen?: (conId: string) => void; memory?: MemoryData }) {
  const proof = memory?.proof;
  const rows = proof || memory?.ttlSeconds ? Math.min(max, 2) : max;
  return (
    <section className="bs-glass bs-panel bs-scene" aria-label="Memory">
      <div className="bs-panel-head">
        <h2 className="stage-heading">What Bodega remembers</h2>
        <span className="stage-label bs-quiet">{cons.length} {cons.length === 1 ? 'con' : 'cons'}, summaries only</span>
      </div>
      <div className="bs-mem-rules" data-compact={memory && (memory.ttlSeconds || proof || memory.forgotten > 0) ? 'true' : undefined}>
        {MEMORY_RULES.map(([t, b]) => (
          <div key={t} className="bs-mem-rule">
            <div className="stage-body bs-ink">{t}</div>
            <div className="stage-label bs-quiet">{b}</div>
          </div>
        ))}
      </div>
      {memory && (memory.ttlSeconds || proof || memory.forgotten > 0) && (
        <div className="bs-proofs">
          {memory.ttlSeconds ? (
            <div className="bs-proof-row stage-label" data-ok="true">
              <span className="bs-dot" /><span>Raw chats expire {Math.round(memory.ttlSeconds / 3600)} h after the last message (TTL index on conversations)</span>
            </div>
          ) : null}
          {proof && (
            <div key={proof.at} className="bs-proof-row stage-label" data-ok={proof.refused ? 'true' : 'false'} data-fresh="true">
              <span className="bs-dot" />
              <span>{proof.refused
                ? <>Tried to store raw chat text in {proof.collection}. <b className="bs-ink">Atlas refused it:</b> {proof.message} (code {proof.code})</>
                : <>Tried to store raw chat text in {proof.collection}, and it was accepted: {proof.message}</>}</span>
            </div>
          )}
          {memory.forgotten > 0 && (
            <div className="bs-proof-row stage-label" data-ok="true">
              <span className="bs-dot" /><span>{memory.forgotten} {memory.forgotten === 1 ? 'shopper' : 'shoppers'} forgotten on request: their chats deleted, the rules kept</span>
            </div>
          )}
        </div>
      )}
      <table className="bs-table stage-body" style={{ marginTop: 14 }}>
        <thead className="stage-label"><tr><th>Con</th><th>First seen</th><th className="bs-num-col" style={{ width: 230 }}>Blocked by</th></tr></thead>
        <tbody>
          {cons.slice(0, rows).map((c) => (
            <tr key={c.id} onClick={() => onOpen?.(c.id)} style={{ cursor: onOpen ? 'pointer' : undefined }}>
              <td>{c.summary}</td>
              <td><span className="bs-store-chip"><AwningMark store={c.firstSeen} width={30} />{storeName(c.firstSeen)}</span></td>
              <td className={`bs-num-col ${c.coveredBy != null ? 'bs-good' : 'bs-quiet'}`}>{c.coveredBy != null ? `Policy v${c.coveredBy}` : 'Not yet'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── Every guardrail version on the same held-out cases (M4-08) ─────────────────────────────

export function VersionChart({ versions }: { versions: VersionPoint[] }) {
  const W = 1100, H = 190, padL = 70, padR = 70, padT = 16, padB = 40;
  const top = Math.max(40, Math.ceil(Math.max(...versions.map((v) => Math.max(v.scamsPct, v.honestAwayPct)), 0) / 20) * 20);
  const x = (i: number) => padL + (versions.length <= 1 ? 0 : (i * (W - padL - padR)) / (versions.length - 1));
  const y = (p: number) => padT + (1 - p / top) * (H - padT - padB);
  const kept = versions.map((v, i) => ({ ...v, i })).filter((v) => !v.rejected);
  const line = (key: 'scamsPct' | 'honestAwayPct') => kept.map((v) => `${x(v.i)},${y(v[key])}`).join(' ');
  const last = kept.at(-1);
  return (
    <section className="bs-glass bs-panel bs-scene" aria-label="Every guardrail version">
      <div className="bs-panel-head">
        <h2 className="stage-heading">Every <span className="bs-wide-only">guardrail </span>version</h2>
        <span className="stage-label bs-legend">
          <span><i className="bs-key" style={{ background: 'var(--loss)' }} /> Scams that work</span>
          <span><i className="bs-key bs-key-dot" /> Honest turned away</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="bs-chart" role="img"
        aria-label={versions.map((v) => `${v.label}: ${v.scamsPct}% scams, ${v.honestAwayPct}% honest turned away`).join('; ')}>
        {[0, top / 2, top].map((p) => (
          <g key={p}>
            <line x1={padL} x2={W - padR} y1={y(p)} y2={y(p)} stroke="var(--line)" />
            <text x={padL - 14} y={y(p) + 9} textAnchor="end" className="bs-chart-t">{p}%</text>
          </g>
        ))}
        <polyline points={line('honestAwayPct')} fill="none" stroke="var(--served)" strokeWidth={3} strokeDasharray="2 9" strokeLinecap="round" />
        <polyline points={line('scamsPct')} fill="none" stroke="var(--loss)" strokeWidth={3} />
        {kept.map((v) => <circle key={`s${v.v}`} cx={x(v.i)} cy={y(v.scamsPct)} r={6} fill="var(--loss)" />)}
        {versions.map((v, i) => v.rejected && (
          <g key={`r${v.v}`}>
            <line x1={x(i)} x2={x(i)} y1={y(Math.max(v.scamsPct, v.honestAwayPct))} y2={H - padB} stroke="var(--ink-faint)" strokeDasharray="3 5" />
            <circle cx={x(i)} cy={y(Math.max(v.scamsPct, v.honestAwayPct))} r={10} fill="none" stroke="var(--ink-3)" strokeWidth={2} />
            <path d={`M${x(i) - 6} ${y(Math.max(v.scamsPct, v.honestAwayPct)) - 6}l12 12M${x(i) + 6} ${y(Math.max(v.scamsPct, v.honestAwayPct)) - 6}l-12 12`} stroke="var(--ink-3)" strokeWidth={2} />
          </g>
        ))}
        {versions.map((v, i) => (
          <text key={`l${v.v}`} x={x(i)} y={H - 6} textAnchor="middle" className="bs-chart-t" textDecoration={v.rejected ? 'line-through' : undefined}>{v.label}</text>
        ))}
        {last && (
          <>
            <text x={x(last.i) + 16} y={y(last.scamsPct) - 10} className="bs-chart-t" fill="var(--loss)">{fmtPct(last.scamsPct)}</text>
            <text x={x(last.i) + 16} y={y(last.honestAwayPct) + 30} className="bs-chart-t" fill="var(--served)">{fmtPct(last.honestAwayPct)}</text>
          </>
        )}
      </svg>
    </section>
  );
}

// ── The audit trail for one con (stretch X4): who allowed this, and what changed ─────────────

const VIOLATION_WORDS: Record<string, string> = {
  code_unknown: 'code not on file', code_inactive: 'code switched off', member_unknown: 'member not on file',
  member_not_shopper: "someone else's membership", discount_no_basis: 'discount with no basis', discount_over_valid: 'bigger than the code gives',
  price_below_list: 'below the list price', free_item: 'given away', refund_no_order: 'no such order', refund_not_shoppers: "someone else's order",
  refund_already_refunded: 'already refunded', refund_over_refundable: 'more than was paid', refund_price_adjustment: 'refund used as a discount',
};

export function AuditPanel({ audit, index, count }: { audit: AuditData; index: number; count: number }) {
  const cov = audit.coveredBy;
  return (
    <section className="bs-glass bs-panel bs-scene" aria-label="Audit trail">
      <div className="bs-panel-head">
        <h2 className="stage-heading">{audit.summary}</h2>
        <span className="stage-label bs-quiet">Audit trail{count > 1 ? `, ${index + 1} of ${count}` : ''}</span>
      </div>
      <div className="stage-label bs-quiet" style={{ marginBottom: 16 }}>
        First seen at {storeName(audit.firstSeen)}, {clock(new Date(audit.firstSeenAt))}. Grouped {audit.grouping === 'agent-memory'
          ? <>by Atlas Agent Memory{audit.matchScore != null ? <> (match <span className="bd-num">{audit.matchScore.toFixed(2)}</span>)</> : null}</>
          : 'by its violation'}: {audit.incidents} {audit.incidents === 1 ? 'incident' : 'incidents'}, {money(audit.lostCents)} lost.
      </div>
      <div className="bs-audit-cols">
        <div>
          <div className="stage-label bs-col-label">What moved, from the ledger</div>
          {audit.entries.slice(0, 3).map((e) => (
            <div key={`${e.at}${e.orderNumber}`} className="bs-audit-row">
              <span className="stage-label bs-quiet bd-num">{clock(new Date(e.at))}</span>
              <span className="stage-body">
                <span className="mono-stage">{e.orderNumber ?? (e.kind === 'refund' ? 'refund' : 'sale')}</span>{' '}
                <span className="bs-quiet-2">{storeName(e.store)}<span className="bs-wide-only">, v{e.guardVersion ?? 0}</span></span>
                <div className="stage-label" style={{ color: 'var(--loss)' }}>{e.violations.map((v) => VIOLATION_WORDS[v] ?? v).join(', ')}</div>
              </span>
              <span className="stage-body bd-num" style={{ color: 'var(--loss)' }}>{'−'}{money(e.lossCents)}</span>
            </div>
          ))}
        </div>
        <div className="bs-audit-cover" data-covered={cov ? 'yes' : 'no'}>
          <div className="stage-label bs-col-label">What blocks it now</div>
          {!cov ? <div className="stage-body bs-quiet">Nothing yet. It's in the con memory, waiting to be learned.</div> : (
            <>
              <div className="stage-body"><b className="bs-ink">Policy v{cov.version}</b>{cov.promotedAt ? <span className="bs-quiet">, live since {clock(new Date(cov.promotedAt))}</span> : null}</div>
              {cov.rules.slice(0, 2).map((r) => <div key={r.id} className="stage-body bs-rule">{r.title}</div>)}
              {cov.gate && (
                <div className="stage-label bs-quiet-2" style={{ marginTop: 10 }}>
                  Proven on {cov.gate.scamsTotal + cov.gate.honestTotal} unseen cases: scams that work{' '}
                  <span className="bd-num">{cov.gate.scamsBefore} {'→'} {cov.gate.scamsAfter}</span> of {cov.gate.scamsTotal}, honest turned away{' '}
                  <span className="bd-num">{cov.gate.awayBefore} {'→'} {cov.gate.awayAfter}</span>. Same settings{' '}
                  <span className="mono-stage">{cov.gate.settingsHash?.slice(0, 8)}</span>.
                </div>
              )}
              <div className="stage-label" style={{ marginTop: 10, color: 'var(--immune)' }}>Blocked {audit.blocked} {audit.blocked === 1 ? 'time' : 'times'} since</div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** "Policy v2 adds 1 rule to v1's 3, every store", or for a first version "Policy v1: 3 rules, every store". */
function buildsOn(g: LearningData['guardrail']): string {
  const plural = (n: number) => `${n} ${n === 1 ? 'rule' : 'rules'}`;
  if (g.parentVersion && g.parentRules) {
    const added = g.newRules ?? 0;
    return added > 0
      ? `Policy v${g.version} adds ${plural(added)} to v${g.parentVersion}'s ${g.parentRules}, every store`
      : `Policy v${g.version} rewrites v${g.parentVersion}'s ${plural(g.parentRules)}, every store`;
  }
  return `Policy v${g.version}: ${plural(g.rules.length)}, every store`;
}

/** Rows to scale between 10% and 92% of the timeline, but never closer than one label apart: stores that
 *  land within a few ms of each other (the usual case) are spread evenly instead of drawn over each other. */
const MIN_GAP = 16;   // percent of the timeline's height, about one row
export function timelineTops(stores: { store: string; ms: number | null }[], scale: number): Map<string, number> {
  const TOP = 10, BOTTOM = 92;
  const order = [...stores].sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity));
  const tops = order.map((s) => (s.ms == null ? BOTTOM : TOP + ((BOTTOM - TOP) * s.ms) / scale));
  for (let i = 1; i < tops.length; i++) tops[i] = Math.max(tops[i], tops[i - 1] + MIN_GAP);
  const overflow = tops[tops.length - 1] - BOTTOM;
  if (overflow > 0) for (let i = 0; i < tops.length; i++) tops[i] = Math.max(TOP + i * MIN_GAP, tops[i] - overflow);
  return new Map(order.map((s, i) => [s.store, Math.min(BOTTOM, tops[i])]));
}

// ── The flash sale (M4-09, stretch): 100 bots, 10 hoodies, exactly 10 sold ──────────────────

const HOODIE = 'M9 4.2c-2 .8-3.4 1.8-4.5 3.1L3 13.2l2.6 1 1-3V20.5h10.8v-9.3l1 3 2.6-1-1.5-5.9c-1.1-1.3-2.5-2.3-4.5-3.1M9 4.2c.4 2.2 1.5 3.4 3 3.4s2.6-1.2 3-3.4M10.3 7.3v3.2M13.7 7.3v3.2M9 15.6h6l.6 2.9H8.4z';

/** Which of the bots got a hoodie: spread across the grid, the same every render (the ledger doesn't say which). */
function winners(attempted: number, sold: number): Set<number> {
  const out = new Set<number>();
  for (let i = 0; out.size < Math.min(sold, attempted); i++) out.add((i * 37 + 11) % attempted);
  return out;
}

export function FlashPanel({ data }: { data: FlashData }) {
  const won = winners(data.attempted, data.sold);
  const ok = data.passed && data.oversold === 0;
  return (
    <section className="bs-glass bs-panel bs-scene" aria-label="Flash sale">
      <div className="bs-panel-head">
        <h2 className="stage-title">Flash sale at {storeName(data.store)}</h2>
        <span className="bs-state stage-callout" data-tone={ok ? 'served' : 'conned'}><span className="bs-dot" />
          <span className="bs-state-word">{ok ? (data.stockAfter === 0 ? 'Sold out' : 'Done') : 'Check failed'}</span></span>
      </div>
      <div className="bs-flash-grid">
        <div>
          <div className="stage-label bs-quiet" style={{ marginBottom: 14 }}><b className="bs-ink bd-num">{data.attempted}</b> shoppers at once</div>
          <div className="bs-bots">{Array.from({ length: data.attempted }, (_, i) => <span key={i} className="bs-tdot" data-state={won.has(i) ? 'served' : 'waiting'} />)}</div>
        </div>
        <div>
          <div className="stage-label bs-quiet" style={{ marginBottom: 14 }}><b className="bs-ink bd-num">{data.stock}</b> limited hoodies</div>
          <div className="bs-hoodies">
            {Array.from({ length: data.stock }, (_, i) => (
              <span key={i} className="bs-hoodie" data-sold={i < data.sold ? 'true' : undefined}>
                <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={HOODIE} /></svg>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="bs-flash-foot">
        <div className="bs-flash-num"><span className="stage-display bd-num">{data.sold}</span><span className="stage-heading bs-quiet">sold</span></div>
        <div className="bs-flash-num"><span className="stage-display bd-num" style={{ color: data.oversold === 0 ? 'var(--immune)' : 'var(--loss)' }}>{data.oversold}</span><span className="stage-heading bs-quiet">oversold</span></div>
        <div className="stage-label bs-quiet-2" style={{ maxWidth: 520 }}>
          Every order is one Atlas transaction, so stock never goes below zero.{' '}
          {data.walletsMatchLedger && data.noNegativeWallets
            ? 'Every wallet matches its ledger, and none went negative.'
            : <span style={{ color: 'var(--loss)' }}>{!data.walletsMatchLedger ? 'A wallet does not match its ledger. ' : ''}{!data.noNegativeWallets ? 'A wallet went negative.' : ''}</span>}
        </div>
      </div>
    </section>
  );
}
