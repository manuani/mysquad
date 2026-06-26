# ADR 010: Local dev database stack — migration tool and the app-role/superuser split

- Status: Accepted
- Date: 2026-06-26
- Deciders: lead engineer (pending sign-off)

## Context

Deliverable 1.1.2 (Sprint 1.1, per `docs/handoff/FIRST_SESSIONS.md` Session
C) wires the local development environment: Docker Compose for Postgres
(pgvector), Neo4j, Redis, and MinIO; real client factories in `@voai/db`;
a migration runner; and a seed script that proves row-level security
enforces the tenant boundary from System Architecture §8.1.1.

Two decisions needed making that the Sprint Plan and Architecture don't
settle directly: which migration tool, and — discovered only while
verifying the seed script — how the database connection role is set up.

## Decision 1 — Migration tool: node-pg-migrate, SQL-language migrations

### Options considered

**node-pg-migrate** (chosen) vs. **drizzle-kit** (the Sprint Plan's other
named option) vs. a hand-rolled runner.

drizzle-kit couples migrations to a TypeScript schema definition file that
becomes the source of truth ORM-style; that's a heavier commitment at the
skeleton stage, before any service module has real persistence
requirements to model. node-pg-migrate runs plain `.sql` files with `--
Up Migration` / `-- Down Migration` markers, which keeps the migration
format identical to the SQL already embedded in System Architecture
§4.3's schema examples — copy the architecture doc's CREATE TABLE
statement directly into a migration file, no translation layer.

### Decision

node-pg-migrate, with `--migration-file-language sql`. Migrations live in
`packages/db/migrations/`, run via `pnpm run db:migrate` /
`pnpm run db:migrate:down` from the repo root (delegating to
`@voai/db`'s `migrate:up`/`migrate:down` scripts).

## Decision 2 — Separate application role from the migration/superuser role

### Context for this decision

While verifying the seed script (`pnpm run db:seed`), the cross-tenant
boundary check failed: a query scoped to tenant B successfully read a row
belonging to tenant A, even with `ENABLE ROW LEVEL SECURITY` and `FORCE
ROW LEVEL SECURITY` both set on the table. Investigation
(`select rolname, rolsuper, rolbypassrls from pg_roles`) showed the
docker-compose `POSTGRES_USER` ("voai") is a Postgres superuser, and
**Postgres superusers bypass row-level security unconditionally** — `FORCE
ROW LEVEL SECURITY` only extends RLS enforcement to the table _owner_; it
does not and cannot extend to superusers or any role with the
`BYPASSRLS` attribute. This is documented Postgres behaviour, not a bug
in this codebase, but it would have silently defeated the entire §8.1.1
layer-4 enforcement mechanism if the application connected as that role
in any environment that provisioned Postgres the same way.

This is exactly the kind of gap the architecture's defense-in-depth model
exists to catch — even with layers 1–3 (explicit context parameters,
`withTenant`, `SET LOCAL`) implemented correctly, layer 4 silently doing
nothing is invisible until something tests for it.

### Decision

Two Postgres roles:

- **`voai`** — superuser, used only by `pnpm run db:migrate` (via
  `MIGRATIONS_DATABASE_URL`). Migrations need DDL privileges (`CREATE
TABLE`, `ALTER TABLE ... ENABLE/FORCE ROW LEVEL SECURITY`) that a
  restricted role shouldn't necessarily hold by default; using the
  superuser for migrations only, never for runtime queries, is a common
  and reasonable split.
- **`voai_app`** — `NOSUPERUSER NOBYPASSRLS`, used by the running
  application and by `@voai/db` (via `DATABASE_URL`). Every row-level
  security policy applies to this role with no exceptions.

Created in `infra/docker/init/postgres/002_app_role.sql`, with `ALTER
DEFAULT PRIVILEGES` so tables created by future migrations (run as
`voai`) are automatically grant-accessible to `voai_app` without a
matching `GRANT` in every migration.

### Consequences

- `.env.example` documents both `DATABASE_URL` (app role) and
  `MIGRATIONS_DATABASE_URL` (superuser, migrations only) with an explicit
  warning about why they must stay separate.
- `packages/db/package.json`'s `migrate:up`/`migrate:down` pass `-d
MIGRATIONS_DATABASE_URL` to node-pg-migrate so migrations never
  accidentally run against the app role (which lacks DDL privileges
  anyway, so this would fail loudly rather than silently — but explicit is
  better than relying on that failure mode).
- `packages/db/migrations/1750000000000_baseline.sql` documents the
  owner-bypass behavior inline, so the next migration author doesn't
  rediscover this by failing the same boundary test.
- Verified end-to-end: `pnpm run db:seed` and
  `packages/db/tests/integration/tenant-boundary.test.ts` both confirm a
  cross-tenant read returns zero rows when connected as `voai_app`, and
  both would have passed silently-wrong if connected as `voai` — this is
  why the boundary check exists as an automated test, not just a one-time
  manual verification.

## Revisit triggers

- If staging/production provisioning (Sprint 1.1.3, Terraform) creates
  the database role differently (e.g. a managed Postgres service's
  default admin role), re-verify that role's `rolsuper`/`rolbypassrls`
  attributes before assuming the same two-role split transfers
  unchanged.
- If a future migration needs to run as `voai_app` for some reason
  (unlikely — DDL needs elevated privileges), reconsider whether RLS
  bypass needs an explicit, audited exception rather than an accidental
  one.
