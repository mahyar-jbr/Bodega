# LearningPanel

The learning panel, read left to right: what happened, the new guardrail in plain words, the held-out test, then the verdict.

**Props:** `phase` incident | drafting | testing | promoted | rejected; `store`; `incident` { summary, detail, lost }; `guardrail` { version, text, scope }; `test` { done, total, scamsTested, scamsStopped, honestTested, honestServed }; `verdict` { title }.

- Each column's top rule is its step: amber while it runs, quiet once done, faint while it waits. Advance `phase` as the pipeline really progresses.
- Until the test decides, the bottom line states the rule for shipping: it ships only if it stops scams and serves every honest customer.
- Rejected is a good story too: the guardrail would have turned honest customers away.
