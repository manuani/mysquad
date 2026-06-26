# ADR 002: pnpm workspaces and Turborepo for monorepo tooling

- Status: Accepted
- Date: 2026-05-03
- Deciders: founder, lead engineer (pending sign-off)

## Context

Per ADR 001 the platform is TypeScript across ~12 service modules, 7 shared
packages, and 3 apps. We need a workspace tool that handles dependency
hoisting cleanly and a build orchestrator that caches per-package output
and runs tasks in dependency order.

## Options considered

### Option A — pnpm workspaces + Turborepo

pnpm has the strictest workspace semantics (no phantom dependencies),
the smallest disk footprint (content-addressable store), and the fastest
install. Turborepo gives per-package task caching, remote cache support,
and topological task scheduling.

### Option B — Yarn workspaces + Nx

Nx is more capable for very large monorepos (100+ packages) and has
stronger codegen and dependency-graph tooling. Yarn 4 workspaces are
solid.

Trade-offs: Nx introduces more conceptual surface area than we need at v1.
The opinionated project structure can fight against the modular monolith
boot pattern.

### Option C — npm workspaces + plain TypeScript project references

Simplest. No third-party orchestrator.

Trade-offs: no per-task caching means CI gets slow as workspaces grow. We
hit the slowdown before Phase 4 most likely.

## Decision

**Option A.** pnpm 9.x workspaces with Turborepo 2.x.

## Rationale

We need the workspace strictness and the task caching, and we need both
now — the skeleton already has 21 workspaces. Turborepo's task graph
matches the dependency order in `apps/api-gateway/src/index.ts` exactly,
so a build of the gateway implies a topologically correct build of every
service it imports. Per-task caching means CI on a one-line PR change to
one service rebuilds and tests only what depends on that service.

Nx would solve the same problems but with more configuration weight. We
can adopt Nx later if we hit a scale where Turborepo no longer fits.

## Consequences

- `pnpm-workspace.yaml` lists `apps/*`, `services/*`, `packages/*`.
- `turbo.json` defines the task pipeline.
- `pnpm install --frozen-lockfile` is the CI install command.
- Adding a new service: create the directory, add a workspace `package.json`,
  add it to `pnpm-workspace.yaml` (already covered by glob), reference it
  from the api-gateway and any consumers. No central registry to update.

## Revisit triggers

- Workspace count over ~75 (Nx becomes more attractive at that scale).
- Need for explicit codegen across many packages (Nx generators).
- Need for remote caching across a CI fleet larger than GitHub Actions
  default runners (Turborepo has remote cache; we may not need it for a
  while).
