# VersionChart

Every guardrail version on the same held-out cases: scams that work and honest customers turned away, on one percent axis.

**Props:** `versions` [{ v, scams, honest, rejected, note }]; `width`; `height`; `size` stage | ui; `legend`.

- Scams that work is a solid line and honest turned away is dotted, so the legend never relies on colour alone. End values are labelled.
- A rejected draft is a crossed ring at its honest-refusal rate on a dotted stem, never joined to the lines.
- Hover shows a crosshair and that version's numbers.
