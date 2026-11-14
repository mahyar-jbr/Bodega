import type { StoreKey } from './stores';
import { STORES } from './stores';

export function AwningMark({ store, width = 32 }: { store: StoreKey; width?: number }) {
  const design = STORES[store];
  return <img className="bd-awning" src={design.awning} width={width} alt="" aria-hidden="true" />;
}
