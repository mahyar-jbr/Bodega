// Scene 8, Flow: Bodega's whole mechanism as one loop of 15 live steps, laid out as a ring of stations
// around a centre stage. A track runs inside the ring; one light travels it to the newest step.
// The eye goes to one place: the active station and the centre, which says what just happened in plain
// words and shows its one number big. Done stations sit at 60%, pending ones at 25%.
// When every store is immune the whole loop glows once and holds for 8 s: the photo moment.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FlowNodeId } from '../../agent/screen/flow';
import type { StoreId } from '../../shared/contract';
import type { FlowData, Scene } from './types';

const META: Record<FlowNodeId, { title: string; tech: string; short?: string }> = {
  shopper: { title: 'A shopper asks', tech: 'chat or voice' },
  shopkeeper: { title: 'Claude serves', tech: 'Claude Sonnet 5.5' },
  guard: { title: 'The guard checks', tech: 'guardrail runtime' },
  transaction: { title: 'Money moves', tech: 'Atlas transaction' },
  ledgerStream: { title: 'Atlas tells the auditor', tech: 'change stream' },
  auditor: { title: 'Checked against the facts', tech: 'auditor' },
  incident: { title: 'The con lands', tech: 'incident' },
  memory: { title: 'Atlas remembers it', tech: 'Atlas Agent Memory', short: 'Agent Memory' },
  learner: { title: 'Claude writes a rule', tech: 'Claude Opus 5.5' },
  gate: { title: 'Proven on 120 unseen cases', tech: 'held-out gate' },
  guardrail: { title: 'A new policy', tech: 'guardrail doc' },
  stateStream: { title: 'Sent to every store', tech: 'change stream' },
  runtimes: { title: 'Every store immune', tech: 'store runtimes' },
  block: { title: 'The trick fails', tech: 'same guard' },
  rollback: { title: 'One click undoes it', tech: 'rollback' },
};

// The ring: 6 columns by 4 rows, clockwise from the top left. Row 2 of column 1 stays open, so the track
// visibly closes the loop back to the first station.
const ORDER: FlowNodeId[] = ['shopper', 'shopkeeper', 'guard', 'transaction', 'ledgerStream', 'auditor', 'incident', 'memory',
  'learner', 'gate', 'guardrail', 'stateStream', 'runtimes', 'block', 'rollback'];
const CELL: Record<FlowNodeId, [row: number, col: number]> = {
  shopper: [1, 1], shopkeeper: [1, 2], guard: [1, 3], transaction: [1, 4], ledgerStream: [1, 5], auditor: [1, 6],
  incident: [2, 6], memory: [3, 6],
  learner: [4, 6], gate: [4, 5], guardrail: [4, 4], stateStream: [4, 3], runtimes: [4, 2], block: [4, 1],
  rollback: [3, 1],
};
const CHAPTER: Record<FlowNodeId, string> = {
  shopper: 'The con', shopkeeper: 'The con', guard: 'The con', transaction: 'The con', ledgerStream: 'The con', auditor: 'The con',
  incident: 'The con', memory: 'Learning', learner: 'Learning', gate: 'Learning', guardrail: 'Immunity', stateStream: 'Immunity',
  runtimes: 'Immunity', block: 'Round 2', rollback: 'Roll back',
};
const STORE_LETTER: Record<StoreId, string> = { queen: 'Queen St', yonge: 'Yonge St', scarborough: 'Scarborough' };
const PHOTO_HOLD_MS = 8_000;
const HOP_MS = 800;

/** Which header beat a step belongs to. */
export function flowBeat(active: FlowNodeId | null): Scene | null {
  if (!active) return null;
  if (active === 'memory' || active === 'learner' || active === 'gate') return 'learning';
  if (active === 'guardrail' || active === 'stateStream' || active === 'runtimes') return 'immunity';
  if (active === 'block') return 'round2';
  if (active === 'rollback') return 'memory';
  return 'round1';
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Text whose numbers count up to their new value (tabular figures, so nothing shifts). Order numbers and versions stay put. */
function Count({ text }: { text: string }) {
  const NUM = /(?<![A-Za-z\d-])(\d+(?:\.\d+)?)/g;
  const [shown, setShown] = useState(text);
  const from = useRef<string | null>(null);
  useEffect(() => {
    const prev = from.current;
    from.current = text;
    const targets = [...text.matchAll(NUM)].map((m) => m[1]);
    if (!targets.length || reducedMotion()) { setShown(text); return; }
    const sameShape = prev != null && prev.replace(NUM, '#') === text.replace(NUM, '#');
    const starts = sameShape ? [...prev!.matchAll(NUM)].map((m) => Number(m[1])) : targets.map(() => 0);
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 700), e = 1 - Math.pow(1 - k, 3);
      let i = 0;
      setShown(text.replace(NUM, (m) => {
        const to = Number(m), s = starts[i++] ?? 0, dp = m.includes('.') ? m.split('.')[1].length : 0;
        return (s + (to - s) * e).toFixed(dp);
      }));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]);
  return <>{shown}</>;
}

type Box = { x: number; y: number; w: number; h: number };

export function FlowScene({ flow }: { flow: FlowData }) {
  // The photo moment: hold the lit loop for 8 s from when every store became immune (only if that's news).
  const [photoUntil, setPhotoUntil] = useState(0);
  const seenPhoto = useRef<string | null>(null);
  useEffect(() => {
    const p = flow.photo;
    if (!p || seenPhoto.current === p.at) return;
    seenPhoto.current = p.at;
    if (Date.now() - new Date(p.at).getTime() < 20_000) setPhotoUntil(Date.now() + PHOTO_HOLD_MS);
  }, [flow.photo]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (photoUntil <= Date.now()) return;
    const t = setTimeout(() => tick((n) => n + 1), photoUntil - Date.now() + 20);
    return () => clearTimeout(t);
  }, [photoUntil]);
  const holding = photoUntil > Date.now() && !!flow.photo;
  const active: FlowNodeId | null = holding ? 'runtimes' : flow.active;

  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const lit = (id: FlowNodeId) => !!byId.get(id)?.value;
  const focus = active ?? null;

  // ── Geometry: measure the stations, build the track inside the ring ──
  const grid = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<Partial<Record<FlowNodeId, Box>>>({});
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const measure = () => {
      const next: Partial<Record<FlowNodeId, Box>> = {};
      el.querySelectorAll<HTMLElement>('[data-node]').forEach((n) => {
        next[n.dataset.node as FlowNodeId] = { x: n.offsetLeft, y: n.offsetTop, w: n.offsetWidth, h: n.offsetHeight };
      });
      setBoxes(next);
      setSize({ w: el.offsetWidth, h: el.offsetHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const track = useMemo(() => {
    const a = boxes.shopkeeper, b = boxes.incident, c = boxes.gate, d = boxes.rollback;
    if (!a || !b || !c || !d) return null;
    const x0 = d.x + d.w + (a.x - (d.x + d.w)) / 2, x1 = b.x - (b.x - (boxes.ledgerStream!.x + boxes.ledgerStream!.w)) / 2;
    const y0 = a.y + a.h + (b.y - (a.y + a.h)) / 2, y1 = c.y - (c.y - (boxes.memory!.y + boxes.memory!.h)) / 2;
    const R = 28, q = R * (1 - Math.SQRT1_2);
    const tl = { x: x0 + q, y: y0 + q }, tr = { x: x1 - q, y: y0 + q }, br = { x: x1 - q, y: y1 - q }, bl = { x: x0 + q, y: y1 - q };
    const d_ = `M ${tl.x} ${tl.y} A ${R} ${R} 0 0 1 ${x0 + R} ${y0} H ${x1 - R} A ${R} ${R} 0 0 1 ${x1} ${y0 + R} V ${y1 - R}`
      + ` A ${R} ${R} 0 0 1 ${x1 - R} ${y1} H ${x0 + R} A ${R} ${R} 0 0 1 ${x0} ${y1 - R} V ${y0 + R} A ${R} ${R} 0 0 1 ${tl.x} ${tl.y}`;
    const station = (id: FlowNodeId) => {
      const bx = boxes[id]!, [row, col] = CELL[id], cx = bx.x + bx.w / 2, cy = bx.y + bx.h / 2;
      if (id === 'shopper') return tl;
      if (id === 'auditor') return tr;
      if (id === 'learner') return br;
      if (id === 'block') return bl;
      if (row === 1) return { x: cx, y: y0 };
      if (row === 4) return { x: cx, y: y1 };
      return col === 6 ? { x: x1, y: cy } : { x: x0, y: cy };
    };
    return { d: d_, stations: Object.fromEntries(ORDER.map((id) => [id, station(id)])) as Record<FlowNodeId, { x: number; y: number }> };
  }, [boxes]);

  // Each station's distance along the track, sampled from the real path.
  const path = useRef<SVGPathElement>(null);
  const [lens, setLens] = useState<{ total: number; at: Record<FlowNodeId, number> } | null>(null);
  useLayoutEffect(() => {
    const p = path.current;
    if (!p || !track) return;
    const total = p.getTotalLength();
    const samples: { l: number; x: number; y: number }[] = [];
    for (let l = 0; l <= total; l += 3) { const pt = p.getPointAtLength(l); samples.push({ l, x: pt.x, y: pt.y }); }
    const at = {} as Record<FlowNodeId, number>;
    for (const id of ORDER) {
      const s = track.stations[id];
      let best = samples[0];
      for (const c of samples) if ((c.x - s.x) ** 2 + (c.y - s.y) ** 2 < (best.x - s.x) ** 2 + (best.y - s.y) ** 2) best = c;
      at[id] = id === 'shopper' ? 0 : best.l;
    }
    setLens({ total, at });
  }, [track]);

  // ── The travelling light: one eased hop from the last station to the newest ──
  const furthest = ORDER.reduce((m, id, i) => (lit(id) ? i : m), -1);
  const target = lens && focus ? lens.at[focus] : lens && furthest >= 0 ? lens.at[ORDER[furthest]] : 0;
  const [pos, setPos] = useState<number | null>(null);
  const posRef = useRef<number | null>(null);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (!lens) return;
    const from = posRef.current;
    if (from == null || reducedMotion() || Math.abs(from - target) < 1) { posRef.current = target; setPos(target); return; }
    // Always forward round the loop (rollback → the next shopper wraps through the start).
    const dist = ((target - from) % lens.total + lens.total) % lens.total;
    const t0 = performance.now();
    let raf = 0;
    setMoving(true);
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / HOP_MS);
      const l = (from + dist * easeInOut(k)) % lens.total;
      posRef.current = l; setPos(l);
      if (k < 1) raf = requestAnimationFrame(step); else setMoving(false);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, lens]);
  const dot = path.current && pos != null ? path.current.getPointAtLength(pos) : null;
  const litLen = lens ? Math.max(furthest >= 0 ? lens.at[ORDER[furthest]] : 0, holding ? lens.total : 0) : 0;

  // ── The centre: what just happened, in words, with its one number big ──
  const node = focus ? byId.get(focus) : undefined;
  const served = byId.get('guard')?.tone === 'served' && (focus === 'shopper' || focus === 'shopkeeper' || focus === 'guard' || focus === 'transaction');
  const chapter = !focus ? 'Waiting' : served ? 'An honest sale' : CHAPTER[focus];
  const tone = holding ? 'immune' : flow.narrationTone;
  const step = focus ? ORDER.indexOf(focus) + 1 : 0;
  const narration = holding && flow.photo
    ? `Policy v${flow.photo.version} · every store immune in ${(flow.photo.ms / 1000).toFixed(1)} s`
    : flow.narration ?? 'Waiting for the first shopper';

  return (
    <section className="fl-scene" aria-label="How Bodega works, live" data-photo={holding ? 'true' : undefined}>
      <div className="fl-grid" ref={grid}>
        <svg className="fl-track" width={size.w} height={size.h} aria-hidden="true">
          {track && <>
            <path ref={path} d={track.d} className="fl-rail" />
            {lens && <path d={track.d} className="fl-rail-lit" strokeDasharray={`${litLen} ${lens.total}`} />}
            {lens && holding && <path key={flow.photo?.at} d={track.d} className="fl-rail-sweep" pathLength={1} />}
            {ORDER.map((id) => {
              const s = track.stations[id];
              return <circle key={id} cx={s.x} cy={s.y} r={id === focus ? 9 : 6} className="fl-stop"
                data-state={id === focus ? 'active' : lit(id) ? 'done' : 'waiting'} />;
            })}
            {dot && <>
              <circle cx={dot.x} cy={dot.y} r={22} className="fl-light-halo" data-moving={moving ? 'true' : undefined} />
              <circle cx={dot.x} cy={dot.y} r={8} className="fl-light" />
            </>}
          </>}
        </svg>

        {ORDER.map((id, i) => {
          const n = byId.get(id)!;
          const [row, col] = CELL[id];
          const state = id === focus ? 'active' : n.value ? 'done' : 'waiting';
          return (
            <div key={id} data-node={id} className="fl-node bs-glass" data-state={state} data-tone={n.tone ?? undefined}
              style={{ gridRow: row, gridColumn: col, ['--i' as string]: i }}>
              <div className="fl-title">{META[id].title}</div>
              <div className="fl-tech">{META[id].short
                ? <><span className="fl-wide">{META[id].tech}</span><span className="fl-narrow">{META[id].short}</span></> : META[id].tech}</div>
              {n.stores && n.stores.length > 0 && <Stores stores={n.stores} small />}
              <div className="fl-value" data-alt={n.stores?.length ? 'true' : undefined}>{n.value ? <Count text={n.value} /> : null}</div>
            </div>
          );
        })}

        <div className="fl-centre" style={{ gridRow: '2 / 4', gridColumn: '2 / 6' }} data-tone={tone ?? undefined} data-focus={focus ?? undefined}>
          <div className="fl-eyebrow" key={`${chapter}-${step}`}>
            <span className="fl-chapter">{chapter}</span>
            {step > 0 && <span className="fl-step">step {step} of 15</span>}
          </div>
          <div className="fl-say" key={narration}>{narration}</div>
          <div className="fl-hero">
            <Hero flow={flow} focus={focus} holding={holding} value={node?.value ?? null} detail={node?.detail ?? null} stores={node?.stores} />
          </div>
          <div className="fl-foot">
            <span className="fl-live" />Live from Atlas · same model, same prompt · <span className="fl-mono">{flow.hash.slice(0, 8)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Hero({ flow, focus, holding, value, detail, stores }: { flow: FlowData; focus: FlowNodeId | null; holding: boolean;
  value: string | null; detail: string | null; stores?: { store: StoreId; ms: number | null }[] }) {
  if (holding || ((focus === 'runtimes' || focus === 'rollback') && stores?.length)) {
    const list = holding ? flow.nodes.find((n) => n.id === 'runtimes')?.stores ?? [] : stores!;
    return <Stores stores={list} />;
  }
  if (focus === 'gate' && flow.gate) return <GateDots gate={flow.gate} />;
  if ((focus === 'block' || focus === 'learner') && detail) return (
    <div className="fl-hero-value" key={`${focus}-${detail}`}>
      <div className="fl-hero-detail">{focus === 'block' ? 'the rule that stopped it' : value === '1 rule' ? 'the rule' : `the first of ${value}`}</div>
      <div className="fl-quote">“{detail}”</div>
    </div>
  );
  if (!focus || !value) return null;
  return (
    <div className="fl-hero-value" key={`${focus}-${value}`}>
      <div className="fl-big"><Count text={value} /></div>
      {detail && <div className="fl-hero-detail">{detail}</div>}
    </div>
  );
}

function Stores({ stores, small }: { stores: { store: StoreId; ms: number | null }[]; small?: boolean }) {
  return (
    <div className={small ? 'fl-stores fl-stores-small' : 'fl-stores'}>
      {stores.map((s) => (
        <div key={s.store} className="fl-store" style={{ ['--store' as string]: `var(--store-${s.store})` }}>
          <span className="fl-store-name">{small ? STORE_LETTER[s.store][0] : STORE_LETTER[s.store]}</span>
          <span className="fl-store-ms">{s.ms == null ? '…' : <><Count text={String(Math.round(s.ms))} /><small> ms</small></>}</span>
        </div>
      ))}
    </div>
  );
}

function GateDots({ gate }: { gate: NonNullable<FlowData['gate']> }) {
  const row = (label: string, total: number, tested: number, good: number, tone: string) => (
    <div className="fl-gate-row">
      <div className="fl-gate-label"><span>{label}</span><span className="fl-gate-num"><Count text={`${good} of ${total}`} /></span></div>
      <div className="fl-dots">
        {Array.from({ length: total }, (_, i) => <i key={i} data-state={i < good ? tone : i < tested ? 'miss' : 'waiting'} />)}
      </div>
    </div>
  );
  return (
    <div className="fl-gate">
      {row('Cons stopped', gate.scamsTotal, gate.scamsTested, gate.scamsStopped, 'immune')}
      {row('Honest customers served', gate.honestTotal, gate.honestTested, gate.honestServed, 'served')}
    </div>
  );
}
