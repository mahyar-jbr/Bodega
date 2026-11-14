// The big screen's view of the chain, built on the agent side and served inside agent.state() as
// `screen`, so the screen never reads collections itself. Summaries, titles, nicknames and numbers
// only: no raw customer text ever goes in here.
import { ObjectId, type Db } from 'mongodb';
import type { StoreApi, StoreId } from '../../shared/contract';
import type { AgentMetrics, IncidentDoc, MetricPoint } from '../auditor/auditor';
import type { EvaluationDoc } from '../eval/record';
import type { ConDoc } from '../memory/con-memory';
import { AGENT_STATE, CONS, GUARDRAILS, INCIDENTS, ROLLOUTS, type AgentStateDoc, type GuardrailDoc } from '../rollout/state';
import type { RolloutDoc } from '../rollout/runtimes';

const STORES: StoreId[] = ['queen', 'yonge', 'scarborough'];
const STORE_NAME: Record<StoreId, string> = { queen: 'Queen St', yonge: 'Yonge St', scarborough: 'Scarborough' };
const FEED_MAX = 8;

export type Scene = 'round1' | 'learning' | 'immunity' | 'round2' | 'memory';
export type StoreStatus = 'idle' | 'conned' | 'learning' | 'immune';
export type FeedKind = 'sale' | 'con-worked' | 'con-blocked' | 'rule-promoted' | 'rule-rejected' | 'learning' | 'rollback';

export interface ScreenSnapshot {
  scene: Scene;                    // the scene the state suggests; the screen may pin another
  activeVersion: number;
  epoch: number;
  tiles: { store: StoreId; status: StoreStatus; policy: number; learnedAt: string | null; lostCents: number;
    lostCount: number; blocked: number; blockedCents: number; immuneInMs: number | null; online: boolean }[];
  feed: { id: string; kind: FeedKind; who: string; text: string; amountCents: number | null; at: string }[];
  cons: { id: string; summary: string; firstSeen: StoreId; worked: number; blocked: number; coveredBy: number | null }[];
  learning: null | {
    phase: 'incident' | 'drafting' | 'testing' | 'promoted' | 'rejected';
    store: StoreId;
    incident: { summary: string; detail: string; lostCents: number };
    guardrail: { version: number; rules: string[] };
    test: { done: number; total: number; scamsTested: number; scamsStopped: number; honestTested: number; honestServed: number };
    scamsTotal: number; honestTotal: number;
    settingsHash: string;
    verdict: string | null;
  };
  rollout: null | {
    kind: 'immune' | 'forgot'; version: number; toVersion: number; at: string;
    stores: { store: StoreId; ms: number | null }[];
    scams: [number, number] | null; honest: [number, number] | null;
    learningPaused: boolean;
  };
  versions: { v: number; label: string; scamsPct: number; honestAwayPct: number; rejected: boolean }[];
  audits: AuditTrail[];
  results: null | {
    before: { version: number; scamsPct: number; honestAway: number };
    after: { version: number; scamsPct: number; honestAway: number };
    honestTotal: number;
    immunityMs: number | null;
  };
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
const short = (s: string, n = 30) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

// state() is polled by the screen and by every shop window: build the snapshot at most this often.
const SNAPSHOT_TTL_MS = 750;
let cached: { db: string; at: number; value: Promise<ScreenSnapshot> } | null = null;

export function screenSnapshot(deps: SnapshotDeps): Promise<ScreenSnapshot> {
  const now = Date.now();
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

  const [metrics, guardrails, incidents, cons, blocks, evaluations, rollouts, orders] = await Promise.all([
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

  // ── Learning: the newest learning cycle (learning_runs), its attempt's held-out test and verdict ──
  const run = await db.collection<LearningRunDoc>('learning_runs').find({ epoch }).sort({ startedAt: -1 }).limit(1).next();
  const newest = guardrails.find((g) => g.source !== 'v0');
  let learning: ScreenSnapshot['learning'] = null;
  const attempt = run?.attempts.at(-1);
  const testEval = attempt?.evaluationId
    ? evaluations.find((e) => e._id.toHexString() === attempt.evaluationId)
      ?? await db.collection<EvaluationDoc>('evaluations').findOne({ _id: new ObjectId(attempt.evaluationId) })
    : !run && newest ? recentEvals.find((e) => e.version === newest._id) : undefined;
  if (run || state?.learning || newest) {
    const phase: NonNullable<ScreenSnapshot['learning']>['phase'] = run
      ? run.phase === 'learning' ? (attempt ? 'drafting' : 'incident')
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
    const rules = attempt?.rules ?? byVersion.get(versionNo)?.rules.map((r) => r.title) ?? [];
    const reasons = attempt?.reasons ?? [];
    learning = trigger || run || newest ? {
      phase,
      store: (cons.find((c) => conIds.has(c._id))?.firstSeenStore) ?? trigger?.storeId ?? 'queen',
      incident: trigger
        ? { summary: trigger.summary, detail: `${trigger.kind === 'refund' ? 'A refund' : 'A sale'} at ${STORE_NAME[trigger.storeId]}${conIds.size > 1 ? `, and ${conIds.size - 1} more ${conIds.size === 2 ? 'con' : 'cons'}` : ''}`, lostCents: trigger.lossCents }
        : { summary: 'A new con', detail: '', lostCents: 0 },
      guardrail: { version: versionNo, rules },
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
      stores: STORES.map((store) => ({ store, ms: rollouts.find((r) => r.storeId === store)?.ms ?? null })),
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
    const promoteMs = state?.change === 'promote' ? rollouts.map((r) => r.ms) : [];
    results = {
      before: { version: 0, scamsPct: worst.summary!.scams.successPct, honestAway: worst.summary!.honest.turnedAway },
      after: { version: activeVersion, scamsPct: after.summary.scams.successPct, honestAway: after.summary.honest.turnedAway },
      honestTotal: after.summary.honest.total,
      immunityMs: promoteMs.length === STORES.length ? Math.max(...promoteMs) : null,
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
    const status: StoreStatus = applied > 0 ? 'immune'
      : learning && (learning.phase === 'drafting' || learning.phase === 'testing') && lostCount > 0 ? 'learning'
      : lostCount > 0 ? 'conned' : 'idle';
    const promoted = applied > 0 ? byVersion.get(applied)?.promotedAt ?? null : null;
    return {
      store, status, policy: applied, learnedAt: iso(promoted), lostCents: m?.lostCents ?? 0, lostCount,
      blocked: m?.blockedCount ?? 0, blockedCents: m?.blockedCents ?? 0, online: rt?.online ?? true,
      immuneInMs: state?.change === 'promote' ? rollouts.find((r) => r.storeId === store)?.ms ?? null : null,
    };
  });

  // ── Feed: the newest events, two lines each ──
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
      const line = (o.lines as { sku: string; qty: number }[] | undefined)?.[0];
      const what = line ? `${line.qty > 1 ? `${line.qty} \u00d7 ` : ''}${productNames.get(line.sku) ?? line.sku}` : 'An order';
      return { id: `o:${o._id}`, kind: 'sale' as const, who: nicknames.get(String(o.shopperId)) ?? 'A shopper',
        text: short(`${what} at ${STORE_NAME[o.storeId as StoreId]}`), amountCents: o.totalCents as number, at: new Date(o.createdAt).toISOString() };
    }),
    ...guardrails.filter((g) => g.status !== 'candidate' && (g.promotedAt ?? g.createdAt) >= (sinceReset ?? new Date(0))).map((g) => ({
      id: `g:${g._id}:${g.status}`, kind: (g.status === 'rejected' ? 'rule-rejected' : 'rule-promoted') as FeedKind,
      who: g.status === 'rejected' ? `v${g._id} rejected` : `Policy v${g._id} is live`,
      text: short(g.status === 'rejected' ? 'Failed the 120-case test' : `${g.rules.length} ${g.rules.length === 1 ? 'rule' : 'rules'}, every store`),
      amountCents: null, at: (g.promotedAt ?? g.createdAt).toISOString() })),
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
    : learning?.phase === 'rejected' && run?.finishedAt && Date.now() - run.finishedAt.getTime() < 60_000 ? 'learning'
    : learning?.phase === 'rejected' && !run && newest && Date.now() - newest.createdAt.getTime() < 60_000 ? 'learning'
    : state?.change === 'promote' && sinceChange < 30_000 ? 'immunity'
    : activeVersion > 0 ? 'round2' : 'round1';

  return { scene, activeVersion, epoch, tiles, feed, cons: conRows, learning, rollout, versions, audits, results };
}
