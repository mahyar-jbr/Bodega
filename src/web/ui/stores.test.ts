import { describe, expect, it } from 'vitest';
import { STORES, STORE_KEYS } from './stores';

describe('store design identities', () => {
  it('matches the final design kit for all three stores', () => {
    expect(STORE_KEYS).toEqual(['queen', 'yonge', 'scarborough']);
    expect(STORES).toMatchObject({
      queen: {
        name: 'Queen St',
        stageColour: '#BAAEE3',
        daylightColour: '#6B5BB0',
        orderPrefix: 'QS',
      },
      yonge: {
        name: 'Yonge St',
        stageColour: '#D9C099',
        daylightColour: '#85693A',
        orderPrefix: 'YS',
      },
      scarborough: {
        name: 'Scarborough',
        stageColour: '#E1A6A9',
        daylightColour: '#A44F59',
        orderPrefix: 'SC',
      },
    });
  });

  it('uses a supplied awning asset for every store', () => {
    for (const store of Object.values(STORES)) {
      expect(store.awning).toMatch(/^(data:image\/svg\+xml|\/?[^\s]+\.svg)/);
    }
  });
});
