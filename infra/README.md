# Infrastructure

## Layout

- `terraform/` — Infrastructure-as-Code for staging and production.
  Populated in Sprint 1.1.3 (Staging deployment pipeline). Cloud provider
  is AWS, primary region `ap-south-1` (Mumbai) — see
  `docs/adr/012-hosting-aws-india-region.md`.
- `docker/` — Local-development Docker Compose for Postgres (pgvector),
  Neo4j, Redis, and MinIO (S3-compatible object store). Populated in
  Deliverable 1.1.2 (Local development environment).

## Status

`docker/` is populated. `terraform/` is still a placeholder, pending
Sprint 1.1.3 — the cloud provider decision is made (ADR 012); the
Terraform itself is not yet written.

## Local development quickstart

```bash
pnpm run docker:up       # Postgres, Neo4j, Redis, MinIO
cp .env.example .env.local
# .env.local needs no edits for local dev — defaults match docker-compose.

# Migrations run as the superuser role (DDL privileges); the app runs as
# a separate non-superuser role subject to row-level security. See
# docs/adr/010-local-dev-database-stack.md for why these must stay split.
set -a && source .env.local && set +a
pnpm run db:migrate
pnpm run db:seed         # creates a test tenant, confirms RLS blocks cross-tenant reads

pnpm run build
node apps/api-server/dist/index.js
```

`pnpm run test:integration` runs `packages/db/tests/integration/` against
the live stack (same RLS boundary check as `db:seed`, as an automated
test rather than a one-off script).

`pnpm run docker:down` tears the stack down; data persists in named
Docker volumes between runs (`pnpm run docker:down --volumes` to wipe
them, run manually since it's destructive).
