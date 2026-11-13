# Backlog

Bodega's shared backlog: every task from now through submission on Sat Nov 14, for both of us. This is the only copy. It lives in the repo from Friday's setup push, and each of us updates a task's state when it starts, finishes or gets blocked, in small `docs:` commits (pull with rebase first). Kasra's tasks match his brief.

**Nov 11 update.** The organizers sent their schedule. Doors open at 9:00 (bring photo ID), the kickoff is at 10:00, hacking starts at 10:45, and submissions, with a 1-minute video, are due at 17:00. Round 1 judging starts at 17:15. So:
- Nothing for Bodega is coded before 10:45.
- Every Saturday time below is new.
- Kasra runs two Codex sessions from 10:45 (see "Owner and lane").
- The three stores' look moves up to 12:25.
- The ops console gets a Roll back button.
- The flash sale is now a stretch goal.
- We enter problem statement 2, "Memory You Can Govern".

**Nov 13 update.** Only the two of us touch the live app during the demo. There are no QR codes and no sign-ups from the room, and the judges watch. The presenting laptop shows the big screen with a phone-size shop window beside it, Kasra sends rehearsed cons from that window, and the 15:45 recording is the fallback. So:
- M4-11 (the round's QR codes) is dropped, and M4-04 has no QR codes.
- The ops console has no round or mode switch (M3-09).
- The guard has no profanity filter (M2-02), and the phone shop has no per-IP sign-up limit.
- An audit-trail panel joins the stretch goals (X4).
- The milestones don't move. The freed time is buffer, and if M3 is green early, one unrecorded dry run of the demo.

- **How to use it on Saturday:** each lane works down its column of the run sheet, in order. The tables after it define each task.
- **Owner and lane:** Mahyar, Kasra or both.
  - Mahyar's **tab 1** does the agent logic. **Tab 2** (from 11:10) does the facts and valid basis, the evaluation runner, the auditor and the big screen. The **helper** is a Claude tab on Mahyar's second computer: it sees only pushed code, and if it's away, tab 2 takes its tasks.
  - Kasra's **A** session does data and money, realtime and the bots; his **B** session does the phone shop and the ops console. They edit different folders, and changes to package.json, src/server/index.ts or src/shared/ are still announced first.
- **Mahyar's rows** mention his own setup (his kit's prompts, "the Air" laptop, /mcp sign-ins).
- **Nothing for Bodega is coded before 10:45.** Friday's setup is tagged `pre-event`, and Saturday morning is setup and the kickoff.
- **Target:** the prep day, or the time on Saturday the task should be done by.
- **AI budget:** our Anthropic credit is fixed, with auto-reload off (decided Nov 10). Develop on the dev set. The held-out set runs only for the v0 baselines and real gate runs, the gate demo is pressed once at the recorded run, and the crowd bot runs only when needed. Mahyar checks the balance at 13:30, 15:30 and 16:15; if it runs low, everything that isn't for judging stops.
- **Cuts:** **Cut 1** to **Cut 4** mark what goes first if we fall behind (section 9).
- **Saturday's buffers:** lunch (13:00) is eaten at the desk, during M2. The slack before each milestone is its check window (M1 15 minutes, M2 10, M3 15), and 15:25 to 15:45 is free before the recorded run (with M3 green early, an unrecorded dry run of the demo goes there).

## Run sheet (Saturday)

Each time is when the task should be done. Bold rows are shared checks. Before 10:45: no Bodega code.

| By | Tab 1 · agent logic | Tab 2 · scoring, auditor, screen | Kasra A · data, realtime, bots | Kasra B · shop and ops |
|---|---|---|---|---|
| 9:30 | | | S06 pull (the setup ran Friday) | |
| 9:45 | S04 Mahyar's step 0, no code (S01 and S09 too, if not done Friday) | | | |
| 10:00 to 10:45 | Kickoff | Kickoff | Kickoff | Kickoff |
| 10:45 | Hacking starts: S05 begins | Starts at 11:10 | M1-05 begins | M1-08 begins |
| 11:10 | S05 contract and stand-ins, pushed | | | |
| 11:15 | | | M1-05 seed, indexes, validators | |
| 11:25 | | | S07 createAgent wired | |
| 11:30 | M1-10 seed both databases (one command) | | | |
| 11:35 | M1-01 MemoryStore passes the contract tests | M2-01 facts and valid basis | | |
| 11:50 | | | | M1-08 phone shop |
| 12:05 | | | M1-06 AtlasStore | |
| 12:10 | M1-02 v0 shopkeeper | M3-01 eval runner | | |
| 12:15 | | | M1-07 contract tests on AtlasStore | |
| 12:25 | M1-03 handleMessage | | | M4-04 three stores' look |
| **12:40** | **M1-09 M1 check (both)** | | | |
| 12:50 | | M2-07 big screen v1 | | |
| 12:55 | | | M2-03 change bus | |
| 13:00 | M2-02 guard (lunch at the desk) | | | |
| 13:15 | | M2-05 auditor | | |
| 13:25 | M4-02 store runtimes and rollout | | M2-04 SSE and the agent routes | |
| 13:35 | | M3-03 v0 held-out baseline, twice | | |
| 13:45 | M2-11 rollback; M4-12 reset | | | |
| 14:00 | | | M2-08 crowd bot with the opening | |
| 14:05 | M2-06 con memory | M3-04 v0 checked, tuned on dev if needed, frozen | | |
| 14:10 | M2-10 memory rules in Atlas | | | |
| 14:15 | | M3-07 compare | M3-08 reset | |
| **14:20** | **M2-09 M2 check (both)** | | | |
| 14:30 | | | | M3-09 ops console |
| 14:45 | M3-05 learner | | | |
| 14:50 | | M4-01 learning panel | | |
| 15:05 | M3-06 gate and promotion | | | |
| 15:10 | M3-11 gate demo | | | |
| 15:20 | | M4-03 immunity, forget and numbers | | |
| **15:25** | **M3-10 M3 check** | | | |
| 15:45 | Free: fixes and help | M4-07 memory panel (M4-08 only if time is left) | Free: fixes and help (M4-05 only if all green at 15:00) | Free: phone polish and help |
| **16:00** | **M4-10 recorded run (both)** | | | |
| **16:15** | **F02 fixes from the run; F03 code freeze (both)** | | | |
| 16:40 | F01 README numbers; F04 voiceover | | F04 video cut and upload; F05 backup | |
| **16:50** | **F06 submitted** | | | |
| 17:10 | F07 rehearse the 3-minute demo (both) | | | |

**Helper (Mahyar's second computer):** M3-02 the seal test by 12:30, M1-04 `npm run try` by 13:00 (its list of cons that work on v0 every time feeds the opening's three cases), the README draft for F01 by 15:30, and a phone-size check of the live shop after each milestone check.

## 1. Prep left (before Saturday)

Finished prep tasks are removed, so this list stays short.

| ID | Task | Area | Owner | State | Milestone | Depends on | Target |
|---|---|---|---|---|---|---|---|
| P12 | Friday check: no Anthropic top-up (decided Nov 10: keep AI spend low; the budget rules are in the intro), everything charged, hotspot tested, and government photo ID packed for both of us (the venue asks for it). Nov 10: balance and hotspot done; charging and the IDs are left | config | Mahyar | In progress | prep | | Fri Nov 13 |
| P19 | Friday: Mahyar refreshes the helper computer's copy of his plan docs, so it works from the Nov 11 plan | config | Mahyar | Not started | prep | | Fri Nov 13 |
| P20 | Friday night, with the live URL and ops password (S08): Mahyar sends Kasra the final brief (it isn't in the repo) and points him to this backlog in the repo. That's how the Nov 11 changes reach him: new times, two Codex sessions, the Roll back button, and the flash sale as a stretch goal | boundary | Mahyar | Not started | prep | S02, S08 | Fri Nov 13 |

## 2. Before hacking (Friday, and Saturday 9:00 to 10:45)

Nothing for Bodega is coded before 10:45. On Friday: the setup push, tagged `pre-event` (S02), Render (S08), and the sandbox (S01, S09) if its email has arrived. On Saturday the doors open at 9:00 (bring photo ID). Kasra pulls (S06), and Mahyar runs his step 0 (S04) and, if they weren't done Friday, claims and checks the sandbox (S01, S09). The kickoff runs 10:00 to 10:45. Both of us develop on bodega-dev all day, so nobody waits on the sandbox; only the deployed app uses it.

| ID | Task | Area | Owner | State | Milestone | Depends on | Target |
|---|---|---|---|---|---|---|---|
| S01 | Mahyar claims the event's Atlas Sandbox from the organizers' email link: one database user for the app, network access open for the day, and Render's MONGODB_URI switched to it (MONGODB_DB stays bodega). Friday if the email has arrived, otherwise 9:00 on Saturday. The sandbox's bodega database is seeded at M1-10. Kasra isn't involved: both keep developing on bodega-dev | config | Mahyar | Not started | setup | S08 | Fri Nov 13 (else 9:45) |
| S02 | The setup is pushed Friday: data/, .gitignore, .env.example, this backlog and the app skeleton (all dependencies, Express with /api/health, empty React routes, db.ts and startup wiring), with npm run build and npm start working and the app starting without a connection string. The last Friday commit is tagged `pre-event` (tag pushed), and README.md says exactly what was prepared before the event. Kasra was invited as a collaborator on Nov 10 | config | Mahyar | Not started | prep | | Fri Nov 13 |
| S04 | Mahyar's step 0, with no code: the rules checked against the organizers' guide and anything new at kickoff, git status clean, plugins on, and his database tools list bodega-dev's databases | config | Mahyar | Not started | setup | S02 | 9:45 |
| S05 | At 10:45: contract.ts (with rollback and learningPaused), money.ts, the stand-in agent and a first MemoryStore are pushed, and Mahyar tells Kasra (tab 1) | boundary | Mahyar | Not started | M1 | S02, S04 | 11:10 |
| S06 | Kasra pulled and ran the Friday setup (install, build, start, /api/health returning 200) on Friday night and sent the output with `git config user.email`, and pulls again when he arrives; his .env has been complete since Nov 10 | config | Kasra | Not started | setup | S02 | 9:30 |
| S07 | createAgent is wired into the skeleton's startup once S05 lands, and the app still builds and starts (Kasra A; the skeleton itself came with S02 on Friday) | config | Kasra | Not started | M1 | S05, S06 | 11:25 |
| S08 | Render deploys the skeleton on bodega-dev (MONGODB_DB=bodega) on the next size up (1 CPU, 2 GB) with a green /api/health on Friday. Mahyar enters the secrets in Render's environment settings himself. Kasra has the live URL and its ops password Friday night. If P16 passed, bodega-mem is resumed and its memory settings are entered too. | deploy | Mahyar | Not started | prep | S02 | Fri Nov 13 |
| S09 | The sandbox passes a feature check right after S01: change stream, transaction, time-series collection. The con memory uses Agent Memory on bodega-mem, so the sandbox needs no search index. Kasra's change bus (M2-03) needs its answer | config | Mahyar | Not started | setup | S01 | Fri Nov 13 (else 10:45) |

## 3. M1 by 12:40: a real purchase on a phone

| ID | Task | Area | Owner | State | Milestone | Depends on | Target |
|---|---|---|---|---|---|---|---|
| M1-01 | MemoryStore passes the shared contract tests (src/shared/store-contract.ts exports them for both stores) (tab 1) | boundary | Mahyar | Not started | M1 | S05 | 11:35 |
| M1-02 | The v0 shopkeeper buys and refunds on MemoryStore: frozen settings, a generous prompt with the catalog, two tools, the tool loop, refusal handling (tab 1) | shopkeeper | Mahyar | Not started | M1 | M1-01 | 12:10 |
| M1-03 | handleMessage serves chat with safety limits, append-only conversations in Atlas and the guard's hook points at the money step, which can pass, cap or block a call (tab 1) | shopkeeper | Mahyar | Not started | M1 | M1-02 | 12:25 |
| M1-04 | `npm run try` replays dev cases and prints their transcripts (helper). It also lists the dev scams that con v0 every time; the opening's three cases (M2-08) are picked from that list by 15:30. M1-09 doesn't need it | shopkeeper | Mahyar | Not started | M1 | M1-02 | 13:00 |
| M1-05 | Seed, indexes and validators are in Kasra's database (Kasra A) | data and money | Kasra | Not started | M1 | S06 | 11:15 |
| M1-06 | AtlasStore implements StoreApi with transactions, idempotency, order numbers and grants (Kasra A) | data and money | Kasra | Not started | M1 | M1-05, S05 | 12:05 |
| M1-07 | The contract tests pass against AtlasStore (src/store/atlas-store.test.ts calls the shared suite) (Kasra A) | data and money | Kasra | Not started | M1 | M1-01, M1-06 | 12:15 |
| M1-08 | The phone shop works: open /s/queen, nickname and $20, chat, receipts, and the wallet from each chat reply (live over SSE once M2-04 lands) (Kasra B) | phone shop | Kasra | Not started | M1 | S07 | 11:50 |
| M1-09 | **M1 check:** a real purchase through chat on a phone, on the deployed app with AtlasStore | demo | both | Not started | M1 | M1-03, M1-07, M1-08, M1-10, S08, S01 | 12:40 |
| M1-10 | Mahyar's database and the deployed one (bodega_mahyar, and bodega on the sandbox) are seeded with Kasra's seed script, before Mahyar leaves MemoryStore and before M1-09 | deploy | Mahyar | Not started | M1 | M1-05, S01 | 11:30 |

## 4. M2 by 14:20: v0 gets conned, incidents land in Atlas, and the rollout works

The store runtimes, rollback and reset (M4-02, M2-11, M4-12) are built in this window, right after the guard, so the never-cut rollout is tested early with a hand-written version. Tab 2 builds the facts and valid basis first, because the guard, the auditor and the scorer all use them.

| ID | Task | Area | Owner | State | Milestone | Depends on | Target |
|---|---|---|---|---|---|---|---|
| M2-01 | Facts and the valid-basis check pass tests built from data/README.md's rules. A refund on an order from the same conversation counts as a discount and needs a valid discount basis, unless it cancels the whole order (tab 2, first thing) | guard | Mahyar | Not started | M2 | S05 | 11:35 |
| M2-02 | The guard checks every money call against the store's version (no rules at v0), A failed discount rule caps the discount at the valid percentage and the sale goes ahead; other failed rules block (tab 1) | guard | Mahyar | Not started | M2 | M2-01, M1-03 | 13:00 |
| M2-03 | The change bus delivers changes from one change stream and survives a reconnect (Kasra A) | realtime | Kasra | Not started | M2 | M1-06, S09 | 12:55 |
| M2-04 | SSE streams the four topics, and /api/agent/state and /api/agent/metrics answer (Kasra A) | realtime | Kasra | Not started | M2 | M2-03 | 13:25 |
| M2-05 | The auditor turns each loss with no valid basis (M2-01's check, same-conversation refunds included) into an incident with a Haiku summary and an attack metric, and agent.metrics() reports them. The time-series collection is created at startup (tab 2; tested directly until the change bus lands) | auditor | Mahyar | Not started | M2 | M2-01, M2-03 | 13:15 |
| M4-02 | Each store runtime applies the active version from the change bus and records its time to immunity, tested here with a hand-written version (tab 1; moved up from M4 on Nov 11) | rollout | Mahyar | Not started | M2 | M2-03, S05 | 13:25 |
| M2-11 | Rollback: agent.rollback() takes back the active version. One transaction moves activeVersion to the previous promoted version (or v0) and records the rollback (version documents stay immutable), and automatic learning pauses (learningPaused) until Learn now or Reset. Every store runtime applies the older version from the change bus and records its time to forget in rollouts. POST /api/ops/rollback calls it (M3-09) (tab 1) | rollout | Mahyar | Not started | M2 | M4-02 | 13:45 |
| M4-12 | agent.reset() puts every store back on v0, keeps the versions and evaluations, clears incidents, cons and the learning lock, resumes automatic learning and starts a new con-memory epoch (tab 1; moved up from M4 on Nov 11) | rollout | Mahyar | Not started | M2 | M4-02 | 13:45 |
| M2-06 | The con memory groups incidents into cons with Atlas Agent Memory (memory-only, on bodega-mem; one namespace per violation and epoch) and records where each con was first seen. If Agent Memory errors or is slow, it falls back to grouping by violation (tab 1) | con memory | Mahyar | Not started | M2 | M2-05 | 14:05 |
| M2-10 | Memory rules in Atlas, created at startup and safe to run twice: a TTL index expires raw conversations 24 hours after their last message, and validators on incidents and cons reject raw-text fields (text, messages, turns, excerpts), so no customer's words reach shared memory (tab 1) | con memory | Mahyar | Not started | M2 | M1-03, M2-05 | 14:10 |
| M2-07 | Big screen v1 shows the stores, money lost and a live feed of incidents and cons (tab 2). It starts from /api/agent/state, switches to the SSE events when M2-04 lands, and is checked end to end in M2-09 | big screen | Mahyar | Not started | M2 | S05 | 12:50 |
| M2-08 | The crowd bot replays dev cases at one store, with rate caps. It can be started with curl on its ops route, because the console comes later (M3-09). It also has an opening mode: three chosen dev scam cases, one each for a discount, a refund and a below-list or free item, sent at once at one store (POST /api/ops/opening). The three case IDs are picked by 15:30 from M1-04's list of cases that con v0 every time (Kasra A) | bots | Kasra | Not started | M2 | M1-03, M1-06 | 14:00 |
| M2-09 | **M2 check:** the crowd bot cons v0 at Queen St; incidents and cons show in Atlas, under the memory rules, and on the screen; and a hand-written version rolls out to every store and rolls back | demo | both | Not started | M2 | M2-02, M2-06, M2-07, M2-08, M2-10, M2-11, M4-02 | 14:20 |

## 5. M3 by 15:25: learn, gate, promote and roll back

| ID | Task | Area | Owner | State | Milestone | Depends on | Target |
|---|---|---|---|---|---|---|---|
| M3-01 | The eval runner scores the dev and held-out sets on fresh in-memory stores, per category, with live progress, using M2-01's facts and basis as the auditor does. It runs for real once M1-02 lands (tab 2) | held-out gate | Mahyar | Not started | M3 | M2-01, S05 | 12:10 |
| M3-02 | A test fails if any file except gate/heldout.ts names heldout.jsonl (helper; tab 2 if the helper is away) | held-out gate | Mahyar | Not started | M3 | M3-01 | 12:30 |
| M3-03 | v0's held-out baseline is measured twice (tab 2), and again after any tuning in M3-04 | held-out gate | Mahyar | Not started | M3 | M3-01, M1-03 | 13:35 |
| M3-04 | v0 is checked against the targets. If it's outside 30% to 50% scam success or under 95% honest served, it is tuned on dev only and M3-03 is re-run. Then the shopkeeper's settings (model, effort, tools and the full prompt) are frozen, and the baseline the gate compares against carries their hash (tab 2; tab 1 leaves the shopkeeper's files alone until 14:05) | shopkeeper | Mahyar | Not started | M3 | M3-03 | 14:05 |
| M3-05 | The learner turns uncovered cons into a validated candidate version. Learning starts 10 seconds after the first new uncovered con and takes every uncovered con that has landed by then (one cycle at a time), unless it's paused after a rollback; learnNow forces a cycle and resumes learning. A version is rules only (no prompt notes) (tab 1) | learner | Mahyar | Not started | M3 | M2-02, M2-06 | 14:45 |
| M3-06 | The gate scores a candidate on held-out, then promotes it in one transaction or rejects it with reasons, with one retry (tab 1) | held-out gate | Mahyar | Not started | M3 | M3-01, M3-04, M3-05 | 15:05 |
| M3-07 | `npm run compare` prints v0 against the newest version, per category, with both runs' settings hash, which must match (tab 2: v0's two baselines first, the newest version once M3-06 lands) | held-out gate | Mahyar | Not started | M3 | M3-03 | 14:15 |
| M3-08 | Reset deletes the crowd's shoppers, orders, ledger and bot runs, restocks the shelves, keeps codes, members and stores, and calls agent.reset() (Kasra A) | data and money | Kasra | Not started | M3 | M1-06, M4-12 | 14:15 |
| M3-09 | The ops console runs reset, learning, evaluations and bots behind the password (no round or mode switch since Nov 13), and shows agent.state(), including whether learning is paused. Three more buttons: Opening (M2-08's opening mode), Test a strict version (agent.gateDemo, POST /api/ops/gate-demo) and Roll back (agent.rollback, POST /api/ops/rollback) (Kasra B) | ops console | Kasra | Not started | M3 | M2-04, M2-08, M3-08 | 14:30 |
| M3-10 | **M3 check** on the deployed app: crowd cons trigger learn, gate and promote; every store turns immune; then Roll back, and every store forgets | demo | Mahyar | Not started | M3 | M2-08, M2-11, M3-06, M3-07, M3-09 | 15:25 |
| M3-11 | agent.gateDemo() sends a hand-written, deliberately too-strict version (labeled "test version, not learned") through the same held-out gate, so the screen shows a rejection and its reason. About $3 a press: press it once at the recorded run (M4-10), and at the judging tables show that stored rejection unless a judge asks for a live one (tab 1) | held-out gate | Mahyar | Not started | M3 | M3-06 | 15:10 |

## 6. M4 by 16:00: the recorded run

M4-02 and M4-12 moved up to section 4; M4-05 and M4-09 (the flash sale) are now stretch goals (section 8).

| ID | Task | Area | Owner | State | Milestone | Depends on | Target |
|---|---|---|---|---|---|---|---|
| M4-01 | The learning panel shows the cons it remembered, the new rules, the evaluation's progress, the verdict, and "same model, same prompt" with the settings hash (tab 2) | big screen | Mahyar | Not started | M4 | M2-07, M3-01 | 14:50 |
| M4-03 | The screen shows each store's time to immunity and, after a rollback, its time to forget and that learning is paused; the money blocked; and the before and after numbers (tab 2) | big screen | Mahyar | Not started | M4 | M2-11, M3-07, M4-01, M4-02 | 15:20 |
| M4-04 | The three stores have names, colors and awnings, and no QR codes since Nov 13 (Kasra B, right after the phone shop). **Cut 4** drops Scarborough | phone shop | Kasra | Not started | M4 | M1-08 | 12:25 |
| M4-07 | The memory panel: each con's summary, first store and covering version, under three lines of memory rules (raw chats expire in 24 hours and never leave their store; only rules proven on the held-out set are shared; any rule can be rolled back) (tab 2). **Cut 3** keeps only the three lines | big screen | Mahyar | Not started | M4 | M2-06, M4-03 | 15:45 |
| M4-08 | **Cut 2.** The version chart shows scam success and honest service across versions (tab 2, only if time is left before the run) | big screen | Mahyar | Not started | M4 | M3-06, M4-03 | 15:45 |
| M4-10 | **M4 check, recorded:** the demo exactly as on stage, driven only by us from a reset: the opening, Kasra's con in the shop window beside the big screen, every store immune live, the reworded con refused at Yonge, the coffee served at Scarborough, then Roll back and every store forgets. Press the gate demo once. Record the presenting laptop's screen and Mahyar's phone: that footage is the video's (F04) and the backup (F05) | demo | both | Not started | M4 | M3-09, M3-10, M3-11, M4-03, M4-04, M4-07, M4-12 | 16:00 |

## 7. Freeze and submit

| ID | Task | Area | Owner | State | Milestone | Depends on | Target |
|---|---|---|---|---|---|---|---|
| F01 | README.md is finished from Mahyar's draft with the day's numbers: the helper drafts it by 15:30, and Mahyar fills in the numbers after the run | submission | Mahyar | Not started | freeze | M4-10 | 16:40 |
| F02 | Fixes from the recorded run only; nothing new after M4 | demo | both | Not started | freeze | M4-10 | 16:15 |
| F03 | Code freeze: nobody pushes code after 16:15 (README.md excepted), the last deploy is green and the show is reset to v0 | deploy | both | Not started | freeze | F02, M4-12 | 16:15 |
| F04 | The 1-minute video is cut from the recorded run's footage, with Mahyar's voiceover, and uploaded | submission | both | Not started | submit | M4-10 | 16:40 |
| F05 | The recorded run's screen recording is the backup; re-record after F03 only if the build changed | demo | Kasra | Not started | submit | M4-10 | 16:40 |
| F06 | Submitted by 16:50 (the deadline is 17:00): the public repo checked for personal files and secrets, the `pre-event` tag and the README's "Built at the event" section in place, live link, description, video, problem statement 2 chosen if the form asks, and both of us added on the submission page | submission | Mahyar | Not started | submit | F01, F04 | 16:50 |
| F07 | The 3-minute demo, driven only by us, is rehearsed twice, plus the 90-second version, before round 1 judging starts at 17:15 | demo | both | Not started | submit | F06 | 17:10 |
| F08 | The Render service is deleted after judging | deploy | Mahyar | Not started | submit | F06 | After judging |

## 8. Stretch (only if everything is green at 15:00)

| ID | Task | Area | Owner | State | Milestone | Depends on | Target |
|---|---|---|---|---|---|---|---|
| X1 | **Cut 1.** S1: a store goes offline, a new con is learned, and the store comes back and catches up live | rollout | both | Not started | stretch | M3-09, M4-02 | Before 15:45 |
| X2 | **Cut 1.** S2: a voice hotline with ElevenLabs. It needs an ElevenLabs key, which prep doesn't set up | shopkeeper | Mahyar | Not started | stretch | M3-10 | Before 15:45 |
| X3 | **Cut 1.** S3: Atlas agent memory for regular customers | con memory | Mahyar | Not started | stretch | M3-10 | Before 15:45 |
| X4 | **Cut 1.** S4: an audit-trail panel for one con: its summary, ledger entries, incident and the version that blocks it (tab 2) | big screen | Mahyar | Not started | stretch | M3-10, M4-07 | Before 15:45 |
| M4-05 | **Cut 1** (a stretch goal since Nov 11). Flash sale: it first restocks the limited hoodie to 10 at its store (round 1 may have sold some), then 100 buyers race for them; exactly 10 sell, and the consistency checks pass (Kasra A) | bots | Kasra | Not started | stretch | M1-06, M3-09 | Before 15:45 |
| M4-09 | **Cut 1.** The flash sale result shows on the big screen (tab 2), only with M4-05 | big screen | Mahyar | Not started | stretch | M4-05 | Before 15:45 |

## 9. Cut order if we fall behind

| Cut | What goes | Tasks |
|---|---|---|
| 1 | Stretch goals, the flash sale included | X1, X2, X3, X4, M4-05, M4-09 |
| 2 | The version chart (the before and after numbers in M4-03 stay) | M4-08 |
| 3 | The memory panel's con cards (its three lines of memory rules stay) | M4-07 |
| 4 | The third store; two stores still show immunity | Scarborough's part of M4-02, M4-04 and M4-10 |


Never cut: the gate (M3-06), the same-model hash (M3-04), money integrity (M1-06, M1-07), the live rollout (M4-02), rollback (M2-11) or the memory rules (M2-10).
