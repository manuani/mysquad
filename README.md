# VirtualOffice AI — platform monorepo

The VirtualOffice AI platform. Modular monolith in TypeScript.

This repository is the source of truth for everything that runs on the
backend, plus the mobile and admin web clients. The architecture is locked
to a **modular monolith** per System Architecture v1 (preserved unchanged
in v2): one Node process boots, registers every service module, and serves
all platform traffic from that process. Scaling is by replication, not by
extracting modules.

## Status

Skeleton — Deliverable 1.1.1 from the Sprint Plan (Phase 1, Sprint 1.1).
Build passes, tests pass, the modular-monolith registration contract is
exercised end-to-end. No business logic is implemented yet — every service
module exposes a `/healthz` route and a contract test, and that is all.

Subsequent deliverables fill in the modules. The boot order, module
contract, and shared infrastructure are stable from this skeleton forward.

## Layout

```
voai-platform/
├── apps/                   # The five §3.7 process types
│   ├── api-server/         # API server pool; modular-monolith boot process. Registers all 11 service modules.
│   ├── worker/             # Background worker pool — placeholder, populated when first job lands
│   ├── media-coordinator/  # Media coordinator pool — placeholder, populated in Phase 2
│   ├── scheduler/          # Scheduled job runner — placeholder, populated when first cron job lands
│   ├── founder-mobile/     # React Native — populated in Sprint 1.3.1
│   └── admin-web/          # Operations console — populated in Phase 7
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
│   └── admin-console-api/  # Operations team API (Phase 7)
├── packages/               # Shared libraries used by every service module
│   ├── types/              # Module contract: ModuleDefinition, ModuleHandle, ModuleContext
│   ├── config/             # Env-driven configuration with zod validation
│   ├── telemetry/          # Structured JSON logging; OTel hooks added in Phase 8
│   ├── auth-context/       # Tenant and user context propagation via AsyncLocalStorage
│   ├── errors/             # Typed error hierarchy mapped to HTTP responses
│   ├── events/             # Internal event bus (in-process at v1; Postgres LISTEN/NOTIFY later)
│   └── db/                 # Postgres + Neo4j + Redis client factories — wired in Sprint 1.1.2
├── infra/
│   ├── terraform/          # IaC for staging and production — populated in Sprint 1.1.3
│   └── docker/             # Docker Compose for local dev — populated in Sprint 1.1.2
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

Expected output: 37 Turborepo tasks succeed.

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
cp .env.example .env.local
# Fill in DATABASE_URL, NEO4J_URI, etc.
pnpm run build
node apps/api-server/dist/index.js
```

Note: end-to-end local boot needs Postgres, Neo4j, and Redis running. Sprint
1.1.2 lands the Docker Compose setup that brings those up automatically.

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

- Database wiring (Sprint 1.1.2)
- Local Docker Compose (Sprint 1.1.2)
- Staging deployment (Sprint 1.1.3)
- Mobile app (Sprint 1.3.1)
- Admin web app (Phase 7)
- Real handlers in any service (filled by their owning sprints)

The structure above accommodates each of these without restructuring.
