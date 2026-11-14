# StoreTile

One store on the big screen: name and policy, state, money lost and cons blocked.

**Props:** `store`; `status` idle | conned | learning | immune; `policy`; `lost`; `blocked`; `immuneIn` (seconds, shown as "Immune in 0.8s"); `learnedAgo`.

- Money lost is red while the store is bleeding and turns grey once it is immune; cons blocked turns green. A zero stays grey.
- When the store turns immune one soft light sweeps across the tile and the state word blurs across. Drive each tile from its own store's report, so the stagger on screen is the real propagation time.
- From $100 the figures drop to 88px so four digits still fit.
