# @voai/admin-web

Web app for the operations team. Separate codebase from the founder app, shared
design system. Authenticates against the same identity provider but with the
admin user_type (per System Architecture v2 §6.1).

## Status

**Not yet scaffolded.** Sprint 7.1.1 (Admin app skeleton) populates this
directory.

## When this is built

Phase 7 — Admin Console (overlaps with later phases of build work as the team
scales).

## Permission model

Three role groups, any combination (per System Architecture v2 §6.2):

- Operations — agent management, marketplace management, pricing setup, content
  moderation.
- Customer Success — founder support, consent-gated meeting/brain/ledger
  access, billing actions.
- Trust & Safety — content moderation, complaint handling, expert and agent
  suspension.

The backing API for this app is `@voai/admin-console-api`.
