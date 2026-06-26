# @voai/brain

Brain Service.

The eight knowledge domains stored across Postgres (structured), pgvector (semantic), and Neo4j (relationship graph). Ingestion from sessions, documents, integrations. Three query modes: semantic retrieval, structured metric, real-time contradiction check (P95 brain query target < 800ms).

## Sprint reference

Phase 3, Sprint 3.1 — Brain capture and storage

## Module contract

This service exports a `ModuleDefinition` (from `@voai/types`). The API
gateway registers it at boot. Other services that need to call this one import
the typed service from `@voai/brain` — never reach into internal files.

## Status

Skeleton only. See `src/index.ts` for the placeholder handler and
`tests/smoke.test.ts` for the registration contract test.
