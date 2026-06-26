# Evaluation harness

The evaluation workspace, owned by the AI Quality Lead. Per ADR 001, this
workspace is intentionally insulated from the rest of the monorepo's build
and language choices — it can be Python, TypeScript, or whatever fits the
evaluation work best.

## Status

Placeholder at the skeleton stage. Populated starting in Sprint 5.2.2
(per-language test sets and quality floors) and Sprint 5.3.2 (weekly
evaluation cycle).

## What lands here

- Per-language test sets (English, Tamil, Hindi at v1).
- Six performance signal capture and aggregation: factual grounding, peer
  agreement, expert agreement, founder action, outcome, pushback.
- Weekly evaluation runner that the AI Quality Lead reviews.
- A/B testing infrastructure (v1.5+, per Platform Spec v2 §11.5).
