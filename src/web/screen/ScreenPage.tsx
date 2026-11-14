// The big screen (/screen): the window onto the three stores, at 1920 by 1080 on the Stage theme.
import '../../../design/tokens.css';
import './screen.css';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useScreenData } from './live';
import { AuditPanel, LearningPanel, MemoryPanel, ResultsRow, RolloutPanel, VersionChart } from './panels';
import { ConWall, LiveFeed, StageFrame, StageHeader, StoreTile } from './parts';
import { SCENES, type Scene, type ScreenData } from './types';

// On the presenting laptop: 1 to 5 pin a scene, 0 goes back to the scene the state suggests.
// 6 opens the audit trail; pressing 6 again moves to the next con.
function usePinnedScene(): { pinned: Scene | null; auditIndex: number; openAudit: (i: number) => void } {
  const [pinned, setPinned] = useState<Scene | null>(null);
  const [auditIndex, setAuditIndex] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '0') setPinned(null);
      const i = Number(e.key) - 1;
      if (i >= 0 && i < SCENES.length) {
        const next = SCENES[i].key;
        setPinned((prev) => {
          if (next === 'audit' && prev === 'audit') setAuditIndex((n) => n + 1);
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { pinned, auditIndex, openAudit: (i: number) => { setAuditIndex(i); setPinned('audit'); } };
}

export default function ScreenPage() {
  // Keys work without a click first.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.focus(); }, []);
  return (
    <div className="bs-root" data-theme="stage" ref={root} tabIndex={-1}>
      <BigScreen />
    </div>
  );
}

/** The big screen at 1920 by 1080, scaled into its container: /screen fills the window, /stage the left side. */
export function BigScreen() {
  const { data, connection } = useScreenData();
  const { pinned, auditIndex, openAudit } = usePinnedScene();
  // ?scene=learning previews a scene by hand.
  const [params] = useSearchParams();
  const asked = params.get('scene');
  const scene: Scene = pinned ?? (SCENES.some((s) => s.key === asked) ? (asked as Scene) : data.scene);

  return (
    <div className="bs-screen" data-connection={connection}>
      <StageFrame>
        <StageHeader scene={scene} />
        <div className="bs-tiles">
          {data.tiles.map((t) => <StoreTile key={t.store} tile={t} />)}
        </div>
        <div className="bs-lower">
          <MainPanel scene={scene} data={data} auditIndex={auditIndex}
            onOpenCon={(id) => { const i = data.audits.findIndex((a) => a.conId === id); if (i >= 0) openAudit(i); }} />
          <LiveFeed items={data.feed} />
        </div>
        {pinned && <div className="bs-pin stage-label">{SCENES.find((x) => x.key === pinned)!.label} pinned · 0 for auto</div>}
        {connection === 'stale' && <div className="bs-pin bs-pin-right stage-label">Reconnecting</div>}
      </StageFrame>
    </div>
  );
}

// The scene's main panel, left of the live feed.
function MainPanel({ scene, data, auditIndex, onOpenCon }: { scene: Scene; data: ScreenData; auditIndex: number; onOpenCon: (conId: string) => void }) {
  if (scene === 'audit' && data.audits.length) {
    const i = auditIndex % data.audits.length;
    return <AuditPanel key={`audit-${data.audits[i].conId}`} audit={data.audits[i]} index={i} count={data.audits.length} />;
  }
  if (scene === 'learning' && data.learning) return <LearningPanel key="learning" data={data.learning} />;
  if (scene === 'immunity' && data.rollout) return <RolloutPanel key={`rollout-${data.rollout.kind}`} data={data.rollout} />;
  if (scene === 'round2' && data.results) {
    return (
      <div className="bs-stack" key="round2">
        <ResultsRow data={data.results} />
        {data.versions.length >= 2 ? <VersionChart versions={data.versions} /> : <ConWall cons={data.cons} max={2} />}
      </div>
    );
  }
  if (scene === 'memory' || scene === 'audit') return <MemoryPanel key="memory" cons={data.cons} onOpen={onOpenCon} />;
  return <ConWall key="round1" cons={data.cons} />;
}
