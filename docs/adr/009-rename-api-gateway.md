# ADR 009: Rename apps/api-gateway to apps/api-server

- Status: Accepted
- Date: 2026-06-26
- Deciders: lead engineer (pending sign-off)

## Context

`docs/handoff/VERIFICATION_BACKLOG.md` Issue 2: System Architecture §3.1
names "Edge gateway" as a component — TLS termination, rate limiting,
request routing, WebRTC signalling negotiation. That is infrastructure
(CDN, load balancer, WAF), not an application module. The skeleton's
`apps/api-gateway` is the API server pool from §3.7 — the modular-monolith
boot process that registers all service modules — not the edge gateway.
The shared word "gateway" invited exactly the confusion the backlog
flagged: a reader skimming `services/` and `apps/` would reasonably guess
`api-gateway` implements the §3.1 edge gateway, when it implements the
§3.7 API server pool instead.

## Options considered

### Option A — Rename `apps/api-gateway` to `apps/api-server`

Matches the §3.7 term exactly. Add `infra/edge-gateway/` for the
load-balancer/WAF config when Sprint 1.1.3 lands, so the two concepts
each have an unambiguous home.

### Option B — Keep the name, add a clarifying README note

Cheaper, but leaves the misleading name in place for every future reader
who doesn't read the README first — including future Claude Code
sessions reading directory listings before opening any file.

## Decision

**Option A.** `apps/api-gateway` is renamed to `apps/api-server`:
workspace name `@voai/api-server`, package description and module-level
comment in `src/index.ts` both state explicitly that this is the §3.7 API
server pool and not the §3.1 Edge Gateway. `infra/edge-gateway/` is left
for Sprint 1.1.3 to populate — not created now, since there is no content
for it yet at the skeleton stage.

## Rationale

The backlog's own framing settles this: Option A is "more honest and
avoids the term collision." A renamed-now fix costs one mechanical rename
across a handful of references; a renamed-later fix costs the same
mechanical rename plus however much code by then imports or documents the
old name.

## Consequences

- Directory: `apps/api-gateway/` → `apps/api-server/`.
- Workspace name: `@voai/api-gateway` → `@voai/api-server`.
- `tsconfig.json` (root) and any package depending on this workspace
  updated to the new path/name.
- `README.md` and `CLAUDE.md` path and prose references updated.
- Historical documents (ADRs 001/003/005, `docs/handoff/*`) are left
  using "api-gateway" where they describe decisions made under that name
  at the time — they are a record of what was true when written, not a
  live reference. Readers following a literal path from those documents
  should treat `apps/api-gateway` as `apps/api-server` post-rename.

## Revisit triggers

- If Sprint 1.1.3 introduces `infra/edge-gateway/` and a naming clash
  resurfaces in a different form (unlikely — the two now live in
  different top-level directories with different artifact types: an app
  workspace vs. infrastructure config).
