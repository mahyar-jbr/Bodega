// The big screen (/screen): the window onto the three stores, at 1920 by 1080 on the Stage theme.
import '../../../design/tokens.css';
import './screen.css';
import { useSearchParams } from 'react-router';
import { MOCK } from './mock';
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
          {scene === 'round1' ? <ConWall key="round1" cons={data.cons} />
            : <ScenePlaceholder key={scene} title={SCENES.find((s) => s.key === scene)!.label} />}
          <LiveFeed items={data.feed} />
        </div>
      </StageFrame>
    </div>
  );
}
