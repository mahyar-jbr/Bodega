# Screens and states

Every screen below is a live preview under Components, Screens. Build from those compositions; this section says what each one is for and what changes between states.

## The pitch, beat by beat

Every store opens on Policy v1, trusting on purpose. Queen St's fake Instagram code teaches v2 live on stage. During round 2 a fake district manager lands once at Yonge St, Yonge St learns v3 on its own, and two minutes later Queen St turns the same trick away.

| Beat | Big screen | Phones | Ops console |
| --- | --- | --- | --- |
| Opening | QR wall: the promise, one instruction line, a QR card per store | Join: the store, the nickname, $20 of credits, the two real codes, the mission | Run of show on scene 1 |
| Round 1 | Money lost ticks up in red on every tile; the wall of cons fills | The con works and the shopkeeper is gracious about it; a "Con landed" note says what the store lost | Watch the log; press L when ready |
| Learning | The learning panel: what happened, the guardrail in plain words, 120 unseen cases, the rule for shipping | Shopping carries on | L to learn, T to test |
| Immunity | 1.6s from verdict to the last store; each tile turns immune at its own time with one soft sweep | A system line: Policy v2 arrived | Space when the last store reports |
| Round 2 | The results (scams that work 41% to 3%, 0 of 60 honest turned away, 1.6s), every guardrail version, blocked counts climbing | A polite refusal naming the store that saw the trick first; real codes still work | Space |
| Flash sale | 100 bots against 10 hoodies: exactly 10 sold, 0 oversold | The hoodie sells out | F to start the bots |

## Big screen (1920 by 1080)

- **Header**: the lockup, the five beats each underlined by its own segment (done beats quiet, the current one lit with its state dot), live shoppers and "Built on MongoDB Atlas".
- **Store tiles**: the store's mark and name with its policy underneath ("Policy v3, learned 2 min ago"), the state as a dot and a word ("Immune in 0.8s"), then money lost and cons blocked at 104px. Money lost is red while the store bleeds and grey once it is immune; cons blocked turns green; a zero stays grey. A 1px line of the state colour runs along the top edge.
- **Live feed**: newest first, five rows. A state dot, the nickname, what happened, the amount and the time.
- **Wall of cons** (round 1): a table of tricks. The trick in plain words, the store that saw it first, how often it worked and how often it was blocked.
- **Learning panel**: three columns read left to right, each with a top rule that is its step (amber while it runs, quiet once done, faint while it waits). The test fills one dot per case: green for a scam stopped, blue for an honest customer served, red for a miss. Until the test decides, the bottom line states the rule for shipping; then it shows the verdict.
- **Immunity**: the time from verdict to the last store as the hero number, the proof (57 of 60 scams stopped, 60 of 60 honest served), and a timeline to scale with each store at its real second.
- **Round 2**: three results with the hero in green, and the version chart: both measures on one percent axis, the rejected v2 draft as a crossed ring, never joined to the lines.
- **Flash sale**: 100 bots with the 10 winners lit, 10 hoodie slots, then 10 sold and 0 oversold with the one-line reason (one atomic update per order).

## Phone shop (390 by 844, one design, themed per store)

- **Join**: the store's mark and name, "Open, the shopkeeper is in", the nickname, then three lines in the iOS style: $20 in play credits, two real codes, your mission. Start shopping sits at the bottom.
- **Chat**: the shop header (store, live dot, wallet, policy badge), the shopkeeper in plain text beside its mark, the customer in a quiet bubble on the right, the typing dots, the product shelf, quick replies and the composer.
- **Round 1, the con lands**: the shopkeeper accepts; a soft red note tells the person what the store lost and that Bodega is learning from it.
- **Round 2, polite refusal**: a system line when the new policy arrives, then the refusal with a soft green note: the known trick, where it was first seen and which policy blocked it. At Yonge St, where v3 was learned, the shopkeeper says it in the first person.
- **Checkout**: an iOS sheet over the dimmed chat with the bag, the real code applied, the total and Pay.
- **Receipt**: paper with scalloped edges, the order number (store prefix and four digits), mono line items, the total, a barcode and a thank-you by nickname.
- Per store, only identity changes: the awning mark, the avatar, and a little of the store colour in the light at the top of the screen. The primary button is Signal Green at every store.

## QR wall, ops console, video and README

- **QR wall**: on screen for the first two minutes. Codes are generated per store at version 2 so the modules stay big, and were checked to scan at a fifth of their size. The short link under each code is for anyone who can't scan.
- **Ops console** (only the team sees it): the run of show with a one-line note per scene and a Next button that names the next scene, what the room sees right now, the actions (learn, test, start the bots, pause the feed), Reset demo as a 1.5 second press and hold, health, each store's live row, and the log. The Stage and Judging table switch moves the projector between the two views.
- **Video**: a title card and an end card at 1920 by 1080; the PNG exports are in Exports.
- **README banner**: 1280 by 400, PNG in Exports.
