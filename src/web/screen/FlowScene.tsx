// Scene 8, Flow: the whole mechanism as one loop of 15 real steps. The top row runs left to right (a con
// lands and is learned), the bottom row right to left (the fix goes live everywhere), and the arrow from
// "Blocked at the guard" back up to the Guard closes the loop. The active step glows, finished steps keep
// their live values, and a dot travels each edge as the next step lights up.
import { useLayoutEffect, useRef, useState } from 'react';
import type { FlowNodeId } from '../../agent/screen/flow';
import type { FlowData, Scene } from './types';

const META: Record<FlowNodeId, { name: string; feature: string }> = {
  shopper: { name: 'Shopper', feature: 'chat or voice' },
  shopkeeper: { name: 'Claude shopkeeper', feature: 'same model' },
  guard: { name: 'Guard', feature: 'the money step' },
  transaction: { name: 'Atlas transaction', feature: 'ledger + orders' },
  ledgerStream: { name: 'Change stream', feature: 'ledger to auditor' },
  auditor: { name: 'Auditor', feature: 'checks real data' },
  incident: { name: 'Incident', feature: 'summary only' },
  memory: { name: 'Agent Memory', feature: 'Vector Search' },
  learner: { name: 'Opus learner', feature: 'plain-words rule' },
  gate: { name: 'Held-out gate', feature: '120 unseen cases' },
  guardrail: { name: 'Guardrail', feature: 'versioned doc' },
  stateStream: { name: 'Change stream', feature: 'agent_state' },
  runtimes: { name: 'Three stores', feature: 'rollouts' },
  block: { name: 'Blocked', feature: 'round 2' },
  rollback: { name: 'Roll back', feature: 'every store forgets' },
};

// Grid positions: 8 columns. Top row 1..8 left to right; bottom row from column 8 back to column 2.
const TOP: FlowNodeId[] = ['shopper', 'shopkeeper', 'guard', 'transaction', 'ledgerStream', 'auditor', 'incident', 'memory'];
const BOTTOM: FlowNodeId[] = ['learner', 'gate', 'guardrail', 'stateStream', 'runtimes', 'block', 'rollback'];
const ORDER: FlowNodeId[] = [...TOP, ...BOTTOM];
const place = (id: FlowNodeId) => {
  const t = TOP.indexOf(id);
  return t >= 0 ? { row: 1, col: t + 1 } : { row: 3, col: 8 - BOTTOM.indexOf(id) };
};

/** Which header beat a step belongs to. */
export function flowBeat(active: FlowNodeId | null): Scene | null {
  if (!active) return null;
  if (active === 'learner' || active === 'gate') return 'learning';
  if (active === 'guardrail' || active === 'stateStream' || active === 'runtimes') return 'immunity';
  if (active === 'block') return 'round2';
  if (active === 'rollback') return 'memory';
  return 'round1';
}

export function FlowScene({ flow }: { flow: FlowData }) {
  const grid = useRef<HTMLDivElement>(null);
  const [centers, setCenters] = useState<Partial<Record<FlowNodeId, { x: number; y: number; w: number; h: number }>>>({});
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const measure = () => {
      const next: typeof centers = {};
      el.querySelectorAll<HTMLElement>('[data-node]').forEach((n) => {
        next[n.dataset.node as FlowNodeId] = { x: n.offsetLeft + n.offsetWidth / 2, y: n.offsetTop + n.offsetHeight / 2, w: n.offsetWidth, h: n.offsetHeight };
      });
      setCenters(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const lit = (id: FlowNodeId) => !!byId.get(id)?.value;
  const edge = (a: FlowNodeId, b: FlowNodeId): string | null => {
    const p = centers[a], q = centers[b];
    if (!p || !q) return null;
    if (p.y === q.y) {                                  // same row: edge to edge
      const dir = q.x > p.x ? 1 : -1;
      return `M ${p.x + dir * p.w / 2} ${p.y} L ${q.x - dir * q.w / 2} ${q.y}`;
    }
    return `M ${p.x} ${p.y + (q.y > p.y ? p.h / 2 : -p.h / 2)} L ${q.x} ${q.y - (q.y > p.y ? q.h / 2 : -q.h / 2)}`;
  };
  const edges: { a: FlowNodeId; b: FlowNodeId; d: string | null; back?: boolean }[] = [
    ...ORDER.slice(0, -1).map((a, i) => ({ a, b: ORDER[i + 1], d: edge(a, ORDER[i + 1]) })),
    { a: 'block', b: 'guard', d: edge('block', 'guard'), back: true },   // round 2 runs through the same guard
  ];
  const activeIndex = flow.active ? ORDER.indexOf(flow.active) : -1;
  const incoming = flow.active === 'guard' && byId.get('guard')?.tone === 'immune'
    ? edges.find((e) => e.back) : activeIndex > 0 ? edges[activeIndex - 1] : undefined;

  return (
    <section className="fl-scene" aria-label="How Bodega works, live">
      <div className="fl-grid" ref={grid}>
        <svg className="fl-edges" aria-hidden="true">
          <defs>
            <marker id="fl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
            </marker>
          </defs>
          {edges.map((e) => e.d && (
            <path key={`${e.a}-${e.b}`} d={e.d} className="fl-edge" data-lit={lit(e.a) && lit(e.b) ? 'true' : undefined}
              data-back={e.back ? 'true' : undefined} markerEnd="url(#fl-arrow)" />
          ))}
          {incoming?.d && flow.activeAt && (
            <circle key={`${flow.active}-${flow.activeAt}`} r="9" className="fl-dot">
              <animateMotion dur="0.9s" repeatCount="1" fill="freeze" path={incoming.d} />
            </circle>
          )}
        </svg>
        {ORDER.map((id) => {
          const n = byId.get(id)!;
          const { row, col } = place(id);
          const state = flow.active === id ? 'active' : n.value ? 'done' : 'waiting';
          return (
            <div key={id} data-node={id} className="fl-node bs-glass" data-state={state} data-tone={n.tone ?? undefined}
              style={{ gridRow: row, gridColumn: col }}>
              <div className="fl-name">{META[id].name}</div>
              <div className="fl-feature">{META[id].feature}</div>
              {id === 'gate' && flow.gate && flow.gate.done < flow.gate.total
                ? <GateDots gate={flow.gate} />
                : <div className="fl-value" key={n.value ?? ''}>{n.value ?? '—'}</div>}
              {n.detail && <div className="fl-detail">{n.detail}</div>}
            </div>
          );
        })}
        <div className="fl-legend" style={{ gridRow: 3, gridColumn: 1 }}>
          <div className="fl-legend-title">Live from Atlas</div>
          <div>Same model, same prompt</div>
          <div className="fl-mono">{flow.hash.slice(0, 8)}</div>
        </div>
        <div className="fl-narration" data-tone={flow.narrationTone ?? undefined}>
          <span key={flow.narration ?? ''}>{flow.narration ?? 'Waiting for the first shopper.'}</span>
        </div>
      </div>
    </section>
  );
}

function GateDots({ gate }: { gate: NonNullable<FlowData['gate']> }) {
  const dots = (total: number, tested: number, good: number, tone: string) =>
    Array.from({ length: total }, (_, i) => <i key={i} data-state={i < good ? tone : i < tested ? 'miss' : 'waiting'} />);
  return (
    <div className="fl-gate">
      <div className="fl-value">{gate.done} of {gate.total}</div>
      <div className="fl-dots">{dots(gate.scamsTotal, gate.scamsTested, gate.scamsStopped, 'immune')}</div>
      <div className="fl-dots">{dots(gate.honestTotal, gate.honestTested, gate.honestServed, 'served')}</div>
    </div>
  );
}
