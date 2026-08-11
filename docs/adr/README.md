# Architecture Decision Records

Each ADR records a technical decision made during the build. The format is
deliberately short: context, options considered, decision, consequences.

ADRs are immutable once accepted. If a decision is reversed, write a new ADR
that supersedes the old one — keep both in the repo so the history of why is
preserved.

## Index

| #   | Title                                                                                                         | Status                    |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 001 | [TypeScript on Node 20 LTS for backend services](001-typescript-on-node.md)                                   | Accepted                  |
| 002 | [pnpm workspaces and Turborepo for monorepo tooling](002-pnpm-turborepo.md)                                   | Accepted                  |
| 003 | [Modular monolith with in-process module registration](003-modular-monolith.md)                               | Accepted                  |
| 004 | [Service module list at v1 skeleton](004-service-module-list.md)                                              | Superseded by 008         |
| 005 | [Express for HTTP routing at v1](005-express-at-v1.md)                                                        | Accepted                  |
| 006 | [Tenant and user context propagation via AsyncLocalStorage](006-async-local-storage-context.md)               | Superseded by 007         |
| 007 | [Explicit TenantContext value type, superseding ADR 006](007-explicit-tenant-context.md)                      | Accepted (supersedes 006) |
| 008 | [Merge Identity and Tenancy into one module, superseding ADR 004's count](008-merge-identity-and-tenancy.md)  | Accepted (supersedes 004) |
| 009 | [Rename apps/api-gateway to apps/api-server](009-rename-api-gateway.md)                                       | Accepted                  |
| 010 | [Local dev database stack — migration tool and the app-role/superuser split](010-local-dev-database-stack.md) | Accepted                  |
| 011 | [In-house multi-agent orchestration, not LangGraph](011-in-house-multi-agent-orchestration.md)                | Accepted                  |
| 012 | [Hosting on AWS, primary region in India](012-hosting-aws-india-region.md)                                    | Accepted (amended)        |
| 013 | [Browser-side audio capture and TTS delivery](013-browser-side-audio-capture-and-tts-delivery.md)             | Accepted                  |
| 014 | [Health checks probe real dependencies](014-dependency-probing-health-checks.md)                              | Accepted                  |

## How to add an ADR

1. Copy the next number (007, 008, ...).
2. Use the template in `_template.md`.
3. Open a PR for review by the lead engineer.
4. On merge, update the index above.

## Conventions

- One decision per ADR. If you find yourself describing two, split them.
- Keep ADRs short. If you need more than two pages, you are explaining
  rather than deciding.
- Date in the ADR header is the date the decision was made, not the date
  it was written.
