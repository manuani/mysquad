# ADR 004: Service module list at v1 skeleton

- Status: Accepted
- Date: 2026-05-03
- Deciders: founder, lead engineer (pending sign-off)

## Context

System Architecture v2 §2 says: "The v1 System Architecture specified ten
major components plus three client surfaces. v2 adds the Admin Console as
the eleventh component and the Marketplace Metering Service as a
sub-component within the Marketplace Service."

The v1 component list is not in project knowledge at the time of this
skeleton. The names of the components must be inferred from the references
in the Sprint Plan and Platform Specification v2.

## Options considered

### Option A — Wait for System Architecture v1 to be added to project knowledge

Cannot proceed with Deliverable 1.1.1 until then.

### Option B — Infer the component list from references in v2, the Sprint

Plan, and Platform Spec v2

The Sprint Plan repeatedly references "System Architecture v1 section on
X" for: Identity Service (Sprint 1.2), Real-time Meeting Pipeline (Sprint
2.2), Agent Runtime and Routing (Sprint 2.1), Brain Service (Sprint 3.1),
Performance Service and Learning Loop (Sprint 5.3), Routing Service
(Sprint 5.1).

Platform Spec v2 and Architecture v2 add: Marketplace Service, Marketplace
Metering Service (sub), Admin Console (eleventh component), Pricing Rules
Engine (cross-cutting), Notification (implied by morning briefings and
hand-raise).

Cross-referencing and counting: identity, tenancy, meeting, brain, ledger,
agent-runtime, routing, performance, marketplace, notification — that's
ten components. Plus admin-console-api as the eleventh. Plus
marketplace-metering as the sub-component. Total of 12 service modules
(`services/*`).

## Decision

**Option B.** The skeleton is built with these 12 service modules:

| Module                 | v1 component or v2 addition             |
| ---------------------- | --------------------------------------- |
| `identity`             | v1 component (Identity Service)         |
| `tenancy`              | v1 component (multi-tenancy layer)      |
| `meeting`              | v1 component (Real-time Meeting)        |
| `brain`                | v1 component (Brain Service)            |
| `ledger`               | v1 component (Ledger)                   |
| `agent-runtime`        | v1 component (Agent Runtime)            |
| `routing`              | v1 component (Routing Service)          |
| `performance`          | v1 component (Performance Service)      |
| `marketplace`          | v1 component (Marketplace Service)      |
| `marketplace-metering` | v2 sub-component (Architecture v2 §2.2) |
| `notification`         | v1 component (implied by briefings)     |
| `admin-console-api`    | v2 addition (Architecture v2 §2.1)      |

Pricing Rules Engine is treated as a sub-component of `marketplace` rather
than a standalone module, because Architecture v2 §6.1 places pricing
operations under Operations admin scope and the schema (Architecture v2
§4.2) is a small set of tables. If it grows, it can be split later — see
ADR 003's revisit triggers.

## Rationale

The build cannot wait. Twelve modules is the minimum that covers every
documented component without bundling things that have separate sprints
(notification, performance, admin-console-api) into a generic "core"
module.

## Consequences

- The 12 modules are wired into `apps/api-gateway/src/index.ts` in
  dependency order.
- The registration test in the api-gateway enforces all 12 are present
  and conform to the contract.
- If v1 lists a thirteenth component or splits one of these differently,
  this ADR is superseded by a new ADR and the structure is updated.

## Revisit triggers

- System Architecture v1 added to project knowledge — first action is to
  cross-check this list against §3 and §4 of v1.
- A sprint references a service that is not on this list — surfaces the
  gap immediately.
- Pricing Rules Engine grows past a few tables and a small set of admin
  endpoints — split it out to its own module.
