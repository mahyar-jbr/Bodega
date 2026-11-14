// The big screen's view of the chain, built on the agent side and served inside agent.state() as
// `screen`, so the screen never reads collections itself. Summaries, titles, nicknames and numbers
// only: no raw customer text ever goes in here.
import { ObjectId, type Db } from 'mongodb';
import type { StoreApi, StoreId } from '../../shared/contract';
import type { AgentMetrics, IncidentDoc, MetricPoint } from '../auditor/auditor';
import { sweepInterruptedEvaluations, type EvaluationDoc } from '../eval/record';
import type { ConDoc } from '../memory/con-memory';
import { TTL_INDEX } from '../memory/memory-rules';
import { MEMORY_PROOFS, type MemoryProof } from '../memory-proof';
import { AGENT_STATE, CONS, GUARDRAILS, INCIDENTS, ROLLOUTS, type AgentStateDoc, type GuardrailDoc } from '../rollout/state';
import type { RolloutDoc } from '../rollout/runtimes';

const STORES: StoreId[] = ['queen', 'yonge', 'scarborough'];
const STORE_NAME: Record<StoreId, string> = { queen: 'Queen St', yonge: 'Yonge St', scarborough: 'Scarborough' };
const FEED_MAX = 8;

export type Scene = 'round1' | 'learning' | 'immunity' | 'round2' | 'memory' | 'audit' | 'flash';
export type StoreStatus = 'idle' | 'conned' | 'learning' | 'immune' | 'offline';
export type FeedKind = 'sale' | 'con-worked' | 'con-blocked' | 'rule-promoted' | 'rule-rejected' | 'learning' | 'rollback';

export interface ScreenSnapshot {
  scene: Scene;                    // the scene the state suggests; the screen may pin another
  activeVersion: number;
  epoch: number;
  tiles: { store: StoreId; status: StoreStatus; policy: number; learnedAt: string | null; lostCents: number;
    lostCount: number; blocked: number; blockedCents: number; immuneInMs: number | null; online: boolean;
    missed: number | null;           // offline and behind: the active version it hasn't applied
    caughtUpMs: number | null }[];   // back online: how long after the missed promotion it caught up
  feed: { id: string; kind: FeedKind; who: string; text: string; amountCents: number | null; at: string }[];
  cons: { id: string; summary: string; firstSeen: StoreId; worked: number; blocked: number; coveredBy: number | null }[];
  learning: null | {
    phase: 'incident' | 'drafting' | 'testing' | 'promoted' | 'rejected';
    title?: string;                // the panel's title when it isn't "Learning from <store>" (the gate demo)
    store: StoreId;
    incident: { summary: string; detail: string; lostCents: number };
    // The candidate's rule titles, new ones first; what it builds on (parent 0 = v0, no rules).
    guardrail: { version: number; rules: string[]; newRules: number; parentVersion: number; parentRules: number };
    test: { done: number; total: number; scamsTested: number; scamsStopped: number; honestTested: number; honestServed: number };
    scamsTotal: number; honestTotal: number;
    settingsHash: string;
    verdict: string | null;
  };
  rollout: null | {
    kind: 'immune' | 'forgot'; version: number; toVersion: number; at: string;
    stores: { store: StoreId; ms: number | null; caughtUp?: boolean }[];
    scams: [number, number] | null; honest: [number, number] | null;
    learningPaused: boolean;
  };
  versions: { v: number; label: string; scamsPct: number; honestAwayPct: number; rejected: boolean }[];
  audits: AuditTrail[];
  flash: FlashSale | null;
  memory: MemoryGovernance;
  results: null | {
    before: { version: number; scamsPct: number; honestAway: number };
    after: { version: number; scamsPct: number; honestAway: number };
    honestTotal: number;
    immunityMs: number | null;
  };
}

/** Memory you can govern, proven live: the last probe of the memory rules, the TTL index, forgotten shoppers. */
export interface MemoryGovernance {
  proof: null | { at: string; refused: boolean; code: number | null; message: string; collection: string; field: string };
  ttlSeconds: number | null;        // the TTL index on conversations (86400 = 24 h)
  forgotten: number;                // shoppers forgotten on request since the last reset
}

/** The flash sale (M4-05, stretch): 100 bots race for 10 hoodies in Atlas transactions. */
export interface FlashSale {
  store: StoreId;
  attempted: number;
  sold: number;
  stock: number;                   // hoodies on the shelf when it started
  stockAfter: number;
  oversold: number;
  walletsMatchLedger: boolean;
  noNegativeWallets: boolean;
  passed: boolean;
  durationMs: number | null;
  at: string;
}

/** One con, end to end: what moved, what the auditor saw, how memory grouped it, and what blocks it now. */
export interface AuditTrail {
  conId: string;
  summary: string;
  title: string;
  firstSeen: StoreId;
  firstSeenAt: string;
  grouping: 'agent-memory' | 'violation';
  matchScore: number | null;
  stores: StoreId[];
  incidents: number;
  lostCents: number;
  blocked: number;
  entries: { at: string; store: StoreId; kind: 'sale' | 'refund'; walletDeltaCents: number; orderNumber: string | null;
    lossCents: number; violations: string[]; who: string | null; guardVersion: number | null }[];
  coveredBy: null | {
    version: number; promotedAt: string | null; rules: { id: string; title: string }[];
    gate: null | { verdict: string; scamsBefore: number; scamsAfter: number; scamsTotal: number; awayBefore: number; awayAfter: number;
      honestTotal: number; settingsHash: string | null; evaluationId: string };
  };
}

// Eng 1's learning cycles (src/agent/learner): one document per cycle.
interface LearningRunDoc {
  _id: unknown; epoch: number; trigger: 'auto' | 'now'; cons: string[];
  phase: 'learning' | 'gating' | 'promoted' | 'rejected' | 'failed';
  attempts: { attempt: number; version: number; title: string; rules: string[]; verdict?: string; reasons?: string[]; evaluationId?: string; learnMs?: number }[];
  startedAt: Date; finishedAt: Date | null; error?: string | null;
}

export interface SnapshotDeps {
  db: Db;
  store: StoreApi;
  metrics: () => Promise<AgentMetrics>;
  stores: () => { storeId: StoreId; appliedVersion: number; appliedAt: Date | null; online: boolean }[];
  settingsHash: string;
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const short = (s: string, n = 36) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

// state() is polled by the screen and by every shop window: build the snapshot at most this often.
const SNAPSHOT_TTL_MS = 750;
let cached: { db: string; at: number; value: Promise<ScreenSnapshot> } | null = null;

// Interrupted evaluations are swept once when a process first serves the screen, then every 30 s.
const SWEEP_EVERY_MS = 30_000;
let lastSweep: { db: string; at: number } | null = null;

export function screenSnapshot(deps: SnapshotDeps): Promise<ScreenSnapshot> {
  const now = Date.now();
  if (!lastSweep || lastSweep.db !== deps.db.databaseName || now - lastSweep.at > SWEEP_EVERY_MS) {
    lastSweep = { db: deps.db.databaseName, at: now };
    sweepInterruptedEvaluations(deps.db)
      .then((n) => { if (n) console.log(`evaluations: marked ${n} interrupted run(s) as failed`); })
      .catch((e) => console.error('evaluation sweep failed:', e));
  }
  if (cached && cached.db === deps.db.databaseName && now - cached.at < SNAPSHOT_TTL_MS) return cached.value;
  const value = buildSnapshot(deps);
  cached = { db: deps.db.databaseName, at: now, value };
  value.catch(() => { if (cached?.value === value) cached = null; });
  return value;
}

async function buildSnapshot(deps: SnapshotDeps): Promise<ScreenSnapshot> {
  const { db } = deps;
  const state = await db.collection<AgentStateDoc>(AGENT_STATE).findOne({ _id: 'agent' });
  const epoch = state?.epoch ?? 0;
  const activeVersion = state?.activeVersion ?? 0;

  const [metrics, guardrails, incidents, cons, blocks, evaluations, rolloutRows, orders] = await Promise.all([
    deps.metrics(),
    db.collection<GuardrailDoc>(GUARDRAILS).find({ _id: { $gt: 0 } }).sort({ _id: -1 }).limit(10).toArray(),
    db.collection<IncidentDoc>(INCIDENTS).find({ epoch }).sort({ at: -1 }).limit(50).toArray(),
    db.collection<ConDoc>(CONS).find({ epoch }).sort({ firstSeenAt: 1 }).limit(20).toArray(),
    db.collection<MetricPoint>('attack_metrics').find({ 'meta.epoch': epoch, 'meta.kind': 'blocked' }).sort({ ts: -1 }).limit(200).toArray(),
    db.collection<EvaluationDoc>('evaluations').find({ set: 'heldout' }).sort({ startedAt: -1 }).limit(20).toArray(),
    state ? db.collection<RolloutDoc>(ROLLOUTS).find({ changedAt: state.changedAt }).toArray() : Promise.resolve([]),
    db.collection('orders').find({}, { projection: { number: 1, storeId: 1, shopperId: 1, lines: 1, totalCents: 1, createdAt: 1 } })
      .sort({ createdAt: -1 }).limit(FEED_MAX).toArray(),
  ]);

  // One row per store for the current change, even if a store reported it more than once (keep its first report).
  const allRollouts = dedupeRollouts(rolloutRows, state?.activeVersion ?? 0);
  // Stores that were online applied the change live; a store that was offline catches up later (X1),
  // measured from the same promotion. Keep them apart: catch-ups don't count as time to immunity.
  const rollouts = allRollouts.filter((r) => r.change !== 'catchup');
  const catchups = allRollouts.filter((r) => r.change === 'catchup');

  const byVersion = new Map(guardrails.map((g) => [g._id, g]));
  const sinceReset = state?.change === 'reset' ? state.changedAt : null;
  const recentEvals = evaluations.filter((e) => !sinceReset || e.startedAt >= sinceReset || e.purpose === 'baseline');

  // ── Cons: summaries, where first seen, how often worked and blocked, and what covers them ──
  const ruleCons = new Map<string, string[]>();          // `${version}:${ruleId}` -> con ids
  for (const g of guardrails) for (const r of g.rules) ruleCons.set(`${g._id}:${r.id}`, r.cons);
  const blockedPerCon = new Map<string, number>();
  for (const b of blocks) for (const c of ruleCons.get(`${b.version}:${b.ruleId}`) ?? []) blockedPerCon.set(c, (blockedPerCon.get(c) ?? 0) + 1);
  const conRows: ScreenSnapshot['cons'] = cons.map((c) => ({
    id: c._id, summary: c.summary, firstSeen: c.firstSeenStore, worked: c.incidents,
    blocked: blockedPerCon.get(c._id) ?? 0, coveredBy: c.coveredBy,
  }));

  // ── Learning: the newest learning cycle (learning_runs) or gate demo in this epoch, its held-out test and verdict ──
  // A reset starts a new epoch: nothing from before it shows on the learning panel.
  const lastReset = await db.collection<RolloutDoc>(ROLLOUTS).find({ change: 'reset' as never }).sort({ changedAt: -1 }).limit(1).next();
  const epochStart = state?.change === 'reset' ? state.changedAt : lastReset?.changedAt ?? new Date(0);
  const run = await db.collection<LearningRunDoc>('learning_runs').find({ epoch }).sort({ startedAt: -1 }).limit(1).next();
  // The gate demo has no learning run: follow its evaluation when it's the newest thing this epoch.
  const demoEval = evaluations.find((e) => e.purpose === 'gate-demo' && e.startedAt >= epochStart);
  const demo = demoEval && (!run || demoEval.startedAt > run.startedAt) ? demoEval : undefined;
  const newest = guardrails.find((g) => g.source !== 'v0' && g.source !== 'gate-demo' && g.createdAt >= epochStart);
  let learning: ScreenSnapshot['learning'] = null;
  const attempt = run?.attempts.at(-1);
  // The learner stores the attempt's evaluation id only once the gate returns: until then, the running
  // evaluation is the newest one for the attempt's version (so the test dots fill live).
  const testEval = attempt?.evaluationId
    ? evaluations.find((e) => e._id.toHexString() === attempt.evaluationId)
      ?? await db.collection<EvaluationDoc>('evaluations').findOne({ _id: new ObjectId(attempt.evaluationId) })
    : attempt ? evaluations.find((e) => e.version === attempt.version && e.startedAt >= run!.startedAt)
    : !run && newest ? recentEvals.find((e) => e.version === newest._id) : undefined;
  if (demo) {
    const g = byVersion.get(demo.version);
    const gateRec = (g as (GuardrailDoc & { gate?: { reasons: string[]; candidate: { honestTurnedAway: number; honestTotal: number; scamSuccess: number; scamsTotal: number } } }) | undefined)?.gate;
    const done = demo.status !== 'running';
    const phase: NonNullable<ScreenSnapshot['learning']>['phase'] = !done ? 'testing' : g?.status === 'promoted' ? 'promoted' : 'rejected';
    const sDemo = demo.summary;
    learning = {
      phase, store: 'queen', title: 'Testing a too-strict version',
      incident: { summary: 'A deliberately too-strict guardrail', detail: 'No discounts and no refunds, even real ones', lostCents: 0 },
      guardrail: { version: demo.version, rules: g?.rules.map((r) => r.title) ?? [], newRules: g?.rules.length ?? 0, parentVersion: 0, parentRules: 0 },
      test: demo.progress, scamsTotal: sDemo?.scams.total ?? 60, honestTotal: sDemo?.honest.total ?? 60,
      settingsHash: demo.settingsHash ?? deps.settingsHash,
      verdict: !done ? null
        : phase === 'rejected'
          ? (gateRec && gateRec.candidate.honestTurnedAway > 0
            ? `Rejected: ${gateRec.candidate.honestTurnedAway} of ${gateRec.candidate.honestTotal} honest customers turned away`
            : `Rejected: ${gateRec?.reasons[0] ?? 'it did not beat the current version'}`)
          : 'Promoted',
    };
  } else if (run || state?.learning || newest) {
    const phase: NonNullable<ScreenSnapshot['learning']>['phase'] = run
      ? run.phase === 'learning' ? 'drafting'
        : run.phase === 'gating' ? 'testing'
        : run.phase === 'promoted' ? 'promoted'
        : 'rejected'
      : state?.learning ? 'drafting'
      : !newest ? 'incident'
      : newest.status === 'promoted' || newest.status === 'rolled_back' ? 'promoted'
      : newest.status === 'rejected' ? 'rejected' : testEval ? 'testing' : 'drafting';
    const conIds = new Set(run?.cons ?? newest?.cons ?? []);
    const trigger = incidents.find((i) => i.conId && conIds.has(i.conId)) ?? incidents[0];
    const s = testEval?.summary;
    const scamsTotal = s?.scams.total ?? 60, honestTotal = s?.honest.total ?? 60;
    const versionNo = attempt?.version ?? newest?._id ?? activeVersion + 1;
    const allRules = attempt?.rules ?? byVersion.get(versionNo)?.rules.map((r) => r.title) ?? [];
    // What it builds on: the version it was learned from (the active one while it's drafted).
    const parentVersion = byVersion.get(versionNo)?.parentVersion ?? (run && run.phase !== 'promoted' ? activeVersion : Math.max(0, versionNo - 1));
    const parentDoc = parentVersion > 0 ? byVersion.get(parentVersion) ?? await db.collection<GuardrailDoc>(GUARDRAILS).findOne({ _id: parentVersion }) : null;
    const parentTitles = new Set((parentDoc?.rules ?? []).map((r) => r.title.trim().toLowerCase()));
    const fresh = allRules.filter((t) => !parentTitles.has(t.trim().toLowerCase()));
    const rules = [...fresh, ...allRules.filter((t) => parentTitles.has(t.trim().toLowerCase()))];
    const reasons = attempt?.reasons ?? [];
    learning = trigger || run || newest ? {
      phase,
      store: (cons.find((c) => conIds.has(c._id))?.firstSeenStore) ?? trigger?.storeId ?? 'queen',
      incident: trigger
        ? { summary: trigger.summary, detail: `${trigger.kind === 'refund' ? 'A refund' : 'A sale'} at ${STORE_NAME[trigger.storeId]}${conIds.size > 1 ? `, and ${conIds.size - 1} more ${conIds.size === 2 ? 'con' : 'cons'}` : ''}`, lostCents: trigger.lossCents }
        : { summary: 'A new con', detail: '', lostCents: 0 },
      guardrail: { version: versionNo, rules, newRules: parentDoc ? fresh.length : rules.length, parentVersion, parentRules: parentDoc?.rules.length ?? 0 },
      test: testEval?.progress ?? { done: 0, total: scamsTotal + honestTotal, scamsTested: 0, scamsStopped: 0, honestTested: 0, honestServed: 0 },
      scamsTotal, honestTotal,
      settingsHash: testEval?.settingsHash ?? deps.settingsHash,
      verdict: phase === 'promoted'
        ? (s ? `Promoted: scams that work ${s.scams.successPct}%, ${s.honest.turnedAway} of ${s.honest.total} honest turned away` : 'Promoted')
        : phase === 'rejected'
          ? `Rejected: ${reasons[0] ?? (run?.phase === 'failed' ? 'the run failed' : 'it did not beat the current version')}`
          : null,
    } : null;
  }

  // ── Rollout: the last promotion or rollback, with each store's time on the same clock ──
  let rollout: ScreenSnapshot['rollout'] = null;
  if (state && (state.change === 'promote' || state.change === 'rollback')) {
    const fromVersion = state.change === 'rollback' ? state.rollbacks.at(-1)?.from ?? 0 : state.activeVersion;
    const gate = recentEvals.find((e) => e.version === state.activeVersion && e.status === 'done')?.summary;
    rollout = {
      kind: state.change === 'promote' ? 'immune' : 'forgot',
      version: fromVersion, toVersion: state.activeVersion, at: state.changedAt.toISOString(),
      stores: STORES.map((store) => {
        const live = rollouts.find((r) => r.storeId === store);
        const late = catchups.find((r) => r.storeId === store);
        return live ? { store, ms: live.ms } : late ? { store, ms: late.ms, caughtUp: true } : { store, ms: null };
      }),
      scams: gate ? [gate.scams.stopped, gate.scams.total] : null,
      honest: gate ? [gate.honest.served + gate.honest.leaks, gate.honest.total] : null,
      learningPaused: state.learningPaused,
    };
  }

  // ── Before and after on the held-out set: v0's worse baseline, and the active version's run ──
  let results: ScreenSnapshot['results'] = null;
  const baselines = evaluations.filter((e) => e.version === 0 && e.status === 'done' && e.summary);
  const after = activeVersion > 0 ? recentEvals.find((e) => e.version === activeVersion && e.status === 'done' && e.summary) : undefined;
  if (baselines.length && after?.summary) {
    const worst = baselines.reduce((a, b) => (b.summary!.honest.turnedAway > a.summary!.honest.turnedAway ? b : a));
    // Time to immunity: the slowest live report, once every store that was online has reported. A store that
    // was offline (it caught up later, or is still offline) doesn't hold the number back.
    const promoteMs = state?.change === 'promote' ? rollouts.map((r) => r.ms) : [];   // one per store
    const offline = new Set(deps.stores().filter((r) => !r.online).map((r) => r.storeId));
    const awaited = STORES.filter((st) => !offline.has(st) && !catchups.some((c) => c.storeId === st)).length;
    results = {
      before: { version: 0, scamsPct: worst.summary!.scams.successPct, honestAway: worst.summary!.honest.turnedAway },
      after: { version: activeVersion, scamsPct: after.summary.scams.successPct, honestAway: after.summary.honest.turnedAway },
      honestTotal: after.summary.honest.total,
      immunityMs: promoteMs.length > 0 && promoteMs.length >= awaited ? Math.max(...promoteMs) : null,
    };
  }

  // ── Every version on the held-out set, for the chart: v0's worse baseline, then each tested candidate ──
  const versions: ScreenSnapshot['versions'] = [];
  if (baselines.length) {
    const b = baselines.reduce((a, c) => (c.summary!.honest.turnedAway > a.summary!.honest.turnedAway ? c : a)).summary!;
    versions.push({ v: 0, label: 'v0', scamsPct: b.scams.successPct, honestAwayPct: b.honest.turnedAwayPct, rejected: false });
  }
  for (const g of [...guardrails].reverse()) {
    const e = recentEvals.find((x) => x.version === g._id && x.status === 'done' && x.summary);
    if (!e?.summary || g.status === 'candidate') continue;
    const rejected = g.status === 'rejected';
    versions.push({ v: g._id, label: rejected ? `v${g._id} draft` : `v${g._id}`, scamsPct: e.summary.scams.successPct,
      honestAwayPct: e.summary.honest.turnedAwayPct, rejected });
  }

  // ── Audit trails for up to three cons, covered ones first ──
  const auditCons = [...cons].sort((a, b) => Number(b.coveredBy != null) - Number(a.coveredBy != null)).slice(0, 3);
  const auditIncidents = incidents.filter((i) => i.conId && auditCons.some((c) => c._id === i.conId));
  const ledgerDocs = auditIncidents.length
    ? await db.collection('ledger').find({ id: { $in: auditIncidents.map((i) => i.ledgerId) } },
        { projection: { id: 1, kind: 1, storeId: 1, walletDeltaCents: 1, claimedOrderNumber: 1, guardVersion: 1, at: 1 } }).toArray()
    : [];
  const audits: AuditTrail[] = auditCons.map((c) => {
    const g = c.coveredBy != null ? byVersion.get(c.coveredBy) : undefined;
    const gateRec = (g as (GuardrailDoc & { gate?: { verdict: string; evaluationId: string;
      candidate: { scamSuccess: number; scamsTotal: number; honestTurnedAway: number; honestTotal: number; settingsHash: string | null };
      baseline: { scamSuccess: number; honestTurnedAway: number } } }) | undefined)?.gate;
    return {
      conId: c._id, summary: c.summary, title: c.title, firstSeen: c.firstSeenStore, firstSeenAt: c.firstSeenAt.toISOString(),
      grouping: c.grouping, matchScore: c.matchScore, stores: c.stores, incidents: c.incidents, lostCents: c.lostCents,
      blocked: blockedPerCon.get(c._id) ?? 0,
      entries: auditIncidents.filter((i) => i.conId === c._id).slice(0, 4).map((i) => {
        const l = ledgerDocs.find((d) => d.id === i.ledgerId);
        return { at: i.at.toISOString(), store: i.storeId, kind: i.kind, walletDeltaCents: (l?.walletDeltaCents as number) ?? (i.kind === 'refund' ? i.lossCents : -i.lossCents),
          orderNumber: i.orderNumber, lossCents: i.lossCents, violations: i.violations, who: i.nickname, guardVersion: i.guardVersion };
      }),
      coveredBy: !g ? null : {
        version: g._id, promotedAt: iso(g.promotedAt),
        rules: g.rules.filter((r) => r.cons.includes(c._id)).map((r) => ({ id: r.id, title: r.title })),
        gate: gateRec ? { verdict: gateRec.verdict, scamsBefore: gateRec.baseline.scamSuccess, scamsAfter: gateRec.candidate.scamSuccess,
          scamsTotal: gateRec.candidate.scamsTotal, awayBefore: gateRec.baseline.honestTurnedAway, awayAfter: gateRec.candidate.honestTurnedAway,
          honestTotal: gateRec.candidate.honestTotal, settingsHash: gateRec.candidate.settingsHash, evaluationId: gateRec.evaluationId } : null,
      },
    };
  });

  // ── Tiles ──
  const runtime = deps.stores();
  const tiles: ScreenSnapshot['tiles'] = STORES.map((store) => {
    const rt = runtime.find((r) => r.storeId === store);
    const m = metrics.find((x) => x.storeId === store);
    const applied = rt?.appliedVersion ?? 0;
    const lostCount = m?.lostCount ?? 0;
    const online = rt?.online ?? true;
    const status: StoreStatus = !online ? 'offline'
      : applied > 0 ? 'immune'
      : learning && (learning.phase === 'drafting' || learning.phase === 'testing') && lostCount > 0 ? 'learning'
      : lostCount > 0 ? 'conned' : 'idle';
    const promoted = applied > 0 ? byVersion.get(applied)?.promotedAt ?? null : null;
    return {
      store, status, policy: applied, learnedAt: iso(promoted), lostCents: m?.lostCents ?? 0, lostCount,
      blocked: m?.blockedCount ?? 0, blockedCents: m?.blockedCents ?? 0, online,
      immuneInMs: state?.change === 'promote' ? rollouts.find((r) => r.storeId === store)?.ms ?? null : null,
      missed: !online && activeVersion > applied ? activeVersion : null,
      caughtUpMs: online ? catchups.find((r) => r.storeId === store)?.ms ?? null : null,
    };
  });

  // ── The latest flash sale since the last reset (Kasra's bot_runs, kind 'flash') ──
  const flashDoc = await db.collection('bot_runs').find({ kind: 'flash' }).sort({ _id: -1 }).limit(1).next();
  let flash: FlashSale | null = null;
  if (flashDoc) {
    const at = new Date(flashDoc.finishedAt ?? flashDoc.endedAt ?? flashDoc.at ?? flashDoc.createdAt ?? flashDoc.startedAt ?? (flashDoc._id as { getTimestamp?: () => Date }).getTimestamp?.() ?? Date.now());
    const sold = Number(flashDoc.succeeded ?? flashDoc.salesCount ?? 0);
    const stockAfter = Number(flashDoc.stockAfter ?? 0);
    const stock = Number(flashDoc.stockBefore ?? flashDoc.stock ?? sold + stockAfter);
    if (at >= epochStart) {
      flash = {
        store: (flashDoc.storeId as StoreId) ?? 'queen', attempted: Number(flashDoc.attempted ?? 100), sold, stock, stockAfter,
        oversold: Math.max(0, sold - stock), walletsMatchLedger: flashDoc.walletsMatchLedger === true,
        noNegativeWallets: flashDoc.noNegativeWallets === true, passed: flashDoc.passed === true,
        durationMs: typeof flashDoc.duration === 'number' ? flashDoc.duration : typeof flashDoc.durationMs === 'number' ? flashDoc.durationMs : null,
        at: at.toISOString(),
      };
    }
  }

  // ── Memory governance: the latest probe, the TTL index, forgotten shoppers ──
  const [proofDoc, convIndexes] = await Promise.all([
    db.collection<MemoryProof>(MEMORY_PROOFS).find({}).sort({ at: -1 }).limit(1).next(),
    db.collection('conversations').indexes().catch(() => [] as { name?: string; expireAfterSeconds?: number }[]),
  ]);
  const memory: MemoryGovernance = {
    proof: proofDoc ? { at: proofDoc.at.toISOString(), refused: proofDoc.refused, code: proofDoc.code, message: proofDoc.message,
      collection: proofDoc.collection, field: proofDoc.field } : null,
    ttlSeconds: (convIndexes as { name?: string; expireAfterSeconds?: number }[]).find((i) => i.name === TTL_INDEX)?.expireAfterSeconds ?? null,
    forgotten: 0,
  };

  // ── Feed: the newest events, two lines each ──
  const catchupFeed = await db.collection<RolloutDoc>(ROLLOUTS)
    .find({ change: 'catchup', ...(sinceReset ? { appliedAt: { $gte: sinceReset } } : {}) }).sort({ appliedAt: -1 }).limit(3).toArray();
  const conned = new Set(incidents.map((i) => i.orderNumber).filter(Boolean));
  const nicknames = new Map<string, string>();
  await Promise.all([...new Set(orders.map((o) => String(o.shopperId)))].map(async (id) => {
    const s = await deps.store.shopper(id).catch(() => null);
    if (s) nicknames.set(id, s.nickname);
  }));
  const productNames = new Map((await deps.store.catalog('queen').catch(() => [])).map((p) => [p.sku, p.name]));
  const feed: ScreenSnapshot['feed'] = [
    ...incidents.slice(0, FEED_MAX).map((i) => ({
      id: `i:${i._id}`, kind: 'con-worked' as const, who: i.nickname ?? 'A shopper',
      text: short(`Conned ${STORE_NAME[i.storeId]}, ${i.title}`), amountCents: -i.lossCents, at: i.at.toISOString() })),
    ...blocks.slice(0, FEED_MAX).map((b) => {
      const conTitle = cons.find((c) => (ruleCons.get(`${b.version}:${b.ruleId}`) ?? []).includes(c._id))?.title;
      return { id: `b:${b._id}`, kind: 'con-blocked' as const, who: b.nickname ?? 'A shopper',
        text: short(`Blocked at ${STORE_NAME[b.meta.storeId]}${conTitle ? `, ${conTitle}` : ''}`), amountCents: null, at: b.ts.toISOString() };
    }),
    ...orders.filter((o) => !conned.has(o.number)).map((o) => {
      const lines = (o.lines as { sku: string; qty: number }[] | undefined) ?? [];
      const at = ` at ${STORE_NAME[o.storeId as StoreId]}`;
      const name = (l: { sku: string; qty: number }) => `${l.qty > 1 ? `${l.qty} \u00d7 ` : ''}${productNames.get(l.sku) ?? l.sku}`;
      const both = lines.length === 2 ? `${name(lines[0])}, ${name(lines[1])}${at}` : '';
      const what = lines.length === 0 ? `An order${at}`
        : lines.length === 1 ? `${name(lines[0])}${at}`
        : both && both.length <= 28 ? both
        : `${name(lines[0])} +${lines.length - 1}${at}`;
      return { id: `o:${o._id}`, kind: 'sale' as const, who: nicknames.get(String(o.shopperId)) ?? 'A shopper',
        text: short(what), amountCents: o.totalCents as number, at: new Date(o.createdAt).toISOString() };
    }),
    ...guardrails.filter((g) => g.status !== 'candidate' && (g.promotedAt ?? g.createdAt) >= (sinceReset ?? new Date(0))).map((g) => ({
      id: `g:${g._id}:${g.status}`, kind: (g.status === 'rejected' ? 'rule-rejected' : 'rule-promoted') as FeedKind,
      who: g.status === 'rejected' ? `v${g._id} rejected` : `Policy v${g._id} is live`,
      text: short(g.status === 'rejected' ? 'Failed the 120-case test' : promotedText(g, byVersion.get(g.parentVersion ?? 0))),
      amountCents: null, at: (g.promotedAt ?? g.createdAt).toISOString() })),
    ...(memory.proof && new Date(memory.proof.at) >= epochStart ? [{
      id: `p:${memory.proof.at}`, kind: (memory.proof.refused ? 'con-blocked' : 'con-worked') as FeedKind,
      who: `Tried to store raw chat text in ${memory.proof.collection}`,
      text: short(memory.proof.refused ? `Atlas refused it (code ${memory.proof.code})` : 'Atlas accepted it: check the validator'),
      amountCents: null, at: memory.proof.at }] : []),
    ...(flash ? [{
      id: `f:${flash.at}`, kind: (flash.passed ? 'sale' : 'rule-rejected') as FeedKind, who: `Flash sale at ${STORE_NAME[flash.store]}`,
      text: short(flash.passed ? `${flash.attempted} shoppers, exactly ${flash.sold} sold` : 'A check failed: see the scene'),
      amountCents: null, at: flash.at }] : []),
    ...catchupFeed.map((r) => ({
      id: `c:${r.storeId}:${r.version}:${new Date(r.changedAt).getTime()}`, kind: 'rule-promoted' as const,
      who: `${STORE_NAME[r.storeId]} is back online`,
      text: short(`and caught up on v${r.version}`), amountCents: null, at: new Date(r.appliedAt).toISOString() })),
    ...(state?.rollbacks ?? []).map((r) => ({
      id: `r:${r.at.toISOString()}`, kind: 'rollback' as const, who: `Policy v${r.from} taken back`,
      text: short(`Every store back on v${r.to}`), amountCents: null, at: r.at.toISOString() })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, FEED_MAX);

  // ── The scene the state suggests ──
  const changedAt = state?.changedAt ?? new Date(0);
  const sinceChange = Date.now() - changedAt.getTime();
  const scene: Scene =
    state?.change === 'rollback' && sinceChange < 60_000 ? 'immunity'
    : learning && (learning.phase === 'drafting' || learning.phase === 'testing') ? 'learning'
    : demo && learning && demo.finishedAt && Date.now() - demo.finishedAt.getTime() < 60_000 ? 'learning'
    : learning?.phase === 'rejected' && run?.finishedAt && Date.now() - run.finishedAt.getTime() < 60_000 ? 'learning'
    : learning?.phase === 'rejected' && !run && newest && Date.now() - newest.createdAt.getTime() < 60_000 ? 'learning'
    : state?.change === 'promote' && sinceChange < 30_000 ? 'immunity'
    : activeVersion > 0 ? 'round2' : 'round1';

  return { scene, activeVersion, epoch, tiles, feed, cons: conRows, learning, rollout, versions, audits, flash, memory, results };
}

/** One rollout per store for a change: duplicates (by store, version, change and changedAt) collapse to the fastest. */
export function dedupeRollouts(rows: RolloutDoc[], version: number): RolloutDoc[] {
  const best = new Map<string, RolloutDoc>();
  for (const r of rows) {
    if (r.version !== version) continue;
    const key = `${r.storeId}|${r.version}|${r.change}|${new Date(r.changedAt).getTime()}`;
    const prev = best.get(key);
    if (!prev || r.ms < prev.ms) best.set(key, r);
  }
  // Within this change there's one key per store.
  return [...best.values()];
}

/** "1 new rule on v1, every store" for a version learned on another; "3 rules, every store" for the first. */
function promotedText(g: GuardrailDoc, parent: GuardrailDoc | undefined): string {
  const plural = (n: number) => `${n} ${n === 1 ? 'rule' : 'rules'}`;
  if (!parent || parent._id === 0) return `${plural(g.rules.length)}, every store`;
  const known = new Set(parent.rules.map((r) => r.title.trim().toLowerCase()));
  const added = g.rules.filter((r) => !known.has(r.title.trim().toLowerCase())).length;
  return added > 0 ? `${added} new ${added === 1 ? 'rule' : 'rules'} on v${parent._id}` : `Rewrites v${parent._id}'s rules`;
}
