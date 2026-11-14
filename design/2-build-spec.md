# Build spec

Everything a developer needs to rebuild these screens: how to load the system, every token with both theme values, every component with its props, and the data shapes the screens expect.

## Load order

1. `tokens.css` (compiled from `tokens.json`: colour and shadow variables per theme on `[data-theme]`, then spacing, radius, blur, duration, easing and layout variables, then one class per type style).
2. The fonts: `fonts/Geist-Variable.woff2` and `fonts/GeistMono-Variable.woff2` (both variable, 100 to 900, SIL OFL).
3. `components/bundle.css`.
4. React 18 and ReactDOM 18, then `components/bundle.js`. Components are on `window.Bodega`; the JSX sources are in `components/src/` to copy into your app.
5. Set `data-theme="stage"` (or `daylight`) on `<html>`. Optional `data-perf="lite"` turns glass solid on slow machines.

Every colour, radius, blur, duration and curve in `bundle.css` is a `var(--token)` (alpha variants are a `color-mix()` of one), so changing a token here changes every screen. Spacing and type sizes follow the scales below.

## Colour tokens

| Token | Stage | Daylight | Use |
| --- | --- | --- | --- |
| `navy-950` | `#000f17` | `#000f17` | Reference. Night, the stage canvas: a deeper MongoDB navy that lets white type and the one green carry everything. |
| `navy-900` | `#001e2b` | `#001e2b` | Reference. MongoDB navy. The light that falls from the top of every stage screen, and the ink of QR codes and text on green. |
| `slate-800` | `#0d1f28` | `#0d1f28` | Reference. Solid sheet surface (checkout, tooltips) and the glass fallback in performance mode. |
| `slate-600` | `#3d4f5b` | `#3d4f5b` | Reference. Decorative strokes on stage; daylight secondary text family. |
| `green-500` | `#00ed64` | `#00ed64` | Reference. Signal Green, the one strong accent. Fill or text on navy; never text on white. |
| `green-700` | `#00684a` | `#00684a` | Reference. Forest, the green that reads on white: daylight green text and pressed primary buttons. |
| `canvas` | `#000f17` | `#f4f6f5` | Page background of every screen. Stage: Night. Daylight: a cool off-white, never cream. |
| `canvas-deep` | `#000a10` | `#e9eeec` | Bottom of the canvas gradient. |
| `glow` | `#001e2b` | `#e3f1ec` | The single soft light that falls from the top centre of a stage screen. Static, never animated. |
| `glass-tint` | `#03202b99` | `#ffffffc7` | Base layer of every glass panel. Text on glass is checked against tint plus sheen. |
| `glass-sheen` | `#ffffff0d` | `#ffffff99` | Top-down sheen on glass panels (gradient from this to transparent). |
| `glass-sheen-strong` | `#ffffff17` | `#ffffffe6` | The customer's chat bubble, the selected segment and scene, hover on chips and secondary buttons. |
| `glass-edge` | `#ffffff14` | `#0b1a2114` | The 1px edge of glass panels and cards. |
| `glass-highlight` | `#ffffff1f` | `#ffffff` | The lit top-left rim of glass panels. |
| `line` | `#ffffff12` | `#0b1a2112` | Hairline dividers between rows and columns inside panels; chart gridlines. |
| `line-strong` | `#ffffff24` | `#0b1a2124` | Dividers that separate sections, progress tracks, empty test dots. |
| `control-edge` | `#ffffff61` | `#0b1a2185` | Borders that define a control (inputs, secondary buttons, toggles). 3:1 on canvas and glass in both themes. |
| `ink` | `#eef2f1` | `#0b1a21` | Primary text and every big number, on canvas, glass and raised glass in both themes. |
| `ink-2` | `#a4b1b6` | `#44545c` | Secondary text: what happened in a feed row, descriptions, chat meta. On canvas, glass and raised glass. |
| `ink-3` | `#82929a` | `#5f6f77` | Labels, units and timestamps. On canvas and glass (4.9:1 or better). |
| `ink-faint` | `#3d4f5b` | `#a9b4b9` | Decoration only: empty dots, chart stems, the pending verdict icon. Never for text, not even a zero. |
| `brand` | `#00ed64` | `#00ed64` | Signal Green fill: the logo mark, primary buttons, the immune state. Text on it is on-brand. |
| `brand-ink` | `#00ed64` | `#00684a` | Green as text or mark: "Immune", blocked counts, the live dot, the one improved number. On canvas and glass. |
| `brand-pressed` | `#00c853` | `#00684a` | Primary button while pressed. |
| `brand-soft` | `#00ed641a` | `#ddf7e8` | The faint green wash behind a refusal note and the immunity light sweep. |
| `on-brand` | `#001e2b` | `#001e2b` | Text and icons on a green fill. Never white on green. |
| `loss` | `#f97676` | `#c2343b` | Conned and money lost: the state dot, the losing number while a store is bleeding, the scams line in charts. |
| `loss-soft` | `#f976761a` | `#fbe9e9` | Faint wash behind the "con landed" note on the phone. |
| `learning` | `#f2c36a` | `#8a5a00` | Learning: the state dot, the current step, the test progress line. |
| `learning-soft` | `#f2c36a1a` | `#fbf1dd` | Faint wash behind the learning status on the console. |
| `immune` | `#00ed64` | `#00684a` | Immune and blocked: the state dot and word, blocked counts. The brand green on purpose: immunity is the product. |
| `served` | `#8ec5ec` | `#22639a` | Honest customers served: the sale dot in the feed, honest test cases, the honest line in charts. |
| `on-loss` | `#001e2b` | `#ffffff` | Text on a loss fill (only the danger button while held). |
| `store-queen` | `#baaee3` | `#6b5bb0` | Queen St (Lilac): its awning mark, the dot beside its name, its QR plate edge. Marks only, never large fills. |
| `store-yonge` | `#d9c099` | `#85693a` | Yonge St (Sand): its awning mark, the dot beside its name, its QR plate edge. Marks only. |
| `store-scarborough` | `#e1a6a9` | `#a44f59` | Scarborough (Rose): its awning mark, the dot beside its name, its QR plate edge. Marks only. |
| `paper` | `#f6f8f7` | `#ffffff` | Receipt paper and QR plates: the only bright surfaces on a stage screen. |
| `paper-ink` | `#001e2b` | `#001e2b` | Text on paper. |
| `paper-ink-2` | `#4a5a63` | `#4a5a63` | Secondary text on paper. |
| `qr-ink` | `#001e2b` | `#001e2b` | QR modules. Always navy on paper. |
| `scrim` | `#000a10b3` | `#0b1a2152` | Behind sheets on the phone and dialogs on the console. |

Text on glass was checked on the worst case: `glass-tint` and `glass-sheen` over the brightest `glow`. Every text pair above holds 4.5:1 in both themes; controls and focus rings hold 3:1.

## Type scale

| Style | Family | Size / line | Weight | Tracking | Use |
| --- | --- | --- | --- | --- | --- |
| `.stage-hero` | Geist | 200px / 0.9 | 500 | -0.05em | The one number a beat is about: time to the last store, 0 oversold. One per screen. |
| `.stage-display` | Geist | 104px / 0.86 | 500 | -0.045em | Money lost and cons blocked on each store, the round 2 results, flash sale counts. From $100 a tile drops to 88px so four digits fit. |
| `.stage-number` | Geist | 64px / 1 | 500 | -0.035em | Secondary numbers: the loss in the learning panel. Also the QR wall promise line. |
| `.stage-title` | Geist | 48px / 1.1 | 560 | -0.03em | Panel titles that carry the beat; the video card tagline. |
| `.stage-heading` | Geist | 36px / 1.15 | 560 | -0.02em | Store names on tiles and QR cards, panel titles. |
| `.stage-body` | Geist | 30px / 1.35 | 450 | -0.01em | Feed and table rows, the guardrail in plain words, verdicts, the rollout timeline. |
| `.stage-callout` | Geist | 28px / 1.2 | 560 | -0.005em | State words beside a store or panel title. |
| `.stage-label` | Geist | 26px / 1.3 | 500 | 0em | Labels, units, times and meta. The floor for stage text. |
| `.ui-display` | Geist | 40px / 44px | 600 | -0.04em | The nickname on the join screen. |
| `.ui-title` | Geist | 28px / 32px | 600 | -0.03em | Screen titles, the checkout total. |
| `.ui-heading` | Geist | 20px / 26px | 600 | -0.02em | Sheet headings. |
| `.ui-headline` | Geist | 17px / 22px | 600 | -0.02em | The store name in the shop header and on the join screen (the iOS navigation title size). |
| `.ui-body` | Geist | 16px / 23px | 450 | -0.006em | Chat messages and body copy. |
| `.ui-callout` | Geist | 15px / 20px | 550 | -0.005em | Buttons, list titles, bag rows, console panel titles. |
| `.ui-subhead` | Geist | 14px / 20px | 450 | 0em | Console rows and the descriptions on the join screen. |
| `.ui-caption` | Geist | 13px / 18px | 450 | 0em | Meta, notes, prices, product names, quick replies. |
| `.ui-micro` | Geist | 12px / 16px | 550 | 0.01em | Timestamps, tiny status words, the system line in chat. |
| `.mono-stage` | Geist Mono | 26px / 32px | 450 | 0em | Codes and order numbers on stage screens. |
| `.mono-code` | Geist Mono | 14px / 20px | 500 | 0.01em | Discount codes in chat, checkout and notes. |
| `.mono-receipt` | Geist Mono | 13px / 19px | 420 | 0.01em | Receipt lines and the ops console log (12px there). |

Numbers that change use `font-variant-numeric: tabular-nums` (`.bd-num`).

## Spacing

| Token | Value | Use |
| --- | --- | --- |
| `space-1` | `4px` | A title to its subtitle; a number to its unit inside a chip. |
| `space-2` | `8px` | Icon to label in buttons, chips and notes. |
| `space-3` | `12px` | Dot to word in a state; inside console rows; between a panel title and its rows on the console. |
| `space-4` | `16px` | Gaps between console panels; the composer's side gutter; between bag rows. |
| `space-5` | `20px` | Phone side gutter; console panel padding. |
| `space-6` | `24px` | Gap between stage panels and tiles. |
| `space-8` | `32px` | Stage panel padding. |
| `space-10` | `40px` | Stage side margin: projectors crop the edges. |
| `space-12` | `48px` | Between columns inside a stage panel. |
| `space-16` | `64px` | Between the big results in the flash sale; QR wall top margin. |
| `space-24` | `96px` | QR wall side margins. |

## Radius

| Token | Value | Use |
| --- | --- | --- |
| `radius-xs` | `6px` | Inline code, legend swatches. |
| `radius-sm` | `10px` | Inputs inside sheets, small notes. |
| `radius-md` | `14px` | Product cards, refusal notes, console rows. |
| `radius-lg` | `20px` | Chat bubbles, phone panels, console panels. |
| `radius-xl` | `28px` | Stage panels and the checkout sheet. |
| `radius-2xl` | `36px` | QR plates and the app icon at 200px. |
| `radius-pill` | `999px` | Buttons, chips, the policy badge, the composer. |

## Blur

| Token | Value | Use |
| --- | --- | --- |
| `blur-sm` | `12px` | Chips and the shop header. |
| `blur-md` | `24px` | Phone and console glass. |
| `blur-lg` | `40px` | Stage glass and the checkout sheet. Static panels only; never animated. |

## Motion: duration

| Token | Value | Use |
| --- | --- | --- |
| `dur-press` | `120ms` | Press feedback (scale 0.98). |
| `dur-fast` | `180ms` | Hover, toggles, colour changes on controls. |
| `dur-base` | `280ms` | A chat message or feed row arriving. |
| `dur-panel` | `480ms` | A state word changing, a note or verdict arriving, the checkout sheet rising. |
| `dur-scene` | `640ms` | The big screen moving to the next scene: the main panel blurs in. |
| `dur-tick` | `1000ms` | A number counting to its new value. |
| `dur-sweep` | `1100ms` | The light that sweeps across a store when it turns immune, and the one ping of a state dot. |
| `dur-loop` | `2400ms` | One slow cycle of the live dot ripple or the test case being run; the typing dots run at half. The only loops allowed. |
| `dur-stagger` | `60ms` | Delay between siblings arriving together. |

## Motion: easing

| Token | Value | Use |
| --- | --- | --- |
| `ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Default for anything arriving or responding: long, soft settle, no overshoot. |
| `ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | Things travelling across the screen: the immunity sweep, the story progress line. |
| `ease-in` | `cubic-bezier(0.7, 0, 0.84, 0)` | Exits only, at dur-fast. |
| `ease-sheet` | `cubic-bezier(0.32, 0.72, 0, 1)` | The checkout sheet and the receipt (the iOS sheet curve). |

## Layout

| Token | Value | Use |
| --- | --- | --- |
| `stage-width` | `1920px` | Big screen, QR wall and video cards are designed at 1920 by 1080 and scaled to the display. |
| `stage-height` | `1080px` | See stage-width. Keep the 40px outer margin: projectors crop edges. |
| `phone-width` | `390px` | Phone shop design width. Layouts stretch from 360px to 430px. |
| `phone-height` | `844px` | Phone shop design height. |
| `tap-min` | `44px` | Smallest tap target on the phone and console. |
| `stage-text-min` | `26px` | Smallest text on any stage screen. Anything the back row must read is 48px or larger. |

## Shadows

| Token | Stage | Daylight | Use |
| --- | --- | --- | --- |
| `shadow-glass` | `inset 0 1px 0 0 #ffffff0f, 0 1px 2px 0 #00000059, 0 30px 60px -30px #000000b3` | `inset 0 1px 0 0 #ffffff, 0 1px 2px 0 #0b1a210f, 0 24px 48px -28px #0b1a2124` | Every glass panel: a faint lit top edge, a tight contact shadow and a long soft one. |
| `shadow-float` | `inset 0 1px 0 0 #ffffff14, 0 40px 80px -24px #000000d9, 0 8px 24px -12px #00000099` | `inset 0 1px 0 0 #ffffff, 0 32px 80px -32px #0b1a2159, 0 8px 24px -12px #0b1a2133` | Things above glass: the checkout sheet, the receipt, tooltips. |
| `shadow-press` | `inset 0 1px 3px 0 #00000080` | `inset 0 1px 3px 0 #0b1a2126` | A pressed control. |
| `focus-ring` | `0 0 0 2px #000f17, 0 0 0 4px #00ed64` | `0 0 0 2px #f4f6f5, 0 0 0 4px #00684a` | Keyboard focus on every control: a 2px canvas gap, then 2px of solid green (12.3:1 on Stage, 6.6:1 in Daylight). |

## Glass recipe

```css
.panel {
  background: linear-gradient(180deg, var(--glass-sheen), transparent 55%), var(--glass-tint);
  backdrop-filter: blur(var(--blur-lg)) saturate(140%);
  border: 1px solid var(--glass-edge);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-glass);
}
/* the light edge: a 1px ring, brightest at the top left */
.panel::after {
  content: ""; position: absolute; inset: -1px; border-radius: inherit; padding: 1px; pointer-events: none;
  background: linear-gradient(165deg, var(--glass-highlight), transparent 40%);
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
}
```

No coloured glows: a state shows as its word, its dot and, on a store tile, a 1px line of its colour along the top edge.

## Components

| Component | What it is | Props |
| --- | --- | --- |
| `Logo` | The Bodega logo: the awning mark beside the lowercase wordmark. | `variant` lockup | stacked | mark | wordmark; `height` (px, rendered height); `title` (accessible name, default "Bodega"). |
| `AwningMark` | The awning mark on its own: five slanted stripes, rounded at the hem, in one colour. | `store` brand | queen | yonge | scarborough; `width` (px); `title`. |
| `StoreSign` | A store's identity: its awning mark in the store colour beside the store name. | `store`; `size` sm | md | lg | stage; `name` (override). |
| `Icon` | One of 64 line icons drawn for Bodega on a 24px grid with a 1.6 stroke. | `name`; `size` (px, default 24); `strokeWidth`; `title` (makes it an image with a name; otherwise decorative). |
| `Button` | Pill button: primary (Signal Green, once per view), secondary, ghost or danger. | `variant`; `size` sm 32 | md 44 | lg 52 | stage 72; `icon`, `iconRight`; `full`; `disabled`; `hold` (ms: press and hold to confirm) with `onHoldComplete`. |
| `IconButton` | Round icon-only button for send, add, back and close. | `icon`; `label` (required, used as aria-label and tooltip); `variant`; `size`. |
| `Glass` | Frosted glass surface: the base of every panel, tile and card. | `variant` panel | raised | inset; `as`; any div props. |
| `StatusPill` | A state as a dot and a word: Conned, Learning, Immune, Served or Open. | `state` conned | learning | immune | served | idle; `label` (override); `detail` (such as "in 0.8s"); `size` sm | md | lg | stage; `solid` (adds a quiet glass pill). |
| `StoreChip` | Store name with its awning mark in the store colour, for tables, feeds and meta lines. | `store`; `size` sm | md | stage. |
| `PolicyBadge` | The store's current guardrail version, such as "Policy v3, learned 2 min ago". | `version`; `learnedAgo` (leave out for v1, which nobody learned); `fresh` (green for a moment after a new version arrives); `size` md | stage. |
| `WalletChip` | Play-credit balance, counting to the new amount when it changes. | `amount` (dollars); `size` md | stage. |
| `Ticker` | A number that counts from its last value to the new one, in tabular figures. | `value`; `format` int | money | percent | seconds | decimal; `from` (first render); `duration` (default `dur-tick`); `prefix`, `suffix`. |
| `SegmentedControl` | Equal-width segmented control with a sliding thumb. | `options` [{ value, label, icon }]; `value`; `onChange`; `size` sm | md | lg; `label` (accessible group name). |
| `Toggle` | On and off switch with a visible label. | `checked`; `onChange`; `label`. |
| `ProgressBar` | Determinate progress on a hairline track. | `value`; `max`; `tone` learning | immune | loss | served; `size` md | stage; `label`. |
| `LiveDot` | A small dot with a slow ripple that means "this is live". | `tone`. |
| `Kbd` | A keyboard key, for console shortcuts. | children: the key label. |
| `StageFrame` | Holds a fixed-size stage design (1920 by 1080 by default) and scales it to its container. | `width`, `height` (design size); `fit` width | contain; children. |
| `StageHeader` | Top line of every stage screen: logo, the five beats of the story, live shoppers and "Built on MongoDB Atlas". | `scene` round1 | learning | rollout | round2 | flash; `shoppers`. |
| `StoryStepper` | The five beats of the pitch, each underlined by its own segment. | `current`; `size` stage | sm. |
| `StoreTile` | One store on the big screen: name and policy, state, money lost and cons blocked. | `store`; `status` idle | conned | learning | immune; `policy`; `lost`; `blocked`; `immuneIn` (seconds, shown as "Immune in 0.8s"); `learnedAgo`. |
| `FeedItem` | One event in the live feed: a state dot, who, what happened, amount and time. | `kind` sale | con-worked | con-blocked | rule-promoted | rule-rejected | learning | sold-out; `who`; `text` (30 characters or fewer); `amount`; `time`. |
| `LiveFeed` | The live feed panel, newest first; each new row blurs in. | `items` (FeedItem props with `id`); `max` (default 5); `title`. |
| `ConCard` | One row on the wall of cons: the trick in plain words, the store that saw it first, how often it worked and how often it was blocked. | `summary`; `store` (first seen); `worked`; `blocked`. |
| `ConWall` | The wall of cons as a table, with a count of tricks so far. | `cons`; `max` (default 6); `title`. |
| `TestGrid` | The 120 held-out cases as dots: 60 scams and 60 honest customers, filled as the test runs. | `scamsTotal`, `scamsTested`, `scamsStopped`, `honestTotal`, `honestTested`, `honestServed`; `size` stage | ui. |
| `LearningPanel` | The learning panel, read left to right: what happened, the new guardrail in plain words, the held-out test, then the verdict. | `phase` incident | drafting | testing | promoted | rejected; `store`; `incident` { summary, detail, lost }; `guardrail` { version, text, scope }; `test` { done, total, scamsTested, scamsStopped, honestTested, honestServed }; `verdict` { title }. |
| `MetricCompare` | One result: a label, the after value large and the before value quietly underneath. | `label`; `before` (optional); `after`; `format`; `unit`; `note` (one line, used when there is no before); `highlight`; `size` stage | ui. |
| `VersionChart` | Every guardrail version on the same held-out cases: scams that work and honest customers turned away, on one percent axis. | `versions` [{ v, scams, honest, rejected, note }]; `width`; `height`; `size` stage | ui; `legend`. |
| `FlashSale` | Flash sale result: 100 bots against 10 hoodies, exactly 10 sold and 0 oversold. | `bots`; `stock`; `sold`; `oversold`; `winners` (indices of the winning bots). |
| `RolloutBanner` | The moment of herd immunity: the time to the last store, the proof, and a timeline where each store sits at its real time after the verdict. | `version`; `stores` [{ store, t }]; `scams` [stopped, total]; `honest` [served, total]. |
| `PhoneFrame` | Presentation-only phone frame (390 by 844 screen) for mockups and the design review. | `store`; `theme`; `time`; children. |
| `ShopHeader` | The shop header: the store's mark and name, live status, wallet and current policy. | `store`; `wallet`; `policy` { version, learnedAgo, fresh }; `subtitle`. |
| `NicknameReveal` | "You're shopping as Sneaky Raccoon": the nickname reveal on the join screen. | `nickname`; `rolling` (blurs through a few names, then lands); `onReroll` (shows New name). |
| `ChatBubble` | A chat message: the shopkeeper speaks in plain text beside its awning mark; the customer's words sit in a quiet bubble on the right. | `from` shopkeeper | customer; `store`; `tone` refusal | conned; `time`; `attachment` (RefusalCard, ConLanded); children. |
| `TypingIndicator` | Three dots breathing in turn while the shopkeeper writes. | `store`. |
| `SystemNote` | A centred system line between hairlines, such as when a new policy arrives mid-chat. | children. |
| `Code` | A discount code or order number set in mono, like the real thing. | `tone` immune (a code that was accepted); children. |
| `ProductCard` | A product on the shelf: line art, name, price and an add button. | `product` { id, name, price, icon, stock }; `onAdd`. |
| `ProductStrip` | A horizontally scrolling shelf of ProductCards that snaps to cards. | `products`. |
| `Composer` | Message composer with quick replies and a send button. | `placeholder`; `value`; `chips`. |
| `RefusalCard` | Why a message was refused: the known trick, where it was first seen and which policy blocked it. | `trick`; `seenAt` (store key); `here` (the trick was first seen at this store); `seenAgo`; `policy`. |
| `ConLanded` | Round 1 only: tells the person their con worked and what the store lost. | `amount`; `store`. |
| `CheckoutSheet` | Checkout sheet: the bag, a real code, the total and Pay. | `items`; `code`; `discount`; `wallet`. |
| `Receipt` | The paper receipt: order number, mono line items, total and a thank-you by nickname. | `order` (store prefix and four digits, such as QS-0412); `store`; `items`; `discount`; `code`; `nickname`; `time`. |
| `QRCode` | A QR code from a module matrix: navy on paper with a 4-module quiet zone. | `rows` (strings of 0 and 1); `size`; `title`. |
| `QRCard` | QR card for the opening wall: the store's mark and name, a big code on paper and the short link for anyone who can't scan. | `store`; `rows`; `url`; `size` (QR px, 340 or more on the wall). |
| `ConsolePanel` | A titled glass panel for the ops console. | `title`; `aside`; children. |
| `StatusRow` | Label and value row with an optional state tone. | `icon`; `label`; `value`; `tone`. |
| `EventLog` | The console's event log in mono, newest last. | `lines` [{ t, text, tone }]. |
| `StoreRow` | One store's live row in the console: policy, state, money lost and cons blocked. | `store`; `status`; `policy`; `lost`; `blocked`. |
| `BigScreen` | The big screen, composed: header, store tiles, the scene's main panel and the live feed. | `scene` round1 | learning | rollout | round2 | flash; `tiles`; `feed`; `learning`; `cons`; `shoppers`; `fit`. |
| `StoryPlayer` | Plays the whole pitch with real motion so the timing can be judged before the day. | No props. Press Play the story, or pick a scene. |
| `PhoneScreen` | One phone screen, themed per store: join, chat, conned, refusal, checkout or receipt. | `screen`; `store`; `theme`; `nickname`. |
| `QRWall` | The opening screen: the promise, one instruction and a QR card per store with its short link. | `fit`. |
| `OpsConsole` | The ops console on a laptop: run of show, what the room sees, actions, health, stores and the log. | `scene`; `mode` stage | table; `fit`. |
| `VideoCard` | Title and end cards for the one-minute video. | `kind` title | end; `team`; `repo`; `fit`. |
| `ReadmeBanner` | GitHub README banner, 1280 by 400. | `fit`. |

Each component has its own guidelines and a live preview under Components.

## Data shapes

The screens take plain objects. `Bodega.DEMO` has a full set of examples.

```js
// store tile, one per store
{ store: 'queen', status: 'immune', policy: 3, lost: 38.5, blocked: 23, immuneIn: 0.4, learnedAgo: '2 min ago' }
// feed item
{ id: 'b1', kind: 'con-blocked', who: 'Streetcar Phantom', text: 'Blocked at Yonge St, fake code', store: 'yonge', time: '7:58' }
// trick on the wall of cons (a summary, never the raw message)
{ id: 'insta50', summary: 'Fake 50% code from Instagram', store: 'queen', worked: 3, blocked: 11 }
// learning panel
{ phase: 'testing', store: 'queen', incident: { summary, detail, lost }, guardrail: { version: 2, text, scope },
  test: { done: 96, total: 120, scamsTested: 48, scamsStopped: 46, honestTested: 48, honestServed: 48 } }
// guardrail versions for the chart (percent of the held-out set)
[{ v: 'v1', scams: 41, honest: 0 }, { v: 'v2 draft', scams: 9, honest: 35, rejected: true }, { v: 'v2', scams: 5, honest: 0 }, { v: 'v3', scams: 3, honest: 0 }]
// rollout: seconds from the verdict to each store
[{ store: 'queen', t: 0.4 }, { store: 'yonge', t: 0.8 }, { store: 'scarborough', t: 1.6 }]
```

## Wiring it live

- Keep one source of truth per store (state, policy version, money lost, blocked count) and push changes to the big screen and the phones as they happen. A change stream on the store and event collections maps one to one onto these props.
- Set a store tile's `status` to `immune` when that store reports the new policy, and pass the measured `immuneIn`. The sweep then lands on each tile at its real time, and the rollout timeline is to scale.
- Advance `LearningPanel.phase` from the real pipeline (incident, drafting, testing, promoted or rejected) and stream the `test` counts as each case finishes.
- Queue feed events so a new row arrives at most every 300ms, and batch blocked counts so a counter moves at most four times a second.
- Flash sale: decrement stock with one conditional atomic update per order (`stock > 0`) and drive `FlashSale.sold` from the inventory document.

## Performance budget

- Target 60fps on a MacBook Air driving a 1080p projector, and on mid-range phones.
- Animate `transform`, `opacity` and a short `filter: blur()` on small elements only (a feed row, a state word). Backdrop blur stays on static panels.
- Loops are limited to the live dot, the typing dots and the test case being run.
- If frames drop, set `data-perf="lite"`: glass turns solid and nothing else changes.

## Accessibility

- Contrast: all text pairs 4.5:1 or better in both themes; controls, focus rings and meaningful marks 3:1.
- A state always carries a word as well as a colour.
- `focus-ring` on every interactive element; icon-only buttons have labels; the Reset hold also works from the keyboard (hold Enter or Space).
- `prefers-reduced-motion`: numbers jump, blurs become plain fades, the sweep and loops stop.
