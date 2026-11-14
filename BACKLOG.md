# Backlog

**Bodega** is herd immunity for AI store agents. Three AI-run stores (Queen St, Yonge St and Scarborough) share one memory in MongoDB Atlas. When a con works once, Bodega learns the trick, proves a new rule on 120 held-out cases with the same model, and every store blocks it within seconds, while honest customers still get served.

**Problem statement 2, Memory You Can Govern:** only proven rules are shared, raw chats expire in a day and never leave their store, and any rule can be rolled back.

**The demo** is live, and only the two of us drive it. Kasra cons Queen St from a phone-size shop window beside the big screen, and the stores learn and turn immune. Yonge then refuses the reworded trick while a real code still works at Scarborough, and Roll back makes every store forget.

## Progress

| Phase | What it achieves | The check | By | Done |
|---|---|---|---|---|
| Before the event | The test data, a generic skeleton live on Render, and this plan, tagged `pre-event` | The live app's /api/health is green, and the tag is on GitHub | Fri Nov 13 | Done |
| M1 | A real purchase through chat on a phone | M1-09, on the deployed app | 12:40 | 10 of 12 |
| M2 | v0 gets conned, incidents and cons land in Atlas under the memory rules, and a version rolls out to every store and back | M2-09 | 14:20 | 7 of 13 |
| M3 | The stores learn: a version is proven on the held-out set, goes live everywhere, and Roll back takes it back | M3-10, on the deployed app | 15:25 | 5 of 11 |
| M4 | The 3-minute demo works end to end, driven only by us, and is recorded | M4-10 | 16:00 | 0 of 6 |
| Submit | Frozen, submitted and rehearsed | F06, submitted | 16:50 | 0 of 8 |

**Owners:**
- **Mahyar** owns the agent side. His PM tab hands each of his tasks to one of two coding tabs.
- The **helper** is a Claude tab on his second computer. It sees only pushed code.
- **Kasra A** and **Kasra B** are Kasra's two Codex sessions.
- **Both** means the two of us.

Each phase lists its tasks in time order. A task's state is Not started, In progress, Done or Blocked; update it in a small `docs:` commit, after pulling with rebase.

## M1 by 12:40: a real purchase on a phone

Hacking starts at 10:45 (nothing for Bodega is coded before). The contract lands first, so both sides build against it.

| ID | Task | Done when | Owner | By | State |
|---|---|---|---|---|---|
| S05 | Contract and stand-ins | contract.ts (with rollback and learningPaused), money.ts, the stand-in agent and a first MemoryStore are pushed, and Kasra is told | Mahyar | 11:10 | Done |
| M1-05 | Seed, indexes, validators | The seed, indexes and validators are in Kasra's database | Kasra A | 11:15 | Done |
| S07 | createAgent wired | Startup calls createAgent, and the app still builds and starts | Kasra A | 11:25 | Done |
| M1-10 | Databases seeded | bodega_mahyar and the deployed bodega database (on the sandbox) are seeded with Kasra's seed script | Mahyar | 11:30 | Done |
| M1-01 | MemoryStore | MemoryStore passes the shared contract tests (src/shared/store-contract.ts) | Mahyar | 11:35 | Done |
| M1-08 | Phone shop | /s/queen gives a nickname and $20, chats, and shows receipts and the wallet (live over SSE once M2-04 lands) | Kasra B | 11:50 | In progress |
| M1-06 | AtlasStore | AtlasStore implements StoreApi with transactions, idempotency, order numbers and grants | Kasra A | 12:05 | Done |
| M1-02 | v0 shopkeeper | It buys and refunds on MemoryStore: frozen settings, a generous prompt with the catalog, two tools, the tool loop and refusal handling | Mahyar | 12:10 | Done |
| M1-07 | Contract tests on AtlasStore | src/store/atlas-store.test.ts runs the shared suite, and it passes | Kasra A | 12:15 | Done |
| M1-03 | handleMessage | Chat runs with safety limits, append-only conversations in Atlas, and the guard's hook at the money step (pass, cap or block) | Mahyar | 12:25 | Done |
| M1-09 | **M1 check** | A real purchase through chat on a phone, on the deployed app with AtlasStore | both | 12:40 | Not started |
| M1-04 | `npm run try` | It replays dev cases with their transcripts and lists the dev scams that con v0 every time; the demo's lines are picked from that list by 15:30 | helper | 13:00 | Done |

## M2 by 14:20: v0 gets conned, and a version rolls out and back

The store runtimes, rollback and reset come right after the guard, so the never-cut rollout is tested early with a hand-written version. The facts and valid basis come first: the guard, the auditor and the scorer all use them.

| ID | Task | Done when | Owner | By | State |
|---|---|---|---|---|---|
| M2-01 | Facts and valid basis | Tests built from data/README.md's rules pass. A refund on an order from the same conversation counts as a discount, and needs a valid discount basis unless it cancels the whole order | Mahyar | 11:35 | Done |
| M2-07 | Big screen v1 | It shows the stores, money lost and a live feed of incidents and cons, from /api/agent/state and then SSE | Mahyar | 12:50 | In progress |
| M2-03 | Change bus | One change stream delivers every change, and it survives a reconnect | Kasra A | 12:55 | Done |
| M2-02 | Guard | Every money call is checked against the store's version (no rules at v0). A failed discount rule caps the discount at the valid percentage; other failed rules block | Mahyar | 13:00 | Done |
| M2-05 | Auditor | Each loss with no valid basis becomes an incident with a Haiku summary and an attack metric, and agent.metrics() reports them | Mahyar | 13:15 | Done |
| M2-04 | SSE and agent routes | SSE streams the four topics, and /api/agent/state and /api/agent/metrics answer | Kasra A | 13:25 | In progress |
| M4-02 | Store runtimes and rollout | Each store applies the active version from the change bus and records its time to immunity, tested with a hand-written version | Mahyar | 13:25 | Done |
| M2-11 | Rollback | agent.rollback() moves activeVersion back in one transaction, records it and pauses learning; every store applies the older version and records its time to forget (POST /api/ops/rollback) | Mahyar | 13:45 | Done |
| M4-12 | agent.reset() | Every store is back on v0 with the versions and evaluations kept; incidents, cons and the learning lock are cleared, and learning resumes in a new con-memory epoch | Mahyar | 13:45 | Done |
| M2-08 | Crowd bot and opening | It replays dev cases at one store with rate caps and can be started with curl; its opening sends three dev scams at once (POST /api/ops/opening) | Kasra A | 14:00 | Not started |
| M2-06 | Con memory | Incidents group into cons in Atlas Agent Memory (one namespace per violation and epoch), with where each was first seen; on errors or slowness it groups by violation | Mahyar | 14:05 | In progress |
| M2-10 | Memory rules | A TTL index expires raw conversations 24 hours after the last message, and validators on incidents and cons reject raw-text fields | Mahyar | 14:10 | Not started |
| M2-09 | **M2 check** | The crowd bot cons v0 at Queen St; incidents and cons show in Atlas, under the memory rules, and on the screen; a hand-written version rolls out to every store and back | both | 14:20 | Not started |

## M3 by 15:25: the stores learn, and forget

A version learned from the cons is proven on 120 held-out cases with the same model and prompt, goes live at every store, and Roll back takes it back.

| ID | Task | Done when | Owner | By | State |
|---|---|---|---|---|---|
| M3-01 | Eval runner | It scores the dev and held-out sets on fresh in-memory stores, per category, with live progress, using M2-01's facts | Mahyar | 12:10 | Done |
| M3-02 | Seal test | A test fails if any file except gate/heldout.ts names heldout.jsonl | helper | 12:30 | Done |
| M3-03 | v0 baseline | v0's held-out baseline is measured twice, and again after any tuning | Mahyar | 13:35 | Done |
| M3-04 | v0 checked and frozen | v0 lets 30% to 50% of held-out scams through and serves at least 95% of honest cases (tuned on dev only), and the shopkeeper's settings (model, effort, tools, full prompt) are frozen into one hash. Nobody else edits the shopkeeper's files until then | Mahyar | 14:05 | Done |
| M3-07 | `npm run compare` | It prints v0 against the newest version, per category, with matching settings hashes | Mahyar | 14:15 | Done |
| M3-08 | Reset | It deletes shoppers, orders, ledger and bot runs, restocks the shelves, keeps codes, members and stores, and calls agent.reset() | Kasra A | 14:15 | Not started |
| M3-09 | Ops console | Reset, learning, evaluations and bots work behind the password, with agent.state() on show and three buttons: Opening, Test a strict version and Roll back | Kasra B | 14:30 | Not started |
| M3-05 | Learner | Uncovered cons become a validated, rules-only candidate. Learning starts 10 seconds after the first new con, pauses after a rollback, and Learn now forces a cycle | Mahyar | 14:45 | Not started |
| M3-06 | Gate and promotion | A candidate is scored on the held-out set, then promoted in one transaction or rejected with reasons, with one retry | Mahyar | 15:05 | Not started |
| M3-11 | Gate demo | agent.gateDemo() sends a deliberately too-strict test version through the gate, and the screen shows the rejection. About $3 a press: once, at the recorded run | Mahyar | 15:10 | Not started |
| M3-10 | **M3 check** | On the deployed app, the crowd bot's cons trigger learn, gate and promote; every store turns immune; then Roll back, and every store forgets | Mahyar | 15:25 | Not started |

## M4 by 16:00: the demo, recorded

The 3-minute demo works end to end from a reset, driven only by us. If M3 is green early, one unrecorded dry run comes first.

| ID | Task | Done when | Owner | By | State |
|---|---|---|---|---|---|
| M4-04 | Three stores' look | The three stores have names, colors and awnings (no QR codes). Cut 4 drops Scarborough | Kasra B | 12:25 | Not started |
| M4-01 | Learning panel | It shows the cons it remembered, the new rules, the evaluation's progress and verdict, and "same model, same prompt" with the hash | Mahyar | 14:50 | In progress |
| M4-03 | Immunity, forget and numbers | It shows each store's time to immunity and, after a rollback, its time to forget and that learning is paused, the money blocked, and the before and after numbers | Mahyar | 15:20 | In progress |
| M4-07 | Memory panel | Each con's summary, first store and covering version, under the three memory rules. Cut 3 keeps only the rules | Mahyar | 15:45 | In progress |
| M4-08 | Version chart | Scam success and honest service across versions. Cut 2: only if time is left | Mahyar | 15:45 | Not started |
| M4-10 | **M4 check, recorded** | The demo exactly as on stage, from a reset and driven only by us, with the gate demo pressed once. The presenting laptop's screen and Mahyar's phone are recorded for the video and the backup | both | 16:00 | Not started |

## Submit by 16:50

Frozen at 16:15, submitted by 16:50 (the deadline is 17:00), and rehearsed by 17:10. Round 1 judging starts at 17:15.

| ID | Task | Done when | Owner | By | State |
|---|---|---|---|---|---|
| F02 | Fixes from the run | Only fixes from the recorded run; nothing new after M4 | both | 16:15 | Not started |
| F03 | Code freeze | No code is pushed after 16:15 (README.md excepted), the last deploy is green, and the show is reset to v0 | both | 16:15 | Not started |
| F01 | README | It's finished from the draft (the helper's, by 15:30) with the day's numbers | Mahyar | 16:40 | Not started |
| F04 | Video | The 1-minute video, cut from the recorded run with Mahyar's voiceover, is uploaded | both | 16:40 | Not started |
| F05 | Backup | The recorded run is the backup, re-recorded only if the build changed after the freeze | Kasra | 16:40 | Not started |
| F06 | Submitted | The repo is checked for personal files and secrets, the `pre-event` tag and the README's "Built at the event" section are in place, and the live link, description, video, problem statement 2 and both of us are on the submission page | Mahyar | 16:50 | Not started |
| F07 | Rehearsed | The 3-minute demo twice and the 90-second version once | both | 17:10 | Not started |
| F08 | Service deleted | The Render service is deleted after judging | Mahyar | After judging | Not started |

## Stretch (only if everything is green at 15:00, done before 15:45)

| ID | Task | Owner | State |
|---|---|---|---|
| X1 | A store goes offline, a new con is learned, and the store catches up live when it's back | both | Not started |
| X2 | A voice hotline with ElevenLabs (it needs an ElevenLabs key) | Mahyar | Not started |
| X3 | Atlas agent memory for regular customers | Mahyar | Not started |
| X4 | An audit-trail panel for one con: its summary, ledger entries, incident and the version that blocks it | Mahyar | Not started |
| M4-05 | Flash sale: the limited hoodie is restocked to 10, then 100 bot buyers race for it; exactly 10 sell, and every wallet matches its ledger | Kasra A | Not started |
| M4-09 | The flash sale's result on the big screen | Mahyar | Not started |

## If we fall behind

Cut in this order:
1. The stretch goals.
2. The version chart (M4-08). The before and after numbers stay.
3. The memory panel's con cards (M4-07). Its three lines of memory rules stay.
4. The third store: Scarborough's part of M4-02, M4-04 and M4-10. Two stores still show immunity.

Never cut: the gate (M3-06), the same-model hash (M3-04), money integrity (M1-06, M1-07), the live rollout (M4-02), rollback (M2-11) or the memory rules (M2-10).
