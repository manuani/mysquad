# ADR 012: Hosting on AWS, primary region in India

- Status: Accepted, compute amended 2026-06-29 (see "Amendment" below)
- Date: 2026-06-28
- Deciders: founder, lead engineer (pending sign-off)

## Context

System Architecture §9 (cloud provider) was explicitly left blank at
skeleton stage — `docs/handoff/FIRST_SESSIONS.md` Session D named this a
"build-start decision we need to make now," deferred until Sprint 1.1.3
(staging deployment pipeline). It cannot stay deferred once that sprint
starts: Terraform, the staging environment, and the deploy pipeline all
depend on which cloud is chosen.

Constraints supplied by the founder:
- Open to an Indian provider, AWS, or Azure.
- Optimize for the combination of running cost and maintenance cost, not
  running cost alone — the team is very small (per Strategic Vision
  §11.1, 9-11 people total, most non-infra roles).
- Vendor tooling and UX need to be good, because there is no dedicated
  infra/platform hire at launch.
- DPDPA implementation is a named v1 launch quality bar (Platform
  Specification §13.2) and India is the priority market (Strategic
  Vision §5.1) — data residency and latency to Indian users both matter.

## Options considered

### Option A — A niche/regional Indian cloud provider

Satisfies data-residency and latency directly; may appeal on local
support, INR billing, or specific compliance empanelment needs.

Trade-offs: materially shallower managed-service depth than AWS/Azure.
Postgres with pgvector support, managed Redis, S3-equivalent object
storage with presigned URLs, and mature Terraform providers are not
uniformly available at the same quality bar. For a team with no
dedicated infra hire, this concretely means self-managing more
infrastructure (patching, backups, scaling Postgres/Redis on raw VMs)
— directly contradicting the "optimize for maintenance cost, small
team" constraint. Rejected on this basis, not on data-residency grounds
(which AWS/Azure regions in India address regardless).

### Option B — Azure, India region (Central/South/West India)

Container Apps offers a genuinely simpler small-team deploy experience
than AWS's ECS/Fargate — scale-to-zero, consumption pricing, less
Terraform/networking surface area to own (no VPC/ALB/target-group setup
required to get a single container running). Azure Database for
PostgreSQL Flexible Server supports pgvector; Azure Cache for Redis is
mature.

Trade-offs: `packages/db/src/object-store.ts` is already written against
`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (ADR 010's local
dev stack uses MinIO specifically for S3-API parity with production).
Azure Blob Storage's API is different — moving to Azure means either a
second `ObjectStoreClient` implementation or an S3-compatibility shim in
front of Blob, both adding code and operational surface for no
corresponding benefit. AWS also has the larger engineering talent pool
in India specifically, which matters for a team expecting to hire
fractional or contract infra help rather than carrying a dedicated
platform engineer.

### Option C — AWS, India region (Mumbai `ap-south-1` primary)

Matches the object-store code already written. RDS for PostgreSQL
supports pgvector. ElastiCache for Redis is mature. App Runner gives an
Azure-Container-Apps-comparable low-ops deploy experience for the API
server pool, with Fargate as a documented upgrade path if more
networking control is needed later. Largest Terraform community and
talent pool of the three options, which lowers both maintenance cost and
hiring risk for a small team.

## Decision

**AWS**, primary region **Mumbai (`ap-south-1`)**, with **Hyderabad
(`ap-south-2`)** as the documented DR/secondary-region option if
in-country redundancy is needed later (not built at v1 — a future
Terraform decision, not a blocker now).

Service mapping for the platform's five data stores (System Architecture
§4.1) plus compute:

| Concern | AWS service | Notes |
| --- | --- | --- |
| API server pool compute | ECS on Fargate + ALB | App Runner was the original choice but is closed to new AWS customers as of 2026-04-30 (see Amendment below) |
| Postgres + pgvector | RDS for PostgreSQL | pgvector supported on RDS Postgres 15+ |
| Redis | ElastiCache for Redis | |
| Object store | S3 | Zero-friction match to existing `@aws-sdk/client-s3` code and MinIO-based local dev parity (ADR 010) |
| Graph (Neo4j) | Neo4j AuraDB | Cloud-agnostic managed SaaS, independent of this cloud-provider decision — already named in System Architecture §4.1 |

## Rationale

The "hosted in India" requirement and the "good vendor tooling, small
team" requirement are not in tension once regional presence is separated
from provider choice: AWS's Mumbai/Hyderabad regions satisfy residency
and latency without trading away managed-service maturity. Between AWS
and Azure specifically, the object-store code already committed in Wave
1/2 (`@voai/db`) tips the decision concretely rather than abstractly —
Azure would mean writing and maintaining a second storage adapter for no
functional gain. AWS's larger Indian talent pool is the second concrete
factor for a team without a dedicated infra hire.

## Consequences

- Sprint 1.1.3 (staging deployment pipeline) builds Terraform against
  AWS, region `ap-south-1`, not a multi-cloud abstraction — per ADR 003's
  general principle, build for what's decided, not for hypothetical
  portability.
- `infra/terraform/` (currently a placeholder per `infra/README.md`)
  targets AWS provider resources when populated.
- No code changes required now — `packages/db`'s `ObjectStoreClient` is
  already S3-API-shaped; this ADR confirms that choice was forward-
  compatible with the eventual hosting decision rather than requiring
  rework.
- DPDPA data-residency requirements (Platform Spec §13.2) are satisfied
  by region selection, not by provider choice — worth confirming with
  counsel during Sprint 1.1.3 that residency obligations are fully met by
  "data stored in `ap-south-1`" rather than requiring anything further.

## Amendment — 2026-06-29: App Runner replaced by ECS Fargate + ALB

Discovered while running the actual first `terraform apply` against a
real AWS account: **AWS App Runner stopped accepting new customers as of
April 30, 2026.** This is not a quota, activation delay, or IAM gap — the
service is closed to any account that wasn't already using it. The
`SubscriptionRequiredException` returned by `CreateVpcConnector` is AWS's
permanent signal for this, not a transient one. AWS's own guidance
(returned in-console) points to **Amazon ECS with Fargate** (specifically
naming "ECS Express Mode" as the closest equivalent low-ops experience)
as the replacement.

This was not knowable when the original decision was made — App Runner
was open to new customers as of this ADR's original date one day
earlier. It's exactly the kind of platform-availability change the
original "Revisit triggers" section anticipated in spirit ("if AWS...
service availability... changes materially") even though no one
predicted this specific mechanism.

**Updated decision:** compute is **ECS on Fargate**, fronted by an
Application Load Balancer (`infra/terraform/ecs.tf`), not App Runner.
This is the upgrade path the original ADR already named as acceptable
("Fargate as a documented upgrade path if more networking control is
needed later") — moved up from "later" to "now," for a different reason
than originally anticipated (closed access, not a networking-control
need). The service mapping table below is updated accordingly. Nothing
else in this ADR's reasoning (region, RDS, ElastiCache, S3, Neo4j AuraDB)
changes.

Consequence for ops burden: Fargate + ALB is a real increase in
Terraform/networking surface area versus App Runner (target groups,
listener, task definitions, an ECS cluster) — exactly the tradeoff this
ADR originally weighed App Runner against and chose to avoid. That
tradeoff is no longer available to choose; this is the cost of the
platform change, not a reconsideration of the original preference.

## Revisit triggers

- If AWS pricing or service availability in `ap-south-1`/`ap-south-2`
  changes materially, or a specific compliance/empanelment requirement
  surfaces that only a local Indian provider satisfies (e.g. a government
  contract requirement), revisit Option A specifically against whatever
  the new constraint actually is.
- If team scale grows enough to justify a dedicated infra/platform hire,
  re-evaluate whether Fargate (or even self-managed Kubernetes) is
  justified over App Runner — that hire changes the "optimize for
  maintenance cost given a tiny team" premise this ADR is built on.
- If a future object-storage requirement needs an AWS-specific feature
  Azure Blob lacks (or vice versa), that's a narrower decision than this
  ADR — re-evaluate the specific feature gap, not the whole hosting
  choice.
