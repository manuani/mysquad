# @voai/db

Database client contracts for Postgres (pgvector), Neo4j, and Redis.
Concrete wiring (`pg.Pool`, `neo4j-driver`, `ioredis`) lands in Sprint
1.1.2; this package currently exposes the type-level contract every
service module compiles against.

## The `withTenant` pattern

`PostgresClient` has no `query` method. Postgres access only happens
inside `withTenant`:

```ts
const rows = await db.postgres.withTenant(tenantContext.tenantId, async (client) => {
  return client.query<Decision>('select * from decisions where status = $1', ['active']);
});
```

Per System Architecture §8.1.1 layer 3, the connection has
`SET LOCAL app.tenant_id = $1` applied immediately on acquisition, before
`fn` runs — so every row-level-security policy (layer 4) reading
`current_setting('app.tenant_id')` is correctly scoped for every query
inside the callback. `SET LOCAL` is transaction-scoped, so the setting is
discarded when the connection is released back to the pool; it can never
leak to the next caller that borrows the same connection.

There is intentionally no escape hatch that returns a raw, tenant-unaware
connection. If a function holds a `TenantScopedClient`, it got it by going
through `withTenant`, and the tenant boundary was already enforced before
that function ran.

See `docs/adr/007-explicit-tenant-context.md` for the related decision on
how `tenantId` itself is threaded into call sites (explicit parameter, not
ambient state).
