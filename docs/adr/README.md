# Architecture Decision Records

Each ADR records a technical decision made during the build. The format is
deliberately short: context, options considered, decision, consequences.

ADRs are immutable once accepted. If a decision is reversed, write a new ADR
that supersedes the old one — keep both in the repo so the history of why is
preserved.

## Index

| #   | Title                                          | Status   |
| --- | ---------------------------------------------- | -------- |
| 001 | TypeScript on Node 20 LTS for backend services | Accepted |
| 002 | pnpm workspaces and Turborepo for monorepo     | Accepted |
| 003 | Modular monolith with in-process registration  | Accepted |
| 004 | Service module list at v1 skeleton             | Accepted |
| 005 | Express for HTTP routing at v1                 | Accepted |
| 006 | Tenant context via AsyncLocalStorage           | Accepted |

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
