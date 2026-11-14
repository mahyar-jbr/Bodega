// The big screen (/screen): the window onto the three stores, at 1920 by 1080 on the Stage theme.
import '../../../design/tokens.css';
import './screen.css';
import { useSearchParams } from 'react-router';
import { MOCK } from './mock';
import { LearningPanel, ResultsRow, RolloutPanel } from './panels';
import { ConWall, LiveFeed, ScenePlaceholder, StageFrame, StageHeader, StoreTile } from './parts';
import { SCENES, type Scene, type ScreenData } from './types';

// Sample data until /api/agent/state and the screen SSE topic land (M2-04).
function useScreenData(): ScreenData {
  return MOCK;
}

export default function ScreenPage() {
  const data = useScreenData();
  // ?scene=learning previews a scene by hand.
  const [params] = useSearchParams();
  const asked = params.get('scene');
  const scene: Scene = SCENES.some((s) => s.key === asked) ? (asked as Scene) : data.scene;

  return (
    <div className="bs-root" data-theme="stage">
      <StageFrame>
        <StageHeader scene={scene} />
        <div className="bs-tiles">
          {data.tiles.map((t) => <StoreTile key={t.store} tile={t} />)}
        </div>
        <div className="bs-lower">
          <MainPanel scene={scene} data={data} />
          <LiveFeed items={data.feed} />
        </div>
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
  if (scene === 'memory') return <ScenePlaceholder key="memory" title="What Bodega remembers" />;
  return <ConWall key="round1" cons={data.cons} />;
}
