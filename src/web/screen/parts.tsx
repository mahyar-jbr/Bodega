// The big screen's building blocks, built at the event in React 19 from design/README.md.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ago, clock, money, seconds, signedMoney } from './format';
import {
  SCENES, storeName,
  type ConRow, type FeedItemData, type Scene, type StoreKey, type StoreStatus, type TileData,
} from './types';

// The awning mark: five slanted stripes, rounded at the hem (design/assets/Stores).
const AWNING_PATHS = [
  'M11.200 0L15.392 0L10.080 20.000A5.040 5.040 0 0 1 0.000 20.000L6.812 2.971Q8.000 0 11.200 0Z',
  'M17.152 0L24.544 0L22.560 20.000A5.040 5.040 0 0 1 12.480 20.000Z',
  'M26.304 0L33.696 0L35.040 20.000A5.040 5.040 0 0 1 24.960 20.000Z',
  'M35.456 0L42.848 0L47.520 20.000A5.040 5.040 0 0 1 37.440 20.000Z',
  'M44.608 0L48.800 0Q52.000 0 53.188 2.971L60.000 20.000A5.040 5.040 0 0 1 49.920 20.000Z',
];

export function AwningMark({ store, width }: { store: StoreKey | 'brand'; width: number }) {
  const fill = store === 'brand' ? 'var(--brand)' : `var(--store-${store})`;
  return (
    <svg viewBox="0 0 60 25.04" width={width} height={(width * 25.04) / 60} aria-hidden="true">
      {AWNING_PATHS.map((d) => <path key={d} d={d} fill={fill} />)}
    </svg>
  );
}

// Holds the 1080-high design and scales it to fit its container (the window, on /screen). The design
// is 1920 wide; a narrower container (the stage view, beside the phone) gets a narrower layout at full
// scale-down where it can, down to 1640 wide (the stage view: about 0.89, so 26px reads as 23px).
const DESIGN_H = 1080, MAX_W = 1920, MIN_W = 1640;

export function StageFrame({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ scale: 1, x: 0, y: 0, w: MAX_W });
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const fit = () => {
      const pw = parent.clientWidth, ph = parent.clientHeight;
      const aspect = pw / ph;
      const w = Math.max(MIN_W, Math.min(MAX_W, Math.round(DESIGN_H * aspect)));
      const scale = Math.min(pw / w, ph / DESIGN_H);
      setBox({ scale, x: (pw - w * scale) / 2, y: (ph - DESIGN_H * scale) / 2, w });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="bs-stage" data-narrow={box.w < 1800 ? 'true' : undefined}
      style={{ width: box.w, transform: `translate(${box.x}px, ${box.y}px) scale(${box.scale})` }}>
      {children}
    </div>
  );
}

const SCENE_TONE: Record<Scene, string> = {
  round1: 'var(--loss)', learning: 'var(--learning)', immunity: 'var(--immune)',
  round2: 'var(--immune)', memory: 'var(--learning)', audit: 'var(--learning)', flash: 'var(--served)',
};

export function StageHeader({ scene }: { scene: Scene }) {
  // The audit trail belongs to the Memory beat, and the flash sale (for questions) to Round 2.
  const beats = SCENES.filter((s) => s.key !== 'audit' && s.key !== 'flash');
  const beat = scene === 'audit' ? 'memory' : scene === 'flash' ? 'round2' : scene;
  const current = beats.findIndex((s) => s.key === beat);
  return (
    <header className="bs-header">
      <div className="bs-logo">
        <AwningMark store="brand" width={52} />
        <span className="bs-wordmark">bodega</span>
      </div>
      <nav className="bs-beats" aria-label="Story">
        {beats.map((s, i) => (
          <div key={s.key} className="bs-beat stage-label"
            data-state={i < current ? 'done' : i === current ? 'current' : 'next'}
            style={{ ['--tone' as string]: SCENE_TONE[s.key] }}>
            <span className="bs-dot" />
            {s.label}
          </div>
        ))}
      </nav>
      <div className="bs-atlas stage-label">Built on MongoDB Atlas</div>
    </header>
  );
}

const STATUS_WORD: Record<StoreStatus, string> = { idle: 'Open', conned: 'Conned', learning: 'Learning', immune: 'Immune', offline: 'Offline' };

export function StatusWord({ status, detail, word: override }: { status: StoreStatus; detail?: string; word?: string }) {
  const base = override ?? STATUS_WORD[status];
  const word = detail ? `${base} ${detail}` : base;
  return (
    <span className="bs-state stage-callout" data-tone={status}>
      <span className="bs-dot" />
      <span key={word} className="bs-state-word">{word}</span>
    </span>
  );
}

// Re-renders every 15 seconds, for "learned 2 min ago".
function useNow(everyMs = 15_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export function StoreTile({ tile }: { tile: TileData }) {
  const now = useNow();
  // One soft sweep when this store turns immune, at the moment it reports.
  const wasImmune = useRef(tile.status === 'immune');
  const [sweepKey, setSweepKey] = useState(0);
  useEffect(() => {
    if (tile.status === 'immune' && !wasImmune.current) setSweepKey((k) => k + 1);
    wasImmune.current = tile.status === 'immune';
  }, [tile.status]);

  const policy = tile.status === 'offline' && tile.missed != null
    ? `Policy v${tile.policy}, missed v${tile.missed}`
    : tile.policy === 0 || !tile.learnedAt
      ? `Policy v${tile.policy}`
      : `Policy v${tile.policy}, learned ${ago(tile.learnedAt, now)}`;
  const lostTone = tile.lostCents === 0 ? 'quiet' : tile.status === 'immune' ? 'quiet' : 'bleeding';
  const small = tile.lostCents >= 10_000 ? ' bs-small' : '';

  return (
    <section className="bs-glass bs-tile" data-status={tile.status} aria-label={storeName(tile.store)}>
      {sweepKey > 0 && <div key={sweepKey} className="bs-sweep" />}
      <div>
        <div className="bs-tile-head">
          <div className="bs-tile-name">
            <AwningMark store={tile.store} width={36} />
            <span className="stage-heading">{storeName(tile.store)}</span>
          </div>
          {tile.status === 'offline'
            ? <StatusWord status="offline" />
            : tile.status === 'immune' && tile.caughtUpMs != null
              ? <StatusWord status="immune" word="Caught up" detail={`in ${seconds(tile.caughtUpMs)}`} />
              : <StatusWord status={tile.status}
                  detail={tile.status === 'immune' && tile.immuneInMs != null ? `in ${seconds(tile.immuneInMs)}` : undefined} />}
        </div>
        <div className="bs-tile-policy stage-label">{policy}</div>
      </div>
      <div />
      <div className="bs-tile-numbers">
        <div>
          <div className={`stage-display bd-num bs-tile-lost${small}`} data-tone={lostTone}>{money(tile.lostCents)}</div>
          <div className="bs-tile-label stage-label">Money lost</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={`stage-display bd-num bs-tile-blocked${small}`} data-tone={tile.blocked > 0 ? 'good' : 'quiet'}>{tile.blocked}</div>
          <div className="bs-tile-label stage-label">Cons blocked</div>
        </div>
      </div>
    </section>
  );
}

export function LiveFeed({ items, max = 5 }: { items: FeedItemData[]; max?: number }) {
  return (
    <section className="bs-glass bs-panel" aria-label="Live feed">
      <div className="bs-panel-head">
        <div className="bs-feed-title stage-heading">Live <span className="bs-live" /></div>
      </div>
      {items.length === 0 && <p className="bs-empty stage-body">Waiting for the first shopper.</p>}
      {items.slice(0, max).map((it) => (
        <div key={it.id} className="bs-feed-row" data-kind={it.kind}>
          <span className="bs-dot" />
          <div style={{ minWidth: 0 }}>
            <div className="bs-feed-who stage-body">{it.who}</div>
            <div className="bs-feed-what stage-label">{it.text}</div>
          </div>
          <div className="bs-feed-right">
            {it.amountCents != null && (
              <div className="bs-feed-amount stage-body bd-num" data-sign={it.amountCents < 0 ? 'neg' : 'pos'}>
                {signedMoney(it.amountCents)}
              </div>
            )}
            <div className="bs-feed-time stage-label bd-num">{clock(it.at)}</div>
          </div>
        </div>
      ))}
    </section>
  );
}

export function StoreChip({ store }: { store: StoreKey }) {
  return (
    <span className="bs-store-chip">
      <AwningMark store={store} width={30} />
      {storeName(store)}
    </span>
  );
}

// Round 1's main panel: the tricks so far, as summaries.
export function ConWall({ cons, max = 6 }: { cons: ConRow[]; max?: number }) {
  return (
    <section className="bs-glass bs-panel bs-scene" aria-label="Tricks tried">
      <div className="bs-panel-head">
        <h2 className="stage-heading">Tricks tried so far</h2>
        {cons.length > 0 && <span className="stage-label" style={{ color: 'var(--ink-3)' }}>{cons.length} so far</span>}
      </div>
      {cons.length === 0 ? (
        <div className="bs-empty">
          <p className="stage-body">No tricks yet. Every store is trusting on purpose.</p>
          <p className="stage-label" style={{ marginTop: 12 }}>When a con works, it lands here as a summary, never the customer's words.</p>
        </div>
      ) : (
        <table className="bs-table stage-body">
          <thead className="stage-label">
            <tr><th>Trick</th><th>First seen</th><th className="bs-num-col">Worked</th><th className="bs-num-col">Blocked</th></tr>
          </thead>
          <tbody>
            {cons.slice(0, max).map((c) => (
              <tr key={c.id}>
                <td>{c.summary}</td>
                <td><StoreChip store={c.firstSeen} /></td>
                <td className={`bs-num-col bd-num ${c.worked > 0 ? 'bs-worked' : 'bs-zero'}`}>{c.worked}</td>
                <td className={`bs-num-col bd-num ${c.blocked > 0 ? 'bs-good' : 'bs-zero'}`}>{c.blocked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// Holds the place of a scene that isn't built yet (learning, immunity, round 2, memory).
export function ScenePlaceholder({ title }: { title: string }) {
  return (
    <section className="bs-glass bs-panel bs-scene">
      <h2 className="stage-heading">{title}</h2>
    </section>
  );
}
