import queenAwning from '../../../design/assets/Stores/awning-queen.svg';
import scarboroughAwning from '../../../design/assets/Stores/awning-scarborough.svg';
import yongeAwning from '../../../design/assets/Stores/awning-yonge.svg';
import type { StoreId } from '../../shared/contract';

export const STORE_KEYS = ['queen', 'yonge', 'scarborough'] as const satisfies readonly StoreId[];
export type StoreKey = StoreId;

export type StoreDesign = {
  key: StoreKey;
  name: string;
  stageColour: string;
  daylightColour: string;
  awning: string;
  orderPrefix: 'QS' | 'YS' | 'SC';
};

export const STORES: Record<StoreKey, StoreDesign> = {
  queen: {
    key: 'queen',
    name: 'Queen St',
    stageColour: '#BAAEE3',
    daylightColour: '#6B5BB0',
    awning: queenAwning,
    orderPrefix: 'QS',
  },
  yonge: {
    key: 'yonge',
    name: 'Yonge St',
    stageColour: '#D9C099',
    daylightColour: '#85693A',
    awning: yongeAwning,
    orderPrefix: 'YS',
  },
  scarborough: {
    key: 'scarborough',
    name: 'Scarborough',
    stageColour: '#E1A6A9',
    daylightColour: '#A44F59',
    awning: scarboroughAwning,
    orderPrefix: 'SC',
  },
};

export function isStoreKey(value: string | undefined): value is StoreKey {
  return STORE_KEYS.some((key) => key === value);
}
