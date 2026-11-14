// The big screen's live data: polls /api/agent/state once a second and maps its `screen` snapshot
// (built on the agent side, src/agent/screen/snapshot.ts) onto the panels. ?mock=1 shows the sample
// data instead, for building and rehearsing without a server.
import { useEffect, useRef, useState } from 'react';
import type { ScreenSnapshot } from '../../agent/screen/snapshot';
import { MOCK } from './mock';
import type { ScreenData, StoreKey } from './types';

const POLL_MS = 1_000;

export const EMPTY: ScreenData = {
  scene: 'round1',
  tiles: (['queen', 'yonge', 'scarborough'] as StoreKey[]).map((store) => ({
    store, status: 'idle', policy: 0, learnedAt: null, lostCents: 0, blocked: 0, immuneInMs: null })),
  feed: [], cons: [], learning: null, rollout: null, results: null,
};

export function fromSnapshot(s: ScreenSnapshot): ScreenData {
  return {
    scene: s.scene,
    tiles: s.tiles.map((t) => ({ store: t.store, status: t.status, policy: t.policy, learnedAt: t.learnedAt ? new Date(t.learnedAt) : null,
      lostCents: t.lostCents, blocked: t.blocked, immuneInMs: t.immuneInMs })),
    feed: s.feed.map((f) => ({ ...f, at: new Date(f.at) })),
    cons: s.cons,
    learning: s.learning,
    rollout: s.rollout,
    results: s.results,
  };
}

export type Connection = 'mock' | 'connecting' | 'live' | 'stale';

export function useScreenData(): { data: ScreenData; connection: Connection } {
  const mock = typeof location !== 'undefined' && new URLSearchParams(location.search).has('mock');
  const [data, setData] = useState<ScreenData>(mock ? MOCK : EMPTY);
  const [connection, setConnection] = useState<Connection>(mock ? 'mock' : 'connecting');
  const lastOk = useRef(0);

  useEffect(() => {
    if (mock) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch('/api/agent/state', { cache: 'no-store' });
        if (res.ok) {
          const body = (await res.json()) as { screen?: ScreenSnapshot };
          if (body.screen && !stopped) {
            setData(fromSnapshot(body.screen));
            lastOk.current = Date.now();
            setConnection('live');
          }
        }
      } catch { /* keep the last good data on screen */ }
      if (!stopped) {
        if (Date.now() - lastOk.current > 5_000 && lastOk.current > 0) setConnection('stale');
        timer = setTimeout(tick, POLL_MS);
      }
    };
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [mock]);

  return { data, connection };
}
