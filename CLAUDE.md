# CLAUDE.md

This file is the operating manual for Claude Code working in this repository. It
is read on every session. Keep it short, current, and actionable.

## What this project is

VirtualOffice AI — a multi-agent meeting platform for SME founders. The flagship
deliverable Claude Code is building. Founder is the product visionary; a real
engineering team productionizes Claude Code's output.

The architecture is a **modular monolith** in TypeScript: one Node process boots,
registers 11 service modules, serves all platform traffic. Scaling is by
replication, not module extraction.

## Reference documents

The canonical specs live in `docs/reference/`. Read the relevant section before
writing code that depends on it. Order of authority:

1. `System_Architecture.md` — the source of truth for components, data,
   isolation, deployment topology
2. `UX_Specification.md` — the source of truth for product surfaces and flows
3. `Sprint_Plan.md` — the deliverable breakdown driving the build
4. `Session_Operating_Manual.md` — how each work session should run
5. `Platform_Specification.md` — product capabilities and constraints
6. `Strategic_Vision.md` — the why; rarely needed for build decisions

If a decision needs information not in these documents, **flag it in your
response and propose the most defensible default with rationale**. Don't
silently guess.

## Architecture rules — non-negotiable

These are load-bearing and easy to violate by accident. Apply them on every PR.

### 1. Tenant isolation via explicit context parameters

System Architecture §8.1.1 mandates four defense layers, layer 2 of which says:
_"The context is propagated through async work via explicit context parameters;
no implicit globals."_

Concrete rules:

- **Every internal API takes `tenantId` as its first parameter.** §3.6 is
  explicit: "There is no overload that accepts a query without tenantId;
  cross-tenant queries are not expressible in the codebase."
- **Do not use AsyncLocalStorage** for tenant context. The current
  `@voai/auth-context` package uses it; this is a known violation tracked in
  `docs/handoff/VERIFICATION_BACKLOG.md` (Issue 5). When you touch that code,
  fix it — don't propagate the pattern.
- **Postgres connections set session-level `app.tenant_id` immediately on
  acquisition** (layer 3). The `@voai/db` PostgresClient API should expose a
  `withTenant(tenantId, fn)` pattern, not a raw `query` method. Tracked as
  Issue 6.
- **Every tenant-scoped table has row-level security** with
  `current_setting('app.tenant_id')::uuid` as the policy (layer 4).

### 2. Module boundaries are real

- Services in `services/*` communicate only through typed exports — never
  reach into another module's `src/` files.
- Module `package.json` files list explicit `@voai/*` dependencies. An
  unauthorized import shows up as a missing dependency at install time. This
  is intentional.
- New cross-module calls go through the typed service export of the target
  module or through the event bus (`@voai/events`), not direct imports of
  internal files.

### 3. The eleven components

Per System Architecture §3.1 the platform has eleven major components plus
client surfaces. `services/identity-and-tenancy` merges what was
originally split as two modules (Issue 1, resolved — see ADR 008). The
`services/*` directory now has eleven modules, one per component.

The full list: Identity-and-Tenancy, Edge Gateway (infra-level, not in
`services/`), Meeting Coordinator, Agent Runtime, Routing Service,
Performance Service, Brain Service, Ledger Service, Marketplace Service
(with Marketplace Metering sub-component), Notification Service, Admin
Console.

### 4. The five data stores

§4.1: Postgres (with pgvector), vector store (pgvector or Pinecone), Neo4j,
Redis, object store (S3/GCS). The current `@voai/db` is missing the object
store interface — Issue 3. When you wire databases in Sprint 1.1.2, all five
are first-class.

### 5. Deployment topology has five process types

§3.7: API server pool, background worker pool, media coordinator pool,
scheduled job runner, admin console. `apps/api-server` (renamed from
`apps/api-gateway` per ADR 009 — not the Edge Gateway from §3.1, which is
infra-level) has a real entrypoint. `apps/worker`, `apps/media-coordinator`,
and `apps/scheduler` are README-only placeholders (Issue 4, resolved) —
each gets a real entrypoint in the phase its README names. Admin console
is `apps/admin-web` plus `services/admin-console-api`, populated in Phase 7. Don't bundle worker logic into the API server — keep the separation.

## Conventions

- **Workspace names:** `@voai/<kebab-case>` (e.g. `@voai/agent-runtime`).
- **Files:** `kebab-case.ts` for modules, `kebab-case.test.ts` for tests.
- **TypeScript:** `camelCase` for variables and functions, `PascalCase` for
  types and classes, `SCREAMING_SNAKE_CASE` for top-level constants.
- **Database:** `snake_case` for tables and columns (matches §4 data model).
- **Routes:** `/v1/<module>/<resource>` (e.g. `/v1/meeting/sessions`).
- **Imports:** `import { thing } from '../foo.js'` — yes, `.js` even though
  the source is `.ts`. NodeNext module resolution requires it.

## Commands

Run from the repo root unless noted otherwise.

```bash
# First-time setup
nvm use                          # picks up .nvmrc → Node 20.11.0
npm install -g pnpm@9.12.0
pnpm install --frozen-lockfile

# Daily commands
pnpm run build                   # build all 20 packages and services
pnpm run typecheck               # tsc --noEmit across everything
pnpm run lint                    # eslint everything
pnpm run test                    # vitest run across all workspaces
pnpm run format                  # prettier --write everything

# Working on a single workspace
pnpm --filter @voai/meeting run build
pnpm --filter @voai/meeting run test

# Adding a dependency to a workspace
pnpm --filter @voai/meeting add zod
pnpm --filter @voai/meeting add -D @types/node
```

CI runs `pnpm run lint && pnpm run typecheck && pnpm run test`. Any PR
must pass all three locally before pushing.

## When you start a session

1. **Read the relevant reference doc section first.** If the user says
   "Sprint 1.1.2", open `Sprint_Plan.md` and find that section before
   writing code.
2. **Check `docs/handoff/VERIFICATION_BACKLOG.md`** for known gaps that
   might affect the current work.
3. **Check the relevant ADR** in `docs/adr/` for prior decisions on the
   topic. Don't relitigate without reason.
4. **State your plan in 2-4 sentences before starting tool calls.** Confirm
   the deliverable scope and call out anything ambiguous.

## When you finish a session

Per the Session Operating Manual:

1. **Produce a concrete artifact.** Code that builds and tests that pass,
   or a document, or a verified decision. No "we discussed" outputs.
2. **Name what's next.** Concrete next deliverable, not a vague direction.
3. **Capture what's unresolved.** Update `VERIFICATION_BACKLOG.md` or open
   a new section in handoff if you discovered gaps.
4. **Run the checks.** `pnpm run lint && pnpm run typecheck && pnpm run
test` before declaring done.

## Working style

- **Be direct.** The founder explicitly asks for honest, critical analysis
  over validation. Push back when something is wrong; don't cheerlead.
- **Make defensible choices when blocked, and surface them.** If a spec is
  silent on something, pick the most defensible option, document the
  rationale (often a new ADR), and flag it for review.
- **One deliverable per session.** Don't bleed scope. If a finding implies
  a different deliverable, capture it in the backlog and finish the current
  one.
- **No silent guesses.** If you don't know, say you don't know and either
  search the references or ask the user.

## What this repo is _not_

- Not a microservices project. Don't propose extraction without §3.8
  triggers.
- Not a place to put product/marketing content. That lives elsewhere.
- Not a sandbox. Every commit ends up in the platform that real founders
  use.
