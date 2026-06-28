# @voai/meeting

Meeting Service.

Meeting lifecycle, transcript persistence. Owns the meeting state machine.

## Sprint reference

Phase 2 — Single-Agent Meeting (Sprints 2.1-2.3), Deliverable 2.3.2
(End-to-end meeting flow).

## Module contract

This service exports a `ModuleDefinition` (from `@voai/types`). The API
gateway registers it at boot. Other services that need to call this one import
the typed service from `@voai/meeting` — never reach into internal files.

## Status

### Implemented

- **Lifecycle state machine**: `started -> active -> ended`. A session
  starts `started`; the first transcript entry appended implicitly
  transitions it to `active` (a meeting becomes "active" the moment
  conversation actually starts); ending is a terminal transition, always
  triggered by an explicit founder action (no automatic end trigger in v1).
  Application-level guards (matching `services/ledger/src/decisions.ts`'s
  pattern) reject invalid transitions: cannot append a transcript entry to
  an ended session, cannot end an already-ended session.
- **Transcript persistence**: typed-mode entries only, attributed to
  `founder` or `agent`, ordered by an application-assigned
  `sequence_number` per session.
- **Storage**: extends the baseline `sessions` table
  (`packages/db/migrations/1750000000005_meeting.sql`) with `status`,
  `mode`, `ended_at`; adds `transcript_entries`. Both tenant-scoped tables
  have row-level security (`ENABLE` + `FORCE` + `tenant_isolation` policy,
  per ADR 010/§8.1.1 layer 4). All access goes through
  `postgres.withTenant(...)` — no raw queries.
- **HTTP routes** (mounted at `/v1/meeting/...`):
  - `POST /sessions` — start a meeting
  - `GET /sessions/:id` — read session state
  - `POST /sessions/:id/transcript` — append a transcript entry
  - `GET /sessions/:id/transcript` — read the full transcript, in order
  - `POST /sessions/:id/end` — end the meeting
  - Tenant context is resolved from `x-tenant-id` / `x-user-id` /
    `x-user-type` / `x-session-id` headers (no gateway auth middleware
    exists yet — same pattern as `services/brain/src/routes.ts` and
    `services/ledger/src/routes.ts`).
- Unexpected (non-`PlatformError`) errors in routes are logged via the
  module's `Logger` before returning a 500 — no silent catch blocks.

### Deferred

- **Real-time pipeline coordination** (LiveKit, STT, TTS) — needs Sprint
  2.2 external credentials that don't exist in this environment. Only
  **typed mode** is usable; `voice` and `mixed` are modeled at the schema
  level (`mode` column, `CHECK` constraint) so a later migration isn't
  needed to widen the column, but the application layer rejects them today
  (`ValidationError`) until that infra lands.
- **Time-based and participant-leave end triggers** — both need real-time
  infra excluded from this deliverable. v1 only supports the founder
  explicitly ending a meeting via `POST /sessions/:id/end`.
- **Agent contribution integration** — `services/agent-runtime` is being
  built concurrently in this same wave; this module does not call it.
  Agent turns can be appended to the transcript via the same
  `POST /sessions/:id/transcript` endpoint (with `speakerType: "agent"`),
  but nothing here automatically invokes agent-runtime or routing to
  generate that content.
- **Mobile UI** — separate deliverable, client-surface concern.

See `src/sessions.ts` and `src/transcript.ts` for the state machine and
persistence logic, `src/routes.ts` for the HTTP surface, and
`tests/` for unit coverage (in-memory fake Postgres, modeled on
`services/ledger/tests/fake-postgres.ts`) plus `tests/smoke.test.ts` for the
registration contract test.
