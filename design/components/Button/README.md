# Button

Pill button: primary (Signal Green, once per view), secondary, ghost or danger.

**Props:** `variant`; `size` sm 32 | md 44 | lg 52 | stage 72; `icon`, `iconRight`; `full`; `disabled`; `hold` (ms: press and hold to confirm) with `onHoldComplete`.

- The label says exactly what happens: "Pay $9.45", "Start shopping", "Next: Immunity", "Hold to reset".
- Presses to 0.98. Focus shows `focus-ring`.
- Use `hold` for anything destructive: a red fill grows while it is held and the label turns to Done.
- No arrow glyph appended to labels. A chevron icon is fine on Back and Next.
