Bodega is three AI-run corner stores in Toronto (Queen St, Yonge St and Scarborough) that share one memory in MongoDB Atlas. The room tries to con a shopkeeper. When a trick works, Bodega writes a guardrail in plain words, tests it on 120 cases it has never seen, and if it stops the scams without turning honest customers away, every store has it within seconds. The model never changes; only its memory does. Every screen here exists to tell that story to a room: a store gets robbed, the system learns in front of everyone, immunity spreads, and the same tricks fail while honest shoppers still check out.

The look borrows MongoDB's navy and green so the room feels at home, and is finished the way Apple finishes a keynote: almost monochrome, generous space, big confident numbers, frosted glass, and motion only where something actually changed.

## Principles

- **One accent.** Signal Green is the only strong colour, and it means one thing: safe. Everything else is navy, white and grey.
- **Colour is information.** Red, amber, green and blue appear only as small dots, words and numbers that carry a state. A store's colour appears only on its awning mark.
- **Numbers are the headline.** Each beat has one number the back row can read: money lost, 1.6s, 3%, 0 oversold.
- **Motion means something changed.** A state word blurs across, a number counts, a light sweeps over a store as it turns immune. Nothing moves for decoration.

## Voice

The shopkeeper is warm, quick and generous, like the person behind the counter who knows your order. Trusting on purpose in round 1, politely immovable once a trick is known.

- Sentence case, Canadian spelling (honour, neighbourhood, colour), plain verbs, short sentences. No emoji. One exclamation mark per message at most.
- Greeting: "Hey Sneaky Raccoon, welcome in! Coffee's fresh and the butter tarts just came out. What can I grab you?"
- A refusal names where the trick was seen and offers something real: "Nice try! Our Yonge St store saw this one 2 minutes ago, so I can't do that. WELCOME10 still gets you 10% off, though." Never scold, lecture or say "fraud".
- Round 1 acceptance is sincere, not winking: "Oh, nice find! Happy to honour that. Your hoodie comes to $9.50."
- On stage, people are their nicknames (Sneaky Raccoon, Polite Goose, Captain Toque). The big screen never shows anyone's raw message: the wall of cons shows a short summary of the trick, such as "Fake 50% code from Instagram".
- Feed rows are two lines: who, then what happened in 30 characters or fewer ("Conned Queen St, fake code").
- Name stores exactly: Queen St, Yonge St, Scarborough. Codes and order numbers are uppercase mono: `WELCOME10`, `TORONTO5`, `QS-0412`.
- Money always shows cents, and a sign when it moves: $38.50 lost, +$3.50, −$9.50 (a true minus). Times are 12-hour without a leading zero: 7:52.
- "MongoDB" appears only in the line "Built on MongoDB Atlas". Never use MongoDB's logo or wordmark.

## Logo and awning

- The lockup is the awning mark beside the lowercase wordmark, set in Geist at weight 560 with tight spacing. Use the lockup by default, the stacked version on square or centred layouts, and the mark alone at 32px and under (favicon, chat avatar, app icon). Files are in Logos; in code use `Logo` and `AwningMark`, which follow the theme.
- The mark is five slanted stripes, rounded at the hem: a shop awning in one colour. It is Signal Green on navy and forest green (#00684A) on light grounds. A store's own mark is the same shape in the store colour; the logo is never drawn in a store colour.
- Clear space is the height of the mark on every side. Smallest lockup: 20px tall. Smallest mark: 14px wide.
- The awning is the system's one signature shape. In the product it stays small: the logo, the store marks, the chat avatars, and the scalloped edges of the receipt. No awning bands, stripes or patterns as decoration. The cover is the one place it is drawn large.

### Stores

| Store | Colour | Stage | Daylight | Order prefix |
| --- | --- | --- | --- | --- |
| Queen St | Lilac | #BAAEE3 | #6B5BB0 | QS |
| Yonge St | Sand | #D9C099 | #85693A | YS |
| Scarborough | Rose | #E1A6A9 | #A44F59 | SC |

Store colours are soft on purpose, so they never compete with a state. They mark identity only: the store's awning mark, its avatar in chat, the ring around its QR plate, and a little of the light at the top of its phone screen. Never a large fill. Set `bd-store-<key>` on a container and components pick up `--store`.

## Colour

Two themes. **Stage** (the default) is night navy, for the projector, the phones and the console. **Daylight** is a cool off-white for the judging table, docs and the README. Every text pair holds 4.5:1 in both themes.

| Role | Token | Stage | Daylight |
| --- | --- | --- | --- |
| Canvas | `canvas` | #000F17 | #F4F6F5 |
| Light from above | `glow` | #001E2B | #E3F1EC |
| Primary text and big numbers | `ink` | #EEF2F1 | #0B1A21 |
| Secondary text | `ink-2` | #A4B1B6 | #44545C |
| Labels, units and times | `ink-3` | #82929A | #5F6F77 |
| The one accent | `brand` | #00ED64 | #00ED64 |
| Green as text or mark | `brand-ink` | #00ED64 | #00684A |
| Conned and money lost | `loss` | #F97676 | #C2343B |
| Learning | `learning` | #F2C36A | #8A5A00 |
| Immune and blocked | `immune` | #00ED64 | #00684A |
| Honest and served | `served` | #8EC5EC | #22639A |
| Receipt and QR paper | `paper` | #F6F8F7 | #FFFFFF |

- `brand` fills the primary button (one per view) and nothing large besides the logo. Text on it is navy (`on-brand`), never white.
- Immune is the brand green on purpose: immunity is the product.
- Served is a soft blue so an honest sale never reads as a block.
- A state is never colour alone: it always has its word.
- Hairlines (`line`, `line-strong`) divide rows and sections. `ink-faint` is for decoration only, never for text.
- `paper` is the only bright surface on a dark screen: the receipt and the QR plates. QR codes are always navy on paper.
- Keyboard focus is `focus-ring`: a 2px canvas gap, then 2px of solid green.

## Type

- **Geist** (variable, 100 to 900) for everything: a free, clean grotesk close to MongoDB's interface type, with true tabular figures. Turn on tabular numbers (`.bd-num`) for every number that changes.
- **Geist Mono** only where the real world is monospaced: receipts, discount codes, order numbers, the ops log.
- Weights stay calm: 450 for text, 500 to 560 for numbers and titles, 600 for phone headings. Nothing heavier.
- Stage scale, for 1920 by 1080 read from the back of a room: 200 hero, 104 display, 64 number, 48 title, 36 heading, 30 body, 28 state words, 26 labels. 26px is the floor; nothing on stage is smaller.
- Phone and console scale: 40 for the nickname, 28 for totals, 20 for sheet headings, 17 for the store name, 16 for chat, 15 for buttons and list titles, 14 for console rows, 13 for meta, 12 for timestamps.
- Big numbers run tight (-0.045em at display size, -0.05em at hero). Labels sit under numbers in `ink-3`, in sentence case. No all-caps labels anywhere.

## Glass and depth

- A glass panel is `glass-tint` under a top-down `glass-sheen` gradient, with `blur-lg` backdrop blur, a 1px `glass-edge` and `shadow-glass` (a faint lit top edge, a tight contact shadow and a long soft one). A 1px light ring, brightest at the top-left corner, finishes the edge.
- Panels never glow. A store's state shows as its word and dot, plus a 1px line of the state colour along the top edge of its tile.
- One static light falls from the top centre of every stage screen (`glow` over `canvas`). Nothing brighter sits behind text.
- Radius grows with the thing: `radius-xl` for stage panels and tiles, `radius-lg` for console panels, `radius-md` for product cards and notes, `radius-2xl` for QR plates and the top of the checkout sheet, pills for every button, chip and badge.
- On slow hardware set `data-perf="lite"` on the root: glass becomes solid `slate-800` and nothing else changes.

## Layout

- **Big screen**, 1920 by 1080: 40px side margins, because projectors crop edges. A 66px header with the logo, the five beats of the story and the live shopper count. Three store tiles, 300px tall, with 24px gaps. Below them, the scene's main panel on the left and the live feed, 620px wide, on the right.
- **QR wall**, 1920 by 1080: the logo and the promise top left, the event top right, one instruction line, three equal QR cards with 360px codes, and the Atlas line at the foot.
- **Phone**, 390 wide (works from 360 to 430): 20px side gutters (16px for the composer), the shop header pinned at the top, the composer pinned at the bottom, and the chat in between, anchored to the bottom like iMessage. The shopkeeper speaks in plain text; the customer's words sit in a quiet bubble on the right.
- **Ops console**, 1440 by 900: three columns. Run of show and health; what the room sees and the actions; stores and the log.
- Tables and lists beat grids of cards: rows divided by hairlines, numbers right-aligned in tabular figures.

## Iconography

- One set of 64 icons drawn for Bodega on a 24px grid: 1.6 stroke, round caps and joins, 2px padding. In code use `Icon`, which inherits `currentColor`. The SVG files in Icons are single-ink slate (#6B7F8A) so they read on light and dark; recolour them in code.
- Three families: interface (check, chevrons, refresh), Bodega ideas (store, mask, shield-check, broadcast, flask, loop, scale, database) and the twelve products (coffee, patty, tart, sandwich, chips, bar, can, cookie, umbrella, toque, hoodie, console).
- Icons sit in `ink-3` beside a word. On stage the word does the work; the icon supports it.
- No emoji anywhere, including product art.

## Motion

Motion shows that something changed, once, and then gets out of the way. Nothing bounces, flips or overshoots.

| What | When | Duration | Easing |
| --- | --- | --- | --- |
| A row, message or note blurs in (6px rise, 6px blur to sharp) | A new feed event, chat message or note | `dur-base`, `dur-panel` | `ease-out` |
| A state word blurs across and its dot pings once | A store or the test changes state | `dur-panel` | `ease-out` |
| One soft light sweeps across a tile | That store reports the new policy | `dur-sweep` | `ease-in-out` |
| A number counts to its new value | Any number that changes | `dur-tick` | `ease-out` |
| The main panel blurs in | The next scene | `dur-scene` | `ease-out` |
| The rollout stops arrive in order | Each store at its real time | `dur-panel` | `ease-out` |
| A test case fills | Each held-out case finishes | `dur-base` | `ease-out` |
| The checkout sheet rises over a scrim | Check out | `dur-panel` | `ease-sheet` |
| Press, to 0.98 | Any button | `dur-press` | `ease-out` |
| The live dot ripple, the typing dots, the case being run | Always; nothing else loops | `dur-loop` | `ease-out`, `ease-in-out` |

- Stagger by the real data, not a fixed delay: each store turns immune when it actually reports the new policy, so the motion is the measurement.
- Backdrop blur never animates. A short blur on a small element (a row, a word) is the only animated filter.
- With reduced motion, numbers jump, blurs become plain fades, and the sweep and the loops stop.

## Using this system

Load `tokens.css`, the two fonts, `components/bundle.css`, React 18 and `components/bundle.js`; the components are on `window.Bodega`. Every colour, radius, blur, duration and curve in the stylesheet is a token, so changing a token here changes every screen; spacing and type sizes follow the scales above. Wrap stage screens in `StageFrame` (1920 by 1080, scaled to fit). The Screens previews (`BigScreen` and its four scenes, `StoryPlayer`, `PhoneScreen`, `QRWall`, `OpsConsole`, `VideoCard`, `ReadmeBanner`) are complete compositions to build from, and `DEMO` holds their sample data in the shapes the app needs. Screens and states walks through the pitch beat by beat; Build spec lists every token, component and data shape.
