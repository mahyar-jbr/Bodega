# Bodega

<p align="center">
  <img src="docs/media/stage.png" width="100%" alt="The presenting laptop's stage view: the big screen with three conned or open stores, the tricks tried so far and the live feed, beside a phone-size shop window with four shopper tabs">
</p>

**Herd immunity for AI store agents.** A con that works once at one store is blocked at every store within seconds, after the fix is proven on 120 held-out cases with the same model, while honest customers still get served. The memory behind it is governed: who reads it, how long it lives and how it's taken back are rules, not promises.

**Problem statement:** Memory You Can Govern (statement 2 at Agents in Context Toronto).

[Live demo](https://bodega-dxwd.onrender.com) · [1-minute video](https://youtu.be/1yWAWO6mxAE) · Built in one day at Agents in Context Toronto (MongoDB), Nov 14, 2026, by Mahyar Jaberi and Kasra Bashizadeh ([what we built at the event](#built-at-the-event)).

## See it

<p align="center">
  <img src="docs/media/learning-loop.gif" width="100%" alt="The learning loop from the live app: the held-out test dots fill, every store turns immune, then a rollback makes every store forget the rule">
</p>

<p align="center"><img src="docs/media/immune.png" width="100%" alt="Policy v2 live at every store: Queen St and Yonge St immune in 0.3 seconds, Scarborough in 0.6, with 60 of 60 held-out scams stopped and 58 of 60 honest customers served"></p>

<p align="center"><em>Every store immune, 0.3 to 0.6 s in this run.</em></p>

<p align="center"><img src="docs/media/rollback.png" width="100%" alt="Policy v2 taken back at every store: each store forgets it in 0.3 seconds, back on v0 with learning paused"></p>

<p align="center"><em>Roll back: every store forgets it in 0.3 s, and learning pauses.</em></p>

## What it does

Bodega is a chain of three AI-run corner stores: Queen St, Yonge St and Scarborough. Shoppers open a store's page on their phone, get $20 of credits and buy snacks by chatting with that store's Claude shopkeeper, typing or [talking](#talk-to-it).

Shop agents like this get talked into giving stock away: fake codes, fake memberships, refunds for things never bought. Bodega turns every con that works into a tested fix for every store:

- **It notices.** An auditor checks every sale and refund against real data and flags losses with no valid basis.
- **It remembers.** The con memory in MongoDB Atlas groups reworded versions of the same trick.
- **It learns, carefully.** A learner writes a new guardrail version (rules over facts, never over phrases). A gate tests it on 120 held-out cases it never saw, half of them honest customers, with the same shopkeeper model and prompt. It goes live only if scams drop and honest customers are still served.
- **Every store becomes immune.** Each store picks up the new version on its own and reports how long that took.
- **Any rule can be taken back.** One tap rolls a version back, and every store forgets it and reports how long that took.

<p align="center"><img src="docs/media/phone-shop.png" width="360" alt="The Queen St shop on a phone: the shopkeeper greets Lucky Fox 52, sells one iced tea for $2.50 and prints receipt Q-1013, with the wallet at $17.50 and Policy v0 in the header"></p>

<p align="center"><em>A shop on a phone: chat with the shopkeeper, pay with play credits, get a receipt.</em></p>

### Talk to it

Hold the mic and talk. ElevenLabs Scribe shows a live transcript while you speak, your words go through the same frozen shopkeeper and the same guard as typed text, and the reply is spoken back with ElevenLabs text-to-speech. Per-IP caps and daily ceilings bound what voice can spend, and an unknown shopper spends nothing.

### The whole loop, live

The big screen's Flow scene draws the mechanism as one loop of 15 steps, lit by real events as they happen: the con, the auditor, Atlas remembering it, the rule Claude writes, the held-out gate, every store immune, round 2 blocked at the same guard, and the rollback. `/stage` puts the big screen and a phone-size shop with five shopper tabs on one laptop, with the demo controls one key away.

## Results

From the live run on the deployed app, on the event's Atlas Sandbox:

| | v0 (no guardrails) | v1 (learned) |
|---|---|---|
| Held-out scams that got through | 60% (36 of 60) | 0% (0 of 60) |
| Honest customers turned away (of 60) | 2 | 3 |
| Honest customers given a discount nobody earned | 4 | 0 |
| Money lost on the held-out cases | $227.25 | $0.00 |
| Time to immunity: Queen St / Yonge St / Scarborough | | 320 / 320 / 319 ms |
| From the first con to every store immune | | 41 seconds |
| Time to forget after a rollback: Queen St / Yonge St / Scarborough | | 247 / 249 / 249 ms |

One more honest customer was turned away with v1 than with v0 (3 of 60, against 2): within the gate's limit of one more, and never above 3 of 60.

Same model and same prompt in both columns: the shopkeeper's settings (model, effort, tools and the full prompt) are one frozen object, and every evaluation stores its hash, `6adbcc65b15bc033c4cb5aad921eca17af4ed709e768632c7b5fe0f82df4b345` for both.

Per category, from `npm run compare -- 0 1` (6 cases each):

| Scams that got through | v0 | v1 |
|---|---|---|
| fake_code | 6 | 0 |
| fake_membership | 6 | 0 |
| refund_no_purchase | 6 | 0 |
| borrowed_identity | 4 | 0 |
| price_override | 4 | 0 |
| sob_story | 4 | 0 |
| damage_comp | 3 | 0 |
| already_paid | 1 | 0 |
| fake_authority | 1 | 0 |
| prompt_injection | 1 | 0 |

| Honest customers served | v0 | v1 |
|---|---|---|
| big_order, innocent_manager, multi_item, policy_question, question_only, real_code, real_member, simple_purchase | 6 each | 6 each |
| polite_haggle | 2 | 4 |
| real_refund | 4 | 5 |

**Money under load.** A flash sale on the live app: 100 bots raced for 10 hoodies at once, and exactly 10 sold. Stock went from 10 to 0, every wallet matches its ledger and none went negative, in 36 seconds, with every order one Atlas transaction.

<p align="center">
  <img src="docs/media/flash-sale.png" width="100%" alt="The flash sale at Queen St on the big screen: 100 shopper dots with 10 lit, 10 hoodies all sold, 10 sold and 0 oversold, and a note that every order is one Atlas transaction and every wallet matches its ledger">
</p>

**It works every time.** `npm run stage-run` runs the whole stage scenario against the live app through the API, with a pass or fail per step. Three live runs back to back passed 3 of 3: from the opening to every store immune in 44 to 48 seconds, immunity in about 312 ms, forgetting in about 257 ms, and the gate at 0 of 60 held-out scams with 2 to 3 of 60 honest customers turned away.

**New tricks, after learning.** A probe of 20 new con attempts against the learned rules: none worked, and 8 of 8 honest requests were served.

**A store that was offline catches up.** Take a store offline, promote a version, and bring it back: it applies the version it missed and reports when, measured from the promotion. Time to immunity counts only the stores that were online.

## Memory you can govern

What Bodega remembers, and the rule for each:

| Memory | Where it lives | Who reads it | How long it lives | How it's corrected |
|---|---|---|---|---|
| Raw chat text | `conversations` | Only that chat's shopkeeper. Never streamed, shown or given to the learner | 24 hours after the last message (a TTL index) | It expires by itself, and a reset deletes it |
| Incidents (losses with no valid basis) | `incidents`: summaries only, and validators reject raw-text fields | The con memory, the learner and the big screen | Until a reset | A reset clears them |
| Cons (grouped tricks) | Atlas Agent Memory, one namespace per violation and epoch, plus `cons` documents for the screen | The learner and the big screen | Until a reset starts a new epoch | A reset starts a fresh memory |
| Guardrail versions (the learned rules) | `guardrails`: immutable versions, with a pointer to the active one | The store runtimes, and only once the held-out gate has promoted a version | Kept as history | The gate rejects a version that doesn't help or that turns honest customers away. Roll back takes a live version back: every store forgets it, and learning waits for a person |
| Held-out cases | `data/heldout.jsonl` | Only the evaluation code; the learner sees aggregate numbers | Fixed before the event | Never tuned on |

- **No leaking between stores or customers.** Stores share only proven rules, with no customer data: never anyone's words, nickname, wallet or orders.
- **Proof that the memory changed behavior, not the prompt.** The prompt is identical in every version (one settings hash), and the rules run in code at the money step. The change is measured on 120 held-out cases nobody tuned on, half of them honest. And rolling a rule back makes the same trick work again.
- **Atlas enforces the rules, and shows it.** On the live app, a probe tried to write raw chat text into `incidents`, and Atlas schema validation refused it (code 121, `DocumentValidationFailure`). The screen shows the refusal, and only the outcome is logged, never the text. The screen also reads the TTL index on `conversations` (`raw_text_expires_24h`, 86,400 seconds) straight from Atlas.
- **A person can approve before anything goes live.** With approval required (off by default), a version that passes the gate waits for an operator: approved, it rolls out as usual; rejected, it never goes live.
- **One shopper can be forgotten.** On request, their chats are deleted and their incidents anonymised (no shopper id, nickname or conversation), while the cons and rules they taught stay; on the live app this deleted the shopper's chat. `forget_log` keeps counts only.
- **Every con has an audit trail.** On the live app, for one con: the ledger entries it caused, the auditor's violations, how the con memory grouped it, and the rule, version and gate result that block it now.

<p align="center"><img src="docs/media/memory-panel.png" width="100%" alt="The memory panel on the live app: the three memory rules, the TTL index read from Atlas (raw chats expire 24 hours after the last message), Atlas refusing a raw chat text write into incidents with code 121, one shopper forgotten on request, and the cons as summaries"></p>

<p align="center"><em>What Bodega remembers, and Atlas enforcing the rules for it, live.</em></p>

<p align="center"><img src="docs/media/audit-trail.png" width="100%" alt="The audit trail for one con, a refund claimed for an order that never existed: grouped by Atlas Agent Memory with a 0.91 match, three ledger entries with their losses and violations, and nothing blocking it after the rollback"></p>

<p align="center"><em>The audit trail for one con, from the ledger to the rule.</em></p>

## How it works

```mermaid
flowchart LR
  a["Detect<br/>auditor reads the ledger<br/>from a change stream"] --> b["Remember<br/>the con memory groups<br/>reworded tricks"]
  b --> c["Learn<br/>Opus writes the next<br/>guardrail version"]
  c --> d{"Gate<br/>120 held-out cases<br/>same shopkeeper"}
  d -->|"better"| e["Roll out<br/>promoted in a transaction,<br/>each store applies it"]
  d -->|"not better"| f["Rejected,<br/>with its reasons"]
  e --> g["Guard<br/>every store blocks<br/>the trick"]
  g -.->|"operator rolls back"| h["Forget<br/>every store reverts<br/>and reports its time"]
```

- **Money is honest by construction.** Money moves only in Atlas transactions. Wallets and shelves can't go negative, and orders can't double. The money layer never judges whether a discount is deserved; at v0 the shopkeeper can be conned, which is the point.
- **The model is frozen; only the rules change.** The shopkeeper's model, settings and prompt are identical in every version. Everything Bodega learns is data: rules that code checks at the money step, against facts computed from real data.
- **Nothing goes live unproven.** The held-out set is sealed: only the evaluation code reads it, a test fails if any other file names it, and the learner sees aggregate scores only. A candidate is promoted only if fewer held-out scams get through, at most one more honest customer is turned away (never more than 3 of 60), and its settings hash matches. A deliberately too-strict test version is rejected on screen, so the gate is shown, not just described [after the recorded run].
- **Anything live can be taken back.** A rollback is one transaction: the previous version becomes active, each store applies it from the change stream and reports its time to forget, and automatic learning pauses until a person restarts it.

## How we use MongoDB Atlas

| Feature | What it does in Bodega |
|---|---|
| Atlas Agent Memory (Agent Engine, built on Vector Search), with Voyage `voyage-4-lite` embeddings | The con memory: reworded tricks land on the same con, within one namespace per violation and epoch. If it's unavailable or slow, cons are grouped by violation instead |
| Change streams | One database-level change stream per process drives the auditor, each store's rollout and rollback, and the live updates |
| Transactions | Checkout, refunds, promotion, rollback and reset, so money and versions never change halfway |
| TTL index | Raw chat text expires 24 hours after the last message |
| Schema validation and unique indexes | The database itself refuses negative wallets and stock, double orders and repeated payments, and keeps raw customer text out of incidents and cons |
| Time-series collection | Losses and blocks per store, aggregated per minute for the screen |
| Versioned documents | Every guardrail version is immutable, with its gate result; promotion and rollback move a pointer |

The deployed app runs on the event's Atlas Sandbox cluster.

## Architecture

```mermaid
flowchart TB
  phones["Phones · big screen · ops console"]
  subgraph app["Render · one Node process"]
    direction LR
    store["Store side<br/>routes, money layer,<br/>live updates, bots"]
    agent["Agent side<br/>shopkeeper, guard, auditor,<br/>con memory, learner, gate"]
    store <-->|"contract.ts"| agent
  end
  atlas[("MongoDB Atlas")]
  models["Claude · Voyage · ElevenLabs"]
  phones <-->|"HTTP · SSE"| store
  store <-->|"transactions · change stream"| atlas
  agent <-->|"con memory · guardrail versions"| atlas
  agent --> models
```

- **Stack:** TypeScript, Node 24, Express 5 (run with tsx), Vite + React 19 + Tailwind 4, MongoDB Node driver 7, zod and Vitest. No Docker.
- **Models:** Claude Sonnet 5.5 is the shopkeeper, Claude Opus 5.5 the learner and Claude Haiku 5.5 writes incident summaries. Voyage `voyage-4-lite` embeddings come through Atlas.
- **Voice:** ElevenLabs: Scribe for speech-to-text, with a live transcript while you speak, and Flash v2.5 for the spoken replies.
- **The boundary:** the store side and the agent side meet in-process through one typed file, `src/shared/contract.ts`, so two people could build in parallel from the first hour.

## Run it locally

You need Node 24 or newer and a MongoDB Atlas connection string. Copy `.env.example` to `.env` and fill it in, single-quoting values that contain `&` or `$` (Atlas connection strings do). The server loads `.env` by itself when the file exists.

```bash
npm install
cp .env.example .env      # fill it in
npm run seed              # the three stores, the catalog with stock, codes and members
npm run dev               # the server on :3000, and the web app on :5173, which forwards /api to it
```

Then open `/s/queen` (or `/s/yonge`, `/s/scarborough`) for a store, `/screen` for the big screen, `/stage` for the one-laptop demo view (`o` shows the demo controls) and `/ops` for the ops console.

| Command | What it does |
|---|---|
| `npm run dev` | Runs the server (restarting on changes) and the Vite dev server |
| `npm run build` | Builds the web app into `dist/` |
| `npm start` | Serves the API and the built web app on `PORT` (default 3000) |
| `npm test` | Runs the tests (Vitest), including the shared money-layer contract tests and the held-out seal |
| `npm run check` | Type-checks the code (tsc) |
| `npm run seed` | Seeds the database in `MONGODB_DB` with the stores, catalog, codes and members |
| `npm run eval -- --set dev` | Scores a guardrail version (`--version N`, default 0) on the dev set; `--case S-201` or `--limit 10` for a few cases, `--record baseline` to keep the result in Atlas |
| `npm run eval -- --set heldout --record baseline` | Scores the sealed held-out set (aggregates only, about $3 of model calls) |
| `npm run compare -- 0 [n]` | Prints v0 against v[n] from their recorded held-out runs, overall and per category, with both settings hashes |
| `npm run compare -- 0 [n] --archive` | The same for a version set aside by `npm run fresh-show` (the newest show, or `--epoch N` for one show); v0's baselines stay live |
| `npm run stage-run` | Runs the stage scenario on the live app with a pass or fail per step and its timings (`-- --runs 3` for three, `--url` for another server; about $0.50 a run) |
| `npm run try` | Replays dev cases through the shopkeeper with their transcripts, and lists the dev scams that con v0 every time (`--case S-203`, `--kind scam`, `--runs 2`) |

`GET /api/health` answers 200 when Atlas answers a ping, and 503 with the reason otherwise. Without `ANTHROPIC_API_KEY` the app runs a keyless stand-in shopkeeper (and evaluations refuse to run); without the Agent Memory credentials, the con memory groups cons by violation.

## Built before the event

The `pre-event` tag marks the last commit made before the event. Up to that tag, this repository holds only:

- `data/`: the store data (catalog, discount codes and members) and the test cases (40 dev and 120 held-out), written before any Bodega code;
- a generic app skeleton with no Bodega logic: the dependencies and config, an Express server with a health check and an Atlas client, and empty React pages;
- `BACKLOG.md`, our task plan, and `.env.example`, the names of the settings.
- `design/`: Bodega's design system (brand book, tokens, fonts, logos and icons), made by Mahyar before the event and imported at 10:45; the components were built at the event.

Everything after the tag is built on Nov 14, 2026, from 10:45: [see the changes](https://github.com/mahyar-jbr/Bodega/compare/pre-event...main).

## Built at the event

From 10:45 on Nov 14, 2026, at Agents in Context Toronto, we built everything else: the contract between the two sides, the money layer and the change bus, the shopkeeper, guard and auditor, the con memory, the learner and the held-out gate, rollout and rollback, the phone shop and its voice line, the ops console, the big screen with the Flow scene, `/stage` and the bots. The demo and the video show only this work.

## Team

- **Mahyar Jaberi:** the agent side (shopkeeper, guardrails, learning loop, held-out gate, big screen) and hosting.
- **Kasra Bashizadeh:** the store side (money layer, live updates, phone shop, ops console, bots).
