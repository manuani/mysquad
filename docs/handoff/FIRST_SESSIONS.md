# First-session prompts

Ready-to-paste prompts for the early sessions in Claude Code. Copy the
prompt for the session you're starting, paste it after running `claude` in
the repo root, and let Claude Code drive.

---

## Session A — Verification (do this FIRST)

Confirms Claude Code can read the repo and understands the operating rules
before any code changes. About 5 minutes.

```
Read CLAUDE.md and confirm the architecture rules you'll apply, especially
the §8.1.1 explicit-tenancy mandate. Then read
docs/handoff/VERIFICATION_BACKLOG.md and give me a one-paragraph summary of
each of the six issues in priority order, with no code changes yet.
```

Expected output: a short structured summary. No file edits. If Claude Code
tries to start fixing things, stop it — that's the next session.

---

## Session B — Apply sync corrections to Deliverable 1.1.1

The first real coding session. Fixes the six gaps from the verification
backlog. About 30-90 minutes depending on how much review you do between
issues.

```
Apply all six sync corrections from docs/handoff/VERIFICATION_BACKLOG.md
to bring Deliverable 1.1.1 into alignment with System Architecture v2.

Work them in this order:
  1. Issue 5 (ADR 006 violates §8.1.1) — write ADR 007 superseding ADR 006,
     replace AsyncLocalStorage in @voai/auth-context with explicit
     TenantContext value type, update ModuleContext to thread tenantId.
  2. Issue 6 (PostgresClient missing withTenant) — update @voai/db
     interface; pair with Issue 5 since they're the same architectural
     concern.
  3. Issue 1 (Identity+Tenancy should be one module) — merge directories,
     update gateway MODULES array, update registration test, write ADR
     superseding ADR 004.
  4. Issue 3 (object store missing from @voai/db) — add ObjectStoreClient
     interface.
  5. Issue 2 (Edge Gateway naming) — rename apps/api-gateway to
     apps/api-server, document the rename. Update README.md references.
  6. Issue 4 (missing process types) — add apps/worker, apps/media-coordinator,
     apps/scheduler placeholder workspaces with READMEs.

After each issue:
  - Run pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run test
  - Commit with a clear message referencing the issue

After all six:
  - Update VERIFICATION_BACKLOG.md marking each issue resolved
  - Give me a summary of what changed with a single suggested commit
    message for the full PR
```

Expected output: ~8-12 commits, all green checks, VERIFICATION_BACKLOG.md
showing all six resolved, ready to push.

---

## Session C — Deliverable 1.1.2 (local development environment)

Once Session B is merged. About 60-90 minutes.

```
Start Deliverable 1.1.2: local development environment.

Read docs/reference/Sprint_Plan.md for the Sprint 1.1 deliverables and
docs/reference/System_Architecture.md §4 for the data layer.

Build:
  1. infra/docker/docker-compose.yml bringing up Postgres 16 with pgvector,
     Neo4j 5, Redis 7, and a MinIO container for S3-compatible object
     store local testing.
  2. infra/docker/init/ scripts that create the voai_dev database, enable
     pgvector, create the row-level-security helpers from §8.1.1, and
     set up the per-tenant namespace pattern.
  3. Wire up @voai/db with real client factories: pg.Pool for Postgres,
     neo4j-driver for Neo4j, ioredis for Redis, @aws-sdk/client-s3 for
     object store (S3-compatible, points at MinIO locally).
  4. Implement the withTenant pattern from Issue 6 — acquire a connection,
     SET LOCAL app.tenant_id, run the callback, release.
  5. Add a baseline migration runner. Use node-pg-migrate or drizzle-kit
     (you choose; document the choice in an ADR).
  6. Seed script that creates a test tenant, test user, and confirms
     row-level security blocks cross-tenant queries.

Verification:
  - docker compose up brings everything healthy
  - pnpm run db:migrate creates the baseline schema
  - pnpm run db:seed produces a working test tenant
  - pnpm run test:integration (new task) runs a cross-tenant boundary
    test and confirms row-level security blocks the leak

Deliverable: a fresh clone + docker compose up + pnpm install + pnpm
run db:migrate gets a developer to a working local environment with
verified tenant isolation.
```

---

## Session D — Deliverable 1.1.3 (staging deployment pipeline)

Read the Sprint Plan for scope. Likely involves Terraform + GitHub Actions.

```
Start Deliverable 1.1.3: staging deployment pipeline.

Before writing code:
  1. Read docs/reference/Sprint_Plan.md for 1.1.3 scope.
  2. Read docs/reference/System_Architecture.md §3.7 (deployment topology)
     and §9.1 (cloud provider — note §9 is mostly empty in the doc; this
     means cloud choice is a build-start decision and we need to make it
     now).
  3. Propose: cloud provider (AWS or GCP) with concrete reasoning, with
     IaC tool (Terraform vs Pulumi vs CDK), and the staging deployment
     shape. Stop and wait for my approval before generating code.

Once approved:
  - Populate infra/terraform/ (or chosen IaC) with the staging environment
  - Add .github/workflows/deploy-staging.yml that builds, runs CI, and
    deploys on push to main
  - Document the deploy process in infra/README.md
```

---

## Style notes for any session

- **Be explicit about scope.** "Apply Issue 5 only" is better than "fix
  the auth-context stuff."
- **Ask Claude Code to explain before changing.** "Before editing, tell
  me which files you'll touch and why." Cheap insurance.
- **Reject suggestions you don't like.** Claude Code doesn't have ego.
  "Don't add a singleton; thread it explicitly" — fine.
- **Don't paste documents into the prompt.** Tell Claude Code to read
  the file: "Read docs/reference/System_Architecture.md §4."

## When to start a new chat vs continue in one

In Claude Code:

- **One Claude Code session per deliverable.** Start a new one (`exit`
  then `claude` again) when moving to a new deliverable.
- **Long sessions degrade.** If you've been going for an hour and the
  responses are getting confused, save with a commit, exit, restart.
- **The reference docs and CLAUDE.md carry context** — restart doesn't
  lose anything that matters.
