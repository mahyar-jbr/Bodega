// The Flow scene: Bodega's whole mechanism as one loop of 15 nodes, lit by real data as it happens.
// Built from what the snapshot already reads (incidents, cons, blocks, orders, the learning cycle,
// guardrails, rollouts) and, when present, the agent's own `flow_events` log (Eng 1), which adds the
// shopper's channel, the guard's decision and the change-stream lag. Summaries and numbers only.
import type { StoreId } from '../../shared/contract';

export const FLOW_NODES = [
  'shopper', 'shopkeeper', 'guard', 'transaction', 'ledgerStream', 'auditor', 'incident', 'memory',
  'learner', 'gate', 'guardrail', 'stateStream', 'runtimes', 'block', 'rollback',
] as const;
export type FlowNodeId = typeof FLOW_NODES[number];

export interface FlowNode {
  id: FlowNodeId;
  value: string | null;          // the live value, big (null: nothing yet this epoch)
  detail: string | null;         // a second, smaller line
  at: string | null;             // when it last happened
  tone: 'loss' | 'immune' | 'served' | 'learning' | null;
}

export interface FlowView {
  nodes: FlowNode[];
  active: FlowNodeId | null;     // the newest step, if it's recent
  activeAt: string | null;
  narration: string | null;      // one line for the room
  narrationTone: 'loss' | 'immune' | 'served' | 'learning' | null;
  gate: { done: number; total: number; scamsStopped: number; scamsTested: number; honestServed: number; honestTested: number; scamsTotal: number; honestTotal: number } | null;
  hash: string;
}

const STORE_NAME: Record<StoreId, string> = { queen: 'Queen St', yonge: 'Yonge St', scarborough: 'Scarborough' };
const ACTIVE_FOR_MS = 25_000;

const VIOLATION_WORDS: Record<string, string> = {
  code_unknown: 'code not on file', code_inactive: 'code switched off', member_unknown: 'member not on file',
  member_not_shopper: "someone else's membership", discount_no_basis: 'discount with no basis', discount_over_valid: 'bigger than the code gives',
  price_below_list: 'below the list price', free_item: 'given away free', refund_no_order: 'no such order', refund_not_shoppers: "someone else's order",
  refund_already_refunded: 'already refunded', refund_over_refundable: 'more than was paid', refund_price_adjustment: 'refund used as a discount',
};

export interface FlowInputs {
  now: number;
  hash: string;
  activeVersion: number;
  incident: null | { nickname: string | null; storeId: StoreId; kind: 'sale' | 'refund'; lossCents: number; violations: string[];
    title: string; summary: string; orderNumber: string | null; conId: string | null; at: Date; createdAt: Date };
  con: null | { grouping: 'agent-memory' | 'violation'; matchScore: number | null; incidents: number; firstSeenStore: StoreId; lastSeenAt: Date };
  honest: null | { nickname: string | null; storeId: StoreId; number: string; totalCents: number; codePct: number | null; code: string | null; at: Date };
  learning: null | { phase: string; rules: string[]; ruleCount: number; version: number; startedAt: Date | null;
    test: { done: number; total: number; scamsTested: number; scamsStopped: number; honestTested: number; honestServed: number } | null;
    scamsTotal: number; honestTotal: number; testStartedAt: Date | null; testFinishedAt: Date | null; verdict: string | null };
  promoted: null | { version: number; at: Date; status: string };
  rollout: null | { kind: 'immune' | 'forgot'; version: number; toVersion: number; at: Date; stores: { store: StoreId; ms: number | null }[]; lastAppliedAt: Date | null };
  block: null | { nickname: string | null; storeId: StoreId; title: string | null; firstSeenStore: StoreId | null; version: number | null; at: Date };
  rollback: null | { from: number; to: number; at: Date; stores: { store: StoreId; ms: number | null }[] };
  events: { at: Date; node: string; storeId: StoreId | null; value: string; ms?: number | null; score?: number | null;
    version?: number | null; cents?: number | null; firstSeenStore?: StoreId | null }[];
}

const money = (c: number) => `$${(Math.abs(c) / 100).toFixed(2)}`;
const ms = (n: number | null | undefined) => (n == null ? '…' : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`);
const INITIAL: Record<StoreId, string> = { queen: 'Q', yonge: 'Y', scarborough: 'S' };
/** "Q 320 · Y 320 · S 319 ms" for a node; the narration spells the stores out. */
const storeMs = (stores: { store: StoreId; ms: number | null }[]) => {
  const all = stores.every((s) => s.ms != null && s.ms < 1000);
  return stores.map((s) => `${INITIAL[s.store]} ${all ? Math.round(s.ms!) : ms(s.ms)}`).join(' · ') + (all ? ' ms' : '');
};
const storeMsLong = (stores: { store: StoreId; ms: number | null }[]) =>
  stores.map((s) => `${STORE_NAME[s.store]} ${ms(s.ms)}`).join(', ');

export function buildFlow(x: FlowInputs): FlowView {
  const nodes = new Map<FlowNodeId, FlowNode>(FLOW_NODES.map((id) => [id, { id, value: null, detail: null, at: null, tone: null }]));
  const set = (id: FlowNodeId, at: Date | null | undefined, value: string, detail: string | null = null, tone: FlowNode['tone'] = null) => {
    const prev = nodes.get(id)!;
    if (prev.at && at && new Date(prev.at) > at) return;          // keep the newest
    nodes.set(id, { id, value, detail, at: at ? at.toISOString() : prev.at, tone });
  };

  // The con: shopper → shopkeeper → guard (v0 lets it through) → transaction → change stream → auditor → incident → memory.
  if (x.incident) {
    const i = x.incident;
    const moved = new Date(i.at.getTime() - 1);
    set('shopper', new Date(moved.getTime() - 3), i.nickname ?? 'A shopper', `at ${STORE_NAME[i.storeId]}`, 'loss');
    set('shopkeeper', new Date(moved.getTime() - 2), 'Sonnet 5.5', `frozen ${x.hash.slice(0, 8)}`, 'loss');
    set('guard', new Date(moved.getTime() - 1), 'pass', i.storeId && x.activeVersion === 0 ? 'v0 has no rules yet' : null, 'loss');
    set('transaction', i.at, i.kind === 'refund' ? `refund ${money(i.lossCents)}` : `${i.orderNumber ?? 'order'}`, i.kind === 'refund' ? null : 'sale', 'loss');
    const lag = i.createdAt.getTime() - i.at.getTime();
    set('ledgerStream', new Date(i.createdAt.getTime() - 1), 'ledger insert', `${ms(Math.max(0, lag))} to the auditor`);
    set('auditor', i.createdAt, 'no valid basis', VIOLATION_WORDS[i.violations[0]] ?? i.violations[0] ?? null, 'loss');
    set('incident', i.createdAt, i.summary, `${money(i.lossCents)} lost`, 'loss');
  }
  if (x.con) {
    const c = x.con;
    const value = c.grouping === 'violation' ? 'grouped by violation'
      : c.incidents > 1 && c.matchScore != null ? `matched ${c.matchScore.toFixed(2)}` : 'new con';
    set('memory', c.lastSeenAt, value, `first seen at ${STORE_NAME[c.firstSeenStore]}`, 'learning');
  }

  // Learning: Opus writes the rule, the gate proves it on 120 unseen cases.
  let gate: FlowView['gate'] = null;
  if (x.learning) {
    const l = x.learning;
    if (l.rules.length) set('learner', l.startedAt ?? l.testStartedAt, l.rules[0], `Opus 5.5 · ${l.ruleCount} ${l.ruleCount === 1 ? 'rule' : 'rules'}`, 'learning');
    else if (l.phase === 'drafting' || l.phase === 'incident') set('learner', l.startedAt, 'writing a rule…', 'Opus 5.5', 'learning');
    if (l.test && (l.test.done > 0 || l.phase === 'testing')) {
      gate = { ...l.test, scamsTotal: l.scamsTotal, honestTotal: l.honestTotal };
      const done = l.test.done >= l.test.total && l.phase !== 'testing';
      set('gate', done ? l.testFinishedAt ?? l.testStartedAt : l.testStartedAt,
        done ? (l.phase === 'rejected' ? 'rejected' : 'passed') : `${l.test.done} of ${l.test.total}`,
        `same model ${x.hash.slice(0, 8)}`, l.phase === 'rejected' ? 'loss' : done ? 'immune' : 'learning');
    }
  }

  // The fix goes live: a versioned document, the change stream, every store's runtime.
  if (x.promoted) {
    const p = x.promoted;
    const waiting = p.status === 'awaiting_approval';
    set('guardrail', p.at, waiting ? `v${p.version} waiting` : `v${p.version} promoted`, waiting ? 'for a person to approve' : 'versioned in Atlas', waiting ? 'learning' : 'immune');
    if (!waiting) set('stateStream', new Date(p.at.getTime() + 1), `v${p.version} sent`, 'to every store', 'immune');
  }
  if (x.rollout && x.rollout.kind === 'immune') {
    const r = x.rollout;
    const all = r.stores.every((s) => s.ms != null);
    set('runtimes', r.lastAppliedAt ?? r.at, all ? `immune in ${ms(Math.max(...r.stores.map((s) => s.ms ?? 0)))}` : 'applying…', storeMs(r.stores), 'immune');
  }
  if (x.block) {
    const b = x.block;
    set('guard', new Date(b.at.getTime() - 1), 'blocked', b.title ? `rule: ${b.title}` : 'a learned rule', 'immune');   // round 2 stops at the same guard
    set('block', b.at, `blocked at ${STORE_NAME[b.storeId]}`, b.firstSeenStore ? `${STORE_NAME[b.firstSeenStore]} saw it first` : b.title, 'immune');
  }
  if (x.rollback) {
    const r = x.rollback;
    const all = r.stores.every((s) => s.ms != null);
    set('rollback', r.at, `v${r.from} → v${r.to}`, all ? `forgot: ${storeMs(r.stores)}` : 'stores forgetting…', 'learning');
  }

  // An honest purchase: the guard lets it through (the room should see it's not blocking everyone).
  if (x.honest) {
    const h = x.honest;
    set('shopper', new Date(h.at.getTime() - 3), h.nickname ?? 'A shopper', `at ${STORE_NAME[h.storeId]}`, 'served');
    set('shopkeeper', new Date(h.at.getTime() - 2), 'Sonnet 5.5', `frozen ${x.hash.slice(0, 8)}`, 'served');
    set('guard', new Date(h.at.getTime() - 1), 'pass', h.code ? `real code ${h.code}` : 'honest order', 'served');
    set('transaction', h.at, `${h.number} ${money(h.totalCents)}`, 'honest sale', 'served');
  }

  // The agent's own event log, where it has more than the snapshot can see.
  for (const e of x.events) {
    const node: FlowNodeId | null = e.node === 'changeStream' ? (/agent_state/.test(e.value) ? 'stateStream' : 'ledgerStream')
      : e.node === 'rollout' ? (/forgot/.test(e.value) ? 'rollback' : 'runtimes')
      : (FLOW_NODES as readonly string[]).includes(e.node) ? e.node as FlowNodeId
      : e.node === 'transaction' ? 'transaction' : null;
    if (!node) continue;
    const cur = nodes.get(node)!;
    if (cur.at && new Date(cur.at) > e.at) continue;
    if (node === 'shopper') set(node, e.at, e.value.split(' · ')[0], e.value.includes(' · ') ? `by ${e.value.split(' · ')[1]}` : cur.detail, cur.tone);
    else if (node === 'guard') set(node, e.at, e.value.split(':')[0], e.value.includes(':') ? e.value.split(':').slice(1).join(':').trim() : null,
      /block/.test(e.value) ? 'immune' : /cap/.test(e.value) ? 'learning' : cur.tone ?? 'served');
    else if (node === 'ledgerStream' || node === 'stateStream') set(node, e.at, e.value, e.ms != null ? `delivered in ${ms(e.ms)}` : cur.detail, cur.tone);
    else if (node === 'memory' && e.score != null) set(node, e.at, `matched ${e.score.toFixed(2)}`, cur.detail, 'learning');
  }

  // The newest step is the active one, while it's recent.
  const list = FLOW_NODES.map((id) => nodes.get(id)!);
  const newest = list.filter((n) => n.at).sort((a, b) => b.at!.localeCompare(a.at!))[0];
  const active = newest && x.now - new Date(newest.at!).getTime() < ACTIVE_FOR_MS ? newest.id : null;
  const [narration, narrationTone] = narrate(active ?? newest?.id ?? null, x, nodes);
  return { nodes: list, active, activeAt: newest?.at ?? null, narration, narrationTone, gate, hash: x.hash };
}

function narrate(id: FlowNodeId | null, x: FlowInputs, nodes: Map<FlowNodeId, FlowNode>): [string | null, FlowView['narrationTone']] {
  const i = x.incident, c = x.con, l = x.learning;
  switch (id) {
    case null: return [null, null];
    case 'shopper': case 'shopkeeper': case 'guard': case 'transaction': {
      const h = x.honest;
      if (h && nodes.get('guard')!.tone === 'served')
        return [`Honest customer served at ${STORE_NAME[h.storeId]}${h.codePct ? ` · real code, ${h.codePct}% off` : ''}`, 'served'];
      if (nodes.get('guard')!.tone === 'immune' && x.block) return [`Blocked at the guard: ${x.block.firstSeenStore ? `${STORE_NAME[x.block.firstSeenStore]} saw this trick first` : 'a learned rule'}`, 'immune'];
      return i ? [`${i.nickname ?? 'A shopper'} talked ${STORE_NAME[i.storeId]} into it: ${money(i.lossCents)} moved in one Atlas transaction`, 'loss'] : [null, null];
    }
    case 'ledgerStream': return ['The change stream hands every ledger entry to the auditor', null];
    case 'auditor': return i ? [`The auditor checked it against real data: ${VIOLATION_WORDS[i.violations[0]] ?? 'no valid basis'}`, 'loss'] : [null, null];
    case 'incident': return i ? [`Stored as an incident, a summary only: "${i.summary}"`, 'loss'] : [null, null];
    case 'memory': return c ? [c.grouping === 'agent-memory' && c.incidents > 1 && c.matchScore != null
      ? `Atlas Agent Memory matched it to a known con (${c.matchScore.toFixed(2)}), first seen at ${STORE_NAME[c.firstSeenStore]}`
      : `Atlas Agent Memory filed it as a con first seen at ${STORE_NAME[c.firstSeenStore]}`, 'learning'] : [null, null];
    case 'learner': return l?.rules[0] ? [`Opus wrote a rule in plain words: "${l.rules[0]}"`, 'learning'] : ['Opus is writing a rule from the cons it remembered', 'learning'];
    case 'gate': {
      const g = l?.test;
      if (!g) return [null, null];
      if (l!.phase === 'rejected') return [l!.verdict ?? 'The gate said no: it would have hurt honest customers', 'loss'];
      if (g.done >= g.total) return [`Proven on ${g.total} unseen cases with the same model: ${g.scamsStopped} of ${l!.scamsTotal} scams stopped, ${g.honestServed} of ${l!.honestTotal} honest served`, 'immune'];
      return [`Testing on ${g.total} cases it has never seen, same model ${x.hash.slice(0, 8)}: ${g.done} done`, 'learning'];
    }
    case 'guardrail': return x.promoted ? [x.promoted.status === 'awaiting_approval'
      ? `Policy v${x.promoted.version} is proven and waits for a person to approve it`
      : `Policy v${x.promoted.version} promoted in one Atlas transaction`, 'immune'] : [null, null];
    case 'stateStream': return x.promoted ? [`The change stream tells every store about v${x.promoted.version}`, 'immune'] : [null, null];
    case 'runtimes': return x.rollout ? [`Every store is immune: ${storeMsLong(x.rollout.stores)}`, 'immune'] : [null, null];
    case 'block': return x.block ? [`Blocked at ${STORE_NAME[x.block.storeId]}${x.block.firstSeenStore ? `: ${STORE_NAME[x.block.firstSeenStore]} saw this trick first` : ''}`, 'immune'] : [null, null];
    case 'rollback': return x.rollback ? [`Rolled back to v${x.rollback.to}: every store forgot it (${storeMsLong(x.rollback.stores)})`, 'learning'] : [null, null];
  }
}
