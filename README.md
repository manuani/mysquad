# VirtualOffice AI — platform monorepo

The VirtualOffice AI platform. Modular monolith in TypeScript.

This repository is the source of truth for everything that runs on the
backend, plus the mobile and admin web clients. The architecture is locked
to a **modular monolith** per System Architecture v1 (preserved unchanged
in v2): one Node process boots, registers every service module, and serves
all platform traffic from that process. Scaling is by replication, not by
extracting modules.

## Status

All twelve service modules carry real handlers, backed by Postgres with
row-level tenant isolation. The founder-facing surface — AI advisor roster,
meetings, brain, ledger, entitlements, and voice — works end to end; see
`docs/FEATURES.md` for the endpoint-by-endpoint reference.

Voice is the newest capability: speech flows browser → Deepgram → agent
runtime → ElevenLabs and back, with each advisor answering in their own
voice (ADR 013).

Still outstanding: the React Native app (Sprint 1.3.1), the admin web app as
its own bundle (Phase 7 — a working console is served from
`api-server/public/admin` today), and the evaluation harness (Sprint 5.3).
Stripe and Cal.com are wired but unproven against live accounts, pending
credentials.

Two checks exercise a running stack rather than mocks:

```bash
pnpm verify:e2e      # every module's HTTP surface, with a real tenant and session
pnpm verify:voice    # audio in, transcript and spoken advisor replies out
```

## Layout

```
voai-platform/
├── apps/                   # The five §3.7 process types
│   ├── api-server/         # API server pool; modular-monolith boot process. Registers all 12 service modules.
│   ├── worker/             # Background worker pool — BullMQ jobs (brain indexing, Neo4j graph)
│   ├── media-coordinator/  # Real-time audio: Deepgram STT, ElevenLabs TTS, LiveKit publish. Own process on :3001.
│   ├── scheduler/          # Scheduled job runner — morning briefing
│   ├── founder-mobile/     # React Native — populated in Sprint 1.3.1
│   └── admin-web/          # Operations console — served today from api-server/public/admin
├── services/               # Service modules — one per architecture component
│   ├── identity-and-tenancy/ # WorkOS auth + multi-tenant isolation (Sprint 1.2, 1.2.2)
│   ├── meeting/            # Meeting lifecycle and real-time pipeline (Phase 2)
│   ├── brain/              # Eight knowledge domains, three storage modes (Phase 3)
│   ├── ledger/             # Decisions, actions, conflicts (Phase 3)
│   ├── agent-runtime/      # Persona, contributions, sub-agent dispatch (Phases 2 and 4)
│   ├── routing/            # LLM provider routing, four-tier classification (Phases 2 and 5)
│   ├── performance/        # Six performance signals, weekly evaluation (Phase 5)
│   ├── marketplace/        # Three-layer expertise stack (Phase 6)
│   ├── marketplace-metering/  # Four billing models, Stripe metering (Phase 6)
│   ├── notification/       # Briefings, alerts, push (Phase 4 onwards)
│   ├── admin-console-api/  # Operations team API (Phase 7)
│   └── voice-gateway/      # LiveKit rooms and participant tokens (see ADR 013)
├── packages/               # Shared libraries used by every service module
│   ├── types/              # Module contract: ModuleDefinition, ModuleHandle, ModuleContext
│   ├── config/             # Env-driven configuration with zod validation
│   ├── telemetry/          # Structured JSON logging; OTel hooks added in Phase 8
│   ├── auth-context/       # Tenant and user context, passed explicitly — never via a side channel (ADR 007)
│   ├── errors/             # Typed error hierarchy mapped to HTTP responses
│   ├── events/             # Internal event bus (in-process at v1; Postgres LISTEN/NOTIFY later)
│   └── db/                 # Postgres + Neo4j + Redis + object store clients, and health probes
├── infra/
│   ├── docker/             # Local dev stack: Postgres+pgvector, Neo4j, Redis, MinIO (populated)
│   └── terraform/          # IaC for AWS staging, ap-south-1 (populated)
├── evals/                  # Evaluation harness — populated in Sprint 5.3
├── docs/
│   └── adr/                # Architecture Decision Records (see docs/adr/README.md)
└── scripts/                # Repo automation
```

## Module contract

Every service module exports a `ModuleDefinition`:

```ts
export interface ModuleDefinition {
  readonly name: string;
  readonly register: (ctx: ModuleContext) => Promise<ModuleHandle>;
}
```

The API server calls `register()` on each module in dependency order, mounts
the returned router at `/v1/<module-name>`, and aggregates per-module health
into a top-level `/healthz` endpoint. Modules talk to each other through their
typed service exports — never by reaching into another module's internals.

The full contract is in `packages/types/src/module.ts`. The smoke test in
`apps/api-server/tests/registration.test.ts` exercises it for every module.

## Getting started

### Prerequisites

- Node 20.11.0 (`nvm use` picks it up from `.nvmrc`)
- pnpm 9.12.0+ (`npm install -g pnpm@9`)

### First time

```bash
pnpm install
pnpm run build
pnpm run test
```

Expected output: 24 build tasks, then 44 test tasks, all succeeding.

### Day-to-day commands

```bash
pnpm run dev          # tsc --watch across all workspaces
pnpm run lint         # eslint everywhere
pnpm run typecheck    # tsc --noEmit everywhere
pnpm run test         # vitest run everywhere
pnpm run format       # prettier --write everywhere
```

### Running the platform locally

```bash
pnpm run docker:up       # Postgres+pgvector, Neo4j, Redis, MinIO
cp .env.example .env.local   # defaults already match docker-compose
set -a && source .env.local && set +a
pnpm run db:migrate
pnpm run db:seed         # test tenant + confirms RLS blocks cross-tenant reads
pnpm run build
node --env-file=.env.local apps/api-server/dist/index.js
```

The API server on `:3000` serves everything except real-time audio. Voice
needs the media coordinator running alongside it as a second process — the
meeting UI connects to it directly, so without it a room opens but nobody
hears anything:

```bash
node --env-file=.env.local apps/media-coordinator/dist/index.js
```

Then `http://localhost:3000/meeting/` for voice, or `/demo` for the typed
UI. `GET /healthz` reports each module's real dependency state and returns
503 when a required one is unreachable, so it is a genuine readiness signal
rather than a liveness ping.

See `infra/README.md` for the full quickstart, including why migrations
and the running application connect as two different Postgres roles
(`docs/adr/010-local-dev-database-stack.md`).

## Naming conventions

- **Workspace names:** `@voai/<kebab-case>` (e.g. `@voai/agent-runtime`).
- **Files:** `kebab-case.ts` for modules, `kebab-case.test.ts` for tests.
- **TypeScript:** `camelCase` for variables and functions, `PascalCase` for
  types and classes, `SCREAMING_SNAKE_CASE` for top-level constants.
- **Database:** `snake_case` for tables and columns (matches the Architecture
  v2 data model).
- **Routes:** `/v1/<module>/<resource>` (e.g. `/v1/meeting/sessions`).

## Source of truth for decisions

Architectural choices made while building this skeleton are captured in
`docs/adr/`. Read those before pushing back on the structure — the
rationale is there. New decisions get a new ADR with the next number.

## What's intentionally not here yet

- Mobile app (Sprint 1.3.1) — `apps/founder-mobile` is still empty
- Admin web as its own bundle (Phase 7) — the console is served from
  `apps/api-server/public/admin` for now
- Evaluation harness (Sprint 5.3)
- Live Stripe and Cal.com integration — the code paths exist and are tested
  against mocks, but have never run against real accounts

The structure above accommodates each of these without restructuring.
