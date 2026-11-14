// The big screen (/screen): the window onto the three stores, at 1920 by 1080 on the Stage theme.
import '../../../design/tokens.css';
import './screen.css';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useScreenData } from './live';
import { LearningPanel, MemoryPanel, ResultsRow, RolloutPanel } from './panels';
import { ConWall, LiveFeed, StageFrame, StageHeader, StoreTile } from './parts';
import { SCENES, type Scene, type ScreenData } from './types';

// On the presenting laptop: 1 to 5 pin a scene, 0 goes back to the scene the state suggests.
function usePinnedScene(): Scene | null {
  const [pinned, setPinned] = useState<Scene | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '0') setPinned(null);
      const i = Number(e.key) - 1;
      if (i >= 0 && i < SCENES.length) setPinned(SCENES[i].key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return pinned;
}

export default function ScreenPage() {
  const { data, connection } = useScreenData();
  const pinned = usePinnedScene();
  // ?scene=learning previews a scene by hand.
  const [params] = useSearchParams();
  const asked = params.get('scene');
  const scene: Scene = pinned ?? (SCENES.some((s) => s.key === asked) ? (asked as Scene) : data.scene);
  // Keys work without a click first.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.focus(); }, []);

  return (
    <div className="bs-root" data-theme="stage" data-connection={connection} ref={root} tabIndex={-1}>
      <StageFrame>
        <StageHeader scene={scene} />
        <div className="bs-tiles">
          {data.tiles.map((t) => <StoreTile key={t.store} tile={t} />)}
        </div>
        <div className="bs-lower">
          <MainPanel scene={scene} data={data} />
          <LiveFeed items={data.feed} />
        </div>
        {pinned && <div className="bs-pin stage-label">{SCENES.find((x) => x.key === pinned)!.label} pinned · 0 for auto</div>}
        {connection === 'stale' && <div className="bs-pin bs-pin-right stage-label">Reconnecting</div>}
      </StageFrame>
    </div>
  );
}

// The scene's main panel, left of the live feed.
function MainPanel({ scene, data }: { scene: Scene; data: ScreenData }) {
  if (scene === 'learning' && data.learning) return <LearningPanel key="learning" data={data.learning} />;
  if (scene === 'immunity' && data.rollout) return <RolloutPanel key={`rollout-${data.rollout.kind}`} data={data.rollout} />;
  if (scene === 'round2' && data.results) {
    return (
      <div className="bs-stack" key="round2">
        <ResultsRow data={data.results} />
        <ConWall cons={data.cons} max={2} />
      </div>
    );
  }
  if (scene === 'memory') return <MemoryPanel key="memory" cons={data.cons} />;
  return <ConWall key="round1" cons={data.cons} />;
}
