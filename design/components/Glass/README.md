# Glass

Frosted glass surface: the base of every panel, tile and card.

**Props:** `variant` panel | raised | inset; `as`; any div props.

- Panel: stage panels, tiles, console panels. Raised: small glass without its own shadow. Inset: wells inside glass.
- A 1px light edge, brightest at the top left, does the work of a border. Never add coloured glows or extra outlines.
- `data-perf="lite"` on a parent swaps the blur for solid `slate-800` on weak machines.
