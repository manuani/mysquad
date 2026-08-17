# Product Backlog

Work that is wanted but deliberately not built yet, with enough context to pick
up cold. Distinct from `handoff/VERIFICATION_BACKLOG.md`, which tracks gaps
between the implementation and System Architecture v2.

Each item records what it is, why it came up, and what is already known — the
last part matters most, because most of these were learned by watching real
meetings rather than reasoned about in advance.

---

## 1 — Configurable agent personality

**Status:** Backlog · **Raised:** 2026-08-17, from live testing

Let the founder shape how each agent behaves, rather than shipping one fixed
disposition per persona.

### Why

Marcus was originally a Devil's Advocate, and the role name alone drove the
behaviour: with "probing and a little disagreeable" as his tone and "open with
the specific assumption you're challenging" as his style, every reply began with
an objection. The founder's words: *"I do not want them to be a devil's advocate
all the time. They need to analyze and take devil's advocate as needed after
explaining their position. Otherwise it won't be a pleasant conversation."*

That was fixed by rewriting him as Chief of Staff, but the fix is a constant. A
founder in a fundraise wants harder scrutiny than one exploring an idea, and
different founders want different amounts of it from the same person.

### What is already known

The dials that visibly change behaviour, all found by testing:

| Dial | Observed effect |
| --- | --- |
| Challenge posture | Adversarial-by-default made every turn open with an objection; the same persona with challenge made conditional produced a position first, then a reservation only when it changed the decision |
| Reply length | The voice-mode target is under 60 words. Advisors land near 100 in practice; without a cap they wrote 250-word memos and read them aloud |
| Question budget | Two advisors each asking a question turns a meeting into an interview. Currently capped at one per turn across the roster |
| Formality | Untested. Likely matters for whether "Hey! Good to see you" reads as warm or flippant |

Where the wiring already exists:

- `services/agent-runtime/src/team-charter.ts` — shared behaviour across the
  roster. Most personality dials belong here rather than per-persona, since
  they govern how the team works together.
- `services/agent-runtime/src/personas/*.ts` — who each member is. The `role`
  string is load-bearing: it feeds the relevance gate as well as the prompt, so
  changing it changes both what an agent says and when they speak at all.
- `assembleSystemPrompt()` in `agent-runtime.ts` already layers situational
  guidance (voice vs typed, greeting vs work, brief present) onto the persona.
  Personality settings would layer the same way.

### Open questions

- **Per tenant, per meeting, or per persona?** A fundraise meeting and a
  brainstorm want different postures from the same team, which argues for
  per-meeting — the meeting brief is already session-scoped and could carry it.
- **Presets or free text?** Named settings ("challenge: light / balanced /
  hard") are testable and predictable. Free-text instructions are more
  expressive and much harder to keep coherent across three agents.
- **Founder-visible or admin-only?** Architecture §2.5 is explicit that the
  founder experience must not surface internal complexity — "it rules out
  designs that surface internal complexity: dropdowns to choose models,
  settings to tune routing weights". A personality slider is closer to product
  than to plumbing, but the same principle deserves a decision rather than an
  assumption.
- **Does the Performance Service learn this instead?** §5.6 already describes
  reclassification from outcome data. Inferring that a founder mutes an agent
  who pushes hard may beat asking them to configure it.

### Worth knowing before starting

Persona behaviour is not reliably steerable by instruction alone. "Do not end on
a question" was followed literally — the agent asked its question mid-paragraph
instead. Expect to verify each setting against real generations rather than
trusting the prompt to hold, and to enforce what can be enforced structurally
(token ceilings, speaker caps) rather than by asking.

---

## Known loose ends

Smaller items surfaced while building, recorded so they are not lost. None are
blocking.

- **Metering writes fail silently.** `invalid input syntax for type uuid` in the
  api-server log on every roster call — the session token is passed where a UUID
  column is expected. Caught and non-blocking, so nothing breaks, but usage
  events are not being recorded. Matters before billing does.
- **LiveKit ingress is dead weight locally.** Every advisor reply creates an
  ingress and registers a serve route that LiveKit Cloud cannot fetch from
  localhost (ADR 013). Harmless since the crash fix, but it is wasted work per
  turn — worth skipping when `selfBaseUrl` is not publicly reachable.
- **No process supervision.** A crash in api-server or media-coordinator means a
  manual restart, and an in-flight meeting simply dies. A `.claude/launch.json`
  or equivalent would restore them automatically.
- **Sessions expire after 24 hours with no refresh.** Fine for production,
  irritating while testing daily — the founder hits an expired session every
  morning.
- **Advisors converge.** Even with the charter, two agents often reach for the
  same point from different angles. Improved but not solved; likely wants
  explicit lane assignment per turn rather than more prompt instruction.
