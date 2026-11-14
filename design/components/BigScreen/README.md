# BigScreen

The big screen, composed: header, store tiles, the scene's main panel and the live feed.

**Props:** `scene` round1 | learning | rollout | round2 | flash; `tiles`; `feed`; `learning`; `cons`; `shoppers`; `fit`.

- Pass live data and the components move between states on their own. Changing `scene` blurs the main panel in (`dur-scene`).
- This preview is round 1; the other scenes follow.
