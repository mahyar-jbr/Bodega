import lockupStage from '../../../design/assets/Logos/bodega-lockup-stage.svg';

export function Logo({ height = 24 }: { height?: number }) {
  return <img className="bd-logo" src={lockupStage} height={height} alt="Bodega" />;
}
